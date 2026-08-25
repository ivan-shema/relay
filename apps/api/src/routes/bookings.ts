import { Router } from "express";
import { z } from "zod";
import type { BookingDetail } from "@relay/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { requireAuth } from "../middleware/auth";
import { toTripSummary, tripInclude } from "../lib/mappers";
import { parsePage, paged } from "../lib/pagination";

export const bookingsRouter = Router();

function dec(v: Prisma.Decimal): number {
  return Number(v.toString());
}

const bookingInclude = { trip: { include: tripInclude }, payment: true, tickets: true } satisfies Prisma.BookingInclude;

function toBookingDetail(b: Prisma.BookingGetPayload<{ include: typeof bookingInclude }>): BookingDetail {
  return {
    id: b.id,
    trip: toTripSummary(b.trip),
    status: b.status,
    seats: b.seats,
    fare: dec(b.fare),
    createdAt: b.createdAt.toISOString(),
    payment: b.payment
      ? {
          id: b.payment.id,
          bookingId: b.payment.bookingId,
          amount: dec(b.payment.amount),
          method: b.payment.method,
          status: b.payment.status,
          createdAt: b.payment.createdAt.toISOString(),
        }
      : undefined,
    tickets: b.tickets.map((t) => ({ id: t.id, code: t.code, seatNumber: t.seatNumber, boarded: t.boarded })),
  };
}

const createSchema = z.object({ tripId: z.string(), seats: z.number().int().min(1).max(6).default(1) });

function makeReference(): string {
  return "RLY-" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

// POST /bookings — reserve seats on a trip (holds seats, status PENDING until paid)
bookingsRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { tripId, seats } = createSchema.parse(req.body);

    // Validate outside the transaction so the tx itself is just two statements.
    const trip = await prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) throw new HttpError(404, "Trip not found");
    // Moto-taxis carry one passenger — a moto-only trip can never be booked
    // for more than one seat, whatever its stored capacity says.
    const legs = (trip.legs as { mode?: string }[] | null) ?? [];
    const motoOnly = legs.length > 0 && legs.every((l) => l.mode === "MOTO");
    if (motoOnly && seats > 1) throw new HttpError(409, "A moto-taxi carries one passenger — book one seat per moto");
    if (trip.seatsLeft < seats) throw new HttpError(409, "Not enough seats left");

    const booking = await prisma.$transaction(async (tx) => {
      // Conditional decrement: atomically re-checks availability so two
      // concurrent bookings can't both take the last seats.
      const held = await tx.trip.updateMany({
        where: { id: tripId, seatsLeft: { gte: seats } },
        data: { seatsLeft: { decrement: seats } },
      });
      if (held.count === 0) throw new HttpError(409, "Not enough seats left");

      return tx.booking.create({
        data: {
          reference: makeReference(),
          passengerId: req.auth!.sub,
          tripId,
          seats,
          fare: new Prisma.Decimal(trip.fare).mul(seats),
          status: "PENDING",
        },
        include: bookingInclude,
      });
    });

    res.status(201).json(toBookingDetail(booking));
  })
);

// GET /bookings — current passenger's bookings (Trips tab), paginated
bookingsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = parsePage(req, 8);
    const where = { passengerId: req.auth!.sub };
    const [bookings, total] = await prisma.$transaction([
      prisma.booking.findMany({
        where,
        include: bookingInclude,
        orderBy: { createdAt: "desc" },
        skip: p.skip,
        take: p.take,
      }),
      prisma.booking.count({ where }),
    ]);
    res.json(paged(bookings.map(toBookingDetail), total, p));
  })
);

bookingsRouter.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.id },
      include: bookingInclude,
    });
    if (!booking || booking.passengerId !== req.auth!.sub) {
      throw new HttpError(404, "Booking not found");
    }
    res.json(toBookingDetail(booking));
  })
);

// POST /bookings/:id/cancel
bookingsRouter.post(
  "/:id/cancel",
  requireAuth,
  asyncHandler(async (req, res) => {
    const booking = await prisma.booking.findUnique({ where: { id: req.params.id } });
    if (!booking || booking.passengerId !== req.auth!.sub) {
      throw new HttpError(404, "Booking not found");
    }
    if (booking.status === "COMPLETED") throw new HttpError(409, "Trip already completed");

    const updated = await prisma.$transaction(async (tx) => {
      await tx.trip.update({
        where: { id: booking.tripId },
        data: { seatsLeft: { increment: booking.seats } },
      });
      return tx.booking.update({
        where: { id: booking.id },
        data: { status: "CANCELLED" },
        include: bookingInclude,
      });
    });
    res.json(toBookingDetail(updated));
  })
);
