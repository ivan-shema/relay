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
      include: { trip: { include: trackingInclude }, tickets: true },
    });
    if (!booking || booking.passengerId !== req.auth!.sub) {
      throw new HttpError(404, "Booking not found");
    }
    const snapshot = buildTrackingSnapshot(booking.trip);
    const seatNumber = booking.tickets.length > 0 ? booking.tickets.map((t) => t.seatNumber).join(", ") : snapshot.seatNumber;
    // Boarding is confirmed by the driver/operator scanning the ticket, not by
    // the passenger — the tracking view reflects that real state instead of a
    // self-reported button.
    const anyBoarded = booking.tickets.some((t) => t.boarded);
    res.json({ ...snapshot, seatNumber, anyBoarded });
  })
);
