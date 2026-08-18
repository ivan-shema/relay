import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { fullNameOf } from "../lib/mappers";
import { requireAuth, requireRole } from "../middleware/auth";
import { notify } from "../lib/notify";
import { normalizeMomoNumber, momoProviderLabel, requestCashout, fetchTransferOutcome } from "../lib/paypack";
import { settlePayout } from "../lib/settlement";

export const driverRouter = Router();

driverRouter.use(requireAuth, requireRole("DRIVER"));

function dec(v: Prisma.Decimal | number): number {
  return typeof v === "number" ? v : Number(v.toString());
}

async function getDriver(userId: string) {
  const driver = await prisma.driver.findUnique({
    where: { userId },
    include: { user: true, vehicle: true, operator: true },
  });
  if (!driver) throw new HttpError(404, "Driver profile not found");
  return driver;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// GET /driver/me — profile + today's stats
driverRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const driver = await getDriver(req.auth!.sub);

    const today = startOfToday();
    const paidToday = await prisma.payment.findMany({
      where: { status: "PAID", createdAt: { gte: today }, booking: { trip: { driverId: driver.id } } },
    });
    const earningsToday = paidToday.reduce((s, p) => s + dec(p.amount), 0);

    const tripsToday = await prisma.booking.count({
      where: { status: "COMPLETED", createdAt: { gte: today }, trip: { driverId: driver.id } },
    });

    const weekPaid = await prisma.payment.findMany({
      where: { status: "PAID", createdAt: { gte: new Date(Date.now() - 7 * 864e5) }, booking: { trip: { driverId: driver.id } } },
    });
    const earningsWeek = weekPaid.reduce((s, p) => s + dec(p.amount), 0);
    const tripsWeek = await prisma.booking.count({
      where: { status: "COMPLETED", createdAt: { gte: new Date(Date.now() - 7 * 864e5) }, trip: { driverId: driver.id } },
    });

    res.json({
      id: driver.id,
      name: fullNameOf(driver.user),
      phone: driver.user.phone,
      online: driver.online,
      suspended: driver.suspended,
      rating: driver.ratingAvg,
      vehicle: driver.vehicle ? { label: driver.vehicle.label, plate: driver.vehicle.plateNumber, type: driver.vehicle.type } : null,
      operatorName: driver.operator?.companyName ?? null,
      stats: {
        earningsToday: Number(earningsToday.toFixed(2)),
        tripsToday,
        onlineHours: 6.2,
        acceptance: 96,
        earningsWeek: Number(earningsWeek.toFixed(2)),
        tripsWeek,
      },
    });
  })
);

// POST /driver/online — toggle availability
driverRouter.post(
  "/online",
  asyncHandler(async (req, res) => {
    const { online } = z.object({ online: z.boolean() }).parse(req.body);
    const driver = await getDriver(req.auth!.sub);
    const updated = await prisma.driver.update({ where: { id: driver.id }, data: { online } });
    res.json({ online: updated.online });
  })
);

