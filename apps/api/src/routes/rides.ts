import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { requireAuth } from "../middleware/auth";
import { fullNameOf } from "../lib/mappers";
import { notify } from "../lib/notify";
import { getMotoCommissionPct } from "../lib/settings";

export const ridesRouter = Router();

ridesRouter.use(requireAuth);

// How long the driver has to reach the passenger once the ride is funded
// (measured from the desired departure time when one was given).
export const PICKUP_WINDOW_MS = 10 * 60_000;

function dec(v: Prisma.Decimal | number | null): number | null {
  if (v === null) return null;
  return typeof v === "number" ? v : Number(v.toString());
}

// GPS is mocked platform-wide (see README) — derive a stable pseudo-distance
// from the driver id so the "nearby" list is deterministic instead of
// reshuffling on every poll.
function mockDistanceKm(driverId: string): number {
  let h = 0;
  for (const c of driverId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return Math.round((3 + (h % 27)) * 10) / 100; // 0.30 – 2.90 km
}

const motoDriverWhere = {
  online: true,
  suspended: false,
  vehicle: { is: { type: "MOTO" as const } },
};

// GET /rides/nearby — online moto drivers a passenger can hail
ridesRouter.get(
  "/nearby",
  asyncHandler(async (_req, res) => {
    const drivers = await prisma.driver.findMany({
      where: motoDriverWhere,
      include: { user: true, vehicle: true, operator: true },
      take: 20,
    });
    res.json(
      drivers
        .map((d) => ({
          driverId: d.id,
          name: fullNameOf(d.user),
          rating: d.ratingAvg,
          plate: d.vehicle?.plateNumber ?? "—",
          model: d.vehicle?.model ?? "Moto",
          operator: d.operator?.companyName ?? "Independent",
          distanceKm: mockDistanceKm(d.id),
        }))
        .sort((a, b) => a.distanceKm - b.distanceKm)
    );
  })
);

const createRideSchema = z.object({
  originLabel: z.string().trim().min(1, "Where should the moto pick you up?"),
  destLabel: z.string().trim().min(1, "Where are you going?"),
  offerFare: z.coerce.number().positive().max(100_000).optional(),
  targetDriverId: z.string().optional(),
  // optional desired departure time — anchors the driver's pickup window
  departAt: z.coerce.date().optional(),
});

const ACTIVE_STATUSES = ["OPEN", "ACCEPTED", "CONFIRMED", "IN_PROGRESS", "AWAITING_CONFIRM"] as const;

const rideInclude = {
  targetDriver: { include: { user: true, vehicle: true } },
  acceptedDriver: { include: { user: true, vehicle: true } },
  offers: { where: { status: "PENDING" as const }, include: { driver: { include: { user: true, vehicle: true } } } },
} satisfies Prisma.RideRequestInclude;

type RideWithRels = Prisma.RideRequestGetPayload<{ include: typeof rideInclude }>;

function toRideView(r: RideWithRels) {
  const driver = r.acceptedDriver ?? r.targetDriver;
  const now = Date.now();
  return {
    id: r.id,
    from: r.originLabel,
    to: r.destLabel,
    offerFare: dec(r.offerFare),
    agreedFare: dec(r.agreedFare),
    departAt: r.departAt?.toISOString() ?? null,
    status: r.status,
    targeted: Boolean(r.targetDriverId),
    // funded but re-broadcast — the next driver to accept skips straight to pickup
    prepaid: Boolean(r.paidAt) && r.status === "OPEN",
    paidAt: r.paidAt?.toISOString() ?? null,
    pickupDeadline: r.pickupDeadline?.toISOString() ?? null,
    // the passenger's "driver never came" prompt trigger
    pickupOverdue: r.status === "CONFIRMED" && r.pickupDeadline !== null && r.pickupDeadline.getTime() < now,
    driver: driver
      ? {
          name: fullNameOf(driver.user),
          phone: driver.user.phone,
          rating: driver.ratingAvg,
          plate: driver.vehicle?.plateNumber ?? "—",
          model: driver.vehicle?.model ?? "Moto",
          distanceKm: mockDistanceKm(driver.id),
        }
      : null,
    // pending counter-offers from drivers (bargaining)
    offers: r.status === "OPEN"
      ? r.offers.map((o) => ({
          id: o.id,
          amount: dec(o.amount) ?? 0,
          driverName: fullNameOf(o.driver.user),
          rating: o.driver.ratingAvg,
          plate: o.driver.vehicle?.plateNumber ?? "—",
          distanceKm: mockDistanceKm(o.driverId),
        }))
      : [],
    createdAt: r.createdAt.toISOString(),
    acceptedAt: r.acceptedAt?.toISOString() ?? null,
  };
}

async function loadRideView(id: string): Promise<RideWithRels | null> {
  return prisma.rideRequest.findUnique({ where: { id }, include: rideInclude });
}

// POST /rides — post a ride request: to one specific nearby moto, or (no
// targetDriverId) broadcast to every online moto driver.
ridesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createRideSchema.parse(req.body);
    const passengerId = req.auth!.sub;

    if (body.departAt && body.departAt.getTime() < Date.now() - 60_000) {
      throw new HttpError(400, "Departure time is in the past");
    }

    const active = await prisma.rideRequest.findFirst({
      where: { passengerId, status: { in: [...ACTIVE_STATUSES] } },
    });
    if (active) throw new HttpError(409, "You already have an active moto request — cancel it first");

    if (body.targetDriverId) {
      const target = await prisma.driver.findFirst({ where: { id: body.targetDriverId, ...motoDriverWhere } });
      if (!target) throw new HttpError(409, "That moto is no longer available — pick another or broadcast the request");
    }

    const ride = await prisma.rideRequest.create({
      data: {
        passengerId,
        originLabel: body.originLabel,
        destLabel: body.destLabel,
        offerFare: body.offerFare,
        departAt: body.departAt,
        targetDriverId: body.targetDriverId,
      },
      include: rideInclude,
    });

    if (ride.targetDriver) {
      await notify(ride.targetDriver.userId, "New moto ride request", `${ride.originLabel} → ${ride.destLabel} — a passenger requested you directly.`);
    }

    res.status(201).json(toRideView(ride));
  })
);

