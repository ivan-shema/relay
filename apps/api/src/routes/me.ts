import { Router } from "express";
import { topUpSchema, savedPlaceSchema, updateProfileSchema, changePasswordSchema, MODE_META } from "@relay/shared";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { requireAuth } from "../middleware/auth";
import { hashPassword, verifyPassword } from "../lib/auth";
import { parsePage, paged } from "../lib/pagination";
import { paypackEnabled, normalizeMomoNumber, requestCashin, fetchTransferOutcome } from "../lib/paypack";
import { settleWalletTopup } from "../lib/settlement";
import { verifyAccessToken } from "../lib/auth";
import { subscribe } from "../lib/realtime";
import { parseReportRange, reportBuckets, bucketSums, toCsv, sendCsv, fileStamp, primaryMode, round2, dec as rdec, BUS_PLATFORM_FEE_PCT, type ReportRange } from "../lib/reports";

export const meRouter = Router();

// GET /me/stream — Server-Sent Events channel for real-time updates (e.g. a
// Paypack settlement landing via webhook). Declared BEFORE the router-wide
// auth guard because EventSource can't send an Authorization header — the
// access token comes as a query param and is verified the same way.
meRouter.get("/stream", (req, res) => {
  let userId: string;
  try {
    userId = verifyAccessToken(String(req.query.token ?? "")).sub;
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(":connected\n\n");

  const unsubscribe = subscribe(userId, res);
  // Comment-line heartbeat keeps proxies from closing the idle connection.
  const heartbeat = setInterval(() => res.write(":ping\n\n"), 25_000);
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

meRouter.use(requireAuth);

function dec(v: Prisma.Decimal | number): number {
  return typeof v === "number" ? v : Number(v.toString());
}

function toAuthUser(u: { id: string; firstName: string; lastName: string; email: string; phone: string; role: string; walletBalance: Prisma.Decimal }) {
  return { id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email, phone: u.phone, role: u.role, walletBalance: dec(u.walletBalance) };
}

// PATCH /me/profile — update the caller's own name/email/phone (any role).
meRouter.patch(
  "/profile",
  asyncHandler(async (req, res) => {
    const body = updateProfileSchema.parse(req.body);
    const userId = req.auth!.sub;

    const emailTaken = await prisma.user.findFirst({ where: { email: body.email, NOT: { id: userId } } });
    if (emailTaken) throw new HttpError(409, "That email is already in use");
    const phoneTaken = await prisma.user.findFirst({ where: { phone: body.phone, NOT: { id: userId } } });
    if (phoneTaken) throw new HttpError(409, "That phone number is already in use");

    const updated = await prisma.user.update({ where: { id: userId }, data: body });
    res.json(toAuthUser(updated));
  })
);

// POST /me/password — change the caller's own password; requires the current
// one so a hijacked session can't silently lock the real owner out.
meRouter.post(
  "/password",
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const userId = req.auth!.sub;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new HttpError(404, "User not found");
    // 400, not 401 — the session is valid, the submitted password is just
    // wrong. A 401 here would trip the client's expired-session auto-logout.
    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) throw new HttpError(400, "Current password is incorrect");

    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    res.json({ ok: true });
  })
);

// Loyalty tiers derived from completed-trip count — no separate table, just a
// deterministic function of real booking history.
const POINTS_PER_TRIP = 10;
const TIERS = [
  { name: "Bronze", minTrips: 0 },
  { name: "Silver", minTrips: 10 },
  { name: "Gold", minTrips: 30 },
  { name: "Platinum", minTrips: 80 },
];

function loyaltyFor(trips: number) {
  let tierIdx = 0;
  for (let i = 0; i < TIERS.length; i++) {
    if (trips >= TIERS[i].minTrips) tierIdx = i;
  }
  const tier = TIERS[tierIdx];
  const next = TIERS[tierIdx + 1] ?? null;
  const points = trips * POINTS_PER_TRIP;
  return {
    tier: tier.name,
    points,
    nextTier: next?.name ?? null,
    tripsToNextTier: next ? next.minTrips - trips : null,
    tierProgressPct: next ? Math.round(((trips - tier.minTrips) / (next.minTrips - tier.minTrips)) * 100) : 100,
  };
}

// GET /me/stats — real rider stats
meRouter.get(
  "/stats",
  asyncHandler(async (req, res) => {
    const userId = req.auth!.sub;
    const [user, trips] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.booking.count({ where: { passengerId: userId, status: "COMPLETED" } }),
    ]);
    if (!user) throw new HttpError(404, "User not found");
    const years = Math.max(1, new Date().getFullYear() - user.createdAt.getFullYear());
    res.json({
      trips,
      co2SavedKg: Math.round(trips * 1.1), // rough estimate vs private car
      memberYears: years,
      rating: 4.8,
      ...loyaltyFor(trips),
    });
  })
);

