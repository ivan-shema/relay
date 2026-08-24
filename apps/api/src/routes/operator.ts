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
  operatorOnboardingSchema,
} from "@relay/shared";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { requireAuth, requireRole } from "../middleware/auth";
import { hashPassword, generateTempPassword } from "../lib/auth";
import { sendCredentialsEmail } from "../lib/mailer";
import { parsePage, paged } from "../lib/pagination";
import { fullNameOf } from "../lib/mappers";
import { upload, requireFile } from "../lib/uploads";
import { storeFile, deleteFile, fromMulter } from "../lib/storage";
import { paypackEnabled, normalizeMomoNumber, momoProviderLabel, requestCashout, fetchTransferOutcome } from "../lib/paypack";
import { settlePayout } from "../lib/settlement";
import { notify } from "../lib/notify";
import { parseReportRange, reportBuckets, bucketSums, toCsv, sendCsv, fileStamp, primaryMode, round2, dec as rdec, BUS_PLATFORM_FEE_PCT, type ReportRange } from "../lib/reports";

export const operatorRouter = Router();

/* -------- Operator onboarding (accessible to any authenticated user) --------
   A passenger applies from their dashboard: this creates a PENDING company +
   KYC docs linked to their account. The user stays a PASSENGER — an admin's
   approval is what promotes them to OPERATOR and unlocks the console. These two
   routes are declared BEFORE the operator-role guard below, so a passenger can
   reach them. */

// GET /operator/application — the caller's own application status, or null if
// they haven't applied. Used by the passenger app to show "under review".
operatorRouter.get(
  "/application",
  requireAuth,
  asyncHandler(async (req, res) => {
    const op = await prisma.operator.findFirst({ where: { ownerUserId: req.auth!.sub }, include: { documents: true } });
    // Full details so a rejected application can be edited in place.
    res.json(
      op
        ? {
            status: op.status,
            companyName: op.companyName,
            contactInfo: op.contactInfo,
            idNumber: op.idNumber,
            modes: op.modes,
            rejectionReason: op.rejectionReason,
            reviewedAt: op.reviewedAt?.toISOString() ?? null,
            documents: op.documents.map((d) => ({ id: d.id, kind: d.kind, fileName: d.fileName, mimeType: d.mimeType })),
          }
        : null
    );
  })
);

// POST /operator/apply (multipart) — company details + KYC (applicant ID/passport
// + RDB business certificate). Creates the company as PENDING for the current user.
operatorRouter.post(
  "/apply",
  requireAuth,
  upload.fields([
    { name: "idDocument", maxCount: 1 },
    { name: "businessCertificate", maxCount: 1 },
  ]),
  asyncHandler(async (req, res) => {
    const data = operatorOnboardingSchema.parse(req.body);
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const idDocument = files?.idDocument?.[0] ?? null;
    const businessCertificate = files?.businessCertificate?.[0] ?? null;

    // One application per account. A rejected one is edited in place: the same
    // record goes back to PENDING with the reason cleared, details updated, and
    // only the documents that were re-uploaded replaced — so the applicant fixes
    // exactly what was flagged and the admin sees one history per company.
    const existing = await prisma.operator.findFirst({ where: { ownerUserId: req.auth!.sub }, include: { documents: true } });
    if (existing && existing.status !== "REJECTED") {
      throw new HttpError(409, "You already have an operator application on file");
    }
    if (!existing && (!idDocument || !businessCertificate)) {
      throw new HttpError(400, "Both your ID document and RDB business certificate are required");
    }

    const details = { companyName: data.companyName, contactInfo: data.contactInfo, idNumber: data.idNumber, modes: data.modes };
    const uploads = [
      idDocument && { kind: "NATIONAL_ID" as const, file: idDocument },
      businessCertificate && { kind: "BUSINESS_CERTIFICATE" as const, file: businessCertificate },
    ].filter((u): u is { kind: "NATIONAL_ID" | "BUSINESS_CERTIFICATE"; file: Express.Multer.File } => !!u);

    // Upload to storage first, then commit the rows. If the commit fails the
    // fresh uploads are removed again so nothing is left orphaned in storage.
    const stored = await Promise.all(
      uploads.map(async (u) => ({
        kind: u.kind,
        fileName: u.file.originalname,
        filePath: await storeFile(fromMulter(u.file), { folder: "kyc/operators", visibility: "private" }),
        mimeType: u.file.mimetype,
        size: u.file.size,
      }))
    );
    const replacedKinds = new Set<string>(stored.map((s) => s.kind));

    const operator = await prisma
      .$transaction(async (tx) => {
        const op = existing
          ? await tx.operator.update({
              where: { id: existing.id },
              data: { ...details, status: "PENDING", rejectionReason: null, reviewedAt: null },
            })
          : await tx.operator.create({ data: { ...details, status: "PENDING", ownerUserId: req.auth!.sub } });
        if (existing && stored.length) {
          await tx.document.deleteMany({ where: { operatorId: op.id, kind: { in: stored.map((s) => s.kind) } } });
        }
        if (stored.length) await tx.document.createMany({ data: stored.map((s) => ({ ...s, operatorId: op.id })) });
        return op;
      })
      .catch(async (e: unknown) => {
        await Promise.all(stored.map((s) => deleteFile(s.filePath)));
        throw e;
      });

    // The replaced documents' rows are gone (committed above) — delete their
    // files from storage too; nothing references them any more.
    if (existing) {
      await Promise.all(existing.documents.filter((d) => replacedKinds.has(d.kind)).map((d) => deleteFile(d.filePath)));
    }

    res.status(201).json({ id: operator.id, status: operator.status });
  })
);