// GET /rides/mine — the passenger's current request (or their most recent one,
// so the UI can show "completed / cancelled" once before resetting)
ridesRouter.get(
  "/mine",
  asyncHandler(async (req, res) => {
    const ride = await prisma.rideRequest.findFirst({
      where: { passengerId: req.auth!.sub },
      orderBy: { createdAt: "desc" },
      include: rideInclude,
    });
    res.json(ride ? toRideView(ride) : null);
  })
);

// POST /rides/:id/offers/:offerId/accept — passenger takes a driver's
// counter-offer. Atomic on the ride's OPEN status, so accepting an offer and a
// driver's instant-accept can't both win.
ridesRouter.post(
  "/:id/offers/:offerId/accept",
  asyncHandler(async (req, res) => {
    const ride = await prisma.rideRequest.findUnique({ where: { id: req.params.id } });
    if (!ride || ride.passengerId !== req.auth!.sub) throw new HttpError(404, "Ride request not found");
    const offer = await prisma.rideOffer.findUnique({ where: { id: req.params.offerId }, include: { driver: { include: { user: true } } } });
    if (!offer || offer.rideId !== ride.id || offer.status !== "PENDING") throw new HttpError(404, "Offer not found");

    const claimed = await prisma.rideRequest.updateMany({
      where: { id: ride.id, status: "OPEN" },
      data: {
        status: "ACCEPTED",
        acceptedDriverId: offer.driverId,
        agreedFare: offer.amount,
        acceptedAt: new Date(),
      },
    });
    if (claimed.count === 0) throw new HttpError(409, "This ride is no longer open");

    await prisma.rideOffer.update({ where: { id: offer.id }, data: { status: "ACCEPTED" } });
    await prisma.rideOffer.updateMany({ where: { rideId: ride.id, status: "PENDING" }, data: { status: "DECLINED" } });
    await notify(offer.driver.userId, "Offer accepted", `${ride.originLabel} → ${ride.destLabel} — the passenger took your price. Waiting for their payment.`);

    const fresh = await loadRideView(ride.id);
    res.json(fresh ? toRideView(fresh) : null);
  })
);

