import { Router } from "express";
import { Prisma } from "@prisma/client";
import {
  formatRWF,
  createVehicleSchema,
  createRouteSchema,
  createDepartureSchema,
  inviteDriverSchema,
  assignVehicleSchema,
  assignTripSchema,
} from "@relay/shared";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { requireAuth, requireRole } from "../middleware/auth";
import { hashPassword } from "../lib/auth";
import { parsePage, paged } from "../lib/pagination";
import { fullNameOf } from "../lib/mappers";
import { upload, requireFile } from "../lib/uploads";

export const operatorRouter = Router();

operatorRouter.use(requireAuth, requireRole("OPERATOR", "ADMIN"));

function dec(v: Prisma.Decimal | number): number {
  return typeof v === "number" ? v : Number(v.toString());
}
function fmtTime(d: Date) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// The caller's OWN operator, strictly by ownerUserId — no fallback. (The old
// "first operator" fallback silently handed control of an arbitrary company
// to any operator-role user without one: cross-tenant access bug.)
async function resolveOperator(userId: string) {
  const op = await prisma.operator.findFirst({ where: { ownerUserId: userId } });
  if (!op) throw new HttpError(404, "No operator profile is linked to this account");
  return op;
}

// Console routes additionally require the company to be VERIFIED — pending
// applications and rejected/suspended companies get no operational access.
async function resolveVerifiedOperatorId(userId: string): Promise<string> {
  const op = await resolveOperator(userId);
  if (op.status !== "VERIFIED") {
    throw new HttpError(
      403,
      op.status === "SUSPENDED"
        ? "Your operator application was not approved"
        : "Your operator application is pending review"
    );
  }
  return op.id;
}

// GET /operator/me — works at ANY status so the web can render the
// pending / not-approved screens.
operatorRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const op = await resolveOperator(req.auth!.sub);
    res.json({ id: op.id, companyName: op.companyName, modes: op.modes, status: op.status, contactInfo: op.contactInfo });
  })
);

// GET /operator/overview — KPIs + live bookings + route performance
operatorRouter.get(
  "/overview",
  asyncHandler(async (req, res) => {
    const opId = await resolveVerifiedOperatorId(req.auth!.sub);
    const today = startOfToday();

    const [bookingsToday, paidToday, activeVehicles, totalVehicles, liveBookings, routes] = await Promise.all([
      prisma.booking.count({ where: { trip: { operatorId: opId }, createdAt: { gte: today } } }),
      prisma.payment.findMany({ where: { status: "PAID", createdAt: { gte: today }, booking: { trip: { operatorId: opId } } } }),
      prisma.vehicle.count({ where: { operatorId: opId, status: "ACTIVE" } }),
      prisma.vehicle.count({ where: { operatorId: opId } }),
      prisma.booking.findMany({
        where: { trip: { operatorId: opId } },
        include: { passenger: true, trip: { include: { route: true } } },
        orderBy: { createdAt: "desc" },
        take: 6,
      }),
      prisma.route.findMany({ include: { trips: { where: { operatorId: opId }, include: { bookings: true } } } }),
    ]);

    const revenueToday = paidToday.reduce((s, p) => s + dec(p.amount), 0);

    const routePerf = routes
      .map((r) => {
        const trips = r.trips;
        const totalCap = trips.reduce((s, t) => s + t.capacity, 0);
        const booked = trips.reduce((s, t) => s + t.bookings.length, 0);
        return { name: r.name, trips: `${trips.length} trips`, util: totalCap ? Math.min(100, Math.round((booked / totalCap) * 100)) : 0 };
      })
      .filter((r) => r.trips !== "0 trips")
      .slice(0, 4);

    res.json({
      kpis: [
        { label: "Bookings today", value: String(bookingsToday), sub: "all modes", delta: "+8%" },
        { label: "Revenue today", value: formatRWF(revenueToday), sub: "gross", delta: "+12%" },
        { label: "Active vehicles", value: `${activeVehicles}/${totalVehicles}`, sub: "on route", delta: "" },
        { label: "Avg rating", value: "4.8", sub: "this week", delta: "+0.1" },
      ],
      liveBookings: liveBookings.map((b) => ({
        passenger: fullNameOf(b.passenger),
        route: b.trip.route.name,
        time: fmtTime(b.createdAt),
        fare: dec(b.fare),
        status: b.status,
      })),
      routePerformance: routePerf,
      fleetUtilization: totalVehicles ? Math.round((activeVehicles / totalVehicles) * 100) : 0,
    });
  })
);