// Everything below requires an approved OPERATOR (or ADMIN) account.
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
      prisma.vehicle.findMany({ where, include: { driver: { include: { user: true } } }, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take }),
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

// GET /operator/routes — paginated. Routes with no departures MUST still be
// listed — a freshly created route starts empty, and hiding it looks like a
// silent failure. cuid ids sort chronologically, so id desc = newest first
// (Route has no createdAt column) and a just-created route lands on page 1.
operatorRouter.get(
  "/routes",
  asyncHandler(async (req, res) => {
    const opId = await resolveVerifiedOperatorId(req.auth!.sub);
    const p = parsePage(req, 8);
    const [routes, total] = await prisma.$transaction([
      prisma.route.findMany({
        include: { origin: true, destination: true, trips: { where: { operatorId: opId }, include: { bookings: true } } },
        orderBy: { id: "desc" },
        skip: p.skip,
        take: p.take,
      }),
      prisma.route.count(),
    ]);
    res.json(
      paged(
        routes.map((r) => {
          const totalCap = r.trips.reduce((s, t) => s + t.capacity, 0);
          const booked = r.trips.reduce((s, t) => s + t.bookings.length, 0);
          const fare = r.trips[0] ? dec(r.trips[0].fare) : 0;
          const hasTrips = r.trips.length > 0;
          return {
            id: r.id,
            name: r.name,
            from: r.origin.name,
            to: r.destination.name,
            stops: `${Math.round(r.distanceKm)} km`,
            buses: hasTrips ? `${r.trips.length} trips` : "No departures yet",
            freq: hasTrips ? "every 15 min" : "not visible to passengers",
            util: totalCap ? Math.min(100, Math.round((booked / totalCap) * 100)) : 0,
            fare,
          };
        }),
        total,
        p
      )
    );
  })
);

// GET /operator/routes/lookup — all routes as select options for the
// "Add departure" form (the paginated list above only carries one page).
operatorRouter.get(
  "/routes/lookup",
  asyncHandler(async (req, res) => {
    await resolveVerifiedOperatorId(req.auth!.sub); // authz
    const routes = await prisma.route.findMany({ orderBy: { name: "asc" }, take: 200 });
    res.json(routes.map((r) => ({ value: r.id, label: r.name })));
  })
);

// Resolve a typed place name to a Place row — reuse an existing stop when the
// name matches (case-insensitive), otherwise register it as a new one so
// operators aren't limited to the pre-seeded list.
async function findOrCreatePlace(rawName: string) {
  const name = rawName.trim();
  const existing = await prisma.place.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (existing) return existing;
  // New stops get placeholder coordinates near Kigali's centre until real
  // geocoding lands (maps/GPS are mocked platform-wide).
  return prisma.place.create({
    data: {
      name,
      area: "Kigali",
      lat: -1.9499 + (Math.random() - 0.5) * 0.05,
      lng: 30.0589 + (Math.random() - 0.5) * 0.05,
    },
  });
}