// POST /rides/:id/pay — fund the agreed fare from the wallet balance (real
// money: the wallet is the only spending rail — it's funded by real Paypack
// deposits). The money leaves the passenger immediately but is HELD BY THE
// PLATFORM (escrow) — the driver is only paid out, minus commission, after the
// passenger confirms completion.
const payRideSchema = z.object({
  method: z.literal("WALLET").default("WALLET"),
  // Client-generated per-attempt key — retries replay instead of re-charging
  idempotencyKey: z.string().min(8).max(64).optional(),
});
ridesRouter.post(
  "/:id/pay",
  asyncHandler(async (req, res) => {
    const { idempotencyKey } = payRideSchema.parse(req.body);
    const passengerId = req.auth!.sub;

    // Replay: this exact attempt already funded the ride but the response was
    // lost (network retry). Return the funded state — charge nothing.
    if (idempotencyKey) {
      const prior = await prisma.rideRequest.findUnique({ where: { payIdempotencyKey: idempotencyKey } });
      if (prior) {
        if (prior.passengerId !== passengerId || prior.id !== req.params.id) {
          throw new HttpError(409, "Idempotency key already used for a different payment");
        }
        const view = await loadRideView(prior.id);
        return res.json(view ? toRideView(view) : null);
      }
    }

    await prisma.$transaction(async (tx) => {
      const ride = await tx.rideRequest.findUnique({ where: { id: req.params.id } });
      if (!ride || ride.passengerId !== passengerId) throw new HttpError(404, "Ride request not found");
      if (ride.status !== "ACCEPTED") throw new HttpError(409, "This ride isn't awaiting payment");
      const fare = ride.agreedFare;
      if (!fare) throw new HttpError(409, "No agreed fare on this ride");

      // Atomic claim: only one concurrent request can move the ride out of
      // ACCEPTED, so a double-click can never fund the escrow twice (the
      // status check above alone would race under read-committed isolation).
      const paidAt = new Date();
      const anchor = ride.departAt && ride.departAt.getTime() > paidAt.getTime() ? ride.departAt : paidAt;
      const claimed = await tx.rideRequest.updateMany({
        where: { id: ride.id, status: "ACCEPTED" },
        data: {
          status: "CONFIRMED",
          paidAt,
          pickupDeadline: new Date(anchor.getTime() + PICKUP_WINDOW_MS),
          payIdempotencyKey: idempotencyKey,
        },
      });
      if (claimed.count === 0) throw new HttpError(409, "This ride isn't awaiting payment");

      const user = await tx.user.findUnique({ where: { id: passengerId } });
      const balance = new Prisma.Decimal(user!.walletBalance);
      if (balance.lessThan(fare)) {
        throw new HttpError(402, "Insufficient wallet balance — top up your wallet to pay this fare");
      }
      await tx.user.update({ where: { id: passengerId }, data: { walletBalance: balance.minus(fare) } });
      await tx.walletTransaction.create({
        data: { userId: passengerId, kind: "DEBIT", amount: fare, label: `Moto ride escrow · ${ride.originLabel} → ${ride.destLabel}` },
      });
    });

    const fresh = await loadRideView(req.params.id);
    if (fresh?.acceptedDriver) {
      const dl = fresh.pickupDeadline!;
      await notify(
        fresh.acceptedDriver.userId,
        "Ride paid — go pick up",
        `${fresh.originLabel} → ${fresh.destLabel} is funded. Pick up the passenger by ${dl.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}.`
      );
    }
    res.json(fresh ? toRideView(fresh) : null);
  })
);

// POST /rides/:id/rebroadcast — the accepted driver never came (pickup window
// passed): put the still-funded ride back on the open board. The next driver
// to accept goes straight to CONFIRMED with a fresh window — no new payment.
ridesRouter.post(
  "/:id/rebroadcast",
  asyncHandler(async (req, res) => {
    const ride = await prisma.rideRequest.findUnique({ where: { id: req.params.id }, include: rideInclude });
    if (!ride || ride.passengerId !== req.auth!.sub) throw new HttpError(404, "Ride request not found");
    if (ride.status !== "CONFIRMED") throw new HttpError(409, "Only a paid, un-picked-up ride can be re-broadcast");
    if (!ride.pickupDeadline || ride.pickupDeadline.getTime() > Date.now()) {
      throw new HttpError(409, "The driver still has time to arrive — wait for the pickup window to pass");
    }

    const missedDriver = ride.acceptedDriver;
    await prisma.rideRequest.update({
      where: { id: ride.id },
      data: {
        status: "OPEN",
        acceptedDriverId: null,
        acceptedAt: null,
        pickupDeadline: null,
        // broadcast to everyone this time — the targeted driver had their chance
        targetDriverId: null,
      },
    });
    if (missedDriver) {
      await notify(missedDriver.userId, "Ride reassigned", `You didn't reach the pickup in time — ${ride.originLabel} → ${ride.destLabel} was re-opened to other drivers.`);
    }

    const fresh = await loadRideView(ride.id);
    res.json(fresh ? toRideView(fresh) : null);
  })
);

