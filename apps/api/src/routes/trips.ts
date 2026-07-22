import { Router } from "express";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { toTripSummary, tripInclude } from "../lib/mappers";

export const tripsRouter = Router();

// GET /trips?origin=Kabeza&destination=Central%20Market
// Returns live/upcoming departures matching the search (browseable without auth).
tripsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const origin = String(req.query.origin ?? "").trim();
    const destination = String(req.query.destination ?? "").trim();

    const trips = await prisma.trip.findMany({
      where: {
        status: { in: ["SCHEDULED", "BOARDING", "RUNNING"] },
        arriveAt: { gt: new Date() },
        ...(origin || destination
          ? {
              route: {
                ...(origin ? { origin: { name: { contains: origin, mode: "insensitive" } } } : {}),
                ...(destination
                  ? { destination: { name: { contains: destination, mode: "insensitive" } } }
                  : {}),
              },
            }
          : {}),
      },
      include: tripInclude,
      orderBy: { departAt: "asc" },
      take: 30,
    });

    res.json(trips.map(toTripSummary));
  })
);

tripsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const trip = await prisma.trip.findUnique({
      where: { id: req.params.id },
      include: tripInclude,
    });
    if (!trip) throw new HttpError(404, "Trip not found");
    res.json(toTripSummary(trip));
  })
);
