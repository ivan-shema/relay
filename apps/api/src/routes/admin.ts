import { Router } from "express";
import { Prisma } from "@prisma/client";
import { formatRWF, createUserSchema } from "@relay/shared";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { requireAuth, requireRole } from "../middleware/auth";
import { hashPassword } from "../lib/auth";
import { parsePage, paged } from "../lib/pagination";
import { fullNameOf } from "../lib/mappers";
import { notify } from "../lib/notify";
import { fetchMerchantBalances } from "../lib/paypack";
import { getMotoCommissionPct, setMotoCommissionPct } from "../lib/settings";
import { z } from "zod";
import { parseReportRange, reportBuckets, bucketSums, toCsv, sendCsv, fileStamp, primaryMode, round2, dec as rdec, BUS_PLATFORM_FEE_PCT, type ReportRange } from "../lib/reports";

export const adminRouter = Router();

const zSettings = z.object({
  motoCommissionPct: z.coerce.number().min(0, "Can't be negative").max(50, "Commission above 50% is not allowed"),
});

adminRouter.use(requireAuth, requireRole("ADMIN"));

function dec(v: Prisma.Decimal | number): number {
  return typeof v === "number" ? v : Number(v.toString());
}
function fmtDate(d: Date) {
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

const TYPE_META: Record<string, { label: string; color: string; bg: string }> = {
  BUS: { label: "Bus", color: "#2f6bff", bg: "#e9f0ff" },
  MOTO: { label: "Moto-taxi", color: "#ff6a1a", bg: "#fff0e6" },
  RIDE: { label: "Shared ride", color: "#7c5cff", bg: "#efeaff" },
};

function operatorTypeLabel(modes: string[]): { type: string; color: string; bg: string } {
  const primary = modes[0] ?? "BUS";
  const meta = TYPE_META[primary] ?? TYPE_META.BUS;
  return { type: modes.length > 1 ? `${meta.label} +${modes.length - 1}` : meta.label, color: meta.color, bg: meta.bg };
}

type ApprovalOperator = Prisma.OperatorGetPayload<{ include: { documents: true; ownerUser: true } }>;

// Full applicant + KYC detail for the admin review panel.
function mapApproval(o: ApprovalOperator) {
  const t = operatorTypeLabel(o.modes);
  return {
    id: o.id,
    company: o.companyName,
    type: t.type,
    color: t.color,
    bg: t.bg,
    initial: o.companyName[0]?.toUpperCase() ?? "?",
    vehicles: "fleet pending",
    date: fmtDate(o.createdAt),
    submittedAt: o.createdAt.toISOString(),
    applicant: o.ownerUser ? fullNameOf(o.ownerUser) : null,
    email: o.ownerUser?.email ?? null,
    phone: o.ownerUser?.phone ?? null,
    contactInfo: o.contactInfo,
    idNumber: o.idNumber,
    modes: o.modes.map((m) => TYPE_META[m]?.label ?? m),
    documents: o.documents.map((doc) => ({ id: doc.id, kind: doc.kind, fileName: doc.fileName, mimeType: doc.mimeType })),
  };
}

// GET /admin/overview — KPIs, approvals, revenue, complaints
adminRouter.get(
  "/overview",
  asyncHandler(async (_req, res) => {
    const [users, operators, trips, paidAll, pendingOps, complaints, paypack] = await Promise.all([
      prisma.user.count(),
      prisma.operator.count(),
      prisma.booking.count(),
      prisma.payment.findMany({ where: { status: "PAID" } }),
      prisma.operator.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, include: { documents: true, ownerUser: true } }),
      prisma.complaint.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 4 }),
      fetchMerchantBalances(), // null when Paypack isn't configured/reachable
    ]);
    const revenue = paidAll.reduce((s, p) => s + dec(p.amount), 0);

    // 6-month revenue bars (mostly synthetic history + real current bucket)
    const base = [0.42, 0.55, 0.6, 0.78, 0.9, 1].map((f) => Math.round(revenue * f * 100) / 100);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];

    res.json({
      kpis: [
        { label: "Total users", value: users.toLocaleString(), sub: "all roles", delta: "+6%" },
        { label: "Operators", value: String(operators), sub: "onboarded", delta: `+${pendingOps.length}` },
        { label: "Trips", value: trips.toLocaleString(), sub: "all time", delta: "+11%" },
        { label: "Revenue", value: formatRWF(revenue), sub: "processed", delta: "+19%" },
      ],
      approvals: pendingOps.map(mapApproval),
      revenueBars: months.map((m, i) => ({ m, value: base[i] })),
      complaints: complaints.map((c) => ({ id: c.id, who: c.who, message: c.message, priority: c.priority })),
      // Paypack merchant float — the real money the platform holds
      paypack,
    });
  })
);