// GET /driver/requests — incoming CONFIRMED bookings on this driver's trips
driverRouter.get(
  "/requests",
  asyncHandler(async (req, res) => {
    const driver = await getDriver(req.auth!.sub);
    const bookings = await prisma.booking.findMany({
      where: { status: "CONFIRMED", trip: { driverId: driver.id } },
      include: { passenger: true, tickets: true, trip: { include: { route: { include: { origin: true, destination: true } } } } },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    res.json(
      bookings.map((b) => ({
        id: b.id,
        passenger: fullNameOf(b.passenger),
        passengerRating: 4.8,
        from: b.trip.route.origin.name,
        to: b.trip.route.destination.name,
        fare: dec(b.fare),
        distanceKm: dec(b.trip.route.distanceKm ?? 3.1),
        seatNumber: b.tickets.length > 0 ? b.tickets.map((t) => t.seatNumber).join(", ") : null,
        // Never expose per-ticket codes/ids here — boarding must come from the
        // code on the ticket the passenger presents, not from this list.
        ticketsBoarded: b.tickets.filter((t) => t.boarded).length,
        ticketsTotal: b.tickets.length,
      }))
    );
  })
);

/* -------- On-demand moto hailing (drivers with a MOTO vehicle) -------- */

function rideMockDistanceKm(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return Math.round((3 + (h % 27)) * 10) / 100;
}

const DRIVER_ACTIVE_RIDE_STATUSES = ["ACCEPTED", "CONFIRMED", "IN_PROGRESS", "AWAITING_CONFIRM"] as const;

// GET /driver/moto-requests — open hails this moto can take (broadcasts +
// requests targeted at them, with their own pending counter-offer attached),
// plus their current ride at whatever lifecycle stage it's in.
driverRouter.get(
  "/moto-requests",
  asyncHandler(async (req, res) => {
    const driver = await getDriver(req.auth!.sub);
    const [open, current] = await Promise.all([
      prisma.rideRequest.findMany({
        where: { status: "OPEN", OR: [{ targetDriverId: null }, { targetDriverId: driver.id }] },
        include: { passenger: true, offers: { where: { driverId: driver.id, status: "PENDING" } } },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.rideRequest.findFirst({
        where: { status: { in: [...DRIVER_ACTIVE_RIDE_STATUSES] }, acceptedDriverId: driver.id },
        include: { passenger: true, offers: { where: { driverId: driver.id, status: "PENDING" } } },
      }),
    ]);
    const map = (r: (typeof open)[number]) => ({
      id: r.id,
      status: r.status,
      passenger: fullNameOf(r.passenger),
      passengerPhone: r.passenger.phone,
      from: r.originLabel,
      to: r.destLabel,
      offerFare: r.offerFare === null ? null : dec(r.offerFare),
      agreedFare: r.agreedFare === null ? null : dec(r.agreedFare),
      departAt: r.departAt?.toISOString() ?? null,
      // funded re-broadcast: accepting goes straight to pickup, price locked
      prepaid: Boolean(r.paidAt),
      pickupDeadline: r.pickupDeadline?.toISOString() ?? null,
      pickupOverdue: r.status === "CONFIRMED" && r.pickupDeadline !== null && r.pickupDeadline.getTime() < Date.now(),
      myOffer: r.offers[0] ? dec(r.offers[0].amount) : null,
      targeted: r.targetDriverId === driver.id,
      distanceKm: rideMockDistanceKm(r.id),
      requestedAt: r.createdAt.toISOString(),
    });
    res.json({ open: open.map(map), current: current ? map(current) : null });
  })
);

// POST /driver/moto-requests/:id/accept — claim a hail at the passenger's
// asking price (or the already-funded fare on a re-broadcast). The claim is a
// single atomic OPEN→next-state update: whichever driver's request lands first
// wins, and every later acceptance matches zero rows and is rejected.
driverRouter.post(
  "/moto-requests/:id/accept",
  asyncHandler(async (req, res) => {
    const driver = await getDriver(req.auth!.sub);
    if (driver.suspended) throw new HttpError(403, "Your account is suspended");

    const busy = await prisma.rideRequest.findFirst({
      where: { status: { in: [...DRIVER_ACTIVE_RIDE_STATUSES] }, acceptedDriverId: driver.id },
    });
    if (busy) throw new HttpError(409, "Finish your current ride before accepting another");

    const ride = await prisma.rideRequest.findUnique({ where: { id: req.params.id } });
    if (!ride) throw new HttpError(404, "Ride not found");

    // A funded re-broadcast keeps its fare and skips payment; a fresh ride
    // needs the passenger's asking price to accept directly (else counter).
    const prepaid = Boolean(ride.paidAt);
    const fare = prepaid ? ride.agreedFare : ride.offerFare;
    if (!fare) throw new HttpError(409, "The passenger didn't propose a price — send them your offer instead");

    const now = new Date();
    const claimed = await prisma.rideRequest.updateMany({
      where: {
        id: ride.id,
        status: "OPEN",
        OR: [{ targetDriverId: null }, { targetDriverId: driver.id }],
      },
      data: prepaid
        ? {
            status: "CONFIRMED",
            acceptedDriverId: driver.id,
            acceptedAt: now,
            pickupDeadline: new Date(Math.max(now.getTime(), ride.departAt?.getTime() ?? 0) + 10 * 60_000),
          }
        : { status: "ACCEPTED", acceptedDriverId: driver.id, acceptedAt: now, agreedFare: fare },
    });
    if (claimed.count === 0) throw new HttpError(409, "Too late — another driver already took this ride");

    await prisma.rideOffer.updateMany({ where: { rideId: ride.id, status: "PENDING" }, data: { status: "DECLINED" } });
    await notify(
      ride.passengerId,
      prepaid ? "New moto on the way" : "Moto accepted your request",
      prepaid
        ? `${fullNameOf(driver.user)} took over your ride ${ride.originLabel} → ${ride.destLabel} — already paid, they're coming.`
        : `${fullNameOf(driver.user)} accepted ${ride.originLabel} → ${ride.destLabel} at your price. Pay to confirm the ride.`
    );
    res.json({ accepted: true });
  })
);

// POST /driver/moto-requests/:id/offer — bargaining: quote a price (when the
// passenger didn't set one, or theirs is too low for the distance). One live
// offer per driver per ride; re-quoting replaces it.
driverRouter.post(
  "/moto-requests/:id/offer",
  asyncHandler(async (req, res) => {
    const { amount } = z.object({ amount: z.coerce.number().positive().max(100_000) }).parse(req.body);
    const driver = await getDriver(req.auth!.sub);
    if (driver.suspended) throw new HttpError(403, "Your account is suspended");

    const ride = await prisma.rideRequest.findUnique({ where: { id: req.params.id } });
    if (!ride || ride.status !== "OPEN") throw new HttpError(409, "This ride is no longer open");
    if (ride.paidAt) throw new HttpError(409, "This ride is already funded at a fixed price — accept it as is");
    if (ride.targetDriverId && ride.targetDriverId !== driver.id) throw new HttpError(403, "This request was sent to another driver");

    await prisma.rideOffer.upsert({
      where: { rideId_driverId: { rideId: ride.id, driverId: driver.id } },
      create: { rideId: ride.id, driverId: driver.id, amount },
      update: { amount, status: "PENDING" },
    });
    await notify(
      ride.passengerId,
      "Price offer from a moto",
      `${fullNameOf(driver.user)} offers RWF ${Math.round(amount).toLocaleString("en-US")} for ${ride.originLabel} → ${ride.destLabel}. Accept it to continue.`
    );
    res.status(201).json({ offered: true });
  })
);

// POST /driver/moto-requests/:id/withdraw — driver backs out of an ACCEPTED
// (still unpaid) ride; it reopens for everyone else.
driverRouter.post(
  "/moto-requests/:id/withdraw",
  asyncHandler(async (req, res) => {
    const driver = await getDriver(req.auth!.sub);
    const ride = await prisma.rideRequest.findUnique({ where: { id: req.params.id } });
    if (!ride || ride.acceptedDriverId !== driver.id) throw new HttpError(404, "Ride not found");
    if (ride.status !== "ACCEPTED") throw new HttpError(409, "You can only withdraw before the passenger pays");

    await prisma.rideRequest.update({
      where: { id: ride.id },
      data: { status: "OPEN", acceptedDriverId: null, acceptedAt: null, agreedFare: null, targetDriverId: null },
    });
    await notify(ride.passengerId, "Driver withdrew", `${fullNameOf(driver.user)} can't take ${ride.originLabel} → ${ride.destLabel} — your request is open to other motos again.`);
    res.json({ withdrawn: true });
  })
);

// POST /driver/moto-requests/:id/pickup — driver confirms the passenger is on
// the moto. Allowed while CONFIRMED, even slightly past the deadline (if the
// passenger hasn't re-broadcast or cancelled yet, the ride is still theirs).
driverRouter.post(
  "/moto-requests/:id/pickup",
  asyncHandler(async (req, res) => {
    const driver = await getDriver(req.auth!.sub);
    const ride = await prisma.rideRequest.findUnique({ where: { id: req.params.id } });
    if (!ride || ride.acceptedDriverId !== driver.id || ride.status !== "CONFIRMED") throw new HttpError(404, "Ride not found");

    await prisma.rideRequest.update({ where: { id: ride.id }, data: { status: "IN_PROGRESS", pickedUpAt: new Date() } });
    await notify(ride.passengerId, "Ride started", `${fullNameOf(driver.user)} picked you up — enjoy the ride to ${ride.destLabel}.`);
    res.json({ pickedUp: true });
  })
);

// POST /driver/moto-requests/:id/complete — the driver says the ride is done.
// This does NOT release the money: the passenger must confirm completion, and
// only that confirmation pays the driver (escrow minus platform commission).
driverRouter.post(
  "/moto-requests/:id/complete",
  asyncHandler(async (req, res) => {
    const driver = await getDriver(req.auth!.sub);
    const ride = await prisma.rideRequest.findUnique({ where: { id: req.params.id }, include: { passenger: true } });
    if (!ride || ride.acceptedDriverId !== driver.id || ride.status !== "IN_PROGRESS") {
      throw new HttpError(404, "Ride not found");
    }
    await prisma.rideRequest.update({ where: { id: ride.id }, data: { status: "AWAITING_CONFIRM", completionRequestedAt: new Date() } });
    await notify(ride.passengerId, "Confirm your ride", `${fullNameOf(driver.user)} marked ${ride.originLabel} → ${ride.destLabel} as completed — confirm it to release their payment.`);
    res.json({ requested: true });
  })
);

// POST /driver/requests/:id/accept — start the trip
driverRouter.post(
  "/requests/:id/accept",
  asyncHandler(async (req, res) => {
    const driver = await getDriver(req.auth!.sub);
    const booking = await prisma.booking.findUnique({ where: { id: req.params.id }, include: { trip: true } });
    if (!booking || booking.trip.driverId !== driver.id) throw new HttpError(404, "Request not found");
    await prisma.$transaction([
      prisma.booking.update({ where: { id: booking.id }, data: { status: "IN_PROGRESS" } }),
      prisma.trip.update({ where: { id: booking.tripId }, data: { status: "RUNNING" } }),
    ]);
    await notify(booking.passengerId, "Driver on the way", `${fullNameOf(driver.user)} accepted your trip.`);
    res.json({ accepted: true });
  })
);

// POST /driver/requests/:id/decline — release the seat, cancel booking
driverRouter.post(
  "/requests/:id/decline",
  asyncHandler(async (req, res) => {
    const driver = await getDriver(req.auth!.sub);
    const booking = await prisma.booking.findUnique({ where: { id: req.params.id }, include: { trip: true } });
    if (!booking || booking.trip.driverId !== driver.id) throw new HttpError(404, "Request not found");
    await prisma.$transaction([
      prisma.booking.update({ where: { id: booking.id }, data: { status: "CANCELLED" } }),
      prisma.trip.update({ where: { id: booking.tripId }, data: { seatsLeft: { increment: booking.seats } } }),
    ]);
    res.json({ declined: true });
  })
);

// POST /driver/requests/:id/complete — finish an in-progress trip
driverRouter.post(
  "/requests/:id/complete",
  asyncHandler(async (req, res) => {
    const driver = await getDriver(req.auth!.sub);
    const booking = await prisma.booking.findUnique({ where: { id: req.params.id }, include: { trip: true } });
    if (!booking || booking.trip.driverId !== driver.id) throw new HttpError(404, "Trip not found");
    await prisma.booking.update({ where: { id: booking.id }, data: { status: "COMPLETED" } });
    res.json({ completed: true });
  })
);

// POST /driver/cashout — settle today's earnings to Mobile Money. Real money:
// a Paypack cashout to the driver's phone, PENDING until the provider
// confirms (webhook/poll settles it). Earnings already cashed out (or in
// flight) today are excluded; failed cashouts return to the pool.
driverRouter.post(
  "/cashout",
  asyncHandler(async (req, res) => {
    const driver = await getDriver(req.auth!.sub);
    const today = startOfToday();
    const [paid, payouts] = await Promise.all([
      prisma.payment.findMany({
        where: { status: "PAID", createdAt: { gte: today }, booking: { trip: { driverId: driver.id } } },
      }),
      prisma.payout.findMany({ where: { driverId: driver.id, createdAt: { gte: today }, status: { not: "FAILED" } } }),
    ]);
    const earned = paid.reduce((s, p) => s + dec(p.amount), 0);
    const alreadyOut = payouts.reduce((s, p) => s + dec(p.amount), 0);
    const amount = Math.floor(earned - alreadyOut); // whole RWF; remainder stays cashable
    if (amount < 100) throw new HttpError(409, "No earnings to cash out yet"); // Paypack minimum transfer is RWF 100

    const number = normalizeMomoNumber(driver.user.phone);
    const transfer = await requestCashout(amount, number);
    const payout = await prisma.payout.create({
      data: {
        reference: "PO-" + Math.random().toString(36).slice(2, 9).toUpperCase(),
        driverId: driver.id,
        amount,
        method: momoProviderLabel(number),
        status: "PENDING",
        momoRef: transfer.ref,
      },
    });
    res.status(201).json({ amount, reference: payout.reference, status: "PENDING" });
  })
);

// GET /driver/cashout/:reference/status — poll backup while Paypack processes
// the cashout: local record first; only asks Paypack (and settles locally)
// when the webhook hasn't landed yet.
driverRouter.get(
  "/cashout/:reference/status",
  asyncHandler(async (req, res) => {
    const driver = await getDriver(req.auth!.sub);
    const payout = await prisma.payout.findUnique({ where: { reference: req.params.reference } });
    if (!payout || payout.driverId !== driver.id) throw new HttpError(404, "Payout not found");

    let status = payout.status;
    if (status === "PENDING" && payout.momoRef) {
      const outcome = await fetchTransferOutcome(payout.momoRef, "CASHOUT");
      if (outcome !== "pending") {
        await settlePayout(payout.momoRef, outcome);
        status = outcome === "successful" ? "COMPLETED" : "FAILED";
      }
    }
    res.json({ status, amount: dec(payout.amount), reference: payout.reference });
  })
);

// GET /driver/trips — today's trips for this driver
driverRouter.get(
  "/trips",
  asyncHandler(async (req, res) => {
    const driver = await getDriver(req.auth!.sub);
    const bookings = await prisma.booking.findMany({
      where: { trip: { driverId: driver.id }, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
      include: { trip: { include: { route: { include: { origin: true, destination: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 12,
    });
    res.json(
      bookings.map((b) => ({
        id: b.id,
        time: b.createdAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }),
        from: b.trip.route.origin.name,
        to: b.trip.route.destination.name,
        mode: (b.trip.legs as { mode: string }[]).map((l) => l.mode).join(" + "),
        fare: dec(b.fare),
        status: b.status,
      }))
    );
  })
);
