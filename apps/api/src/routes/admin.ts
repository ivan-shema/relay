import { Router } from "express";
import { Prisma } from "@prisma/client";
import { formatRWF, createUserSchema, rejectOperatorSchema } from "@relay/shared";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { requireAuth, requireRole } from "../middleware/auth";
import { hashPassword, generateTempPassword } from "../lib/auth";
import { sendCredentialsEmail } from "../lib/mailer";
import { parsePage, paged } from "../lib/pagination";
import { fullNameOf } from "../lib/mappers";
import { notify } from "../lib/notify";
import { fetchMerchantBalances } from "../lib/paypack";
import { getMotoCommissionPct, getBookingCommissionPct, setMotoCommissionPct, setBookingCommissionPct, getCommissionPcts } from "../lib/settings";
import { z } from "zod";
import { parseReportRange, reportBuckets, bucketSums, toCsv, sendCsv, fileStamp, primaryMode, round2, dec as rdec, lockedBookingFee, type ReportRange } from "../lib/reports";

export const adminRouter = Router();

const zPct = z.coerce.number().min(0, "Can't be negative").max(50, "Commission above 50% is not allowed");
const zSettings = z.object({
  motoCommissionPct: zPct.optional(),
  bookingCommissionPct: zPct.optional(),
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

// GET /admin/overview — KPIs, approvals, revenue, complaints. Every number and
// delta is computed from the ledger (the deltas compare this calendar month
// with the previous one).
adminRouter.get(
  "/overview",
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const sixMonthsStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const [users, usersThisMonth, operators, bookings, bookingsThisMonth, paidAll, ridesAll, pendingOps, complaints, paypack] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.operator.count(),
      prisma.booking.count(),
      prisma.booking.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.payment.findMany({ where: { status: "PAID" }, select: { amount: true, commissionAmount: true, createdAt: true } }),
      prisma.rideRequest.findMany({ where: { status: "COMPLETED" }, select: { agreedFare: true, commissionAmount: true, completedAt: true, createdAt: true } }),
      prisma.operator.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, include: { documents: true, ownerUser: true } }),
      prisma.complaint.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 4 }),
      fetchMerchantBalances(), // null when Paypack isn't configured/reachable
    ]);
    const items = [
      ...paidAll.map((p) => ({ at: p.createdAt, gross: rdec(p.amount), fee: rdec(p.commissionAmount) })),
      ...ridesAll.map((r) => ({ at: r.completedAt ?? r.createdAt, gross: rdec(r.agreedFare), fee: rdec(r.commissionAmount) })),
    ];
    const sumIn = (from: Date, to: Date, key: "gross" | "fee") => items.filter((i) => i.at >= from && i.at < to).reduce((s, i) => s + i[key], 0);
    const collected = items.reduce((s, i) => s + i.gross, 0);
    const commission = items.reduce((s, i) => s + i.fee, 0);
    const grossThisMonth = sumIn(monthStart, new Date(now.getTime() + 60_000), "gross");
    const grossPrevMonth = sumIn(prevMonthStart, monthStart, "gross");
    const commThisMonth = sumIn(monthStart, new Date(now.getTime() + 60_000), "fee");
    const commPrevMonth = sumIn(prevMonthStart, monthStart, "fee");
    const mom = (cur: number, prev: number) => (prev > 0 ? `${cur >= prev ? "+" : "−"}${Math.round((Math.abs(cur - prev) / prev) * 100)}% MoM` : cur > 0 ? "new" : "");

    // Real monthly gross for the last six calendar months.
    const revenueBars = Array.from({ length: 6 }, (_, i) => {
      const start = new Date(sixMonthsStart.getFullYear(), sixMonthsStart.getMonth() + i, 1);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      return { m: start.toLocaleDateString("en-US", { month: "short" }), value: round2(sumIn(start, end, "gross")) };
    });

    res.json({
      kpis: [
        { label: "Total users", value: users.toLocaleString(), sub: "all roles", delta: usersThisMonth ? `+${usersThisMonth} this month` : "" },
        { label: "Operators", value: String(operators), sub: pendingOps.length ? `${pendingOps.length} awaiting review` : "all verified", delta: "" },
        { label: "Bookings", value: bookings.toLocaleString(), sub: "all time", delta: bookingsThisMonth ? `+${bookingsThisMonth} this month` : "" },
        { label: "Collected from passengers", value: formatRWF(collected), sub: `${formatRWF(grossThisMonth)} this month`, delta: mom(grossThisMonth, grossPrevMonth) },
        { label: "Relay commission", value: formatRWF(commission), sub: `${formatRWF(commThisMonth)} this month`, delta: mom(commThisMonth, commPrevMonth) },
      ],
      approvals: pendingOps.map(mapApproval),
      revenueBars,
      revenueTrend: mom(grossThisMonth, grossPrevMonth),
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
          // Activated by email OTP or Google sign-in.
          status: u.emailVerified ? "ACTIVE" : "PENDING",
        })),
        total,
        p
      )
    );
  })
);