// POST /operator/routes — create a route between two places, typed or picked
operatorRouter.post(
  "/routes",
  asyncHandler(async (req, res) => {
    await resolveVerifiedOperatorId(req.auth!.sub); // authz
    const body = createRouteSchema.parse(req.body);
    const origin = await findOrCreatePlace(body.origin);
    const destination = await findOrCreatePlace(body.destination);
    if (origin.id === destination.id) throw new HttpError(400, "Origin and destination must differ");

    // same pair already exists → reuse instead of duplicating
    const existingRoute = await prisma.route.findFirst({ where: { originId: origin.id, destinationId: destination.id } });
    if (existingRoute) {
      res.json({ id: existingRoute.id, name: existingRoute.name });
      return;
    }

    const route = await prisma.route.create({
      data: { name: `${origin.name} → ${destination.name}`, originId: origin.id, destinationId: destination.id, distanceKm: body.distanceKm },
    });
    res.status(201).json({ id: route.id, name: route.name });
  })
);

// POST /operator/departures — publish a bookable trip. Resolves any passenger
// "Plan ahead" watches on this route: the watch links to the new trip and its
// owner gets a "match found" notification.
operatorRouter.post(
  "/departures",
  asyncHandler(async (req, res) => {
    const opId = await resolveVerifiedOperatorId(req.auth!.sub);
    const body = createDepartureSchema.parse(req.body);
    const route = await prisma.route.findUnique({ where: { id: body.routeId }, include: { origin: true, destination: true } });
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

    // Watches store free-text labels ("Remera") while places have fuller names
    // ("Remera Hub"), so match by containment either way, case-insensitively.
    // Watch volume is tiny, so filtering in JS beats contorting the query.
    const placeMatch = (label: string, place: string) => {
      const l = label.trim().toLowerCase();
      const p = place.trim().toLowerCase();
      return l.length > 0 && (p.includes(l) || l.includes(p));
    };
    const candidates = await prisma.plannedTrip.findMany({ where: { matchedTripId: null }, take: 500 });
    const watches = candidates.filter(
      (w) => placeMatch(w.originLabel, route.origin.name) && placeMatch(w.destLabel, route.destination.name)
    );
    const timeLabel = departAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    for (const w of watches) {
      await prisma.plannedTrip.update({ where: { id: w.id }, data: { matchedTripId: trip.id } });
      if (w.notify) {
        await notify(w.passengerId, "Trip match found", `${route.name} departs at ${timeLabel} — a trip you planned ahead for is now bookable.`);
      }
    }

    res.status(201).json({ id: trip.id, matchedWatches: watches.length });
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

    // Without an email the driver gets a synthetic, undeliverable address and
    // the temp password is returned to the operator to hand over in person.
    const hasEmail = !!body.email && body.email.length > 0;
    const email = hasEmail ? body.email! : `${body.phone.replace(/\D/g, "")}@drivers.relay.app`;
    const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { phone: body.phone }] } });
    if (existing) throw new HttpError(409, "Phone or email already registered");

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);
    // Upload the KYC files first; roll them back if the account rows fail.
    const [idKey, licenseKey] = await Promise.all([
      storeFile(fromMulter(idDocument), { folder: "kyc/drivers", visibility: "private" }),
      storeFile(fromMulter(licenseDocument), { folder: "kyc/drivers", visibility: "private" }),
    ]);
    const driver = await prisma
      .$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { firstName: body.firstName, lastName: body.lastName, email, phone: body.phone, passwordHash, role: "DRIVER", credentialsEmailed: hasEmail },
        });
        const d = await tx.driver.create({
          data: { userId: user.id, operatorId: opId, licenseNumber: body.licenseNumber, nationalId: body.idNumber },
        });
        await tx.document.createMany({
          data: [
            { kind: "NATIONAL_ID", fileName: idDocument.originalname, filePath: idKey, mimeType: idDocument.mimetype, size: idDocument.size, driverId: d.id },
            { kind: "DRIVING_LICENSE", fileName: licenseDocument.originalname, filePath: licenseKey, mimeType: licenseDocument.mimetype, size: licenseDocument.size, driverId: d.id },
          ],
        });
        return d;
      })
      .catch(async (e: unknown) => {
        await Promise.all([deleteFile(idKey), deleteFile(licenseKey)]);
        throw e;
      });
    if (hasEmail) {
      const op = await prisma.operator.findUnique({ where: { id: opId } });
      sendCredentialsEmail({ email, firstName: body.firstName }, { tempPassword, roleLabel: "driver", createdBy: op?.companyName ?? "Your operator" });
    }
    res.status(201).json({ id: driver.id, credentialsSentTo: hasEmail ? email : null, tempPassword: hasEmail ? undefined : tempPassword });
  })
);

