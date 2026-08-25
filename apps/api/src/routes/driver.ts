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
import { getMotoCommissionPct } from "../lib/settings";
import { motoIneligibleReason } from "../lib/moto";
import { autoResolveStaleDispute } from "./rides";
import { parseReportRange, reportBuckets, bucketSums, toCsv, sendCsv, fileStamp, primaryMode, round2, dec as rdec, BUS_PLATFORM_FEE_PCT, type ReportRange } from "../lib/reports";

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
    const weekAgo = new Date(Date.now() - 7 * 864e5);
    const [paidToday, tripsTodayBus, weekPaid, tripsWeekBus, weekRides] = await Promise.all([
      prisma.payment.findMany({ where: { status: "PAID", createdAt: { gte: today }, booking: { trip: { driverId: driver.id } } } }),
      prisma.booking.count({ where: { status: "COMPLETED", createdAt: { gte: today }, trip: { driverId: driver.id } } }),
      prisma.payment.findMany({ where: { status: "PAID", createdAt: { gte: weekAgo }, booking: { trip: { driverId: driver.id } } } }),
      prisma.booking.count({ where: { status: "COMPLETED", createdAt: { gte: weekAgo }, trip: { driverId: driver.id } } }),
      // Moto hails completed this week — what actually landed in the wallet
      // (fare minus the commission locked on each ride).
      prisma.rideRequest.findMany({
        where: { acceptedDriverId: driver.id, status: "COMPLETED", completedAt: { gte: weekAgo } },
        select: { agreedFare: true, commissionAmount: true, completedAt: true },
      }),
    ]);
    const rideNet = (r: (typeof weekRides)[number]) => rdec(r.agreedFare) - rdec(r.commissionAmount);
    const todayRides = weekRides.filter((r) => r.completedAt && r.completedAt >= today);
    const earningsToday = paidToday.reduce((s, p) => s + dec(p.amount), 0) + todayRides.reduce((s, r) => s + rideNet(r), 0);
    const tripsToday = tripsTodayBus + todayRides.length;
    const earningsWeek = weekPaid.reduce((s, p) => s + dec(p.amount), 0) + weekRides.reduce((s, r) => s + rideNet(r), 0);
    const tripsWeek = tripsWeekBus + weekRides.length;

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

const DRIVER_ACTIVE_RIDE_STATUSES = ["ACCEPTED", "CONFIRMED", "IN_PROGRESS", "AWAITING_CONFIRM", "DISPUTED"] as const;