// GET /admin/users
adminRouter.get(
  "/users",
  asyncHandler(async (req, res) => {
    const role = req.query.role ? String(req.query.role).toUpperCase() : undefined;
    const p = parsePage(req, 10);
    const where = role && ["PASSENGER", "DRIVER", "OPERATOR", "ADMIN"].includes(role) ? { role: role as never } : {};
    const [users, total] = await prisma.$transaction([
      prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take }),
      prisma.user.count({ where }),
    ]);
    res.json(
      paged(
        users.map((u) => ({
          id: u.id,
          name: fullNameOf(u),
          role: u.role,
          phone: u.phone,
          joined: fmtDate(u.createdAt),
          status: u.phoneVerified ? "ACTIVE" : "PENDING",
        })),
        total,
        p
      )
    );
  })
);

// POST /admin/users — create a platform user. Creating an OPERATOR here also
// creates their company record, already VERIFIED (admin creation is itself
// the trust/approval signal — no pending step).
adminRouter.post(
  "/users",
  asyncHandler(async (req, res) => {
    const body = createUserSchema.parse(req.body);
    const existing = await prisma.user.findFirst({ where: { OR: [{ email: body.email }, { phone: body.phone }] } });
    if (existing) throw new HttpError(409, "Email or phone already registered");
    const passwordHash = await hashPassword("password123");
    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { firstName: body.firstName, lastName: body.lastName, email: body.email, phone: body.phone, role: body.role, passwordHash, phoneVerified: true },
      });
      if (body.role === "DRIVER") {
        await tx.driver.create({ data: { userId: u.id, licenseNumber: "PENDING" } });
      }
      if (body.role === "OPERATOR") {
        await tx.operator.create({
          data: { companyName: body.companyName!, contactInfo: body.phone, modes: body.modes ?? ["BUS"], status: "VERIFIED", ownerUserId: u.id },
        });
      }
      return u;
    });
    res.status(201).json({ id: user.id });
  })
);

// GET /admin/operators
adminRouter.get(
  "/operators",
  asyncHandler(async (req, res) => {
    const p = parsePage(req, 10);
    const [operators, total] = await prisma.$transaction([
      prisma.operator.findMany({ include: { vehicles: true, drivers: true }, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take }),
      prisma.operator.count(),
    ]);
    const result = await Promise.all(
      operators.map(async (o) => {
        const paid = await prisma.payment.aggregate({ _sum: { amount: true }, where: { status: "PAID", booking: { trip: { operatorId: o.id } } } });
        const t = operatorTypeLabel(o.modes);
        return {
          id: o.id,
          company: o.companyName,
          type: t.type,
          color: t.color,
          bg: t.bg,
          vehicles: o.vehicles.length,
          drivers: o.drivers.length,
          revenue: dec(paid._sum.amount ?? new Prisma.Decimal(0)),
          status: o.status,
        };
      })
    );
    res.json(paged(result, total, p));
  })
);

// GET /admin/approvals — pending operators with their KYC details/documents
adminRouter.get(
  "/approvals",
  asyncHandler(async (_req, res) => {
    const ops = await prisma.operator.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      include: { documents: true, ownerUser: true },
    });
    res.json(ops.map(mapApproval));
  })
);

type OperatorDetailPayload = Prisma.OperatorGetPayload<{
  include: { documents: true; ownerUser: true; vehicles: true; drivers: true };
}>;

