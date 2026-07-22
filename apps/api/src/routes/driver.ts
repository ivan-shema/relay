import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { requireAuth, requireRole } from "../middleware/auth";

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
      name: driver.user.fullName,
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
      include: { passenger: true, trip: { include: { route: { include: { origin: true, destination: true } } } } },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    res.json(
      bookings.map((b) => ({
        id: b.id,
        passenger: b.passenger.fullName,
        passengerRating: 4.8,
        from: b.trip.route.origin.name,
        to: b.trip.route.destination.name,
        fare: dec(b.fare),
        distanceKm: dec(b.trip.route.distanceKm ?? 3.1),
        seatNumber: b.seatNumber,
      }))
    );
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
      prisma.notification.create({ data: { userId: booking.passengerId, title: "Driver on the way", message: `${driver.user.fullName} accepted your trip.` } }),
    ]);
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

// POST /driver/cashout — settle today's earnings to Mobile Money
driverRouter.post(
  "/cashout",
  asyncHandler(async (req, res) => {
    const driver = await getDriver(req.auth!.sub);
    const today = startOfToday();
    const paid = await prisma.payment.findMany({
      where: { status: "PAID", createdAt: { gte: today }, booking: { trip: { driverId: driver.id } } },
    });
    const amount = paid.reduce((s, p) => s + dec(p.amount), 0);
    if (amount <= 0) throw new HttpError(409, "No earnings to cash out yet");
    const payout = await prisma.payout.create({
      data: { reference: "PO-" + Math.random().toString(36).slice(2, 9).toUpperCase(), driverId: driver.id, amount, method: "MTN MoMo" },
    });
    await prisma.notification.create({
      data: { userId: req.auth!.sub, title: "Payout sent", message: `RWF ${Math.round(amount).toLocaleString("en-US")} sent to your MTN MoMo.` },
    });
    res.status(201).json({ amount: Number(amount.toFixed(2)), reference: payout.reference });
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