// GET /operator/vehicles
operatorRouter.get(
  "/vehicles",
  asyncHandler(async (req, res) => {
    const opId = await resolveVerifiedOperatorId(req.auth!.sub);
    const p = parsePage(req, 8);
    const where = { operatorId: opId };
    const [vehicles, total] = await prisma.$transaction([
      prisma.vehicle.findMany({ where, include: { driver: { include: { user: true } } }, orderBy: { plateNumber: "asc" }, skip: p.skip, take: p.take }),
      prisma.vehicle.count({ where }),
    ]);
    res.json(
      paged(
        vehicles.map((v) => ({
          id: v.id,
          plate: v.plateNumber,
          type: v.type,
          model: v.model,
          capacity: v.capacity,
          driver: v.driver ? fullNameOf(v.driver.user) : "Unassigned",
          util: v.status === "ACTIVE" ? "77%" : v.status === "IDLE" ? "0%" : "—",
          status: v.status,
        })),
        total,
        p
      )
    );
  })
);

// POST /operator/vehicles — add
operatorRouter.post(
  "/vehicles",
  asyncHandler(async (req, res) => {
    const opId = await resolveVerifiedOperatorId(req.auth!.sub);
    const body = createVehicleSchema.parse(req.body);
    const v = await prisma.vehicle.create({
      data: { operatorId: opId, plateNumber: body.plateNumber, type: body.type, capacity: body.capacity, model: body.model, label: body.label ?? `${body.type} ${body.plateNumber.slice(-3)}`, status: "IDLE" },
    });
    res.status(201).json({ id: v.id });
  })
);

// GET /operator/routes
operatorRouter.get(
  "/routes",
  asyncHandler(async (req, res) => {
    const opId = await resolveVerifiedOperatorId(req.auth!.sub);
    const routes = await prisma.route.findMany({
      include: { origin: true, destination: true, trips: { where: { operatorId: opId }, include: { bookings: true } } },
    });
    res.json(
      routes
        .filter((r) => r.trips.length > 0)
        .map((r) => {
          const totalCap = r.trips.reduce((s, t) => s + t.capacity, 0);
          const booked = r.trips.reduce((s, t) => s + t.bookings.length, 0);
          const fare = r.trips[0] ? dec(r.trips[0].fare) : 0;
          return {
            id: r.id,
            name: r.name,
            from: r.origin.name,
            to: r.destination.name,
            stops: `${Math.round(r.distanceKm)} km`,
            buses: `${r.trips.length} trips`,
            freq: "every 15 min",
            util: totalCap ? Math.min(100, Math.round((booked / totalCap) * 100)) : 0,
            fare,
          };
        })
    );
  })
);

// POST /operator/routes — create a route between two saved places
operatorRouter.post(
  "/routes",
  asyncHandler(async (req, res) => {
    await resolveVerifiedOperatorId(req.auth!.sub); // authz
    const body = createRouteSchema.parse(req.body);
    const [origin, destination] = await Promise.all([
      prisma.place.findUnique({ where: { id: body.originId } }),
      prisma.place.findUnique({ where: { id: body.destinationId } }),
    ]);
    if (!origin || !destination) throw new HttpError(400, "Invalid places");
    const route = await prisma.route.create({
      data: { name: `${origin.name} → ${destination.name}`, originId: origin.id, destinationId: destination.id, distanceKm: body.distanceKm },
    });
    res.status(201).json({ id: route.id, name: route.name });
  })
);

