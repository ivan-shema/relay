"use client";

import type { TransportMode, TripFilters, TripWhen } from "@relay/shared";

// Filter state shared by the passenger "Available trips" screen and the public
// /browse page. The route (origin / destination) lives alongside it in each
// page's own search UI; this covers the rest.
export interface TripQuery {
  when: TripWhen;
  mode: TransportMode | "";
  available: boolean;
}

export const DEFAULT_TRIP_QUERY: TripQuery = { when: "all", mode: "", available: false };
export const TRIP_PAGE_SIZE = 24;

const WHEN_OPTIONS: { value: TripWhen; label: string }[] = [
  { value: "all", label: "All upcoming" },
  { value: "live", label: "Live now" },
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
];

const MODE_OPTIONS: { value: TransportMode | ""; label: string; color: string }[] = [
  { value: "", label: "All modes", color: "#1b1714" },
  { value: "BUS", label: "Bus", color: "#2f6bff" },
  { value: "MOTO", label: "Moto", color: "#ff6a1a" },
  { value: "RIDE", label: "Shared ride", color: "#7c5cff" },
];

export function isDefaultQuery(q: TripQuery): boolean {
  return q.when === "all" && !q.mode && !q.available;
}

// Turn the UI selection into API params. Day windows are computed in the
// browser's timezone so "today" means the passenger's today.
export function toTripFilters(q: TripQuery, origin: string, dest: string, page = 1): TripFilters {
  const f: TripFilters = {
    origin: origin.trim() || undefined,
    destination: dest.trim() || undefined,
    page,
    pageSize: TRIP_PAGE_SIZE,
  };
  if (q.when === "live") f.when = "live";
  if (q.when === "today" || q.when === "tomorrow") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    if (q.when === "tomorrow") start.setDate(start.getDate() + 1);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    f.from = start.toISOString();
    f.to = end.toISOString();
  }
  if (q.mode) f.mode = q.mode;
  if (q.available) f.available = true;
  return f;
}

// "12 trips today", "3 live now", "48 upcoming trips" …
export function tripCountLabel(q: TripQuery, total: number): string {
  const n = `${total} ${total === 1 ? "trip" : "trips"}`;
  switch (q.when) {
    case "live":
      return `${total} live now`;
    case "today":
      return `${n} today`;
    case "tomorrow":
      return `${n} tomorrow`;
    default:
      return `${total} upcoming ${total === 1 ? "trip" : "trips"}`;
  }
}

export function emptyTripsCopy(q: TripQuery, routeSet: boolean): string {
  if (q.when === "live") return routeSet ? "Nothing live on this route right now — try “All upcoming”." : "Nothing live right now — try “All upcoming”.";
  if (!isDefaultQuery(q)) return "No trips match these filters.";
  return routeSet ? "No upcoming trips on this route yet." : "No upcoming trips yet — check back soon.";
}

function Chip({ active, color, onClick, children }: { active: boolean; color?: string; onClick: () => void; children: React.ReactNode }) {
  const ink = color ?? "#1b1714";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 12.5,
        fontWeight: 700,
        fontFamily: "'Manrope', sans-serif",
        background: active ? ink : "#fff",
        color: active ? "#fff" : "#1b1714",
        border: `1px solid ${active ? ink : "#e3ddd1"}`,
        borderRadius: 30,
        padding: "8px 14px",
        cursor: "pointer",
        whiteSpace: "nowrap",
        transition: "background .12s, color .12s",
      }}
    >
      {children}
    </button>
  );
}

export function TripFilterBar({ value, onChange }: { value: TripQuery; onChange: (q: TripQuery) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {WHEN_OPTIONS.map((o) => (
          <Chip key={o.value} active={value.when === o.value} onClick={() => onChange({ ...value, when: o.value })}>
            {o.value === "live" && <span className="rel-pulse" style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: value.when === "live" ? "#fff" : "#1f9d6b", marginRight: 6, verticalAlign: "middle" }} />}
            {o.label}
          </Chip>
        ))}
      </div>
      <span style={{ width: 1, height: 22, background: "#e9e3d8", margin: "0 2px" }} />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {MODE_OPTIONS.map((o) => (
          <Chip key={o.value || "all"} active={value.mode === o.value} color={o.color} onClick={() => onChange({ ...value, mode: o.value })}>
            {o.label}
          </Chip>
        ))}
      </div>
      <span style={{ width: 1, height: 22, background: "#e9e3d8", margin: "0 2px" }} />
      <Chip active={value.available} color="#1f9d6b" onClick={() => onChange({ ...value, available: !value.available })}>
        {value.available ? "✓ " : ""}Seats left
      </Chip>
      {!isDefaultQuery(value) && (
        <button type="button" onClick={() => onChange(DEFAULT_TRIP_QUERY)} style={{ background: "none", border: "none", color: "#8c8378", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif", padding: "8px 6px" }}>
          Reset
        </button>
      )}
    </div>
  );
}