// POST /admin/users — create a platform user. Creating an OPERATOR here also
// creates their company record, already VERIFIED (admin creation is itself
// the trust/approval signal — no pending step). The account gets a random
// temporary password which is emailed to the new user once the row commits.
adminRouter.post(
  "/users",
  asyncHandler(async (req, res) => {
    const body = createUserSchema.parse(req.body);
    const existing = await prisma.user.findFirst({ where: { OR: [{ email: body.email }, { phone: body.phone }] } });
    if (existing) throw new HttpError(409, "Email or phone already registered");
    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);
    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { firstName: body.firstName, lastName: body.lastName, email: body.email, phone: body.phone, role: body.role, passwordHash, credentialsEmailed: true },
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
    sendCredentialsEmail(user, { tempPassword, roleLabel: body.role.toLowerCase(), createdBy: "A Relay administrator" });
    res.status(201).json({ id: user.id, credentialsSentTo: user.email });
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
    rejectionReason: o.rejectionReason,
    reviewedAt: o.reviewedAt?.toISOString() ?? null,
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
      prisma.operator.update({ where: { id: op.id }, data: { status: "VERIFIED", reviewedAt: new Date(), rejectionReason: null } }),
      ...(op.ownerUserId ? [prisma.user.update({ where: { id: op.ownerUserId }, data: { role: "OPERATOR" } })] : []),
    ]);
    if (op.ownerUserId) {
      await notify(op.ownerUserId, "Operator application approved", `${op.companyName} is verified — your operator console is now live.`);
    }
    res.json({ approved: true });
  })
);