// POST /operator/departures — publish a bookable trip
operatorRouter.post(
  "/departures",
  asyncHandler(async (req, res) => {
    const opId = await resolveVerifiedOperatorId(req.auth!.sub);
    const body = createDepartureSchema.parse(req.body);
    const route = await prisma.route.findUnique({ where: { id: body.routeId } });
    if (!route) throw new HttpError(400, "Invalid route");
    const departAt = new Date(Date.now() + body.departInMinutes * 60_000);
    const trip = await prisma.trip.create({
      data: {
        routeId: route.id,
        operatorId: opId,
        vehicleId: body.vehicleId,
        driverId: body.driverId,
        legs: [{ mode: body.mode }],
        departAt,
        arriveAt: new Date(departAt.getTime() + body.durationMinutes * 60_000),
        fare: body.fare,
        capacity: body.capacity,
        seatsLeft: body.capacity,
        status: "SCHEDULED",
      },
    });
    res.status(201).json({ id: trip.id });
  })
);

// POST /operator/drivers/invite — onboard a new driver with KYC (multipart):
// ID number + driving licence number, plus their ID and licence documents.
operatorRouter.post(
  "/drivers/invite",
  upload.fields([
    { name: "idDocument", maxCount: 1 },
    { name: "licenseDocument", maxCount: 1 },
  ]),
  asyncHandler(async (req, res) => {
    const opId = await resolveVerifiedOperatorId(req.auth!.sub);
    const body = inviteDriverSchema.parse(req.body);
    const idDocument = requireFile(req, "idDocument");
    const licenseDocument = requireFile(req, "licenseDocument");

    const email = body.email && body.email.length > 0 ? body.email : `${body.phone.replace(/\D/g, "")}@drivers.relay.app`;
    const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { phone: body.phone }] } });
    if (existing) throw new HttpError(409, "Phone or email already registered");

    const passwordHash = await hashPassword("password123");
    const driver = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { firstName: body.firstName, lastName: body.lastName, email, phone: body.phone, passwordHash, role: "DRIVER", phoneVerified: false },
      });
      const d = await tx.driver.create({
        data: { userId: user.id, operatorId: opId, licenseNumber: body.licenseNumber, nationalId: body.idNumber },
      });
      await tx.document.createMany({
        data: [
          { kind: "NATIONAL_ID", fileName: idDocument.originalname, filePath: idDocument.filename, mimeType: idDocument.mimetype, size: idDocument.size, driverId: d.id },
          { kind: "DRIVING_LICENSE", fileName: licenseDocument.originalname, filePath: licenseDocument.filename, mimeType: licenseDocument.mimetype, size: licenseDocument.size, driverId: d.id },
        ],
      });
      return d;
    });
    res.status(201).json({ id: driver.id });
  })
);

// POST /operator/payout — withdraw today's net earnings
operatorRouter.post(
  "/payout",
  asyncHandler(async (req, res) => {
    const opId = await resolveVerifiedOperatorId(req.auth!.sub);
    const today = startOfToday();
    const paid = await prisma.payment.findMany({ where: { status: "PAID", createdAt: { gte: today }, booking: { trip: { operatorId: opId } } } });
    const gross = paid.reduce((s, p) => s + dec(p.amount), 0);
    const net = gross * 0.88;
    if (net <= 0) throw new HttpError(409, "Nothing to withdraw yet");
    const payout = await prisma.payout.create({
      data: { reference: "PO-" + Math.random().toString(36).slice(2, 9).toUpperCase(), operatorId: opId, amount: net, method: "MTN MoMo" },
    });
    res.status(201).json({ amount: Number(net.toFixed(2)), reference: payout.reference });
  })
);