// Full detail for one operator, any status — the "View" action from the
// Operators list. Same shape as an approval, plus real fleet/revenue numbers
// instead of "fleet pending".
function mapOperatorDetail(o: OperatorDetailPayload, revenue: number) {
  const t = operatorTypeLabel(o.modes);
  return {
    id: o.id,
    company: o.companyName,
    type: t.type,
    color: t.color,
    bg: t.bg,
    initial: o.companyName[0]?.toUpperCase() ?? "?",
    status: o.status,
    date: fmtDate(o.createdAt),
    submittedAt: o.createdAt.toISOString(),
    applicant: o.ownerUser ? fullNameOf(o.ownerUser) : null,
    email: o.ownerUser?.email ?? null,
    phone: o.ownerUser?.phone ?? null,
    contactInfo: o.contactInfo,
    idNumber: o.idNumber,
    modes: o.modes.map((m) => TYPE_META[m]?.label ?? m),
    vehicles: o.vehicles.length,
    drivers: o.drivers.length,
    revenue,
    documents: o.documents.map((doc) => ({ id: doc.id, kind: doc.kind, fileName: doc.fileName, mimeType: doc.mimeType })),
  };
}

// GET /admin/operators/:id — full detail for the Operators list "View" action
adminRouter.get(
  "/operators/:id",
  asyncHandler(async (req, res) => {
    const o = await prisma.operator.findUnique({
      where: { id: req.params.id },
      include: { documents: true, ownerUser: true, vehicles: true, drivers: true },
    });
    if (!o) throw new HttpError(404, "Operator not found");
    const paid = await prisma.payment.aggregate({
      _sum: { amount: true },
      where: { status: "PAID", booking: { trip: { operatorId: o.id } } },
    });
    res.json(mapOperatorDetail(o, dec(paid._sum.amount ?? new Prisma.Decimal(0))));
  })
);

// POST /admin/operators/:id/suspend — pull a verified operator's access
// (e.g. a compliance issue found after approval).
adminRouter.post(
  "/operators/:id/suspend",
  asyncHandler(async (req, res) => {
    const o = await prisma.operator.findUnique({ where: { id: req.params.id } });
    if (!o) throw new HttpError(404, "Operator not found");
    await prisma.operator.update({ where: { id: o.id }, data: { status: "SUSPENDED" } });
    res.json({ status: "SUSPENDED" });
  })
);

// POST /admin/operators/:id/reinstate — restore a suspended operator to VERIFIED
adminRouter.post(
  "/operators/:id/reinstate",
  asyncHandler(async (req, res) => {
    const o = await prisma.operator.findUnique({ where: { id: req.params.id } });
    if (!o) throw new HttpError(404, "Operator not found");
    await prisma.operator.update({ where: { id: o.id }, data: { status: "VERIFIED" } });
    res.json({ status: "VERIFIED" });
  })
);

// POST /admin/operators/:id/approve — verify the company AND promote its owner
// to the OPERATOR role. Applicants stay PASSENGERs while pending, so approval is
// what actually unlocks the operator console for them.
adminRouter.post(
  "/operators/:id/approve",
  asyncHandler(async (req, res) => {
    const op = await prisma.operator.findUnique({ where: { id: req.params.id } });
    if (!op) throw new HttpError(404, "Operator not found");
    await prisma.$transaction([
      prisma.operator.update({ where: { id: op.id }, data: { status: "VERIFIED" } }),
      ...(op.ownerUserId ? [prisma.user.update({ where: { id: op.ownerUserId }, data: { role: "OPERATOR" } })] : []),
    ]);
    if (op.ownerUserId) {
      await notify(op.ownerUserId, "Operator application approved", `${op.companyName} is verified — your operator console is now live.`);
    }
    res.json({ approved: true });
  })
);

// POST /admin/operators/:id/reject
adminRouter.post(
  "/operators/:id/reject",
  asyncHandler(async (req, res) => {
    const op = await prisma.operator.findUnique({ where: { id: req.params.id } });
    if (!op) throw new HttpError(404, "Operator not found");
    await prisma.operator.update({ where: { id: op.id }, data: { status: "SUSPENDED" } });
    if (op.ownerUserId) {
      await notify(op.ownerUserId, "Operator application rejected", `Your application for ${op.companyName} was not approved. Contact support for details.`);
    }
    res.json({ rejected: true });
  })
);

