import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { fullNameOf } from "../lib/mappers";
import { requireAuth, requireRole } from "../middleware/auth";
import { notify } from "../lib/notify";
import { motoIneligibleReason } from "../lib/moto";
import { autoResolveStaleDispute } from "./rides";

// A driver works for an operator: the operator schedules the departures,
// assigns the driver, handles moto hails and collects every fare. Nothing here
// is about money — the driver's console is purely operational: run the trips
// they've been assigned (board passengers, start, finish) and, on a moto, take
// the hail their operator handed them from pickup to completion.

export const driverRouter = Router();

driverRouter.use(requireAuth, requireRole("DRIVER"));

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

// GET /driver/me — profile + today's activity (no earnings: fares belong to
// the operator)
driverRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const driver = await getDriver(req.auth!.sub);

    const today = startOfToday();
    const weekAgo = new Date(Date.now() - 7 * 864e5);
    const [tripsToday, tripsWeek, boardedToday, ridesToday] = await Promise.all([
      prisma.trip.count({ where: { driverId: driver.id, status: "COMPLETED", arriveAt: { gte: today } } }),
      prisma.trip.count({ where: { driverId: driver.id, status: "COMPLETED", arriveAt: { gte: weekAgo } } }),
      prisma.ticket.count({ where: { boarded: true, boardedAt: { gte: today }, booking: { trip: { driverId: driver.id } } } }),
      prisma.rideRequest.count({ where: { acceptedDriverId: driver.id, status: "COMPLETED", completedAt: { gte: today } } }),
    ]);

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
        tripsToday: tripsToday + ridesToday,
        passengersToday: boardedToday + ridesToday,
        onlineHours: 6.2,
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

/* -------- Assigned departures (bus / shared ride) --------
   The operator schedules a trip and puts this driver on it; the passengers
   book seats with the operator. The driver doesn't accept or decline anyone —
   they board the passengers who show up (ticket code), start the trip and
   finish it. */

const scheduleInclude = {
  route: { include: { origin: true, destination: true } },
  bookings: {
    where: { status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] } },
    include: { passenger: true, tickets: true },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.TripInclude;

type ScheduleTrip = Awaited<ReturnType<typeof loadSchedule>>[number];

async function loadSchedule(driverId: string) {
  return prisma.trip.findMany({
    where: {
      driverId,
      OR: [
        { status: { in: ["SCHEDULED", "BOARDING", "RUNNING"] }, arriveAt: { gt: new Date(Date.now() - 6 * 3600_000) } },
        { status: "COMPLETED", arriveAt: { gte: startOfToday() } },
      ],
    },
    include: scheduleInclude,
    orderBy: { departAt: "asc" },
    take: 20,
  });
}

function toScheduleTrip(t: ScheduleTrip) {
  const tickets = t.bookings.flatMap((b) => b.tickets);
  return {
    id: t.id,
    from: t.route.origin.name,
    to: t.route.destination.name,
    mode: (t.legs as { mode: string }[]).map((l) => l.mode).join(" + "),
    departAt: t.departAt.toISOString(),
    arriveAt: t.arriveAt.toISOString(),
    status: t.status,
    capacity: t.capacity,
    seatsLeft: t.seatsLeft,
    // Never expose per-ticket codes here — boarding comes from the code on the
    // ticket the passenger presents, not from this list.
    passengers: t.bookings.map((b) => ({
      bookingId: b.id,
      name: fullNameOf(b.passenger),
      seats: b.seats,
      seatNumbers: b.tickets.map((tk) => tk.seatNumber).join(", ") || null,
      boarded: b.tickets.filter((tk) => tk.boarded).length,
      status: b.status,
    })),
    boarded: tickets.filter((tk) => tk.boarded).length,
    ticketsTotal: tickets.length,
  };
}

// GET /driver/schedule — the trips this driver is assigned to (upcoming and
// running, plus today's completed ones), each with its confirmed passengers.
driverRouter.get(
  "/schedule",
  asyncHandler(async (req, res) => {
    const driver = await getDriver(req.auth!.sub);
    const trips = await loadSchedule(driver.id);
    res.json(trips.map(toScheduleTrip));
  })
);

