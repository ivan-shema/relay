import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { toTripSummary, tripInclude } from "../lib/mappers";
import { parsePage, paged } from "../lib/pagination";

export const tripsRouter = Router();

// A SCHEDULED trip counts as "live" once it departs within this window; BOARDING
// and RUNNING trips are always live.
const LIVE_WINDOW_MS = 60 * 60 * 1000;
const MODES = new Set(["BUS", "MOTO", "RIDE"]);

function parseDate(raw: string): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// GET /trips — every upcoming departure, browseable without auth. Unfiltered by
// default; each query param narrows the list:
//   origin / destination  place-name substring match on the route
//   when=live             boarding/running, or departing within the hour
//   from / to             ISO bounds on departAt (clients send a local day window)
//   mode=BUS|MOTO|RIDE    at least one leg in that mode
//   available=1           seats left > 0
//   page / pageSize       standard pagination (default 24 per page)
tripsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = (k: string) => String(req.query[k] ?? "").trim();
    const origin = q("origin");
    const destination = q("destination");
    const when = q("when").toLowerCase();
    const mode = q("mode").toUpperCase();
    const available = ["1", "true"].includes(q("available").toLowerCase());
    const from = parseDate(q("from"));
    const to = parseDate(q("to"));
    const p = parsePage(req, 24);
    const now = new Date();

    const where: Prisma.TripWhereInput = {
      status: { in: ["SCHEDULED", "BOARDING", "RUNNING"] },
      arriveAt: { gt: now },
    };
    if (origin || destination) {
      where.route = {
        ...(origin ? { origin: { name: { contains: origin, mode: "insensitive" } } } : {}),
        ...(destination ? { destination: { name: { contains: destination, mode: "insensitive" } } } : {}),
      };
    }
    if (when === "live") {
      where.OR = [
        { status: { in: ["BOARDING", "RUNNING"] } },
        { departAt: { lte: new Date(now.getTime() + LIVE_WINDOW_MS) } },
      ];
    }
    if (from || to) {
      where.departAt = { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) };
    }
    if (mode) {
      if (!MODES.has(mode)) throw new HttpError(400, "mode must be BUS, MOTO or RIDE");
      where.legs = { array_contains: [{ mode }] };
    }
    if (available) where.seatsLeft = { gt: 0 };

    const [trips, total] = await prisma.$transaction([
      prisma.trip.findMany({
        where,
        include: tripInclude,
        orderBy: { departAt: "asc" },
        skip: p.skip,
        take: p.take,
      }),
      prisma.trip.count({ where }),
    ]);

    res.json(paged(trips.map(toTripSummary), total, p));
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
