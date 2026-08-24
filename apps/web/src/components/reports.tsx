"use client";

/* Shared report toolkit used by every dashboard (admin, operator, driver,
   passenger): one period picker (presets + custom dates), one authenticated
   file download, one PDF builder, and a couple of presentational pieces so
   the four report screens read as one system. */

import { useEffect, useState } from "react";
import { tokenStore } from "@/lib/api";

const DISPLAY = "'Space Grotesk', sans-serif";
const MONO = "'JetBrains Mono', monospace";
const SANS = "'Manrope', sans-serif";

export type ReportPreset = "week" | "month" | "year" | "all";
export interface ReportRangeValue {
  period: ReportPreset | "custom";
  from?: string; // YYYY-MM-DD
  to?: string;
}

export const REPORT_PRESETS: { value: ReportPreset; label: string }[] = [
  { value: "week", label: "Last 7 days" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
  { value: "all", label: "All time" },
];

// Query string the report endpoints understand. Always non-empty so callers
// can append "&type=…" safely.
export function rangeQuery(v: ReportRangeValue): string {
  if (v.period === "custom") {
    const p = new URLSearchParams();
    if (v.from) p.set("from", v.from);
    if (v.to) p.set("to", v.to);
    return `?${p.toString()}`;
  }
  return `?period=${v.period}`;
}

export function isRangeReady(v: ReportRangeValue): boolean {
  return v.period !== "custom" || Boolean(v.from && v.to && v.from <= v.to);
}

function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const selectStyle: React.CSSProperties = {
  background: "#fff", border: "1px solid #e3ddd1", borderRadius: 10, padding: "8px 11px", fontSize: 12.5, fontWeight: 700,
  fontFamily: SANS, cursor: "pointer", color: "#1b1714",
};
const dateStyle: React.CSSProperties = {
  border: "1px solid #e3ddd1", borderRadius: 10, padding: "7px 10px", fontSize: 12.5, fontWeight: 700, fontFamily: MONO, color: "#1b1714", background: "#fff",
};

// Presets + a "Custom…" option that reveals from/to date inputs. The parent
// only sees a change once a custom range is complete and ordered.
export function PeriodPicker({ value, onChange }: { value: ReportRangeValue; onChange: (v: ReportRangeValue) => void }) {
  const today = isoDay(new Date());
  const [from, setFrom] = useState(value.from ?? isoDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [to, setTo] = useState(value.to ?? today);
  const [custom, setCustom] = useState(value.period === "custom");

  useEffect(() => {
    if (!custom) return;
    if (from && to && from <= to) onChange({ period: "custom", from, to });
  }, [custom, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const invalid = custom && from && to && from > to;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <select
        value={custom ? "custom" : value.period}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "custom") { setCustom(true); return; }
          setCustom(false);
          onChange({ period: v as ReportPreset });
        }}
        style={selectStyle}
      >
        {REPORT_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        <option value="custom">Custom range…</option>
      </select>
      {custom && (
        <>
          <input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} style={dateStyle} aria-label="From" />
          <span style={{ fontSize: 12, color: "#8c8378", fontWeight: 700 }}>→</span>
          <input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} style={dateStyle} aria-label="To" />
          {invalid && <span style={{ fontSize: 11.5, color: "#c2553f", fontWeight: 700 }}>"To" must be after "From"</span>}
        </>
      )}
    </div>
  );
}

// Fetch a protected file (CSV) with the bearer token and hand it to the
// browser as a download. Uses the server's filename when it sends one.
export async function downloadAuthed(url: string, fallbackName: string): Promise<void> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${tokenStore.access ?? ""}` } });
  if (!res.ok) {
    let msg = "Could not generate the report";
    try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* non-JSON error body */ }
    throw new Error(msg);
  }
  const cd = res.headers.get("Content-Disposition") ?? "";
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName;
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

// Fetch a protected CSV and parse it (quoted fields, embedded commas/quotes)
// — lets a PDF export reuse the exact rows the CSV export produces.
export async function fetchAuthedCsv(url: string): Promise<{ header: string[]; rows: string[][] }> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${tokenStore.access ?? ""}` } });
  if (!res.ok) throw new Error("Could not load the report data");
  const text = (await res.text()).replace(/^﻿/, "");
  const lines: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c !== "")) lines.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); if (row.some((c) => c !== "")) lines.push(row); }
  const [header = [], ...rows] = lines;
  return { header, rows };
}

/* ---------------- PDF ---------------- */

export interface PdfSection {
  title: string;
  columns: string[];
  rows: (string | number)[][];
  // "r" right-aligns numeric columns
  align?: ("l" | "r")[];
}

export interface PdfReport {
  title: string;
  subtitle: string;
  preparedFor?: string;
  kpis: { label: string; value: string }[];
  sections: PdfSection[];
  fileName: string;
}