// POST /driver/trips/:id/start — depart: the trip goes RUNNING and every
// confirmed booking on it is now in progress.
driverRouter.post(
  "/trips/:id/start",
  asyncHandler(async (req, res) => {
    const driver = await getDriver(req.auth!.sub);
    const trip = await prisma.trip.findUnique({ where: { id: req.params.id }, include: { bookings: { where: { status: "CONFIRMED" } } } });
    if (!trip || trip.driverId !== driver.id) throw new HttpError(404, "Trip not found");
    if (trip.status !== "SCHEDULED" && trip.status !== "BOARDING") throw new HttpError(409, `This trip is already ${trip.status.toLowerCase()}`);

    await prisma.$transaction([
      prisma.trip.update({ where: { id: trip.id }, data: { status: "RUNNING" } }),
      prisma.booking.updateMany({ where: { tripId: trip.id, status: "CONFIRMED" }, data: { status: "IN_PROGRESS" } }),
    ]);
    for (const b of trip.bookings) {
      await notify(b.passengerId, "Your trip has departed", `${fullNameOf(driver.user)} is on the way — follow the trip live from your ticket.`);
    }
    res.json({ started: true });
  })
);

// POST /driver/trips/:id/complete — arrived: the trip and its in-progress
// bookings are completed; passengers are asked to rate the ride.
driverRouter.post(
  "/trips/:id/complete",
  asyncHandler(async (req, res) => {
    const driver = await getDriver(req.auth!.sub);
    const trip = await prisma.trip.findUnique({
      where: { id: req.params.id },
      include: { bookings: { where: { status: { in: ["CONFIRMED", "IN_PROGRESS"] } } }, route: { include: { destination: true } } },
    });
    if (!trip || trip.driverId !== driver.id) throw new HttpError(404, "Trip not found");
    if (trip.status === "COMPLETED" || trip.status === "CANCELLED") throw new HttpError(409, `This trip is already ${trip.status.toLowerCase()}`);

    await prisma.$transaction([
      prisma.trip.update({ where: { id: trip.id }, data: { status: "COMPLETED" } }),
      prisma.booking.updateMany({ where: { tripId: trip.id, status: { in: ["CONFIRMED", "IN_PROGRESS"] } }, data: { status: "COMPLETED" } }),
    ]);
    for (const b of trip.bookings) {
      await notify(b.passengerId, "You've arrived", `Welcome to ${trip.route.destination.name}. Rate your ride from the Trips tab.`);
    }
    res.json({ completed: true });
  })
);

/* -------- On-demand moto hailing (drivers with a MOTO vehicle) -------- */

function rideMockDistanceKm(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return Math.round((3 + (h % 27)) * 10) / 100;
}

const DRIVER_ACTIVE_RIDE_STATUSES = ["ACCEPTED", "CONFIRMED", "IN_PROGRESS", "AWAITING_CONFIRM", "DISPUTED"] as const;

