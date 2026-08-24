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

// GET /admin/reports/export — CSV of platform transactions
adminRouter.get(
  "/reports/export",
  asyncHandler(async (_req, res) => {
    const payments = await prisma.payment.findMany({
      include: { booking: { include: { passenger: true, trip: { include: { operator: true, route: true } } } } },
      orderBy: { createdAt: "desc" },
    });
    const header = "reference,date,passenger,operator,route,method,amount_rwf,status\n";
    const rows = payments
      .map((p) =>
        [
          p.reference,
          p.createdAt.toISOString(),
          JSON.stringify(fullNameOf(p.booking.passenger)),
          JSON.stringify(p.booking.trip.operator.companyName),
          JSON.stringify(p.booking.trip.route.name),
          p.method,
          Math.round(Number(p.amount)),
          p.status,
        ].join(",")
      )
      .join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="relay-report.csv"');
    res.send(header + rows + "\n");
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

type ReportPeriod = "week" | "month" | "year" | "all";

// Real revenue buckets for the selected window — granularity adapts to the
// span so the chart stays readable (days for a week, weeks for a month,
// months for a year/all-time).
function reportBuckets(period: ReportPeriod, now: Date): { start: Date; end: Date; label: string }[] {
  const buckets: { start: Date; end: Date; label: string }[] = [];
  if (period === "week") {
    for (let i = 6; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
      buckets.push({ start, end, label: start.toLocaleDateString("en-US", { weekday: "short" }) });
    }
  } else if (period === "month") {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    for (let i = 0; i < 5; i++) {
      const start = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 + i * 7);
      if (start > now) break;
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
      buckets.push({ start, end, label: `Wk ${i + 1}` });
    }
  } else {
    const monthsBack = period === "year" ? now.getMonth() + 1 : 12;
    for (let i = monthsBack - 1; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      buckets.push({ start, end, label: start.toLocaleDateString("en-US", { month: "short" }) });
    }
  }
  return buckets;
}

// GET /admin/reports?period=week|month|year|all — aggregate stats scoped to
// a real time window (defaults to this month).
adminRouter.get(
  "/reports",
  asyncHandler(async (req, res) => {
    const period: ReportPeriod = (["week", "month", "year", "all"] as const).includes(req.query.period as ReportPeriod)
      ? (req.query.period as ReportPeriod)
      : "month";
    const now = new Date();
    const rangeStart =
      period === "week" ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6) :
      period === "year" ? new Date(now.getFullYear(), 0, 1) :
      period === "all" ? new Date(0) :
      new Date(now.getFullYear(), now.getMonth(), 1);

    const [trips, paid, multimodalTrips] = await Promise.all([
      prisma.booking.count({ where: { createdAt: { gte: rangeStart } } }),
      prisma.payment.findMany({ where: { status: "PAID", createdAt: { gte: rangeStart } } }),
      prisma.trip.findMany({ where: { createdAt: { gte: rangeStart } }, select: { legs: true } }),
    ]);
    const revenue = paid.reduce((s, p) => s + dec(p.amount), 0);
    const avgFare = paid.length ? revenue / paid.length : 0;
    const multimodal = multimodalTrips.filter((t) => Array.isArray(t.legs) && (t.legs as unknown[]).length > 1).length;
    const multimodalPct = multimodalTrips.length ? Math.round((multimodal / multimodalTrips.length) * 100) : 0;

    const buckets = reportBuckets(period, now);
    const revenueBars = buckets.map((b) => ({
      m: b.label,
      value: paid.filter((p) => p.createdAt >= b.start && p.createdAt < b.end).reduce((s, p) => s + dec(p.amount), 0),
    }));

    res.json({
      period,
      tripsThisMonth: trips,
      avgFare: Number(avgFare.toFixed(2)),
      multimodalPct,
      revenueBars,
    });
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
        data: { status: "COMPLETED", commissionPct: pct, commissionAmount: commission },
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
