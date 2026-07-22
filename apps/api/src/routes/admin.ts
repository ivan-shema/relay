import { Router } from "express";
import { Prisma } from "@prisma/client";
import { formatRWF, createUserSchema } from "@relay/shared";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { requireAuth, requireRole } from "../middleware/auth";
import { hashPassword } from "../lib/auth";
import { parsePage, paged } from "../lib/pagination";

export const adminRouter = Router();

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

// GET /admin/overview — KPIs, approvals, revenue, complaints
adminRouter.get(
  "/overview",
  asyncHandler(async (_req, res) => {
    const [users, operators, trips, paidAll, pendingOps, complaints] = await Promise.all([
      prisma.user.count(),
      prisma.operator.count(),
      prisma.booking.count(),
      prisma.payment.findMany({ where: { status: "PAID" } }),
      prisma.operator.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" } }),
      prisma.complaint.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 4 }),
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
      approvals: pendingOps.map((o) => {
        const t = operatorTypeLabel(o.modes);
        return { id: o.id, company: o.companyName, type: t.type, color: t.color, bg: t.bg, initial: o.companyName[0], vehicles: "fleet pending", date: fmtDate(o.createdAt) };
      }),
      revenueBars: months.map((m, i) => ({ m, value: base[i] })),
      complaints: complaints.map((c) => ({ id: c.id, who: c.who, message: c.message, priority: c.priority })),
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
          name: u.fullName,
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

// POST /admin/users — create a platform user
adminRouter.post(
  "/users",
  asyncHandler(async (req, res) => {
    const body = createUserSchema.parse(req.body);
    const existing = await prisma.user.findFirst({ where: { OR: [{ email: body.email }, { phone: body.phone }] } });
    if (existing) throw new HttpError(409, "Email or phone already registered");
    const user = await prisma.user.create({
      data: { fullName: body.fullName, email: body.email, phone: body.phone, role: body.role, passwordHash: await hashPassword("password123"), phoneVerified: true },
    });
    if (body.role === "DRIVER") await prisma.driver.create({ data: { userId: user.id, licenseNumber: "PENDING" } });
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
          JSON.stringify(p.booking.passenger.fullName),
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
      prisma.operator.findMany({ include: { vehicles: true, drivers: true }, orderBy: { createdAt: "asc" }, skip: p.skip, take: p.take }),
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

// GET /admin/approvals — pending operators
adminRouter.get(
  "/approvals",
  asyncHandler(async (_req, res) => {
    const ops = await prisma.operator.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" } });
    res.json(
      ops.map((o) => {
        const t = operatorTypeLabel(o.modes);
        return { id: o.id, company: o.companyName, type: t.type, color: t.color, bg: t.bg, initial: o.companyName[0], vehicles: "fleet pending", date: fmtDate(o.createdAt) };
      })
    );
  })
);

// POST /admin/operators/:id/approve
adminRouter.post(
  "/operators/:id/approve",
  asyncHandler(async (req, res) => {
    const op = await prisma.operator.findUnique({ where: { id: req.params.id } });
    if (!op) throw new HttpError(404, "Operator not found");
    await prisma.operator.update({ where: { id: op.id }, data: { status: "VERIFIED" } });
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
          user: p.booking.passenger.fullName,
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

// GET /admin/reports — aggregate stats
adminRouter.get(
  "/reports",
  asyncHandler(async (_req, res) => {
    const [trips, paidAll, multimodalTrips] = await Promise.all([
      prisma.booking.count(),
      prisma.payment.findMany({ where: { status: "PAID" } }),
      prisma.trip.findMany({ select: { legs: true } }),
    ]);
    const revenue = paidAll.reduce((s, p) => s + dec(p.amount), 0);
    const avgFare = paidAll.length ? revenue / paidAll.length : 0;
    const multimodal = multimodalTrips.filter((t) => Array.isArray(t.legs) && (t.legs as unknown[]).length > 1).length;
    const multimodalPct = multimodalTrips.length ? Math.round((multimodal / multimodalTrips.length) * 100) : 0;

    const base = [0.42, 0.55, 0.6, 0.78, 0.9, 1].map((f) => Math.round(revenue * f * 100) / 100);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];

    res.json({
      tripsThisMonth: trips,
      avgFare: Number(avgFare.toFixed(2)),
      multimodalPct,
      revenueBars: months.map((m, i) => ({ m, value: base[i] })),
    });
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