// GET /me/insights — frequent routes, an unrated recently-completed trip (if
// any), and this month's spend broken down by mode. Computed in one pass over
// the passenger's recent bookings rather than three separate round trips.
meRouter.get(
  "/insights",
  asyncHandler(async (req, res) => {
    const userId = req.auth!.sub;
    const bookings = await prisma.booking.findMany({
      where: { passengerId: userId, status: { in: ["CONFIRMED", "COMPLETED"] } },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        rating: true,
        trip: { include: { route: true, vehicle: true } },
      },
    });

    // frequent routes — top 3 by booking count
    const byRoute = new Map<string, { name: string; mode: keyof typeof MODE_META; count: number }>();
    for (const b of bookings) {
      const route = b.trip.route;
      const mode = b.trip.vehicle?.type ?? "BUS";
      const existing = byRoute.get(route.id);
      if (existing) existing.count += 1;
      else byRoute.set(route.id, { name: route.name, mode, count: 1 });
    }
    const frequentRoutes = [...byRoute.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((r) => ({ route: r.name, tripCount: r.count, ...MODE_META[r.mode] }));

    // most recent completed trip still awaiting the rider's rating
    const unrated = bookings.find((b) => b.status === "COMPLETED" && !b.rating);
    const pendingRating = unrated
      ? { bookingId: unrated.id, route: unrated.trip.route.name, fare: dec(unrated.fare) }
      : null;

    // this month's spend, grouped by mode
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const bucket: Record<string, number> = { BUS: 0, MOTO: 0, RIDE: 0 };
    let monthTotal = 0;
    for (const b of bookings) {
      if (b.createdAt < monthStart) continue;
      const mode = b.trip.vehicle?.type ?? "BUS";
      const fare = dec(b.fare);
      bucket[mode] += fare;
      monthTotal += fare;
    }
    const spendByMode = (Object.keys(bucket) as (keyof typeof MODE_META)[])
      .filter((m) => bucket[m] > 0)
      .map((m) => ({ ...MODE_META[m], amount: bucket[m], pct: monthTotal > 0 ? Math.round((bucket[m] / monthTotal) * 100) : 0 }))
      .sort((a, b) => b.amount - a.amount);

    res.json({ frequentRoutes, pendingRating, spendThisMonth: { total: monthTotal, byMode: spendByMode } });
  })
);

// ---------- Notifications ----------
meRouter.get(
  "/notifications",
  asyncHandler(async (req, res) => {
    const p = parsePage(req, 10);
    const where = { userId: req.auth!.sub };
    const [items, total, unread] = await prisma.$transaction([
      prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { ...where, read: false } }),
    ]);
    res.json({
      unread,
      ...paged(
        items.map((n) => ({ id: n.id, title: n.title, body: n.message, read: n.read, time: n.createdAt.toISOString() })),
        total,
        p
      ),
    });
  })
);

meRouter.post(
  "/notifications/:id/read",
  asyncHandler(async (req, res) => {
    const n = await prisma.notification.findUnique({ where: { id: req.params.id } });
    if (!n || n.userId !== req.auth!.sub) throw new HttpError(404, "Not found");
    await prisma.notification.update({ where: { id: n.id }, data: { read: true } });
    res.json({ read: true });
  })
);

meRouter.post(
  "/notifications/read-all",
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({ where: { userId: req.auth!.sub, read: false }, data: { read: true } });
    res.json({ ok: true });
  })
);

// ---------- Wallet ----------
meRouter.get(
  "/wallet",
  asyncHandler(async (req, res) => {
    const userId = req.auth!.sub;
    const [user, txns] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.walletTransaction.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 20 }),
    ]);
    if (!user) throw new HttpError(404, "User not found");
    res.json({
      balance: dec(user.walletBalance),
      autoTopupEnabled: user.autoTopupEnabled,
      transactions: txns.map((t) => ({
        id: t.id,
        label: t.label,
        kind: t.kind,
        amount: dec(t.amount),
        status: t.status,
        date: t.createdAt.toISOString(),
      })),
    });
  })
);

meRouter.post(
  "/wallet/auto-topup",
  asyncHandler(async (req, res) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    const user = await prisma.user.update({ where: { id: req.auth!.sub }, data: { autoTopupEnabled: enabled } });
    res.json({ autoTopupEnabled: user.autoTopupEnabled });
  })
);

