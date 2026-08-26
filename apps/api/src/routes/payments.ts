import { Router } from "express";
import { z } from "zod";
import { formatRWF, type PaymentDetail } from "@relay/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { requireAuth } from "../middleware/auth";
import { notify } from "../lib/notify";
import { getBookingCommissionPct } from "../lib/settings";

export const paymentsRouter = Router();

// Unambiguous alphabet (no 0/O/1/I/L) — this is read aloud/typed by a
// conductor off a phone screen, so it needs to survive a manual transcription.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function makeTicketCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

// Real money: every payment draws from the Relay wallet (funded by real
// Paypack deposits). Direct MoMo/QR charging was removed with mock payments.
const createSchema = z.object({
  bookingId: z.string(),
  method: z.literal("WALLET").default("WALLET"),
  // Client-generated per-attempt key — retries replay instead of re-charging
  idempotencyKey: z.string().min(8).max(64).optional(),
});

function toDetail(p: {
  id: string;
  bookingId: string;
  amount: Prisma.Decimal;
  method: PaymentDetail["method"];
  status: PaymentDetail["status"];
  createdAt: Date;
}): PaymentDetail {
  return {
    id: p.id,
    bookingId: p.bookingId,
    amount: Number(p.amount.toString()),
    method: p.method,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
  };
}

// POST /payments — pay for a booking from the wallet balance. Deducts the
// fare atomically, confirms the booking, issues tickets. 402 (with the
// shortfall spelled out) when the balance can't cover it — the client offers
// a top-up from there.
paymentsRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { bookingId, method, idempotencyKey } = createSchema.parse(req.body);
    // Relay's booking commission is locked onto the payment now — a later
    // change to the platform setting doesn't touch what this operator is owed.
    const commissionPct = await getBookingCommissionPct();

    // Replay: this exact attempt already went through but the response was
    // lost (network retry). Return the stored result — charge nothing.
    if (idempotencyKey) {
      const prior = await prisma.payment.findUnique({ where: { idempotencyKey }, include: { booking: true } });
      if (prior) {
        if (prior.booking.passengerId !== req.auth!.sub || prior.bookingId !== bookingId) {
          throw new HttpError(409, "Idempotency key already used for a different payment");
        }
        return res.status(200).json(toDetail(prior));
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: { payment: true, trip: { include: { route: true } } },
      });
      if (!booking || booking.passengerId !== req.auth!.sub) {
        throw new HttpError(404, "Booking not found");
      }
      if (booking.payment && booking.payment.status === "PAID") {
        throw new HttpError(409, "Booking already paid");
      }
      if (booking.status === "CANCELLED") throw new HttpError(409, "Booking cancelled");

      // Atomic claim: only one concurrent request can flip the booking out of
      // PENDING, so a double-click or duplicate request can never deduct twice
      // (the checks above alone would race under read-committed isolation).
      const claimed = await tx.booking.updateMany({
        where: { id: bookingId, status: "PENDING" },
        data: { status: "CONFIRMED" },
      });
      if (claimed.count === 0) throw new HttpError(409, "Booking already paid");

      const user = await tx.user.findUnique({ where: { id: req.auth!.sub } });
      const balance = new Prisma.Decimal(user!.walletBalance);
      if (balance.lessThan(booking.fare)) {
        const short = new Prisma.Decimal(booking.fare).minus(balance);
        throw new HttpError(402, `Insufficient wallet balance — top up ${formatRWF(Number(short))} to pay this fare`);
      }
      await tx.user.update({
        where: { id: req.auth!.sub },
        data: { walletBalance: balance.minus(booking.fare) },
      });

      const commissionAmount = new Prisma.Decimal(booking.fare).mul(commissionPct).div(100).toDecimalPlaces(2);
      const payment = await tx.payment.upsert({
        where: { bookingId },
        create: {
          bookingId,
          amount: booking.fare,
          method,
          status: "PAID",
          reference: "PAY-" + Math.random().toString(36).slice(2, 10).toUpperCase(),
          idempotencyKey,
          commissionPct,
          commissionAmount,
        },
        update: { method, status: "PAID", idempotencyKey, commissionPct, commissionAmount },
      });

      // One independently-boardable ticket per purchased seat — a group
      // booking gets a distinct QR/seat per rider, not one shared pass.
      await tx.ticket.createMany({
        data: Array.from({ length: booking.seats }, (_, i) => ({
          bookingId,
          seatNumber: "12" + String.fromCharCode(65 + i),
          code: makeTicketCode(),
        })),
      });

      // ride charge on the wallet ledger
      await tx.walletTransaction.create({
        data: { userId: req.auth!.sub, kind: "DEBIT", amount: booking.fare, label: booking.trip.route.name },
      });

      return payment;
    });

    // after commit: in-app row + SSE push + email
    await notify(req.auth!.sub, "Booking confirmed", `Payment of ${formatRWF(Number(result.amount))} received. Your seat is reserved.`);

    res.status(201).json(toDetail(result));
  })
);

paymentsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payments = await prisma.payment.findMany({
      where: { booking: { passengerId: req.auth!.sub } },
      orderBy: { createdAt: "desc" },
    });
    res.json(payments.map(toDetail));
  })
);