// Today's withdrawable balance: net of Relay's fee, minus what was already
// paid out (or is in flight) today. Failed payouts return to the pool.
async function withdrawableToday(opId: string): Promise<number> {
  const today = startOfToday();
  const [paid, payouts] = await Promise.all([
    prisma.payment.findMany({ where: { status: "PAID", createdAt: { gte: today }, booking: { trip: { operatorId: opId } } } }),
    prisma.payout.findMany({ where: { operatorId: opId, createdAt: { gte: today }, status: { not: "FAILED" } } }),
  ]);
  const gross = paid.reduce((s, p) => s + dec(p.amount), 0);
  const alreadyOut = payouts.reduce((s, p) => s + dec(p.amount), 0);
  return gross * 0.88 - alreadyOut;
}

// POST /operator/payout — withdraw today's net earnings. Real money only: a
// Paypack MoMo/Airtel cashout to the owner's phone, PENDING until the provider
// confirms. Requires Paypack credentials — no mock fallback.
operatorRouter.post(
  "/payout",
  asyncHandler(async (req, res) => {
    const opId = await resolveVerifiedOperatorId(req.auth!.sub);
    const net = await withdrawableToday(opId);
    if (net < 100) throw new HttpError(409, "Nothing to withdraw yet"); // Paypack minimum transfer is RWF 100
    const reference = "PO-" + Math.random().toString(36).slice(2, 9).toUpperCase();

    const owner = await prisma.user.findUnique({ where: { id: req.auth!.sub } });
    const number = normalizeMomoNumber(owner!.phone);
    const amount = Math.floor(net); // whole RWF; the remainder stays withdrawable
    const transfer = await requestCashout(amount, number);
    const payout = await prisma.payout.create({
      data: { reference, operatorId: opId, amount, method: momoProviderLabel(number), status: "PENDING", momoRef: transfer.ref },
    });
    res.status(201).json({ amount, reference: payout.reference, status: "PENDING" });
  })
);

// GET /operator/payout/:reference/status — poll a withdrawal while Paypack
// processes it (works without a publicly reachable webhook in local dev).
operatorRouter.get(
  "/payout/:reference/status",
  asyncHandler(async (req, res) => {
    const opId = await resolveVerifiedOperatorId(req.auth!.sub);
    const payout = await prisma.payout.findUnique({ where: { reference: req.params.reference } });
    if (!payout || payout.operatorId !== opId) throw new HttpError(404, "Payout not found");

    let status = payout.status;
    if (status === "PENDING" && payout.momoRef && paypackEnabled) {
      const outcome = await fetchTransferOutcome(payout.momoRef, "CASHOUT");
      if (outcome !== "pending") {
        await settlePayout(payout.momoRef, outcome);
        status = outcome === "successful" ? "COMPLETED" : "FAILED";
      }
    }
    res.json({ status, amount: dec(payout.amount), reference: payout.reference });
  })
);

// GET /operator/schedule — upcoming departures
operatorRouter.get(
  "/schedule",
  asyncHandler(async (req, res) => {
    const opId = await resolveVerifiedOperatorId(req.auth!.sub);
    const p = parsePage(req, 8);
    // Upcoming/active departures only — finished trips would otherwise pile up
    // at the top of the ascending list forever and push every newly published
    // departure onto a later page, making "Add departure" look like a no-op.
    const where = { operatorId: opId, arriveAt: { gt: new Date() } };
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
      prisma.driver.findMany({ where, include: { user: true, vehicle: true }, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take }),
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
    await notify(d.userId, "New trip assigned", "You've been assigned to an upcoming departure.");
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
        include: { passenger: true, tickets: true, trip: { include: { route: true } } },
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
          bookingId: b.id,
          passenger: fullNameOf(b.passenger),
          route: b.trip.route.name,
          mode: (b.trip.legs as { mode: string }[]).map((l) => l.mode).join(" + "),
          fare: dec(b.fare),
          status: b.status,
          // Never expose per-ticket codes/ids here — boarding must come from
          // the code on the ticket the passenger presents, not from this list.
          ticketsBoarded: b.tickets.filter((t) => t.boarded).length,
          ticketsTotal: b.tickets.length,
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
    // What's actually left to withdraw (net of fee AND of today's payouts)
    const withdrawable = Math.max(0, await withdrawableToday(opId));
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
        net: Number(withdrawable.toFixed(2)),
        nextPayout: Number(withdrawable.toFixed(2)),
      },
    });
  })
);