// GET /admin/payments — platform transactions
adminRouter.get(
  "/payments",
  asyncHandler(async (req, res) => {
    const pg = parsePage(req, 10);
    const [payments, count] = await prisma.$transaction([
      prisma.payment.findMany({
        include: { booking: { include: { passenger: true, trip: { include: { operator: true } } } } },
        orderBy: { createdAt: "desc" },
        skip: pg.skip,
        take: pg.take,
      }),
      prisma.payment.count(),
    ]);
    const paidAll = await prisma.payment.findMany({ where: { status: "PAID" } });
    const total = paidAll.reduce((s, p) => s + dec(p.amount), 0);
    const byMethod: Record<string, number> = {};
    for (const p of paidAll) byMethod[p.method] = (byMethod[p.method] ?? 0) + dec(p.amount);
    const pct = (m: string) => (total ? Math.round(((byMethod[m] ?? 0) / total) * 100) : 0);

    res.json({
      transactions: paged(
        payments.map((p) => ({
          id: p.reference,
          user: fullNameOf(p.booking.passenger),
          operator: p.booking.trip.operator.companyName,
          method: p.method,
          amount: dec(p.amount),
          status: p.status,
        })),
        count,
        pg
      ),
      summary: {
        total: Number(total.toFixed(2)),
        mobileMoney: pct("MOBILE_MONEY"),
        wallet: pct("WALLET"),
        qrCard: pct("QR"),
      },
    });
  })
);

/* ---------------- Reports ----------------
   One time window (?period=… or ?from=&to=), shared with the export so what
   the admin sees on screen is exactly what they download. Gross volume is
   bus/ride bookings (Payment PAID) + completed moto hails (escrow released);
   the platform's own take is the bus fee share + the locked moto commission. */