// GET /operator/schedule — upcoming departures
operatorRouter.get(
  "/schedule",
  asyncHandler(async (req, res) => {
    const opId = await resolveVerifiedOperatorId(req.auth!.sub);
    const p = parsePage(req, 8);
    const where = { operatorId: opId };
    const [trips, total] = await prisma.$transaction([
      prisma.trip.findMany({
        where,
        include: { route: true, vehicle: true, driver: { include: { user: true } }, bookings: true },
        orderBy: { departAt: "asc" },
        skip: p.skip,
        take: p.take,
      }),
      prisma.trip.count({ where }),
    ]);
    res.json(
      paged(
        trips.map((t) => {
          const booked = t.bookings.filter((b) => b.status !== "CANCELLED").length;
          return {
            id: t.id,
            time: fmtTime(t.departAt),
            route: t.route.name,
            vehicle: t.vehicle?.plateNumber ?? "—",
            driver: t.driver ? fullNameOf(t.driver.user) : "—",
            booked,
            capacity: t.capacity,
            status: t.status,
          };
        }),
        total,
        p
      )
    );
  })
);

// GET /operator/drivers
operatorRouter.get(
  "/drivers",
  asyncHandler(async (req, res) => {
    const opId = await resolveVerifiedOperatorId(req.auth!.sub);
    const p = parsePage(req, 8);
    const where = { operatorId: opId };
    const [drivers, total] = await prisma.$transaction([
      prisma.driver.findMany({ where, include: { user: true, vehicle: true }, orderBy: { createdAt: "asc" }, skip: p.skip, take: p.take }),
      prisma.driver.count({ where }),
    ]);
    const result = await Promise.all(
      drivers.map(async (d) => {
        const trips = await prisma.booking.count({ where: { status: "COMPLETED", trip: { driverId: d.id } } });
        // `revenue` = fares COLLECTED on this driver's trips (the operator's own
        // revenue). This is NOT the driver's personal take-home pay — that is
        // private to the driver and only shown in their own console.
        const paid = await prisma.payment.aggregate({ _sum: { amount: true }, where: { status: "PAID", booking: { trip: { driverId: d.id } } } });
        return {
          id: d.id,
          name: fullNameOf(d.user),
          phone: d.user.phone,
          vehicle: d.vehicle ? `${d.vehicle.type} · ${d.vehicle.plateNumber}` : "Unassigned",
          trips,
          rating: d.ratingAvg,
          revenue: dec(paid._sum.amount ?? new Prisma.Decimal(0)),
          status: d.suspended ? "SUSPENDED" : d.online ? "ONLINE" : "OFFLINE",
        };
      })
    );
    res.json(paged(result, total, p));
  })
);

// GET /operator/drivers/:id
operatorRouter.get(
  "/drivers/:id",
  asyncHandler(async (req, res) => {
    const opId = await resolveVerifiedOperatorId(req.auth!.sub);
    const d = await prisma.driver.findFirst({
      where: { id: req.params.id, operatorId: opId },
      include: { user: true, vehicle: true, documents: true },
    });
    if (!d) throw new HttpError(404, "Driver not found");
    const trips = await prisma.booking.count({ where: { status: "COMPLETED", trip: { driverId: d.id } } });
    // Operator revenue from this driver's trips (see note above) — not personal pay.
    const paid = await prisma.payment.aggregate({ _sum: { amount: true }, where: { status: "PAID", booking: { trip: { driverId: d.id } } } });
    res.json({
      id: d.id,
      name: fullNameOf(d.user),
      phone: d.user.phone,
      nationalId: d.nationalId,
      licenseNumber: d.licenseNumber,
      vehicleId: d.vehicle?.id ?? null,
      vehicle: d.vehicle ? `${d.vehicle.label} · ${d.vehicle.plateNumber}` : "Unassigned",
      trips,
      rating: d.ratingAvg,
      revenue: dec(paid._sum.amount ?? new Prisma.Decimal(0)),
      joined: d.createdAt.getFullYear().toString(),
      status: d.suspended ? "SUSPENDED" : d.online ? "ONLINE" : "OFFLINE",
      suspended: d.suspended,
      documents: d.documents.map((doc) => ({ id: doc.id, kind: doc.kind, fileName: doc.fileName })),
    });
  })
);

