import { Router } from "express";
import type { Place } from "@relay/shared";
import { prisma } from "../prisma";
import { asyncHandler } from "../lib/http";

export const placesRouter = Router();

// GET /places?q=kim  — search/suggest saved places
placesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    const places = await prisma.place.findMany({
      where: q
        ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { area: { contains: q, mode: "insensitive" } }] }
        : undefined,
      orderBy: [{ isPopular: "desc" }, { name: "asc" }],
      take: 20,
    });
    const body: Place[] = places.map((p) => ({
      id: p.id,
      name: p.name,
      area: p.area,
      lat: p.lat,
      lng: p.lng,
    }));
    res.json(body);
  })
);