async function adminReportData(range: ReportRange) {
  const { start, end } = range;
  const [payments, rides, bookings] = await Promise.all([
    prisma.payment.findMany({
      where: { createdAt: { gte: start, lt: end } },
      include: { booking: { include: { passenger: true, trip: { include: { operator: true, route: true } } } } },
    }),
    prisma.rideRequest.findMany({
      where: { status: "COMPLETED", completedAt: { gte: start, lt: end } },
      include: { passenger: true, acceptedDriver: { include: { user: true } } },
    }),
    prisma.booking.findMany({
      where: { createdAt: { gte: start, lt: end } },
      include: { trip: { select: { legs: true, operatorId: true } } },
    }),
  ]);

  const paid = payments.filter((p) => p.status === "PAID");
  const busRevenue = paid.reduce((s, p) => s + rdec(p.amount), 0);
  const busFee = busRevenue * (BUS_PLATFORM_FEE_PCT / 100);
  const motoGross = rides.reduce((s, r) => s + rdec(r.agreedFare), 0);
  const motoCommission = rides.reduce((s, r) => s + rdec(r.commissionAmount), 0);
  const grossVolume = busRevenue + motoGross;
  const settledCount = paid.length + rides.length;

  const multimodal = bookings.filter((b) => Array.isArray(b.trip.legs) && (b.trip.legs as unknown[]).length > 1).length;

  // by mode — bookings use the trip's primary leg; every hail is MOTO
  const modeAgg = new Map<string, { bookings: number; revenue: number }>();
  for (const p of paid) {
    const m = primaryMode(p.booking.trip.legs);
    const e = modeAgg.get(m) ?? { bookings: 0, revenue: 0 };
    e.bookings += 1; e.revenue += rdec(p.amount);
    modeAgg.set(m, e);
  }
  if (rides.length) {
    const e = modeAgg.get("MOTO") ?? { bookings: 0, revenue: 0 };
    e.bookings += rides.length; e.revenue += motoGross;
    modeAgg.set("MOTO", e);
  }
  const MODE_LABEL: Record<string, string> = { BUS: "Bus", MOTO: "Moto-taxi", RIDE: "Shared ride" };
  const byMode = [...modeAgg.entries()]
    .map(([mode, v]) => ({ mode, label: MODE_LABEL[mode] ?? mode, bookings: v.bookings, revenue: round2(v.revenue), pct: grossVolume ? Math.round((v.revenue / grossVolume) * 100) : 0 }))
    .sort((a, b) => b.revenue - a.revenue);

  // by operator (bus/ride bookings only — moto hails are driver-direct)
  const opAgg = new Map<string, { name: string; bookings: number; revenue: number }>();
  for (const p of paid) {
    const op = p.booking.trip.operator;
    const e = opAgg.get(op.id) ?? { name: op.companyName, bookings: 0, revenue: 0 };
    e.bookings += 1; e.revenue += rdec(p.amount);
    opAgg.set(op.id, e);
  }
  const byOperator = [...opAgg.values()]
    .map((o) => ({ name: o.name, bookings: o.bookings, revenue: round2(o.revenue), platformFee: round2(o.revenue * (BUS_PLATFORM_FEE_PCT / 100)), netToOperator: round2(o.revenue * (1 - BUS_PLATFORM_FEE_PCT / 100)) }))
    .sort((a, b) => b.revenue - a.revenue);

  // by payment method (moto hails are wallet-escrow)
  const methodAgg = new Map<string, { count: number; amount: number }>();
  for (const p of paid) {
    const e = methodAgg.get(p.method) ?? { count: 0, amount: 0 };
    e.count += 1; e.amount += rdec(p.amount);
    methodAgg.set(p.method, e);
  }
  if (rides.length) {
    const e = methodAgg.get("WALLET") ?? { count: 0, amount: 0 };
    e.count += rides.length; e.amount += motoGross;
    methodAgg.set("WALLET", e);
  }
  const byMethod = [...methodAgg.entries()].map(([method, v]) => ({ method, count: v.count, amount: round2(v.amount) })).sort((a, b) => b.amount - a.amount);

  const statusAgg = new Map<string, number>();
  for (const b of bookings) statusAgg.set(b.status, (statusAgg.get(b.status) ?? 0) + 1);
  const bookingsByStatus = [...statusAgg.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count);

  const passengers = new Set<string>([...paid.map((p) => p.booking.passengerId), ...rides.map((r) => r.passengerId)]);

  const buckets = reportBuckets(range);
  const revenueBars = bucketSums(buckets, [
    ...paid.map((p) => ({ at: p.createdAt, value: rdec(p.amount) })),
    ...rides.map((r) => ({ at: r.completedAt ?? r.createdAt, value: rdec(r.agreedFare) })),
  ]);

  const avgFare = settledCount ? round2(grossVolume / settledCount) : 0;
  const multimodalPct = bookings.length ? Math.round((multimodal / bookings.length) * 100) : 0;

  return {
    period: range.period,
    label: range.label,
    from: range.start.toISOString(),
    to: range.end.toISOString(),
    kpis: {
      grossVolume: round2(grossVolume),
      busRevenue: round2(busRevenue),
      motoGross: round2(motoGross),
      platformTake: round2(busFee + motoCommission),
      busFee: round2(busFee),
      busFeePct: BUS_PLATFORM_FEE_PCT,
      motoCommission: round2(motoCommission),
      bookings: bookings.length,
      paidBookings: paid.length,
      rides: rides.length,
      avgFare,
      multimodalPct,
      activePassengers: passengers.size,
      cancelledBookings: bookings.filter((b) => b.status === "CANCELLED").length,
    },
    // legacy names still read by the dashboard cards
    tripsThisMonth: bookings.length,
    avgFare,
    multimodalPct,
    revenueBars,
    byMode,
    byOperator,
    byMethod,
    bookingsByStatus,
  };
}

// GET /admin/reports?period=week|month|year|all  |  ?from=YYYY-MM-DD&to=YYYY-MM-DD
adminRouter.get(
  "/reports",
  asyncHandler(async (req, res) => {
    res.json(await adminReportData(parseReportRange(req)));
  })
);

