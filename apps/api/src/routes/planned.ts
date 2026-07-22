import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { requireAuth } from "../middleware/auth";

export const plannedRouter = Router();

const createSchema = z.object({
  originLabel: z.string().min(1),
  destLabel: z.string().min(1),
  whenLabel: z.string().min(1),
  notify: z.boolean().default(true),
});

plannedRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const items = await prisma.plannedTrip.findMany({
      where: { passengerId: req.auth!.sub },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json(
      items.map((p) => ({
        id: p.id,
        from: p.originLabel,
        to: p.destLabel,
        when: p.whenLabel,
        notify: p.notify,
      }))
    );
  })
);

plannedRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const created = await prisma.plannedTrip.create({
      data: { passengerId: req.auth!.sub, ...data },
    });
    res.status(201).json({ id: created.id });
  })
);

plannedRouter.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const item = await prisma.plannedTrip.findUnique({ where: { id: req.params.id } });
    if (!item || item.passengerId !== req.auth!.sub) throw new HttpError(404, "Not found");
    await prisma.plannedTrip.delete({ where: { id: item.id } });
    res.status(204).end();
  })
);
