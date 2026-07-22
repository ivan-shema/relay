import type { TrackingSnapshot, TripStatus } from "@relay/shared";
import type { Prisma } from "@prisma/client";
import { fullNameOf } from "./mappers";

type TripForTracking = Prisma.TripGetPayload<{
  include: {
    route: true;
    driver: { include: { user: true } };
    vehicle: true;
  };
}>;

export const trackingInclude = {
  route: true,
  driver: { include: { user: true } },
  vehicle: true,
} satisfies Prisma.TripInclude;

// Deterministic simulated tracking: progress is derived from how far "now"
// sits between departAt and arriveAt. No external GPS needed for the slice.
export function buildTrackingSnapshot(trip: TripForTracking): TrackingSnapshot {
  const start = trip.departAt.getTime();
  const end = trip.arriveAt.getTime();
  const now = Date.now();

  const raw = (now - start) / Math.max(1, end - start);
  const progress = Math.min(1, Math.max(0, raw));
  const progressPct = Math.round(progress * 100);

  const etaMinutes = Math.max(0, Math.round((end - now) / 60_000));

  let status: TripStatus = trip.status;
  if (now < start) status = trip.status === "RUNNING" ? "RUNNING" : "BOARDING";
  else if (progress >= 1) status = "COMPLETED";
  else status = "RUNNING";

  // interpolate position along the route polyline
  const line = (trip.route.polyline as [number, number][] | null) ?? [];
  let lat = 0;
  let lng = 0;
  let heading = 0;
  if (line.length >= 2) {
    const seg = progress * (line.length - 1);
    const i = Math.min(line.length - 2, Math.floor(seg));
    const f = seg - i;
    const [lng1, lat1] = line[i];
    const [lng2, lat2] = line[i + 1];
    lng = lng1 + (lng2 - lng1) * f;
    lat = lat1 + (lat2 - lat1) * f;
    heading = (Math.atan2(lat2 - lat1, lng2 - lng1) * 180) / Math.PI;
  }

  const driver = trip.driver
    ? {
        name: fullNameOf(trip.driver.user),
        vehicle: trip.vehicle?.label ?? "Vehicle",
        plate: trip.vehicle?.plateNumber ?? "—",
        phone: trip.driver.user.phone,
      }
    : null;

  return {
    tripId: trip.id,
    status,
    vehiclePosition: { lat, lng, heading },
    etaMinutes,
    progressPct,
    driver,
    seatNumber: "12A",
  };
}
