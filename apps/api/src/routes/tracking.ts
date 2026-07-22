import { Router } from "express";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { requireAuth } from "../middleware/auth";
import { buildTrackingSnapshot, trackingInclude } from "../lib/tracking";

export const trackingRouter = Router();

// GET /tracking/:bookingId — simulated live position + ETA for a booked trip.
// Frontend polls this every few seconds.
trackingRouter.get(
  "/:bookingId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.bookingId },
      include: { trip: { include: trackingInclude } },
    });
    if (!booking || booking.passengerId !== req.auth!.sub) {
      throw new HttpError(404, "Booking not found");
    }
    const snapshot = buildTrackingSnapshot(booking.trip);
    res.json({ ...snapshot, seatNumber: booking.seatNumber ?? snapshot.seatNumber });
  })
);