// Deposit — real money only: fires a Paypack MoMo/Airtel cashin, the rider
// approves the USSD prompt, and the wallet is credited once the transfer
// settles (webhook or the status poll below). Requires Paypack credentials —
// there is no mock fallback since money became real.
meRouter.post(
  "/wallet/topup",
  asyncHandler(async (req, res) => {
    const { amount, phone } = topUpSchema.parse(req.body);
    const userId = req.auth!.sub;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new HttpError(404, "User not found");
    const number = normalizeMomoNumber(phone && phone.length > 0 ? phone : user.phone);
    const transfer = await requestCashin(amount, number);
    await prisma.walletTransaction.create({
      data: { userId, kind: "CREDIT", amount, label: "Wallet top-up", status: "PENDING", momoRef: transfer.ref },
    });
    res.status(202).json({ status: "PENDING", ref: transfer.ref });
  })
);

// GET /me/wallet/topup/:ref/status — client polls while the rider approves the
// USSD prompt. Checks Paypack directly so the flow also works without a
// publicly reachable webhook (local dev).
meRouter.get(
  "/wallet/topup/:ref/status",
  asyncHandler(async (req, res) => {
    const userId = req.auth!.sub;
    const ref = req.params.ref;
    const txn = await prisma.walletTransaction.findUnique({ where: { momoRef: ref } });
    if (!txn || txn.userId !== userId) throw new HttpError(404, "Top-up not found");

    let status = txn.status;
    if (status === "PENDING" && paypackEnabled) {
      const outcome = await fetchTransferOutcome(ref, "CASHIN");
      if (outcome !== "pending") {
        await settleWalletTopup(ref, outcome);
        status = outcome === "successful" ? "COMPLETED" : "FAILED";
      }
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    res.json({ status, balance: dec(user!.walletBalance) });
  })
);

// ---------- Saved places ----------
meRouter.get(
  "/places",
  asyncHandler(async (req, res) => {
    const places = await prisma.savedPlace.findMany({ where: { userId: req.auth!.sub }, orderBy: { createdAt: "desc" }, take: 50 });
    res.json(places.map((p) => ({ id: p.id, label: p.label, area: p.area, icon: p.icon })));
  })
);

meRouter.post(
  "/places",
  asyncHandler(async (req, res) => {
    const body = savedPlaceSchema.parse(req.body);
    const p = await prisma.savedPlace.create({ data: { userId: req.auth!.sub, ...body } });
    res.status(201).json({ id: p.id, label: p.label, area: p.area, icon: p.icon });
  })
);

meRouter.delete(
  "/places/:id",
  asyncHandler(async (req, res) => {
    const p = await prisma.savedPlace.findUnique({ where: { id: req.params.id } });
    if (!p || p.userId !== req.auth!.sub) throw new HttpError(404, "Not found");
    await prisma.savedPlace.delete({ where: { id: p.id } });
    res.status(204).end();
  })
);

/* ---------------- Passenger statement ----------------
   Spend for a time window across bus/ride bookings and moto hails, the mode
   and route breakdowns, wallet money-in / money-out, and a line-by-line
   statement (also downloadable as CSV). */

interface StatementRow {
  date: Date;
  kind: "BOOKING" | "MOTO" | "WALLET";
  route: string;
  mode: string;
  seats: number | null;
  amount: number; // negative = money out of the wallet (spend), positive = in
  status: string;
  reference: string;
}

async function passengerReportData(userId: string, range: ReportRange) {
  const { start, end } = range;
  const [bookings, rides, walletTxns] = await Promise.all([
    prisma.booking.findMany({
      where: { passengerId: userId, createdAt: { gte: start, lt: end } },
      include: { payment: true, trip: { include: { route: true, vehicle: true } } },
    }),
    prisma.rideRequest.findMany({
      where: { passengerId: userId, status: { in: ["COMPLETED", "CANCELLED"] }, createdAt: { gte: start, lt: end } },
    }),
    prisma.walletTransaction.findMany({ where: { userId, status: "COMPLETED", createdAt: { gte: start, lt: end } } }),
  ]);

  const paidBookings = bookings.filter((b) => b.payment?.status === "PAID");
  const completedRides = rides.filter((r) => r.status === "COMPLETED");
  const bookingSpend = paidBookings.reduce((s, b) => s + rdec(b.payment!.amount), 0);
  const rideSpend = completedRides.reduce((s, r) => s + rdec(r.agreedFare), 0);
  const spend = bookingSpend + rideSpend;

  const MODE_LABEL: Record<string, string> = { BUS: "Bus", MOTO: "Moto-taxi", RIDE: "Shared ride" };
  const modeAgg = new Map<string, { trips: number; amount: number }>();
  for (const b of paidBookings) {
    const m = b.trip.vehicle?.type ?? primaryMode(b.trip.legs);
    const e = modeAgg.get(m) ?? { trips: 0, amount: 0 };
    e.trips += 1; e.amount += rdec(b.payment!.amount);
    modeAgg.set(m, e);
  }
  if (completedRides.length) {
    const e = modeAgg.get("MOTO") ?? { trips: 0, amount: 0 };
    e.trips += completedRides.length; e.amount += rideSpend;
    modeAgg.set("MOTO", e);
  }
  const byMode = [...modeAgg.entries()].map(([mode, v]) => ({ mode, label: MODE_LABEL[mode] ?? mode, trips: v.trips, amount: round2(v.amount), pct: spend ? Math.round((v.amount / spend) * 100) : 0 })).sort((a, b) => b.amount - a.amount);

  const routeAgg = new Map<string, { route: string; trips: number; amount: number }>();
  for (const b of paidBookings) {
    const e = routeAgg.get(b.trip.route.name) ?? { route: b.trip.route.name, trips: 0, amount: 0 };
    e.trips += 1; e.amount += rdec(b.payment!.amount);
    routeAgg.set(b.trip.route.name, e);
  }
  for (const r of completedRides) {
    const name = `${r.originLabel} → ${r.destLabel}`;
    const e = routeAgg.get(name) ?? { route: name, trips: 0, amount: 0 };
    e.trips += 1; e.amount += rdec(r.agreedFare);
    routeAgg.set(name, e);
  }
  const topRoutes = [...routeAgg.values()].map((r) => ({ ...r, amount: round2(r.amount) })).sort((a, b) => b.trips - a.trips || b.amount - a.amount).slice(0, 5);

  const moneyIn = walletTxns.filter((t) => t.kind === "CREDIT").reduce((s, t) => s + rdec(t.amount), 0);
  const moneyOut = walletTxns.filter((t) => t.kind === "DEBIT").reduce((s, t) => s + rdec(t.amount), 0);
  const refunds = walletTxns.filter((t) => t.kind === "CREDIT" && /refund/i.test(t.label)).reduce((s, t) => s + rdec(t.amount), 0);

  const rows: StatementRow[] = [
    ...bookings.map((b): StatementRow => ({
      date: b.createdAt, kind: "BOOKING", route: b.trip.route.name, mode: b.trip.vehicle?.type ?? primaryMode(b.trip.legs), seats: b.seats,
      amount: b.payment?.status === "PAID" ? -rdec(b.payment.amount) : 0, status: b.status, reference: b.reference,
    })),
    ...rides.map((r): StatementRow => ({
      date: r.completedAt ?? r.createdAt, kind: "MOTO", route: `${r.originLabel} → ${r.destLabel}`, mode: "MOTO", seats: 1,
      amount: r.status === "COMPLETED" ? -rdec(r.agreedFare) : 0, status: r.status, reference: r.id,
    })),
    ...walletTxns
      .filter((t) => !/escrow|payout/i.test(t.label)) // escrow debits are represented by the ride line itself
      .map((t): StatementRow => ({
        date: t.createdAt, kind: "WALLET", route: t.label, mode: "", seats: null,
        amount: t.kind === "CREDIT" ? rdec(t.amount) : -rdec(t.amount), status: t.status, reference: t.momoRef ?? t.id,
      })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  return {
    period: range.period,
    label: range.label,
    from: range.start.toISOString(),
    to: range.end.toISOString(),
    kpis: {
      spend: round2(spend),
      bookings: bookings.length,
      paidBookings: paidBookings.length,
      rides: completedRides.length,
      cancelled: bookings.filter((b) => b.status === "CANCELLED").length + rides.filter((r) => r.status === "CANCELLED").length,
      avgPerTrip: paidBookings.length + completedRides.length ? round2(spend / (paidBookings.length + completedRides.length)) : 0,
      moneyIn: round2(moneyIn),
      moneyOut: round2(moneyOut),
      refunds: round2(refunds),
    },
    spendBars: bucketSums(reportBuckets(range), [
      ...paidBookings.map((b) => ({ at: b.payment!.createdAt, value: rdec(b.payment!.amount) })),
      ...completedRides.map((r) => ({ at: r.completedAt ?? r.createdAt, value: rdec(r.agreedFare) })),
    ]),
    byMode,
    topRoutes,
    rows: rows.slice(0, 300).map((r) => ({ ...r, date: r.date.toISOString() })),
    truncated: rows.length > 300,
  };
}

// GET /me/reports?period=…  |  ?from=&to=
meRouter.get(
  "/reports",
  asyncHandler(async (req, res) => {
    res.json(await passengerReportData(req.auth!.sub, parseReportRange(req)));
  })
);

// GET /me/reports/export — statement lines as CSV
meRouter.get(
  "/reports/export",
  asyncHandler(async (req, res) => {
    const range = parseReportRange(req, "month");
    const data = await passengerReportData(req.auth!.sub, range);
    sendCsv(res, `relay-statement_${fileStamp(range)}.csv`, toCsv(
      ["date", "kind", "description", "mode", "seats", "amount_rwf", "status", "reference"],
      data.rows.map((r) => [r.date, r.kind, r.route, r.mode, r.seats ?? "", r.amount, r.status, r.reference])
    ));
  })
);
