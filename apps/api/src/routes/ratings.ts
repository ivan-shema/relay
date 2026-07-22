import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { requireAuth } from "../middleware/auth";

export const ratingsRouter = Router();

const createSchema = z.object({
  bookingId: z.string(),
  score: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});

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

      // recompute driver average
      if (booking.trip.driverId) {
        const agg = await tx.rating.aggregate({
          _avg: { score: true },
          where: { booking: { trip: { driverId: booking.trip.driverId } } },
        });
        await tx.driver.update({
          where: { id: booking.trip.driverId },
          data: { ratingAvg: agg._avg.score ?? 5 },
        });
      }
      return created;
    });

    res.status(201).json({
      id: rating.id,
      bookingId,
      score: rating.score,
      comment: rating.comment,
      createdAt: rating.createdAt.toISOString(),
    });
  })
);