/* ---------------- Reports ----------------
   The company's own numbers for a time window: revenue and the platform fee
   taken from it, bookings and cancellations, occupancy of the trips that ran,
   and the route / driver breakdowns — plus a CSV of every booking in the
   window so finance can reconcile against payouts. */

async function operatorReportData(opId: string, range: ReportRange) {
  const { start, end } = range;
  const [bookings, trips, ratings] = await Promise.all([
    prisma.booking.findMany({
      where: { createdAt: { gte: start, lt: end }, trip: { operatorId: opId } },
      include: { payment: true, trip: { include: { route: true, driver: { include: { user: true } } } } },
    }),
    prisma.trip.findMany({
      where: { operatorId: opId, departAt: { gte: start, lt: end } },
      include: { route: true, bookings: { select: { seats: true, status: true } } },
    }),
    prisma.rating.findMany({ where: { createdAt: { gte: start, lt: end }, booking: { trip: { operatorId: opId } } } }),
  ]);

  const paidOf = (b: (typeof bookings)[number]) => (b.payment?.status === "PAID" ? rdec(b.payment.amount) : 0);
  const revenue = bookings.reduce((s, b) => s + paidOf(b), 0);
  const platformFee = revenue * (BUS_PLATFORM_FEE_PCT / 100);
  const paidBookings = bookings.filter((b) => b.payment?.status === "PAID");
  const cancelled = bookings.filter((b) => b.status === "CANCELLED").length;
  const seatsSold = trips.reduce((s, t) => s + t.bookings.filter((b) => b.status !== "CANCELLED").reduce((x, b) => x + b.seats, 0), 0);
  const capacity = trips.reduce((s, t) => s + t.capacity, 0);
  const avgRating = ratings.length ? round2(ratings.reduce((s, r) => s + r.score, 0) / ratings.length) : null;

  const routeAgg = new Map<string, { route: string; trips: number; bookings: number; seats: number; revenue: number; capacity: number }>();
  for (const t of trips) {
    const e = routeAgg.get(t.routeId) ?? { route: t.route.name, trips: 0, bookings: 0, seats: 0, revenue: 0, capacity: 0 };
    e.trips += 1; e.capacity += t.capacity;
    e.seats += t.bookings.filter((b) => b.status !== "CANCELLED").reduce((x, b) => x + b.seats, 0);
    routeAgg.set(t.routeId, e);
  }
  for (const b of bookings) {
    const e = routeAgg.get(b.trip.routeId) ?? { route: b.trip.route.name, trips: 0, bookings: 0, seats: 0, revenue: 0, capacity: 0 };
    e.bookings += 1; e.revenue += paidOf(b);
    routeAgg.set(b.trip.routeId, e);
  }
  const byRoute = [...routeAgg.values()]
    .map((r) => ({ ...r, revenue: round2(r.revenue), occupancyPct: r.capacity ? Math.min(100, Math.round((r.seats / r.capacity) * 100)) : 0 }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  const driverAgg = new Map<string, { driver: string; bookings: number; completed: number; revenue: number; scores: number[] }>();
  for (const b of bookings) {
    const d = b.trip.driver;
    if (!d) continue;
    const e = driverAgg.get(d.id) ?? { driver: fullNameOf(d.user), bookings: 0, completed: 0, revenue: 0, scores: [] };
    e.bookings += 1; e.revenue += paidOf(b);
    if (b.status === "COMPLETED") e.completed += 1;
    driverAgg.set(d.id, e);
  }
  const ratingByBooking = new Map(ratings.map((r) => [r.bookingId, r.score]));
  for (const b of bookings) {
    const score = ratingByBooking.get(b.id);
    if (score !== undefined && b.trip.driverId) driverAgg.get(b.trip.driverId)?.scores.push(score);
  }
  const byDriver = [...driverAgg.values()]
    .map((d) => ({ driver: d.driver, bookings: d.bookings, completed: d.completed, revenue: round2(d.revenue), rating: d.scores.length ? round2(d.scores.reduce((s, x) => s + x, 0) / d.scores.length) : null }))
    .sort((a, b) => b.revenue - a.revenue);

  const MODE_LABEL: Record<string, string> = { BUS: "Bus", MOTO: "Moto-taxi", RIDE: "Shared ride" };
  const modeAgg = new Map<string, { bookings: number; revenue: number }>();
  for (const b of bookings) {
    const m = primaryMode(b.trip.legs);
    const e = modeAgg.get(m) ?? { bookings: 0, revenue: 0 };
    e.bookings += 1; e.revenue += paidOf(b);
    modeAgg.set(m, e);
  }
  const byMode = [...modeAgg.entries()].map(([mode, v]) => ({ mode, label: MODE_LABEL[mode] ?? mode, bookings: v.bookings, revenue: round2(v.revenue), pct: revenue ? Math.round((v.revenue / revenue) * 100) : 0 })).sort((a, b) => b.revenue - a.revenue);

  const statusAgg = new Map<string, number>();
  for (const b of bookings) statusAgg.set(b.status, (statusAgg.get(b.status) ?? 0) + 1);
  const byStatus = [...statusAgg.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count);

  const revenueBars = bucketSums(reportBuckets(range), paidBookings.map((b) => ({ at: b.payment!.createdAt, value: rdec(b.payment!.amount) })));

  return {
    period: range.period,
    label: range.label,
    from: range.start.toISOString(),
    to: range.end.toISOString(),
    kpis: {
      revenue: round2(revenue),
      platformFee: round2(platformFee),
      platformFeePct: BUS_PLATFORM_FEE_PCT,
      net: round2(revenue - platformFee),
      bookings: bookings.length,
      paidBookings: paidBookings.length,
      cancelled,
      cancelRate: bookings.length ? Math.round((cancelled / bookings.length) * 100) : 0,
      tripsRun: trips.length,
      seatsSold,
      capacity,
      occupancyPct: capacity ? Math.min(100, Math.round((seatsSold / capacity) * 100)) : 0,
      avgFare: paidBookings.length ? round2(revenue / paidBookings.length) : 0,
      avgRating,
      ratingsCount: ratings.length,
    },
    revenueBars,
    byRoute,
    byDriver,
    byMode,
    byStatus,
  };
}

// GET /operator/reports?period=…  |  ?from=&to=
operatorRouter.get(
  "/reports",
  asyncHandler(async (req, res) => {
    const opId = await resolveVerifiedOperatorId(req.auth!.sub);
    res.json(await operatorReportData(opId, parseReportRange(req)));
  })
);

// GET /operator/reports/export — every booking in the window, as CSV
operatorRouter.get(
  "/reports/export",
  asyncHandler(async (req, res) => {
    const opId = await resolveVerifiedOperatorId(req.auth!.sub);
    const range = parseReportRange(req, "month");
    const bookings = await prisma.booking.findMany({
      where: { createdAt: { gte: range.start, lt: range.end }, trip: { operatorId: opId } },
      include: { passenger: true, payment: true, rating: true, trip: { include: { route: true, driver: { include: { user: true } }, vehicle: true } } },
      orderBy: { createdAt: "desc" },
    });
    sendCsv(res, `bookings_${fileStamp(range)}.csv`, toCsv(
      ["reference", "booked_at", "passenger", "phone", "route", "mode", "depart_at", "driver", "vehicle", "seats", "fare_rwf", "platform_fee_rwf", "net_rwf", "payment_method", "payment_status", "booking_status", "rating"],
      bookings.map((b) => {
        const paid = b.payment?.status === "PAID" ? rdec(b.payment.amount) : 0;
        const fee = round2(paid * (BUS_PLATFORM_FEE_PCT / 100));
        return [
          b.reference, b.createdAt, fullNameOf(b.passenger), b.passenger.phone, b.trip.route.name, primaryMode(b.trip.legs), b.trip.departAt,
          b.trip.driver ? fullNameOf(b.trip.driver.user) : "", b.trip.vehicle?.plateNumber ?? "", b.seats, rdec(b.fare), fee, round2(paid - fee),
          b.payment?.method ?? "", b.payment?.status ?? "NONE", b.status, b.rating?.score ?? "",
        ];
      })
    ));
  })
);