// GET /admin/reports/export?type=revenue|bookings|passengers|drivers&period|from&to
// The four report types the "Generate report" builder offers, as CSV.
const EXPORT_TYPES = ["revenue", "bookings", "passengers", "drivers"] as const;
adminRouter.get(
  "/reports/export",
  asyncHandler(async (req, res) => {
    const type = (EXPORT_TYPES as readonly string[]).includes(String(req.query.type)) ? (String(req.query.type) as (typeof EXPORT_TYPES)[number]) : "revenue";
    const range = parseReportRange(req, "all");
    const { start, end } = range;
    const stamp = fileStamp(range);

    if (type === "revenue") {
      const [payments, rides] = await Promise.all([
        prisma.payment.findMany({
          where: { createdAt: { gte: start, lt: end } },
          include: { booking: { include: { passenger: true, trip: { include: { operator: true, route: true } } } } },
          orderBy: { createdAt: "desc" },
        }),
        prisma.rideRequest.findMany({
          where: { status: "COMPLETED", completedAt: { gte: start, lt: end } },
          include: { passenger: true, acceptedDriver: { include: { user: true } } },
          orderBy: { completedAt: "desc" },
        }),
      ]);
      type Row = [string, Date, string, string, string, string, string, number, number, number, string];
      const rows: Row[] = [
        ...payments.map((p): Row => {
          const gross = rdec(p.amount);
          const fee = p.status === "PAID" ? round2(gross * (BUS_PLATFORM_FEE_PCT / 100)) : 0;
          return [p.reference, p.createdAt, "BOOKING", fullNameOf(p.booking.passenger), p.booking.trip.operator.companyName, p.booking.trip.route.name, p.method, gross, fee, round2(gross - fee), p.status];
        }),
        ...rides.map((r): Row => {
          const gross = rdec(r.agreedFare);
          const fee = rdec(r.commissionAmount);
          return [r.id, r.completedAt ?? r.createdAt, "MOTO_HAIL", fullNameOf(r.passenger), r.acceptedDriver ? fullNameOf(r.acceptedDriver.user) : "—", `${r.originLabel} → ${r.destLabel}`, "WALLET", gross, fee, round2(gross - fee), "COMPLETED"];
        }),
      ].sort((a, b) => b[1].getTime() - a[1].getTime());
      return sendCsv(res, `relay-revenue_${stamp}.csv`, toCsv(
        ["reference", "date", "kind", "passenger", "operator_or_driver", "route", "method", "gross_rwf", "platform_fee_rwf", "net_rwf", "status"],
        rows
      ));
    }

    if (type === "bookings") {
      const bookings = await prisma.booking.findMany({
        where: { createdAt: { gte: start, lt: end } },
        include: { passenger: true, payment: true, trip: { include: { operator: true, route: true, driver: { include: { user: true } }, vehicle: true } } },
        orderBy: { createdAt: "desc" },
      });
      return sendCsv(res, `relay-bookings_${stamp}.csv`, toCsv(
        ["reference", "booked_at", "passenger", "operator", "route", "mode", "depart_at", "driver", "vehicle", "seats", "fare_rwf", "payment_status", "booking_status"],
        bookings.map((b) => [
          b.reference, b.createdAt, fullNameOf(b.passenger), b.trip.operator.companyName, b.trip.route.name, primaryMode(b.trip.legs), b.trip.departAt,
          b.trip.driver ? fullNameOf(b.trip.driver.user) : "", b.trip.vehicle?.plateNumber ?? "", b.seats, rdec(b.fare), b.payment?.status ?? "NONE", b.status,
        ])
      ));
    }

    if (type === "passengers") {
      const [users, bookings, rides] = await Promise.all([
        prisma.user.findMany({ where: { role: "PASSENGER" }, orderBy: { createdAt: "desc" } }),
        prisma.booking.findMany({ where: { createdAt: { gte: start, lt: end } }, include: { payment: true } }),
        prisma.rideRequest.findMany({ where: { status: "COMPLETED", completedAt: { gte: start, lt: end } } }),
      ]);
      const agg = new Map<string, { bookings: number; rides: number; spend: number; last: Date | null }>();
      const bump = (id: string, kind: "bookings" | "rides", amount: number, at: Date) => {
        const e = agg.get(id) ?? { bookings: 0, rides: 0, spend: 0, last: null };
        e[kind] += 1; e.spend += amount;
        if (!e.last || at > e.last) e.last = at;
        agg.set(id, e);
      };
      for (const b of bookings) bump(b.passengerId, "bookings", b.payment?.status === "PAID" ? rdec(b.payment.amount) : 0, b.createdAt);
      for (const r of rides) bump(r.passengerId, "rides", rdec(r.agreedFare), r.completedAt ?? r.createdAt);
      return sendCsv(res, `relay-passengers_${stamp}.csv`, toCsv(
        ["passenger", "email", "phone", "joined", "bookings", "moto_rides", "spend_rwf", "last_activity", "wallet_balance_rwf"],
        users.map((u) => {
          const e = agg.get(u.id);
          return [fullNameOf(u), u.email, u.phone, u.createdAt, e?.bookings ?? 0, e?.rides ?? 0, round2(e?.spend ?? 0), e?.last ?? "", rdec(u.walletBalance)];
        })
      ));
    }

    // drivers
    const [drivers, bookings, rides, ratings] = await Promise.all([
      prisma.driver.findMany({ include: { user: true, operator: true, vehicle: true } }),
      prisma.booking.findMany({ where: { createdAt: { gte: start, lt: end }, trip: { driverId: { not: null } } }, include: { payment: true, trip: { select: { driverId: true } } } }),
      prisma.rideRequest.findMany({ where: { completedAt: { gte: start, lt: end }, status: "COMPLETED" } }),
      prisma.rating.findMany({ where: { createdAt: { gte: start, lt: end } }, include: { booking: { include: { trip: { select: { driverId: true } } } } } }),
    ]);
    const dAgg = new Map<string, { trips: number; completed: number; rides: number; gross: number; commission: number; scores: number[] }>();
    const get = (id: string) => { const e = dAgg.get(id) ?? { trips: 0, completed: 0, rides: 0, gross: 0, commission: 0, scores: [] }; dAgg.set(id, e); return e; };
    for (const b of bookings) {
      const e = get(b.trip.driverId!);
      e.trips += 1;
      if (b.status === "COMPLETED") e.completed += 1;
      if (b.payment?.status === "PAID") e.gross += rdec(b.payment.amount);
    }
    for (const r of rides) {
      if (!r.acceptedDriverId) continue;
      const e = get(r.acceptedDriverId);
      e.rides += 1; e.gross += rdec(r.agreedFare); e.commission += rdec(r.commissionAmount);
    }
    for (const rt of ratings) if (rt.booking.trip.driverId) get(rt.booking.trip.driverId).scores.push(rt.score);
    return sendCsv(res, `relay-drivers_${stamp}.csv`, toCsv(
      ["driver", "phone", "operator", "vehicle", "type", "status", "bookings_on_trips", "completed_bookings", "moto_rides", "gross_rwf", "moto_commission_rwf", "period_rating", "overall_rating"],
      drivers.map((d) => {
        const e = dAgg.get(d.id);
        const pr = e && e.scores.length ? round2(e.scores.reduce((s, x) => s + x, 0) / e.scores.length) : "";
        return [fullNameOf(d.user), d.user.phone, d.operator?.companyName ?? "Independent", d.vehicle?.plateNumber ?? "", d.vehicle?.type ?? "", d.suspended ? "SUSPENDED" : d.online ? "ONLINE" : "OFFLINE", e?.trips ?? 0, e?.completed ?? 0, e?.rides ?? 0, round2(e?.gross ?? 0), round2(e?.commission ?? 0), pr, d.ratingAvg];
      })
    ));
  })
);