// A4 report: dark header band, KPI tiles, then one table per section with
// automatic page breaks and page numbers. Plain jsPDF — no plugins.
export async function exportReportPdf(r: PdfReport): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  const ink: [number, number, number] = [27, 23, 20];
  const dim: [number, number, number] = [140, 131, 120];
  const accent: [number, number, number] = [255, 106, 26];
  const line: [number, number, number] = [230, 224, 213];
  const zebra: [number, number, number] = [250, 248, 244];
  let y = 0;
  let page = 1;

  const footer = () => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...dim);
    doc.text(`Relay · ${r.title} · page ${page}`, M, H - 20);
    doc.text(new Date().toLocaleString(), W - M, H - 20, { align: "right" });
  };
  const newPage = () => {
    footer();
    doc.addPage();
    page += 1;
    y = M;
  };
  const ensure = (needed: number) => { if (y + needed > H - 40) newPage(); };

  // header band
  doc.setFillColor(...ink);
  doc.rect(0, 0, W, 96, "F");
  doc.setFillColor(...accent);
  doc.circle(W - M - 6, 30, 6, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Relay", M, 40);
  doc.setFontSize(13);
  doc.text(r.title, M, 62);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(200, 195, 188);
  doc.text(`${r.subtitle}${r.preparedFor ? `  ·  ${r.preparedFor}` : ""}`, M, 80);
  y = 96 + 26;

  // KPI tiles
  if (r.kpis.length) {
    const perRow = Math.min(4, r.kpis.length);
    const gap = 10;
    const tileW = (W - M * 2 - gap * (perRow - 1)) / perRow;
    const tileH = 50;
    r.kpis.forEach((k, i) => {
      const col = i % perRow;
      if (col === 0 && i > 0) y += tileH + gap;
      const x = M + col * (tileW + gap);
      doc.setDrawColor(...line);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(x, y, tileW, tileH, 6, 6, "FD");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...dim);
      doc.text(k.label, x + 10, y + 17);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(...ink);
      doc.text(k.value, x + 10, y + 37);
    });
    y += tileH + 26;
  }

  for (const s of r.sections) {
    ensure(60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.setTextColor(...ink);
    doc.text(s.title, M, y);
    y += 12;

    const cols = s.columns.length;
    const tableW = W - M * 2;
    const colW = tableW / cols;
    const rowH = 18;
    const drawHeader = () => {
      doc.setFillColor(...zebra);
      doc.rect(M, y, tableW, rowH, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...dim);
      s.columns.forEach((c, i) => {
        const right = s.align?.[i] === "r";
        doc.text(c.toUpperCase(), right ? M + colW * (i + 1) - 6 : M + colW * i + 6, y + 12, { align: right ? "right" : "left" });
      });
      y += rowH;
    };
    drawHeader();
    if (s.rows.length === 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...dim);
      doc.text("No data in this period.", M + 6, y + 12);
      y += rowH;
    }
    s.rows.forEach((row, ri) => {
      if (y + rowH > H - 40) { newPage(); drawHeader(); }
      if (ri % 2 === 1) { doc.setFillColor(253, 252, 250); doc.rect(M, y, tableW, rowH, "F"); }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...ink);
      row.forEach((cell, i) => {
        const right = s.align?.[i] === "r";
        const text = doc.splitTextToSize(String(cell ?? ""), colW - 12)[0] ?? "";
        doc.text(text, right ? M + colW * (i + 1) - 6 : M + colW * i + 6, y + 12, { align: right ? "right" : "left" });
      });
      doc.setDrawColor(...line);
      doc.line(M, y + rowH, M + tableW, y + rowH);
      y += rowH;
    });
    y += 22;
  }
  footer();
  doc.save(r.fileName);
}

/* ---------------- presentational ---------------- */

export function StatTile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #ece6db", borderRadius: 16, padding: "15px 17px", minWidth: 0 }}>
      <div style={{ fontSize: 12, color: "#8c8378", fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 700, letterSpacing: "-.5px", color: accent ?? "#1b1714", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: "#a39a8d", fontWeight: 600, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

export function ReportTable({ columns, rows, align, emptyText = "Nothing in this period." }: { columns: string[]; rows: React.ReactNode[][]; align?: ("l" | "r")[]; emptyText?: string }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: Math.max(360, columns.length * 110) }}>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={c} style={{ textAlign: align?.[i] === "r" ? "right" : "left", fontSize: 10.5, fontWeight: 800, color: "#a39a8d", textTransform: "uppercase", letterSpacing: ".05em", padding: "6px 8px", borderBottom: "1px solid #ece6db", whiteSpace: "nowrap" }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} style={{ padding: "14px 8px", color: "#8c8378", fontWeight: 600 }}>{emptyText}</td></tr>
          )}
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((cell, i) => (
                <td key={i} style={{ textAlign: align?.[i] === "r" ? "right" : "left", padding: "9px 8px", borderBottom: "1px solid #f1ece2", fontWeight: 600, fontFamily: align?.[i] === "r" ? MONO : undefined, whiteSpace: "nowrap" }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExportButtons({ onCsv, onPdf, busy }: { onCsv: () => void; onPdf: () => void; busy?: boolean }) {
  const base: React.CSSProperties = { borderRadius: 10, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: SANS };
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <button onClick={onCsv} disabled={busy} style={{ ...base, background: "#fff", color: "#1b1714", border: "1px solid #e3ddd1" }}>{busy ? "…" : "CSV"}</button>
      <button onClick={onPdf} disabled={busy} style={{ ...base, background: "#1b1714", color: "#fff", border: "none" }}>{busy ? "…" : "PDF"}</button>
    </div>
  );
}

export function fmtReportDate(iso: string): string {
  return new Date(iso).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function fmtMoney(n: number): string {
  return `RWF ${Math.round(n).toLocaleString("en-US")}`;
}
