import { MODE_META, type TransportMode, type TripLeg, type TripSummary } from "@relay/shared";
import type { Prisma } from "@prisma/client";

// A Trip joined with route (+ origin/dest places) and operator.
type TripWithRels = Prisma.TripGetPayload<{
  include: {
    route: { include: { origin: true; destination: true } };
    operator: true;
  };
}>;

function dec(v: Prisma.Decimal | number): number {
  return typeof v === "number" ? v : Number(v.toString());
}

// Compose a display name from the split name columns. Response shapes that
// expose display names (passenger, driver, etc.) stay unchanged for the web.
export function fullNameOf(u: { firstName: string; lastName: string }): string {
  return `${u.firstName} ${u.lastName}`;
}

function relativeLabel(target: Date): string {
  const diffMin = Math.round((target.getTime() - Date.now()) / 60_000);
  if (diffMin <= 0) return "now";
  if (diffMin < 60) return `in ${diffMin} min`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}

function durationLabel(depart: Date, arrive: Date): string {
  const min = Math.max(1, Math.round((arrive.getTime() - depart.getTime()) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function parseLegs(raw: Prisma.JsonValue): TripLeg[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((item) => {
    const mode = ((item as { mode?: string })?.mode ?? "BUS") as TransportMode;
    const meta = MODE_META[mode] ?? MODE_META.BUS;
    return { mode, code: meta.code, color: meta.color, label: meta.label };
  });
}

export function toTripSummary(trip: TripWithRels): TripSummary {
  return {
    id: trip.id,
    routeName: trip.route.name,
    origin: trip.route.origin.name,
    destination: trip.route.destination.name,
    legs: parseLegs(trip.legs),
    operatorName: trip.operator.companyName,
    departAt: trip.departAt.toISOString(),
    arriveAt: trip.arriveAt.toISOString(),
    departsInLabel: relativeLabel(trip.departAt),
    durationLabel: durationLabel(trip.departAt, trip.arriveAt),
    seatsLeft: trip.seatsLeft,
    capacity: trip.capacity,
    fare: dec(trip.fare),
    surge: trip.surge,
    status: trip.status,
    tag: trip.tag ?? undefined,
  };
}

export const tripInclude = {
  route: { include: { origin: true, destination: true } },
  operator: true,
} satisfies Prisma.TripInclude;
