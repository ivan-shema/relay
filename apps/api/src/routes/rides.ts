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

// How long a driver has to contest a "I wasn't picked up" report before the
// dispute auto-resolves in the passenger's favour.
export const DISPUTE_RESPONSE_WINDOW_MS = 10 * 60_000;

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

const ACTIVE_STATUSES = ["OPEN", "ACCEPTED", "CONFIRMED", "IN_PROGRESS", "AWAITING_CONFIRM", "DISPUTED"] as const;

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
    disputedAt: r.disputedAt?.toISOString() ?? null,
    disputeContested: r.disputeContestedAt !== null,
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

// A driver who ignores a pickup dispute shouldn't hold the passenger's money
// hostage: once the response window passes with no contest, the dispute
// auto-resolves as if the driver acknowledged — back to CONFIRMED with the
// window expired, so the passenger regains keep / re-broadcast / refund.
// Applied lazily on reads (no cron needed); atomic so a concurrent
// contest/withdraw can't be clobbered.
export async function autoResolveStaleDispute(ride: {
  id: string;
  status: string;
  disputedAt: Date | null;
  disputeContestedAt: Date | null;
}): Promise<boolean> {
  if (
    ride.status !== "DISPUTED" ||
    ride.disputeContestedAt !== null ||
    !ride.disputedAt ||
    ride.disputedAt.getTime() + DISPUTE_RESPONSE_WINDOW_MS > Date.now()
  ) {
    return false;
  }
  const updated = await prisma.rideRequest.updateMany({
    where: { id: ride.id, status: "DISPUTED", disputeContestedAt: null },
    data: {
      status: "CONFIRMED",
      pickedUpAt: null,
      completionRequestedAt: null,
      disputedAt: null,
      pickupDeadline: new Date(),
    },
  });
  return updated.count > 0;
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
    let ride = await prisma.rideRequest.findFirst({
      where: { passengerId: req.auth!.sub },
      orderBy: { createdAt: "desc" },
      include: rideInclude,
    });
    if (ride && (await autoResolveStaleDispute(ride))) ride = await loadRideView(ride.id);
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

    // Lock the commission at the moment the price is agreed — a later admin
    // change to the platform rate must not move the payout this driver was
    // shown when they committed.
    const pct = await getMotoCommissionPct();
    const claimed = await prisma.rideRequest.updateMany({
      where: { id: ride.id, status: "OPEN" },
      data: {
        status: "ACCEPTED",
        acceptedDriverId: offer.driverId,
        agreedFare: offer.amount,
        acceptedAt: new Date(),
        commissionPct: pct,
        commissionAmount: new Prisma.Decimal(offer.amount).mul(pct).div(100).toDecimalPlaces(2),
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

// POST /rides/:id/extend — the pickup window expired but the driver actually
// arrived (or is moments away) and just didn't tap "picked up" in time: the
// passenger chooses to keep the same driver, which grants a fresh 10 minutes.
ridesRouter.post(
  "/:id/extend",
  asyncHandler(async (req, res) => {
    const ride = await prisma.rideRequest.findUnique({ where: { id: req.params.id }, include: { acceptedDriver: true } });
    if (!ride || ride.passengerId !== req.auth!.sub) throw new HttpError(404, "Ride request not found");
    if (ride.status !== "CONFIRMED") throw new HttpError(409, "Only a paid, un-picked-up ride can be extended");
    if (!ride.pickupDeadline || ride.pickupDeadline.getTime() > Date.now()) {
      throw new HttpError(409, "The pickup window hasn't expired yet");
    }

    const newDeadline = new Date(Date.now() + PICKUP_WINDOW_MS);
    await prisma.rideRequest.update({ where: { id: ride.id }, data: { pickupDeadline: newDeadline } });
    if (ride.acceptedDriver) {
      await notify(
        ride.acceptedDriver.userId,
        "Passenger is keeping you",
        `${ride.originLabel} → ${ride.destLabel}: the passenger extended your pickup window to ${newDeadline.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}. If you've already picked them up, tap "Passenger picked up".`
      );
    }

    const fresh = await loadRideView(ride.id);
    res.json(fresh ? toRideView(fresh) : null);
  })
);

// POST /rides/:id/report-no-pickup — anti-fraud: the driver tapped "picked up"
// but never actually showed. This does NOT hand the passenger an instant
// refund (a rider could otherwise take the trip, then "report" and claw the
// money back): it freezes the ride in DISPUTED. The driver then acknowledges
// (ride reverts, passenger regains their exits), contests (admin resolves), or
// stays silent for 10 minutes (auto-resolves in the passenger's favour). A
// mis-click is undone with /withdraw-report.
ridesRouter.post(
  "/:id/report-no-pickup",
  asyncHandler(async (req, res) => {
    const ride = await prisma.rideRequest.findUnique({ where: { id: req.params.id }, include: { acceptedDriver: true } });
    if (!ride || ride.passengerId !== req.auth!.sub) throw new HttpError(404, "Ride request not found");
    if (ride.status !== "IN_PROGRESS" && ride.status !== "AWAITING_CONFIRM") {
      throw new HttpError(409, "This ride isn't marked as picked up");
    }

    await prisma.rideRequest.update({
      where: { id: ride.id },
      data: { status: "DISPUTED", disputedAt: new Date(), disputeContestedAt: null },
    });
    if (ride.acceptedDriver) {
      await notify(
        ride.acceptedDriver.userId,
        "Pickup disputed",
        `The passenger reported they were NOT picked up for ${ride.originLabel} → ${ride.destLabel}. Respond in your dashboard within 10 minutes — if you did pick them up, contest it and Relay will review.`
      );
    }

    const fresh = await loadRideView(ride.id);
    res.json(fresh ? toRideView(fresh) : null);
  })
);

// POST /rides/:id/withdraw-report — the passenger's report was a mistake (or a
// mischievous tap): put the ride back to the driver's claimed state. The
// driver's completion request is cleared so they simply re-request at the end.
ridesRouter.post(
  "/:id/withdraw-report",
  asyncHandler(async (req, res) => {
    const ride = await prisma.rideRequest.findUnique({ where: { id: req.params.id }, include: { acceptedDriver: true } });
    if (!ride || ride.passengerId !== req.auth!.sub) throw new HttpError(404, "Ride request not found");

    const undone = await prisma.rideRequest.updateMany({
      where: { id: ride.id, status: "DISPUTED" },
      data: { status: "IN_PROGRESS", disputedAt: null, disputeContestedAt: null, completionRequestedAt: null },
    });
    if (undone.count === 0) throw new HttpError(409, "There is no open pickup report on this ride");

    if (ride.acceptedDriver) {
      await notify(
        ride.acceptedDriver.userId,
        "Pickup report withdrawn",
        `The passenger withdrew the no-pickup report for ${ride.originLabel} → ${ride.destLabel} — the ride continues. Request completion again when you arrive.`
      );
    }

    const fresh = await loadRideView(ride.id);
    res.json(fresh ? toRideView(fresh) : null);
  })
);

// POST /rides/:id/confirm-complete — the driver said the ride is done; the
// passenger's confirmation is what actually releases the escrow: driver gets
// the fare minus the platform commission. The commission % was locked on the
// ride when the price was agreed — an admin change since then doesn't apply.
ridesRouter.post(
  "/:id/confirm-complete",
  asyncHandler(async (req, res) => {
    const currentPct = await getMotoCommissionPct();

    const payout = await prisma.$transaction(async (tx) => {
      const ride = await tx.rideRequest.findUnique({ where: { id: req.params.id }, include: { acceptedDriver: { include: { user: true } } } });
      if (!ride || ride.passengerId !== req.auth!.sub) throw new HttpError(404, "Ride request not found");
      if (ride.status !== "AWAITING_CONFIRM") throw new HttpError(409, "The driver hasn't requested completion yet");
      const fare = ride.agreedFare;
      const driver = ride.acceptedDriver;
      if (!fare || !driver) throw new HttpError(409, "Ride has no funded fare/driver");

      const pct = ride.commissionPct ?? currentPct;
      const commission = ride.commissionAmount ?? new Prisma.Decimal(fare).mul(pct).div(100).toDecimalPlaces(2);
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
      // No self-refund while a pickup dispute is open — that's exactly the
      // "ride for free, then report" hole. Undo the report, or wait for the
      // driver / Relay to resolve it.
      if (ride.status === "DISPUTED") {
        throw new HttpError(409, "This ride is under a pickup dispute — withdraw your report or wait for it to be resolved");
      }

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