// GET /admin/settings — platform configuration (currently: moto commission)
adminRouter.get(
  "/settings",
  asyncHandler(async (_req, res) => {
    res.json({ motoCommissionPct: await getMotoCommissionPct() });
  })
);

// PATCH /admin/settings — update platform configuration
adminRouter.patch(
  "/settings",
  asyncHandler(async (req, res) => {
    const { motoCommissionPct } = zSettings.parse(req.body);
    await setMotoCommissionPct(motoCommissionPct);
    res.json({ motoCommissionPct });
  })
);

// GET /admin/ride-disputes — pickup disputes on moto rides. Contested ones
// need an admin verdict; uncontested ones are shown for context (they
// auto-resolve for the passenger after the driver's response window).
adminRouter.get(
  "/ride-disputes",
  asyncHandler(async (_req, res) => {
    const rides = await prisma.rideRequest.findMany({
      where: { status: "DISPUTED" },
      include: { passenger: true, acceptedDriver: { include: { user: true } } },
      orderBy: { disputedAt: "desc" },
    });
    res.json(
      rides.map((r) => ({
        id: r.id,
        from: r.originLabel,
        to: r.destLabel,
        fare: r.agreedFare === null ? null : Number(r.agreedFare.toString()),
        passenger: fullNameOf(r.passenger),
        passengerPhone: r.passenger.phone,
        driver: r.acceptedDriver ? fullNameOf(r.acceptedDriver.user) : "—",
        driverPhone: r.acceptedDriver?.user.phone ?? "—",
        pickedUpClaimedAt: r.pickedUpAt?.toISOString() ?? null,
        disputedAt: r.disputedAt?.toISOString() ?? null,
        contestedAt: r.disputeContestedAt?.toISOString() ?? null,
        contested: r.disputeContestedAt !== null,
        commissionPct: r.commissionPct,
      }))
    );
  })
);

