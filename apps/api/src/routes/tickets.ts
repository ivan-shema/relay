import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { requireAuth } from "../middleware/auth";

export const ticketsRouter = Router();

ticketsRouter.use(requireAuth);

// Only staff of the operator running the trip may confirm boarding — the
// passenger presents the ticket, they don't get to check themselves in.
async function canBoard(userId: string, role: string, tripOperatorId: string, tripDriverId: string | null): Promise<boolean> {
  if (role === "ADMIN") return true;
  if (role === "DRIVER" && tripDriverId) {
    const driver = await prisma.driver.findUnique({ where: { userId } });
    if (driver && driver.id === tripDriverId) return true;
  }
  if (role === "OPERATOR") {
    const operator = await prisma.operator.findFirst({ where: { ownerUserId: userId } });
    if (operator && operator.id === tripOperatorId) return true;
  }
  return false;
}

const verifySchema = z.object({ code: z.string().trim().min(1) });

// POST /tickets/verify — confirm boarding by the code printed/QR-encoded on
// the passenger's ticket. This is the only way in: there is no endpoint that
// boards by a booking's own id, because that id is already visible to staff
// from the trip's booking list — boarding must require reading the code off
// the ticket the passenger actually presents, not a value staff already had.
// Each seat's code is single-use (already-boarded tickets are rejected) and
// only usable by the driver or operator running that specific trip.
ticketsRouter.post(
  "/verify",
  asyncHandler(async (req, res) => {
    const { code } = verifySchema.parse(req.body);

    const ticket = await prisma.ticket.findUnique({
      where: { code: code.toUpperCase() },
      include: { booking: { include: { trip: true } } },
    });
    if (!ticket) throw new HttpError(404, "No ticket found for that code");

    const { trip } = ticket.booking;
    const allowed = await canBoard(req.auth!.sub, req.auth!.role, trip.operatorId, trip.driverId);
    if (!allowed) throw new HttpError(403, "Only the operator or driver running this trip can confirm boarding");

    if (ticket.boarded) throw new HttpError(409, "This ticket has already boarded");

    const updated = await prisma.ticket.update({
      where: { id: ticket.id },
      data: { boarded: true, boardedAt: new Date() },
    });
    res.json({ seatNumber: updated.seatNumber, boarded: updated.boarded });
  })
);