// GET /operator/drivers/:id/trips — that driver's recent trips (operator view:
// route, time and the FARE collected; not the driver's personal earnings).
operatorRouter.get(
  "/drivers/:id/trips",
  asyncHandler(async (req, res) => {
    const opId = await resolveVerifiedOperatorId(req.auth!.sub);
    const d = await prisma.driver.findFirst({ where: { id: req.params.id, operatorId: opId } });
    if (!d) throw new HttpError(404, "Driver not found");
    const bookings = await prisma.booking.findMany({
      where: { trip: { driverId: d.id }, status: { in: ["COMPLETED", "IN_PROGRESS"] } },
      include: { trip: { include: { route: true } } },
      orderBy: { createdAt: "desc" },
      take: 8,
    });
    res.json(
      bookings.map((b) => ({
        id: b.id,
        route: b.trip.route.name,
        time: b.createdAt.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }),
        fare: dec(b.fare),
        status: b.status,
      }))
    );
  })
);

// GET /operator/drivers/:id/lookups — options for the manage screen selects.
operatorRouter.get(
  "/drivers/:id/lookups",
  asyncHandler(async (req, res) => {
    const opId = await resolveVerifiedOperatorId(req.auth!.sub);
    const [vehicles, trips] = await Promise.all([
      prisma.vehicle.findMany({ where: { operatorId: opId }, orderBy: { plateNumber: "asc" }, take: 100 }),
      prisma.trip.findMany({ where: { operatorId: opId, status: "SCHEDULED", departAt: { gt: new Date() } }, include: { route: true }, orderBy: { departAt: "asc" }, take: 50 }),
    ]);
    res.json({
      vehicles: vehicles.map((v) => ({ value: v.id, label: `${v.type} · ${v.plateNumber}${v.driverId ? " (assigned)" : ""}` })),
      trips: trips.map((t) => ({
        value: t.id,
        label: `${t.departAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })} · ${t.route.name}`,
      })),
    });
  })
);

// POST /operator/drivers/:id/assign-vehicle — set/clear the driver's vehicle
operatorRouter.post(
  "/drivers/:id/assign-vehicle",
  asyncHandler(async (req, res) => {
    const opId = await resolveVerifiedOperatorId(req.auth!.sub);
    const { vehicleId } = assignVehicleSchema.parse(req.body);
    const d = await prisma.driver.findFirst({ where: { id: req.params.id, operatorId: opId }, include: { vehicle: true } });
    if (!d) throw new HttpError(404, "Driver not found");

    await prisma.$transaction(async (tx) => {
      // detach any current vehicle of this driver
      if (d.vehicle) await tx.vehicle.update({ where: { id: d.vehicle.id }, data: { driverId: null } });
      if (vehicleId) {
        const v = await tx.vehicle.findFirst({ where: { id: vehicleId, operatorId: opId } });
        if (!v) throw new HttpError(400, "Vehicle not in your fleet");
        // free the vehicle from whoever had it, then assign to this driver
        await tx.vehicle.update({ where: { id: v.id }, data: { driverId: d.id, status: "ACTIVE" } });
      }
    });
    res.json({ ok: true });
  })
);

// POST /operator/drivers/:id/assign-trip — put the driver (+ their vehicle) on a departure
operatorRouter.post(
  "/drivers/:id/assign-trip",
  asyncHandler(async (req, res) => {
    const opId = await resolveVerifiedOperatorId(req.auth!.sub);
    const { tripId } = assignTripSchema.parse(req.body);
    const d = await prisma.driver.findFirst({ where: { id: req.params.id, operatorId: opId }, include: { vehicle: true } });
    if (!d) throw new HttpError(404, "Driver not found");
    const trip = await prisma.trip.findFirst({ where: { id: tripId, operatorId: opId } });
    if (!trip) throw new HttpError(400, "Departure not found");
    await prisma.trip.update({ where: { id: trip.id }, data: { driverId: d.id, vehicleId: d.vehicle?.id ?? trip.vehicleId } });
    await prisma.notification.create({
      data: { userId: d.userId, title: "New trip assigned", message: "You've been assigned to an upcoming departure." },
    });
    res.json({ ok: true });
  })
);