// POST /admin/ride-disputes/:id/resolve — the platform's verdict on a
// contested pickup dispute. REFUND_PASSENGER cancels the ride and returns the
// escrow in full; PAY_DRIVER completes it and releases the payout at the
// commission rate locked when the fare was agreed.
const zResolveDispute = z.object({ outcome: z.enum(["REFUND_PASSENGER", "PAY_DRIVER"]) });
adminRouter.post(
  "/ride-disputes/:id/resolve",
  asyncHandler(async (req, res) => {
    const { outcome } = zResolveDispute.parse(req.body);
    const fallbackPct = await getMotoCommissionPct();

    const result = await prisma.$transaction(async (tx) => {
      const ride = await tx.rideRequest.findUnique({
        where: { id: req.params.id },
        include: { passenger: true, acceptedDriver: { include: { user: true } } },
      });
      if (!ride || ride.status !== "DISPUTED") throw new HttpError(404, "Dispute not found or already resolved");
      const fare = ride.agreedFare;
      const driver = ride.acceptedDriver;
      if (!fare || !driver) throw new HttpError(409, "Ride has no funded fare/driver");
      const route = `${ride.originLabel} → ${ride.destLabel}`;

      if (outcome === "REFUND_PASSENGER") {
        await tx.rideRequest.update({
          where: { id: ride.id },
          data: { status: "CANCELLED", refundedAt: ride.paidAt ? new Date() : undefined },
        });
        if (ride.paidAt) {
          await tx.user.update({
            where: { id: ride.passengerId },
            data: { walletBalance: new Prisma.Decimal(ride.passenger.walletBalance).plus(fare) },
          });
          await tx.walletTransaction.create({
            data: { userId: ride.passengerId, kind: "CREDIT", amount: fare, label: `Moto ride refund (dispute) · ${route}` },
          });
        }
        return { outcome, route, passengerId: ride.passengerId, driverUserId: driver.userId, amount: Number(fare.toString()) };
      }

      const pct = ride.commissionPct ?? fallbackPct;
      const commission = ride.commissionAmount ?? new Prisma.Decimal(fare).mul(pct).div(100).toDecimalPlaces(2);
      const driverShare = new Prisma.Decimal(fare).minus(commission);
      await tx.rideRequest.update({
        where: { id: ride.id },
        data: { status: "COMPLETED", commissionPct: pct, commissionAmount: commission, completedAt: new Date() },
      });
      await tx.user.update({
        where: { id: driver.userId },
        data: { walletBalance: new Prisma.Decimal(driver.user.walletBalance).plus(driverShare) },
      });
      await tx.walletTransaction.create({
        data: { userId: driver.userId, kind: "CREDIT", amount: driverShare, label: `Moto ride payout (dispute resolved) · ${route}` },
      });
      return { outcome, route, passengerId: ride.passengerId, driverUserId: driver.userId, amount: Number(driverShare.toString()) };
    });

    if (result.outcome === "REFUND_PASSENGER") {
      await notify(result.passengerId, "Dispute resolved — refunded", `Relay reviewed the dispute on ${result.route} and refunded ${formatRWF(result.amount)} to your wallet.`);
      await notify(result.driverUserId, "Dispute resolved", `Relay reviewed the dispute on ${result.route} in the passenger's favour — no payout was made. Repeated no-pickups can lead to suspension.`);
    } else {
      await notify(result.driverUserId, "Dispute resolved — paid", `Relay reviewed the dispute on ${result.route} in your favour: ${formatRWF(result.amount)} was added to your wallet.`);
      await notify(result.passengerId, "Dispute resolved", `Relay reviewed the dispute on ${result.route} and confirmed the ride took place — the driver was paid. Contact support if you disagree.`);
    }
    res.json({ resolved: true, outcome: result.outcome });
  })
);

// POST /admin/complaints/:id/resolve
adminRouter.post(
  "/complaints/:id/resolve",
  asyncHandler(async (req, res) => {
    const c = await prisma.complaint.findUnique({ where: { id: req.params.id } });
    if (!c) throw new HttpError(404, "Complaint not found");
    await prisma.complaint.update({ where: { id: c.id }, data: { status: "RESOLVED" } });
    res.json({ resolved: true });
  })
);