// GET /driver/moto-requests — the ride currently assigned to this moto by its
// operator (at whatever lifecycle stage), plus why hailing may be off. Hails
// are accepted/quoted by the operator, not the driver, so there is no list of
// open requests here.
driverRouter.get(
  "/moto-requests",
  asyncHandler(async (req, res) => {
    const driver = await getDriver(req.auth!.sub);
    const hailingReason = motoIneligibleReason(driver);
    const platformCommissionPct = await getMotoCommissionPct();
    const include = { passenger: true, offers: { where: { driverId: driver.id, status: "PENDING" as const } } };
    let current = await prisma.rideRequest.findFirst({
      where: { status: { in: [...DRIVER_ACTIVE_RIDE_STATUSES] }, acceptedDriverId: driver.id },
      include,
    });
    // A dispute the driver never answered resolves for the passenger.
    if (current && (await autoResolveStaleDispute(current))) {
      current = await prisma.rideRequest.findUnique({ where: { id: current.id }, include });
    }
    const map = (r: NonNullable<typeof current>) => {
      // Fee transparency: the driver always sees what Relay takes and what
      // lands in their wallet. Locked rate wins; otherwise the current rate.
      const pct = r.commissionPct ?? platformCommissionPct;
      const fare = r.agreedFare !== null ? dec(r.agreedFare) : r.offerFare !== null ? dec(r.offerFare) : null;
      const commission = fare === null ? null : Math.round(fare * pct) / 100;
      return {
        id: r.id,
        status: r.status,
        passenger: fullNameOf(r.passenger),
        passengerPhone: r.passenger.phone,
        from: r.originLabel,
        to: r.destLabel,
        offerFare: r.offerFare === null ? null : dec(r.offerFare),
        agreedFare: r.agreedFare === null ? null : dec(r.agreedFare),
        departAt: r.departAt?.toISOString() ?? null,
        prepaid: Boolean(r.paidAt),
        pickupDeadline: r.pickupDeadline?.toISOString() ?? null,
        pickupOverdue: r.status === "CONFIRMED" && r.pickupDeadline !== null && r.pickupDeadline.getTime() < Date.now(),
        myOffer: r.offers[0] ? dec(r.offers[0].amount) : null,
        targeted: r.targetDriverId === driver.id,
        distanceKm: rideMockDistanceKm(r.id),
        requestedAt: r.createdAt.toISOString(),
        disputedAt: r.disputedAt?.toISOString() ?? null,
        disputeContested: r.disputeContestedAt !== null,
        commissionPct: pct,
        commissionLocked: r.commissionPct !== null,
        commissionAmount: commission,
        netPayout: fare === null || commission === null ? null : Math.round((fare - commission) * 100) / 100,
      };
    };
    res.json({ current: current ? map(current) : null, platformCommissionPct, hailing: { enabled: !hailingReason, reason: hailingReason } });
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

/* ---------------- Earnings report ----------------
   A driver's statement for a time window. Two income streams are combined:
   fares collected on scheduled trips they drove (bus / shared ride bookings,
   PAID) and on-demand moto hails they completed (agreed fare minus the
   commission locked on the ride). Every line is exportable as CSV. */

interface DriverStatementRow {
  date: Date;
  kind: "TRIP" | "MOTO";
  route: string;
  passenger: string;
  gross: number;
  fee: number;
  net: number;
  status: string;
  reference: string;
}

async function driverReportData(driverId: string, range: ReportRange) {
  const { start, end } = range;
  const [bookings, rides, cancelledRides, disputed, ratings] = await Promise.all([
    prisma.booking.findMany({
      where: { createdAt: { gte: start, lt: end }, trip: { driverId } },
      include: { passenger: true, payment: true, trip: { include: { route: true } } },
    }),
    prisma.rideRequest.findMany({
      where: { acceptedDriverId: driverId, status: "COMPLETED", completedAt: { gte: start, lt: end } },
      include: { passenger: true },
    }),
    prisma.rideRequest.count({ where: { acceptedDriverId: driverId, status: "CANCELLED", createdAt: { gte: start, lt: end } } }),
    prisma.rideRequest.count({ where: { acceptedDriverId: driverId, disputedAt: { gte: start, lt: end } } }),
    prisma.rating.findMany({ where: { createdAt: { gte: start, lt: end }, booking: { trip: { driverId } } } }),
  ]);

  const rows: DriverStatementRow[] = [
    ...bookings.map((b): DriverStatementRow => {
      const gross = b.payment?.status === "PAID" ? rdec(b.payment.amount) : 0;
      return { date: b.createdAt, kind: "TRIP", route: b.trip.route.name, passenger: fullNameOf(b.passenger), gross, fee: 0, net: gross, status: b.status, reference: b.reference };
    }),
    ...rides.map((r): DriverStatementRow => {
      const gross = rdec(r.agreedFare);
      const fee = rdec(r.commissionAmount);
      return { date: r.completedAt ?? r.createdAt, kind: "MOTO", route: `${r.originLabel} → ${r.destLabel}`, passenger: fullNameOf(r.passenger), gross, fee, net: round2(gross - fee), status: "COMPLETED", reference: r.id };
    }),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  const gross = rows.reduce((s, r) => s + r.gross, 0);
  const fee = rows.reduce((s, r) => s + r.fee, 0);
  const tripsCompleted = bookings.filter((b) => b.status === "COMPLETED").length;

  return {
    period: range.period,
    label: range.label,
    from: range.start.toISOString(),
    to: range.end.toISOString(),
    kpis: {
      gross: round2(gross),
      motoCommission: round2(fee),
      net: round2(gross - fee),
      bookings: bookings.length,
      tripsCompleted,
      rides: rides.length,
      ridesCancelled: cancelledRides,
      disputes: disputed,
      avgRating: ratings.length ? round2(ratings.reduce((s, r) => s + r.score, 0) / ratings.length) : null,
      ratingsCount: ratings.length,
    },
    earningsBars: bucketSums(reportBuckets(range), rows.map((r) => ({ at: r.date, value: r.net }))),
    rows: rows.slice(0, 300).map((r) => ({ ...r, date: r.date.toISOString() })),
    truncated: rows.length > 300,
  };
}

// GET /driver/reports?period=…  |  ?from=&to=
driverRouter.get(
  "/reports",
  asyncHandler(async (req, res) => {
    const driver = await getDriver(req.auth!.sub);
    res.json(await driverReportData(driver.id, parseReportRange(req)));
  })
);

// GET /driver/reports/export — the statement lines as CSV
driverRouter.get(
  "/reports/export",
  asyncHandler(async (req, res) => {
    const driver = await getDriver(req.auth!.sub);
    const range = parseReportRange(req, "month");
    const data = await driverReportData(driver.id, range);
    sendCsv(res, `earnings_${fileStamp(range)}.csv`, toCsv(
      ["date", "kind", "route", "passenger", "gross_rwf", "relay_fee_rwf", "net_rwf", "status", "reference"],
      data.rows.map((r) => [r.date, r.kind, r.route, r.passenger, r.gross, r.fee, r.net, r.status, r.reference])
    ));
  })
);
