import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { HttpError } from "./http";

/* Shared plumbing for every dashboard's reports (admin, operator, driver,
   passenger): one way to parse a time window, one way to bucket it for a
   chart, one way to emit CSV. */

export type ReportPeriod = "week" | "month" | "year" | "all" | "custom";

export interface ReportRange {
  period: ReportPeriod;
  start: Date;
  end: Date; // exclusive
  label: string;
}

// Share of every bus/ride booking the platform keeps (matches the operator
// payout maths). Moto hails use the admin-configurable commission instead.
export const BUS_PLATFORM_FEE_PCT = 12;

export function dec(v: Prisma.Decimal | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : Number(v.toString());
}

const DAY_MS = 864e5;
const MAX_CUSTOM_DAYS = 2 * 366;

function parseDay(s: string, name: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new HttpError(400, `${name} must be a date (YYYY-MM-DD)`);
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, `${name} is not a valid date`);
  return date;
}

// ?period=week|month|year|all  — or —  ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive)
export function parseReportRange(req: Request, fallback: ReportPeriod = "month"): ReportRange {
  const now = new Date();
  const q = req.query as Record<string, string | undefined>;
  if (q.from || q.to) {
    const start = q.from ? parseDay(q.from, "from") : new Date(now.getFullYear(), now.getMonth(), 1);
    const toDay = q.to ? parseDay(q.to, "to") : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(toDay.getTime() + DAY_MS);
    if (end <= start) throw new HttpError(400, "'to' must be on or after 'from'");
    if ((end.getTime() - start.getTime()) / DAY_MS > MAX_CUSTOM_DAYS) throw new HttpError(400, "Custom ranges are limited to two years");
    const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    return { period: "custom", start, end, label: `${fmt(start)} – ${fmt(toDay)}` };
  }
  const period = (["week", "month", "year", "all"] as const).includes(q.period as never) ? (q.period as ReportPeriod) : fallback;
  const end = new Date(now.getTime() + 60_000); // include "now"
  switch (period) {
    case "week":
      return { period, start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6), end, label: "Last 7 days" };
    case "year":
      return { period, start: new Date(now.getFullYear(), 0, 1), end, label: `${now.getFullYear()} to date` };
    case "all":
      return { period, start: new Date(0), end, label: "All time" };
    default:
      return { period: "month", start: new Date(now.getFullYear(), now.getMonth(), 1), end, label: now.toLocaleDateString("en-US", { month: "long", year: "numeric" }) };
  }
}

export interface Bucket { start: Date; end: Date; label: string }

// Chart buckets whose granularity adapts to the span so the bars stay
// readable: days for up to two weeks, weeks up to ~4 months, else months.
// "All time" shows the last 12 months.
export function reportBuckets(range: ReportRange): Bucket[] {
  const now = new Date();
  const start = range.period === "all" ? new Date(now.getFullYear(), now.getMonth() - 11, 1) : range.start;
  const end = range.end;
  const spanDays = (end.getTime() - start.getTime()) / DAY_MS;
  const buckets: Bucket[] = [];
  if (spanDays <= 15) {
    for (let d = new Date(start); d < end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      buckets.push({ start: d, end: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1), label: d.toLocaleDateString("en-US", spanDays <= 7 ? { weekday: "short" } : { day: "numeric", month: "short" }) });
    }
  } else if (spanDays <= 130) {
    let i = 1;
    for (let d = new Date(start); d < end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7), i++) {
      buckets.push({ start: d, end: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7), label: spanDays <= 35 ? `Wk ${i}` : d.toLocaleDateString("en-US", { day: "numeric", month: "short" }) });
    }
  } else {
    for (let d = new Date(start.getFullYear(), start.getMonth(), 1); d < end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      buckets.push({ start: d, end: new Date(d.getFullYear(), d.getMonth() + 1, 1), label: d.toLocaleDateString("en-US", spanDays > 400 ? { month: "short", year: "2-digit" } : { month: "short" }) });
    }
  }
  return buckets;
}

export function bucketSums(buckets: Bucket[], items: { at: Date; value: number }[]): { m: string; value: number }[] {
  return buckets.map((b) => ({
    m: b.label,
    value: Math.round(items.filter((i) => i.at >= b.start && i.at < b.end).reduce((s, i) => s + i.value, 0)),
  }));
}

/* ---- CSV ---- */
type Cell = string | number | boolean | null | undefined | Date;

function cell(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return [header.join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n") + "\n";
}

export function sendCsv(res: Response, filename: string, csv: string): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send("\uFEFF" + csv); // BOM so Excel opens UTF-8 correctly
}

export function fileStamp(range: ReportRange): string {
  const d = (x: Date) => x.toISOString().slice(0, 10);
  return range.period === "all" ? "all-time" : `${d(range.start)}_${d(new Date(range.end.getTime() - 1))}`;
}

export function primaryMode(legs: unknown): string {
  if (Array.isArray(legs) && legs.length > 0 && typeof legs[0] === "object" && legs[0] && "mode" in legs[0]) {
    return String((legs[0] as { mode: unknown }).mode);
  }
  return "BUS";
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
