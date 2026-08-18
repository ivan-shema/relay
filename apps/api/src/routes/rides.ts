import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { requireAuth } from "../middleware/auth";
import { fullNameOf } from "../lib/mappers";
import { notify } from "../lib/notify";

export const ridesRouter = Router();

ridesRouter.use(requireAuth);

function dec(v: Prisma.Decimal | number | null): number | null {
  if (v === null) return null;
  return typeof v === "number" ? v : Number(v.toString());
}

// GPS is mocked platform-wide (see README) — derive a stable pseudo-distance
// from the driver id so the "nearby" list is deterministic instead of
// reshuffling on every poll.
function mockDistanceKm(driverId: string): number {
  let h = 0;
  for (const c of driverId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return Math.round((3 + (h % 27)) * 10) / 100; // 0.30 – 2.90 km
}

const motoDriverWhere = {
  online: true,
  suspended: false,
  vehicle: { is: { type: "MOTO" as const } },
};

// GET /rides/nearby — online moto drivers a passenger can hail
ridesRouter.get(
  "/nearby",
  asyncHandler(async (_req, res) => {
    const drivers = await prisma.driver.findMany({
      where: motoDriverWhere,
      include: { user: true, vehicle: true, operator: true },
      take: 20,
    });
    res.json(
      drivers
        .map((d) => ({
          driverId: d.id,
          name: fullNameOf(d.user),
          rating: d.ratingAvg,
          plate: d.vehicle?.plateNumber ?? "—",
          model: d.vehicle?.model ?? "Moto",
          operator: d.operator?.companyName ?? "Independent",
          distanceKm: mockDistanceKm(d.id),
        }))
        .sort((a, b) => a.distanceKm - b.distanceKm)
    );
  })
);

const createRideSchema = z.object({
  originLabel: z.string().trim().min(1, "Where should the moto pick you up?"),
  destLabel: z.string().trim().min(1, "Where are you going?"),
  offerFare: z.coerce.number().positive().max(100_000).optional(),
  targetDriverId: z.string().optional(),
});

function toRideView(
  r: Prisma.RideRequestGetPayload<{
    include: {
      targetDriver: { include: { user: true; vehicle: true } };
      acceptedDriver: { include: { user: true; vehicle: true } };
    };
  }>
) {
  const driver = r.acceptedDriver ?? r.targetDriver;
  return {
    id: r.id,
    from: r.originLabel,
    to: r.destLabel,
    offerFare: dec(r.offerFare),
    status: r.status,
    targeted: Boolean(r.targetDriverId),
    driver: driver
      ? {
          name: fullNameOf(driver.user),
          phone: driver.user.phone,
          rating: driver.ratingAvg,
          plate: driver.vehicle?.plateNumber ?? "—",
          model: driver.vehicle?.model ?? "Moto",
          distanceKm: mockDistanceKm(driver.id),
        }
      : null,
    createdAt: r.createdAt.toISOString(),
    acceptedAt: r.acceptedAt?.toISOString() ?? null,
  };
}

const rideInclude = {
  targetDriver: { include: { user: true, vehicle: true } },
  acceptedDriver: { include: { user: true, vehicle: true } },
} satisfies Prisma.RideRequestInclude;

// POST /rides — post a ride request: to one specific nearby moto, or (no
// targetDriverId) broadcast to every online moto driver.
ridesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createRideSchema.parse(req.body);
    const passengerId = req.auth!.sub;

    const active = await prisma.rideRequest.findFirst({
      where: { passengerId, status: { in: ["OPEN", "ACCEPTED"] } },
    });
    if (active) throw new HttpError(409, "You already have an active moto request — cancel it first");

    if (body.targetDriverId) {
      const target = await prisma.driver.findFirst({ where: { id: body.targetDriverId, ...motoDriverWhere } });
      if (!target) throw new HttpError(409, "That moto is no longer available — pick another or broadcast the request");
    }

    const ride = await prisma.rideRequest.create({
      data: {
        passengerId,
        originLabel: body.originLabel,
        destLabel: body.destLabel,
        offerFare: body.offerFare,
        targetDriverId: body.targetDriverId,
      },
      include: rideInclude,
    });

    if (ride.targetDriver) {
      await notify(ride.targetDriver.userId, "New moto ride request", `${ride.originLabel} → ${ride.destLabel} — a passenger requested you directly.`);
    }

    res.status(201).json(toRideView(ride));
  })
);

// GET /rides/mine — the passenger's current request (or their most recent one,
// so the UI can show "completed / cancelled" once before resetting)
ridesRouter.get(
  "/mine",
  asyncHandler(async (req, res) => {
    const ride = await prisma.rideRequest.findFirst({
      where: { passengerId: req.auth!.sub },
      orderBy: { createdAt: "desc" },
      include: rideInclude,
    });
    res.json(ride ? toRideView(ride) : null);
  })
);

// POST /rides/:id/cancel — passenger backs out. Allowed while OPEN or ACCEPTED
// (plans change); the accepted driver is told instead of arriving to nobody.
ridesRouter.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const ride = await prisma.rideRequest.findUnique({ where: { id: req.params.id }, include: rideInclude });
    if (!ride || ride.passengerId !== req.auth!.sub) throw new HttpError(404, "Ride request not found");
    if (ride.status !== "OPEN" && ride.status !== "ACCEPTED") throw new HttpError(409, "This ride is already finished");

    await prisma.rideRequest.update({ where: { id: ride.id }, data: { status: "CANCELLED" } });
    if (ride.acceptedDriver) {
      await notify(ride.acceptedDriver.userId, "Ride cancelled", `The passenger cancelled ${ride.originLabel} → ${ride.destLabel}.`);
    }
    res.json({ cancelled: true });
  })
);