// GET /driver/moto-requests — the ride currently assigned to this moto by its
// operator (at whatever lifecycle stage), plus why hailing may be off. Hails
// are accepted/quoted by the operator, not the driver, so there is no list of
// open requests here — and no fare breakdown: the fare is the operator's.
driverRouter.get(
  "/moto-requests",
  asyncHandler(async (req, res) => {
    const driver = await getDriver(req.auth!.sub);
    const hailingReason = motoIneligibleReason(driver);
    const include = { passenger: true };
    let current = await prisma.rideRequest.findFirst({
      where: { status: { in: [...DRIVER_ACTIVE_RIDE_STATUSES] }, acceptedDriverId: driver.id },
      include,
    });
    // A dispute the driver never answered resolves for the passenger.
    if (current && (await autoResolveStaleDispute(current))) {
      current = await prisma.rideRequest.findUnique({ where: { id: current.id }, include });
    }
    const map = (r: NonNullable<typeof current>) => ({
      id: r.id,
      status: r.status,
      passenger: fullNameOf(r.passenger),
      passengerPhone: r.passenger.phone,
      from: r.originLabel,
      to: r.destLabel,
      departAt: r.departAt?.toISOString() ?? null,
      prepaid: Boolean(r.paidAt),
      pickupDeadline: r.pickupDeadline?.toISOString() ?? null,
      pickupOverdue: r.status === "CONFIRMED" && r.pickupDeadline !== null && r.pickupDeadline.getTime() < Date.now(),
      targeted: r.targetDriverId === driver.id,
      distanceKm: rideMockDistanceKm(r.id),
      requestedAt: r.createdAt.toISOString(),
      disputedAt: r.disputedAt?.toISOString() ?? null,
      disputeContested: r.disputeContestedAt !== null,
    });
    res.json({ current: current ? map(current) : null, hailing: { enabled: !hailingReason, reason: hailingReason } });
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
// only that confirmation releases the escrow to the operator (minus platform
// commission).
driverRouter.post(
  "/moto-requests/:id/complete",
  asyncHandler(async (req, res) => {
    const driver = await getDriver(req.auth!.sub);
    const ride = await prisma.rideRequest.findUnique({ where: { id: req.params.id }, include: { passenger: true } });
    if (!ride || ride.acceptedDriverId !== driver.id || ride.status !== "IN_PROGRESS") {
      throw new HttpError(404, "Ride not found");
    }
    await prisma.rideRequest.update({ where: { id: ride.id }, data: { status: "AWAITING_CONFIRM", completionRequestedAt: new Date() } });
    await notify(ride.passengerId, "Confirm your ride", `${fullNameOf(driver.user)} marked ${ride.originLabel} → ${ride.destLabel} as completed — confirm it to release the payment.`);
    res.json({ requested: true });
  })
);

// POST /driver/moto-requests/:id/acknowledge-no-pickup — the passenger's
// report was right (a mistaken or premature "picked up" tap): the ride goes
// back to CONFIRMED with the window expired, so the passenger immediately gets
// the keep / re-broadcast / refund choices.
driverRouter.post(
  "/moto-requests/:id/acknowledge-no-pickup",
  asyncHandler(async (req, res) => {
    const driver = await getDriver(req.auth!.sub);
    const ride = await prisma.rideRequest.findUnique({ where: { id: req.params.id } });
    if (!ride || ride.acceptedDriverId !== driver.id) throw new HttpError(404, "Ride not found");

    const done = await prisma.rideRequest.updateMany({
      where: { id: ride.id, status: "DISPUTED" },
      data: {
        status: "CONFIRMED",
        pickedUpAt: null,
        completionRequestedAt: null,
        disputedAt: null,
        disputeContestedAt: null,
        pickupDeadline: new Date(),
      },
    });
    if (done.count === 0) throw new HttpError(409, "There is no open pickup dispute on this ride");

    await notify(ride.passengerId, "Driver confirmed your report", `The driver agreed you weren't picked up for ${ride.originLabel} → ${ride.destLabel} — you can keep them, hand the ride to another moto, or cancel for a full refund.`);
    res.json({ acknowledged: true });
  })
);

// POST /driver/moto-requests/:id/contest-dispute — the driver insists the
// pickup DID happen. The escrow stays frozen and the case goes to the platform:
// an admin resolves it either way from the Disputes queue.
driverRouter.post(
  "/moto-requests/:id/contest-dispute",
  asyncHandler(async (req, res) => {
    const driver = await getDriver(req.auth!.sub);
    const ride = await prisma.rideRequest.findUnique({ where: { id: req.params.id } });
    if (!ride || ride.acceptedDriverId !== driver.id) throw new HttpError(404, "Ride not found");

    const done = await prisma.rideRequest.updateMany({
      where: { id: ride.id, status: "DISPUTED", disputeContestedAt: null },
      data: { disputeContestedAt: new Date() },
    });
    if (done.count === 0) throw new HttpError(409, "There is no open pickup dispute to contest on this ride");

    await notify(ride.passengerId, "Driver contested your report", `${fullNameOf(driver.user)} says the pickup for ${ride.originLabel} → ${ride.destLabel} did happen. Relay will review and resolve — the money stays safely held until then.`);
    const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
    for (const a of admins) {
      await notify(a.id, "Ride dispute needs review", `Pickup dispute on ${ride.originLabel} → ${ride.destLabel}: passenger says no pickup, driver contests. Resolve it in Admin → Disputes.`);
    }
    res.json({ contested: true });
  })
);
