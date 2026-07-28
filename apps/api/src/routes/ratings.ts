import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { requireAuth } from "../middleware/auth";

export const ratingsRouter = Router();

// How long after submitting a rating the rider can still fix a typo/misclick.
export const RATING_EDIT_WINDOW_MS = 10 * 60_000;

const createSchema = z.object({
  bookingId: z.string(),
  score: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});

async function recomputeDriverAverage(tx: Prisma.TransactionClient, driverId: string | null) {
  if (!driverId) return;
  const agg = await tx.rating.aggregate({
    _avg: { score: true },
    where: { booking: { trip: { driverId } } },
  });
  await tx.driver.update({ where: { id: driverId }, data: { ratingAvg: agg._avg.score ?? 5 } });
}

// POST /ratings — rate a completed trip. Marks the booking COMPLETED.
ratingsRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { bookingId, score, comment } = createSchema.parse(req.body);

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { rating: true, trip: { include: { driver: true } } },
    });
    if (!booking || booking.passengerId !== req.auth!.sub) {
      throw new HttpError(404, "Booking not found");
    }
    if (booking.rating) throw new HttpError(409, "Already rated");

    const rating = await prisma.$transaction(async (tx) => {
      const created = await tx.rating.create({
        data: { bookingId, passengerId: req.auth!.sub, score, comment },
      });
      await tx.booking.update({ where: { id: bookingId }, data: { status: "COMPLETED" } });
      await recomputeDriverAverage(tx, booking.trip.driverId);
      return created;
    });

    res.status(201).json({
      id: rating.id,
      bookingId,
      score: rating.score,
      comment: rating.comment,
      createdAt: rating.createdAt.toISOString(),
      editableUntil: new Date(rating.createdAt.getTime() + RATING_EDIT_WINDOW_MS).toISOString(),
    });
  })
);

// PATCH /ratings/:bookingId — fix a typo/misclick within a short window after
// submitting. Rejected once the window has passed, so this isn't an open door
// to rewrite reviews long after the fact.
ratingsRouter.patch(
  "/:bookingId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { score, comment } = createSchema.omit({ bookingId: true }).parse(req.body);

    const booking = await prisma.booking.findUnique({
      where: { id: req.params.bookingId },
      include: { rating: true, trip: { include: { driver: true } } },
    });
    if (!booking || booking.passengerId !== req.auth!.sub || !booking.rating) {
      throw new HttpError(404, "Rating not found");
    }
    const ageMs = Date.now() - booking.rating.createdAt.getTime();
    if (ageMs > RATING_EDIT_WINDOW_MS) {
      throw new HttpError(409, "The edit window for this review has passed");
    }

    const rating = await prisma.$transaction(async (tx) => {
      const updated = await tx.rating.update({
        where: { bookingId: booking.id },
        data: { score, comment },
      });
      await recomputeDriverAverage(tx, booking.trip.driverId);
      return updated;
    });

    res.json({
      id: rating.id,
      bookingId: rating.bookingId,
      score: rating.score,
      comment: rating.comment,
      createdAt: rating.createdAt.toISOString(),
      editableUntil: new Date(rating.createdAt.getTime() + RATING_EDIT_WINDOW_MS).toISOString(),
    });
  })
);