// POST /rides/:id/confirm-complete — the driver said the ride is done; the
// passenger's confirmation is what actually releases the escrow: driver gets
// the fare minus the platform commission (admin-configurable).
ridesRouter.post(
  "/:id/confirm-complete",
  asyncHandler(async (req, res) => {
    const pct = await getMotoCommissionPct();

    const payout = await prisma.$transaction(async (tx) => {
      const ride = await tx.rideRequest.findUnique({ where: { id: req.params.id }, include: { acceptedDriver: { include: { user: true } } } });
      if (!ride || ride.passengerId !== req.auth!.sub) throw new HttpError(404, "Ride request not found");
      if (ride.status !== "AWAITING_CONFIRM") throw new HttpError(409, "The driver hasn't requested completion yet");
      const fare = ride.agreedFare;
      const driver = ride.acceptedDriver;
      if (!fare || !driver) throw new HttpError(409, "Ride has no funded fare/driver");

      const commission = new Prisma.Decimal(fare).mul(pct).div(100).toDecimalPlaces(2);
      const driverShare = new Prisma.Decimal(fare).minus(commission);

      await tx.rideRequest.update({
        where: { id: ride.id },
        data: { status: "COMPLETED", commissionPct: pct, commissionAmount: commission },
      });
      await tx.user.update({
        where: { id: driver.userId },
        data: { walletBalance: new Prisma.Decimal(driver.user.walletBalance).plus(driverShare) },
      });
      await tx.walletTransaction.create({
        data: { userId: driver.userId, kind: "CREDIT", amount: driverShare, label: `Moto ride payout · ${ride.originLabel} → ${ride.destLabel}` },
      });
      return { driverUserId: driver.userId, driverShare: Number(driverShare.toString()), route: `${ride.originLabel} → ${ride.destLabel}` };
    });

    await notify(payout.driverUserId, "Ride payout received", `RWF ${Math.round(payout.driverShare).toLocaleString("en-US")} for ${payout.route} was added to your wallet (after platform commission).`);

    const fresh = await loadRideView(req.params.id);
    res.json(fresh ? toRideView(fresh) : null);
  })
);

// POST /rides/:id/cancel — passenger backs out. If the ride was already funded
// the full escrow is refunded to their wallet; the assigned driver is told.
ridesRouter.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const passengerId = req.auth!.sub;
    const result = await prisma.$transaction(async (tx) => {
      const ride = await tx.rideRequest.findUnique({ where: { id: req.params.id }, include: { acceptedDriver: true } });
      if (!ride || ride.passengerId !== passengerId) throw new HttpError(404, "Ride request not found");
      if (ride.status === "COMPLETED" || ride.status === "CANCELLED") throw new HttpError(409, "This ride is already finished");

      const refund = ride.paidAt && ride.agreedFare ? ride.agreedFare : null;
      await tx.rideRequest.update({
        where: { id: ride.id },
        data: { status: "CANCELLED", refundedAt: refund ? new Date() : undefined },
      });
      if (refund) {
        const user = await tx.user.findUnique({ where: { id: passengerId } });
        await tx.user.update({ where: { id: passengerId }, data: { walletBalance: new Prisma.Decimal(user!.walletBalance).plus(refund) } });
        await tx.walletTransaction.create({
          data: { userId: passengerId, kind: "CREDIT", amount: refund, label: `Moto ride refund · ${ride.originLabel} → ${ride.destLabel}` },
        });
      }
      return { driverUserId: ride.acceptedDriver?.userId ?? null, refunded: Boolean(refund), route: `${ride.originLabel} → ${ride.destLabel}` };
    });

    if (result.driverUserId) {
      await notify(result.driverUserId, "Ride cancelled", `The passenger cancelled ${result.route}.`);
    }
    if (result.refunded) {
      await notify(passengerId, "Ride refunded", `Your payment for ${result.route} was returned to your wallet in full.`);
    }
    res.json({ cancelled: true, refunded: result.refunded });
  })
);