// POST /operator/drivers/:id/remove — detach the driver from this operator's fleet
operatorRouter.post(
  "/drivers/:id/remove",
  asyncHandler(async (req, res) => {
    const opId = await resolveVerifiedOperatorId(req.auth!.sub);
    const d = await prisma.driver.findFirst({ where: { id: req.params.id, operatorId: opId }, include: { vehicle: true } });
    if (!d) throw new HttpError(404, "Driver not found");
    await prisma.$transaction(async (tx) => {
      if (d.vehicle) await tx.vehicle.update({ where: { id: d.vehicle.id }, data: { driverId: null, status: "IDLE" } });
      await tx.driver.update({ where: { id: d.id }, data: { operatorId: null, online: false } });
    });
    res.json({ removed: true });
  })
);

// POST /operator/drivers/:id/suspend — toggle suspension
operatorRouter.post(
  "/drivers/:id/suspend",
  asyncHandler(async (req, res) => {
    const opId = await resolveVerifiedOperatorId(req.auth!.sub);
    const d = await prisma.driver.findFirst({ where: { id: req.params.id, operatorId: opId } });
    if (!d) throw new HttpError(404, "Driver not found");
    const updated = await prisma.driver.update({ where: { id: d.id }, data: { suspended: !d.suspended } });
    res.json({ suspended: updated.suspended });
  })
);

// GET /operator/bookings
operatorRouter.get(
  "/bookings",
  asyncHandler(async (req, res) => {
    const opId = await resolveVerifiedOperatorId(req.auth!.sub);
    const p = parsePage(req, 10);
    const where = { trip: { operatorId: opId } };
    const [bookings, total] = await prisma.$transaction([
      prisma.booking.findMany({
        where,
        include: { passenger: true, trip: { include: { route: true } } },
        orderBy: { createdAt: "desc" },
        skip: p.skip,
        take: p.take,
      }),
      prisma.booking.count({ where }),
    ]);
    res.json(
      paged(
        bookings.map((b) => ({
          id: b.reference,
          passenger: fullNameOf(b.passenger),
          route: b.trip.route.name,
          mode: (b.trip.legs as { mode: string }[]).map((l) => l.mode).join(" + "),
          fare: dec(b.fare),
          status: b.status,
        })),
        total,
        p
      )
    );
  })
);

// GET /operator/payments — transactions + payout summary
operatorRouter.get(
  "/payments",
  asyncHandler(async (req, res) => {
    const opId = await resolveVerifiedOperatorId(req.auth!.sub);
    const today = startOfToday();
    const p = parsePage(req, 10);
    const where = { booking: { trip: { operatorId: opId } } };
    const [payments, total] = await prisma.$transaction([
      prisma.payment.findMany({ where, include: { booking: true }, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take }),
      prisma.payment.count({ where }),
    ]);
    const paidToday = await prisma.payment.findMany({ where: { status: "PAID", createdAt: { gte: today }, booking: { trip: { operatorId: opId } } } });
    const gross = paidToday.reduce((s, pay) => s + dec(pay.amount), 0);
    const fee = gross * 0.12;
    res.json({
      transactions: paged(
        payments.map((pay) => ({
          id: pay.reference,
          booking: pay.booking.reference,
          method: pay.method,
          amount: dec(pay.amount),
          status: pay.status,
        })),
        total,
        p
      ),
      payout: {
        grossToday: Number(gross.toFixed(2)),
        fee: Number(fee.toFixed(2)),
        net: Number((gross - fee).toFixed(2)),
        nextPayout: Number((gross - fee).toFixed(2)),
      },
    });
  })
);