// POST /admin/operators/:id/reject — a reason is mandatory: it is stored on the
// application, shown in the applicant's dashboard, and delivered as an in-app
// notification + email so they know what to fix before applying again.
adminRouter.post(
  "/operators/:id/reject",
  asyncHandler(async (req, res) => {
    const { reason } = rejectOperatorSchema.parse(req.body);
    const op = await prisma.operator.findUnique({ where: { id: req.params.id } });
    if (!op) throw new HttpError(404, "Operator not found");
    if (op.status !== "PENDING") throw new HttpError(409, "Only a pending application can be rejected");
    await prisma.operator.update({
      where: { id: op.id },
      data: { status: "REJECTED", rejectionReason: reason, reviewedAt: new Date() },
    });
    if (op.ownerUserId) {
      await notify(
        op.ownerUserId,
        "Operator application not approved",
        `Your application for ${op.companyName} was not approved.\n\nReason: ${reason}\n\nYou can fix the issue and apply again from your dashboard (Profile → Become an operator).`
      );
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

  const busPct = await getBookingCommissionPct();
  const paid = payments.filter((p) => p.status === "PAID");
  const busRevenue = paid.reduce((s, p) => s + rdec(p.amount), 0);
  const busFee = paid.reduce((s, p) => s + lockedBookingFee(p, busPct), 0);
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
  const opAgg = new Map<string, { name: string; bookings: number; revenue: number; fee: number }>();
  for (const p of paid) {
    const op = p.booking.trip.operator;
    const e = opAgg.get(op.id) ?? { name: op.companyName, bookings: 0, revenue: 0, fee: 0 };
    e.bookings += 1; e.revenue += rdec(p.amount); e.fee += lockedBookingFee(p, busPct);
    opAgg.set(op.id, e);
  }
  const byOperator = [...opAgg.values()]
    .map((o) => ({ name: o.name, bookings: o.bookings, revenue: round2(o.revenue), platformFee: round2(o.fee), netToOperator: round2(o.revenue - o.fee) }))
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
      busFeePct: busPct,
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
      const busPct = await getBookingCommissionPct();
      type Row = [string, Date, string, string, string, string, string, number, number, number, string];
      const rows: Row[] = [
        ...payments.map((p): Row => {
          const gross = rdec(p.amount);
          const fee = p.status === "PAID" ? round2(lockedBookingFee(p, busPct)) : 0;
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

/* ---------------- Finance ----------------
   The platform's money position (lifetime ledger) plus a period view with
   growth against the previous window of the same length, conversion funnels
   and quality signals — the numbers a decision needs, not activity counts.
   Every figure is derived from the ledger (payments, rides, payouts, wallet)
   using the commission locked on each payment / ride. */

const FUNDED_OPEN_RIDE = ["CONFIRMED", "IN_PROGRESS", "AWAITING_CONFIRM", "DISPUTED"] as const;

function pctOf(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}
// Growth vs the previous window, in percent; null when there is no baseline.
function growthPct(cur: number, prev: number): number | null {
  if (prev === 0) return cur === 0 ? 0 : null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

async function financeLedger() {
  const [payments, ridesDone, ridesOpen, ridesRefunded, payouts, wallet, credits] = await Promise.all([
    prisma.payment.findMany({ where: { status: "PAID" }, select: { amount: true, commissionAmount: true } }),
    prisma.rideRequest.findMany({ where: { status: "COMPLETED" }, select: { agreedFare: true, commissionAmount: true } }),
    prisma.rideRequest.findMany({ where: { status: { in: [...FUNDED_OPEN_RIDE] }, paidAt: { not: null } }, select: { agreedFare: true } }),
    prisma.rideRequest.findMany({ where: { refundedAt: { not: null } }, select: { agreedFare: true } }),
    prisma.payout.findMany({ where: { operatorId: { not: null } }, select: { amount: true, status: true } }),
    prisma.user.aggregate({ _sum: { walletBalance: true } }),
    prisma.walletTransaction.findMany({ where: { kind: "CREDIT" }, select: { amount: true, status: true, momoRef: true, label: true } }),
  ]);
  const bookingGross = payments.reduce((s, p) => s + rdec(p.amount), 0);
  const bookingCommission = payments.reduce((s, p) => s + rdec(p.commissionAmount), 0);
  const motoGross = ridesDone.reduce((s, r) => s + rdec(r.agreedFare), 0);
  const motoCommission = ridesDone.reduce((s, r) => s + rdec(r.commissionAmount), 0);
  const collected = bookingGross + motoGross;
  const commission = bookingCommission + motoCommission;
  const owedToOperators = collected - commission;
  const paidOut = payouts.filter((p) => p.status === "COMPLETED").reduce((s, p) => s + rdec(p.amount), 0);
  const payoutsPending = payouts.filter((p) => p.status === "PENDING").reduce((s, p) => s + rdec(p.amount), 0);
  const payoutsFailed = payouts.filter((p) => p.status === "FAILED").length;
  const escrowHeld = ridesOpen.reduce((s, r) => s + rdec(r.agreedFare), 0);
  const refunded = ridesRefunded.reduce((s, r) => s + rdec(r.agreedFare), 0);
  const walletFloat = rdec(wallet._sum.walletBalance);
  const done = credits.filter((c) => c.status === "COMPLETED");
  const topUps = done.filter((c) => c.momoRef !== null);
  const topUpTotal = topUps.reduce((s, c) => s + rdec(c.amount), 0);
  const pendingTopUps = credits.filter((c) => c.status === "PENDING" && c.momoRef !== null).reduce((s, c) => s + rdec(c.amount), 0);
  const operatorBalance = owedToOperators - paidOut - payoutsPending;
  // What the platform must be able to pay out at any moment.
  const liabilities = walletFloat + escrowHeld + Math.max(0, operatorBalance);
  const paypack = await fetchMerchantBalances();
  return {
    collected: round2(collected),
    bookingGross: round2(bookingGross),
    motoGross: round2(motoGross),
    commission: round2(commission),
    bookingCommission: round2(bookingCommission),
    motoCommission: round2(motoCommission),
    takeRatePct: pctOf(commission, collected),
    owedToOperators: round2(owedToOperators),
    paidOut: round2(paidOut),
    payoutsPending: round2(payoutsPending),
    payoutsFailed,
    operatorBalance: round2(operatorBalance),
    escrowHeld: round2(escrowHeld),
    refunded: round2(refunded),
    walletFloat: round2(walletFloat),
    topUps: round2(topUpTotal),
    topUpCount: topUps.length,
    pendingTopUps: round2(pendingTopUps),
    liabilities: round2(liabilities),
    paypackBalance: paypack ? round2(paypack.balance) : null,
    coveragePct: paypack ? pctOf(paypack.balance, liabilities) : null,
  };
}

async function financePeriod(start: Date, end: Date) {
  const win = { gte: start, lt: end };
  const [payments, ridesDone, bookingsBy, hailsBy, usersBy, ratings, disputes, complaints, tripsRun] = await Promise.all([
    prisma.payment.findMany({
      where: { status: "PAID", createdAt: win },
      select: { amount: true, commissionAmount: true, createdAt: true, booking: { select: { passengerId: true, trip: { select: { operatorId: true, route: { select: { name: true } } } } } } },
    }),
    prisma.rideRequest.findMany({
      where: { status: "COMPLETED", completedAt: win },
      select: { agreedFare: true, commissionAmount: true, completedAt: true, passengerId: true, acceptedDriver: { select: { operatorId: true } } },
    }),
    prisma.booking.groupBy({ by: ["status"], _count: { _all: true }, where: { createdAt: win } }),
    prisma.rideRequest.groupBy({ by: ["status"], _count: { _all: true }, where: { createdAt: win } }),
    prisma.user.groupBy({ by: ["role"], _count: { _all: true }, where: { createdAt: win } }),
    prisma.rating.aggregate({ _avg: { score: true }, _count: { _all: true }, where: { createdAt: win } }),
    prisma.rideRequest.count({ where: { disputedAt: win } }),
    prisma.complaint.count({ where: { createdAt: win } }),
    prisma.trip.findMany({ where: { departAt: win, status: { in: ["RUNNING", "COMPLETED"] } }, select: { capacity: true, seatsLeft: true } }),
  ]);
  const countOf = <R extends { _count: { _all: number } }>(rows: R[], pick: (r: R) => string, value: string) =>
    rows.filter((r) => pick(r) === value).reduce((s, r) => s + r._count._all, 0);
  const sumCounts = (rows: { _count: { _all: number } }[]) => rows.reduce((s, r) => s + r._count._all, 0);

  const bookingGross = payments.reduce((s, p) => s + rdec(p.amount), 0);
  const bookingCommission = payments.reduce((s, p) => s + rdec(p.commissionAmount), 0);
  const motoGross = ridesDone.reduce((s, r) => s + rdec(r.agreedFare), 0);
  const motoCommission = ridesDone.reduce((s, r) => s + rdec(r.commissionAmount), 0);
  const gross = bookingGross + motoGross;
  const commission = bookingCommission + motoCommission;

  const bookingsCreated = sumCounts(bookingsBy);
  const bookingsCancelled = countOf(bookingsBy, (r) => r.status, "CANCELLED");
  const bookingsCompleted = countOf(bookingsBy, (r) => r.status, "COMPLETED");
  const hailsRequested = sumCounts(hailsBy);
  const hailsCompleted = countOf(hailsBy, (r) => r.status, "COMPLETED");
  const hailsCancelled = countOf(hailsBy, (r) => r.status, "CANCELLED");

  const passengerCounts = new Map<string, number>();
  for (const p of payments) passengerCounts.set(p.booking.passengerId, (passengerCounts.get(p.booking.passengerId) ?? 0) + 1);
  for (const r of ridesDone) passengerCounts.set(r.passengerId, (passengerCounts.get(r.passengerId) ?? 0) + 1);
  const activePassengers = passengerCounts.size;
  const repeatPassengers = [...passengerCounts.values()].filter((n) => n >= 2).length;

  const opRevenue = new Map<string, number>();
  for (const p of payments) opRevenue.set(p.booking.trip.operatorId, (opRevenue.get(p.booking.trip.operatorId) ?? 0) + rdec(p.amount));
  for (const r of ridesDone) {
    const id = r.acceptedDriver?.operatorId;
    if (id) opRevenue.set(id, (opRevenue.get(id) ?? 0) + rdec(r.agreedFare));
  }
  const topOperator = Math.max(0, ...opRevenue.values());

  const routeAgg = new Map<string, { route: string; bookings: number; revenue: number }>();
  for (const p of payments) {
    const name = p.booking.trip.route.name;
    const e = routeAgg.get(name) ?? { route: name, bookings: 0, revenue: 0 };
    e.bookings += 1; e.revenue += rdec(p.amount);
    routeAgg.set(name, e);
  }
  const topRoutes = [...routeAgg.values()].map((r) => ({ ...r, revenue: round2(r.revenue), sharePct: pctOf(r.revenue, bookingGross) })).sort((a, b) => b.revenue - a.revenue).slice(0, 6);

  const capacity = tripsRun.reduce((s, t) => s + t.capacity, 0);
  const seatsSold = tripsRun.reduce((s, t) => s + (t.capacity - t.seatsLeft), 0);
  const settled = payments.length + ridesDone.length;

  return {
    stats: {
      gross: round2(gross),
      bookingGross: round2(bookingGross),
      motoGross: round2(motoGross),
      commission: round2(commission),
      bookingCommission: round2(bookingCommission),
      motoCommission: round2(motoCommission),
      takeRatePct: pctOf(commission, gross),
      avgTicket: settled ? round2(gross / settled) : 0,
      paidBookings: payments.length,
      bookingsCreated,
      bookingsCancelled,
      bookingsCompleted,
      paidConversionPct: pctOf(payments.length, bookingsCreated),
      cancelRatePct: pctOf(bookingsCancelled, bookingsCreated),
      hailsRequested,
      hailsCompleted,
      hailsCancelled,
      hailFulfilmentPct: pctOf(hailsCompleted, hailsRequested),
      rides: ridesDone.length,
      newPassengers: countOf(usersBy, (r) => r.role, "PASSENGER"),
      newDrivers: countOf(usersBy, (r) => r.role, "DRIVER"),
      newOperators: countOf(usersBy, (r) => r.role, "OPERATOR"),
      activePassengers,
      repeatPassengers,
      repeatRatePct: pctOf(repeatPassengers, activePassengers),
      avgRating: ratings._avg.score !== null ? round2(ratings._avg.score) : null,
      ratingsCount: ratings._count._all,
      disputes,
      disputeRatePct: pctOf(disputes, ridesDone.length),
      complaints,
      tripsRun: tripsRun.length,
      occupancyPct: pctOf(seatsSold, capacity),
      activeOperators: opRevenue.size,
      topOperatorSharePct: pctOf(topOperator, gross),
    },
    topRoutes,
    // for the trend bars
    grossItems: [
      ...payments.map((p) => ({ at: p.createdAt, value: rdec(p.amount) })),
      ...ridesDone.map((r) => ({ at: r.completedAt ?? new Date(0), value: rdec(r.agreedFare) })),
    ],
    commissionItems: [
      ...payments.map((p) => ({ at: p.createdAt, value: rdec(p.commissionAmount) })),
      ...ridesDone.map((r) => ({ at: r.completedAt ?? new Date(0), value: rdec(r.commissionAmount) })),
    ],
  };
}

// GET /admin/finance?period=… | ?from=&to=
adminRouter.get(
  "/finance",
  asyncHandler(async (req, res) => {
    const range = parseReportRange(req);
    const len = range.end.getTime() - range.start.getTime();
    const prevRange = range.period === "all" ? null : { start: new Date(range.start.getTime() - len), end: range.start };
    const [ledger, current, previous] = await Promise.all([
      financeLedger(),
      financePeriod(range.start, range.end),
      prevRange ? financePeriod(prevRange.start, prevRange.end) : Promise.resolve(null),
    ]);
    const buckets = reportBuckets(range);
    const gross = bucketSums(buckets, current.grossItems);
    const comm = bucketSums(buckets, current.commissionItems);
    const c = current.stats;
    const p = previous?.stats ?? null;
    const g = (key: keyof typeof c) => (p ? growthPct(Number(c[key] ?? 0), Number(p[key] ?? 0)) : null);
    res.json({
      period: range.period,
      label: range.label,
      from: range.start.toISOString(),
      to: range.end.toISOString(),
      ledger,
      current: c,
      previous: p,
      growth: {
        gross: g("gross"),
        commission: g("commission"),
        paidBookings: g("paidBookings"),
        rides: g("rides"),
        activePassengers: g("activePassengers"),
        newPassengers: g("newPassengers"),
        bookingsCreated: g("bookingsCreated"),
        hailsRequested: g("hailsRequested"),
      },
      bars: gross.map((b, i) => ({ m: b.m, gross: round2(b.value), commission: round2(comm[i]?.value ?? 0) })),
      topRoutes: current.topRoutes,
    });
  })
);

// GET /admin/settings — platform configuration: the two commissions
adminRouter.get(
  "/settings",
  asyncHandler(async (_req, res) => {
    res.json(await getCommissionPcts());
  })
);

// PATCH /admin/settings — update either/both commissions
adminRouter.patch(
  "/settings",
  asyncHandler(async (req, res) => {
    const { motoCommissionPct, bookingCommissionPct } = zSettings.parse(req.body);
    if (motoCommissionPct !== undefined) await setMotoCommissionPct(motoCommissionPct);
    if (bookingCommissionPct !== undefined) await setBookingCommissionPct(bookingCommissionPct);
    res.json(await getCommissionPcts());
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
// escrow in full; PAY_OPERATOR completes it and releases the fare (minus the
// commission locked when it was agreed) to the operator whose moto did the
// ride — it joins their withdrawable balance like any other fare.
const zResolveDispute = z.object({ outcome: z.enum(["REFUND_PASSENGER", "PAY_OPERATOR"]) });
adminRouter.post(
  "/ride-disputes/:id/resolve",
  asyncHandler(async (req, res) => {
    const { outcome } = zResolveDispute.parse(req.body);
    const fallbackPct = await getMotoCommissionPct();

    const result = await prisma.$transaction(async (tx) => {
      const ride = await tx.rideRequest.findUnique({
        where: { id: req.params.id },
        include: { passenger: true, acceptedDriver: { include: { operator: true } } },
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
        return { outcome, route, passengerId: ride.passengerId, driverUserId: driver.userId, operatorOwnerId: driver.operator?.ownerUserId ?? null, amount: Number(fare.toString()) };
      }

      const pct = ride.commissionPct ?? fallbackPct;
      const commission = ride.commissionAmount ?? new Prisma.Decimal(fare).mul(pct).div(100).toDecimalPlaces(2);
      const operatorShare = new Prisma.Decimal(fare).minus(commission);
      await tx.rideRequest.update({
        where: { id: ride.id },
        data: { status: "COMPLETED", commissionPct: pct, commissionAmount: commission, completedAt: new Date() },
      });
      return { outcome, route, passengerId: ride.passengerId, driverUserId: driver.userId, operatorOwnerId: driver.operator?.ownerUserId ?? null, amount: Number(operatorShare.toString()) };
    });

    if (result.outcome === "REFUND_PASSENGER") {
      await notify(result.passengerId, "Dispute resolved — refunded", `Relay reviewed the dispute on ${result.route} and refunded ${formatRWF(result.amount)} to your wallet.`);
      await notify(result.driverUserId, "Dispute resolved", `Relay reviewed the dispute on ${result.route} in the passenger's favour — the fare was refunded. Repeated no-pickups can lead to suspension.`);
      if (result.operatorOwnerId) await notify(result.operatorOwnerId, "Dispute resolved — refunded", `Relay reviewed the pickup dispute on ${result.route} in the passenger's favour; the fare was refunded to them.`);
    } else {
      await notify(result.driverUserId, "Dispute resolved in your favour", `Relay reviewed the dispute on ${result.route} and confirmed the pickup happened. The fare was released to your operator.`);
      if (result.operatorOwnerId) await notify(result.operatorOwnerId, "Dispute resolved — fare released", `Relay confirmed the ride on ${result.route} took place: ${formatRWF(result.amount)} (after commission) is now available to withdraw.`);
      await notify(result.passengerId, "Dispute resolved", `Relay reviewed the dispute on ${result.route} and confirmed the ride took place — the fare was released. Contact support if you disagree.`);
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
