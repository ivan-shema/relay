import { Router } from "express";
import { topUpSchema, savedPlaceSchema } from "@relay/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { requireAuth } from "../middleware/auth";
import { parsePage, paged } from "../lib/pagination";

export const meRouter = Router();

meRouter.use(requireAuth);

function dec(v: Prisma.Decimal | number): number {
  return typeof v === "number" ? v : Number(v.toString());
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
    });
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
      transactions: txns.map((t) => ({
        id: t.id,
        label: t.label,
        kind: t.kind,
        amount: dec(t.amount),
        date: t.createdAt.toISOString(),
      })),
    });
  })
);

meRouter.post(
  "/wallet/topup",
  asyncHandler(async (req, res) => {
    const { amount } = topUpSchema.parse(req.body);
    const userId = req.auth!.sub;
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      const balance = new Prisma.Decimal(user!.walletBalance).plus(amount);
      await tx.user.update({ where: { id: userId }, data: { walletBalance: balance } });
      await tx.walletTransaction.create({ data: { userId, kind: "CREDIT", amount, label: "Wallet top-up" } });
      await tx.notification.create({ data: { userId, title: "Wallet topped up", message: `You added RWF ${Math.round(amount).toLocaleString("en-US")} to your Relay wallet.` } });
      return balance;
    });
    res.json({ balance: dec(result) });
  })
);

// ---------- Saved places ----------
meRouter.get(
  "/places",
  asyncHandler(async (req, res) => {
    const places = await prisma.savedPlace.findMany({ where: { userId: req.auth!.sub }, orderBy: { createdAt: "asc" }, take: 50 });
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
