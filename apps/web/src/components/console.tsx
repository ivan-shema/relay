"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import type { Paginated } from "@relay/shared";
import { useAuth } from "@/lib/auth-context";

const DISPLAY = "'Space Grotesk', sans-serif";
const MONO = "'JetBrains Mono', monospace";

export interface NavItem {
  key: string;
  label: string;
  icon: string;
  badge?: string | number;
}

// Full-height dark-sidebar console used by Operator + Admin.
export function ConsoleShell({
  role,
  nav,
  active,
  onNav,
  title,
  subtitle,
  actions,
  footer,
  children,
}: {
  role: string;
  nav: NavItem[];
  active: string;
  onNav: (key: string) => void;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { user, signOut } = useAuth();

  return (
    <div className="rel-console-shell">
      <aside className="rel-console-side">
        <button onClick={() => router.push("/")} style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px 22px", background: "none", border: "none", cursor: "pointer", textAlign: "left", flex: "none" }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: "#2a2520", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
            <div style={{ width: 11, height: 11, borderRadius: "50%", background: "#ff6a1a" }} />
          </div>
          <div className="rel-console-only-desktop">
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 16, color: "#fff" }}>Relay</div>
            <div style={{ fontSize: 10, color: "#9a9186", letterSpacing: ".08em", textTransform: "uppercase" }}>{role}</div>
          </div>
        </button>
        <nav className="rel-console-nav">
          {nav.map((n) => {
            const on = n.key === active;
            return (
              <button
                key={n.key}
                onClick={() => onNav(n.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  padding: "11px 13px",
                  borderRadius: 11,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 13.5,
                  fontWeight: 700,
                  fontFamily: "'Manrope', sans-serif",
                  textAlign: "left",
                  whiteSpace: "nowrap",
                  background: on ? "#2a2520" : "transparent",
                  color: on ? "#fff" : "#9a9186",
                }}
              >
                <span style={{ width: 16, textAlign: "center" }}>{n.icon}</span>
                {n.label}
                {n.badge ? (
                  <span style={{ marginLeft: "auto", background: "#ff6a1a", color: "#fff", fontSize: 10, fontWeight: 800, borderRadius: 20, padding: "1px 7px" }}>{n.badge}</span>
                ) : null}
              </button>
            );
          })}
        </nav>
        <div className="rel-console-only-desktop" style={{ marginTop: "auto" }}>{footer}</div>
        <div className="rel-console-account" style={{ background: "#2a2520", borderRadius: 12, padding: 13, display: "flex", alignItems: "center", gap: 10, marginTop: 12, flex: "none" }}>
          <div style={{ width: 34, height: 34, borderRadius: "50%", background: "linear-gradient(135deg,#ff8a3d,#e0560c)", flex: "none" }} />
          <div className="rel-console-only-desktop" style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap" }}>{user ? `${user.firstName} ${user.lastName}` : "—"}</div>
            <div style={{ fontSize: 10.5, color: "#9a9186", whiteSpace: "nowrap" }}>{role} account</div>
          </div>
          <button onClick={() => { signOut(); router.push("/"); }} title="Sign out" style={{ background: "none", border: "none", color: "#9a9186", cursor: "pointer", fontSize: 15, flex: "none" }}>⎋</button>
        </div>
      </aside>

      <div className="rel-console-main">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22, gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: DISPLAY, fontSize: 24, fontWeight: 700, letterSpacing: "-.5px" }}>{title}</div>
            {subtitle && <div style={{ fontSize: 13, color: "#8c8378", fontWeight: 600 }}>{subtitle}</div>}
          </div>
          {actions && <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{actions}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function KpiGrid({ kpis }: { kpis: { label: string; value: string; sub: string; delta: string }[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 18 }}>
      {kpis.map((k) => (
        <div key={k.label} style={{ background: "#fff", border: "1px solid #ece6db", borderRadius: 16, padding: 17 }}>
          <div style={{ fontSize: 12.5, color: "#8c8378", fontWeight: 600, marginBottom: 8 }}>{k.label}</div>
          <div style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 700, letterSpacing: "-.6px" }}>{k.value}</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 9 }}>
            <span style={{ fontSize: 11.5, color: "#a39a8d" }}>{k.sub}</span>
            {k.delta && <span style={{ fontSize: 11, fontWeight: 800, color: "#1f9d6b", background: "#e7f6ee", borderRadius: 6, padding: "3px 7px" }}>{k.delta}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

const STATUS_COLORS: Record<string, { c: string; b: string }> = {
  CONFIRMED: { c: "#1f9d6b", b: "#e7f6ee" },
  COMPLETED: { c: "#6b6258", b: "#f1ece2" },
  PENDING: { c: "#ff6a1a", b: "#fff0e6" },
  IN_PROGRESS: { c: "#2f6bff", b: "#e9f0ff" },
  CANCELLED: { c: "#c2553f", b: "#fbeae6" },
  PAID: { c: "#1f9d6b", b: "#e7f6ee" },
  FAILED: { c: "#c2553f", b: "#fbeae6" },
  ACTIVE: { c: "#1f9d6b", b: "#e7f6ee" },
  ONLINE: { c: "#1f9d6b", b: "#e7f6ee" },
  OFFLINE: { c: "#8c8378", b: "#f1ece2" },
  IDLE: { c: "#8c8378", b: "#f1ece2" },
  MAINTENANCE: { c: "#c2553f", b: "#fbeae6" },
  SUSPENDED: { c: "#c2553f", b: "#fbeae6" },
  VERIFIED: { c: "#1f9d6b", b: "#e7f6ee" },
  BOARDING: { c: "#ff6a1a", b: "#fff0e6" },
  RUNNING: { c: "#1f9d6b", b: "#e7f6ee" },
  SCHEDULED: { c: "#2f6bff", b: "#e9f0ff" },
  HIGH: { c: "#c2553f", b: "#fbeae6" },
  MEDIUM: { c: "#ff6a1a", b: "#fff0e6" },
  LOW: { c: "#8c8378", b: "#f1ece2" },
};

export function StatusPill({ status }: { status: string }) {
  const s = STATUS_COLORS[status] ?? STATUS_COLORS.PENDING;
  return <span style={{ fontSize: 11, fontWeight: 800, color: s.c, background: s.b, borderRadius: 7, padding: "4px 9px" }}>{status.replace("_", " ")}</span>;
}

export function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: "#fff", border: "1px solid #ece6db", borderRadius: 18, padding: "18px 20px", ...style }}>{children}</div>;
}

export function CardTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{children}</div>
      {right}
    </div>
  );
}

export function BarChart({ bars, height = 130 }: { bars: { m: string; value: number }[]; height?: number }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 14, height, padding: "0 4px" }}>
      {bars.map((b, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", gap: 8 }}>
          <div style={{ width: "100%", display: "flex", alignItems: "flex-end", height: "100%" }}>
            <div style={{ width: "100%", height: `${Math.max(4, (b.value / max) * 100)}%`, background: i === bars.length - 1 ? "#ff6a1a" : "#e9d9c9", borderRadius: 6 }} title={`RWF ${Math.round(b.value).toLocaleString("en-US")}`} />
          </div>
          <span style={{ fontSize: 11, color: "#a39a8d", fontWeight: 600 }}>{b.m}</span>
        </div>
      ))}
    </div>
  );
}

export function ProgressBar({ pct, color = "#ff6a1a" }: { pct: number; color?: string }) {
  return (
    <div style={{ height: 7, background: "#f1ece2", borderRadius: 5, overflow: "hidden" }}>
      <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: color, borderRadius: 5 }} />
    </div>
  );
}

export const consoleFonts = { DISPLAY, MONO };

// Fetch + page-state for a paginated list endpoint.
export function usePaged<T>(fetcher: (page: number) => Promise<Paginated<T>>) {
  const [data, setData] = useState<Paginated<T> | null>(null);
  const [page, setPage] = useState(1);
  const load = useCallback((pg: number) => {
    fetcher(pg).then(setData).catch(() => undefined);
  }, [fetcher]);
  useEffect(() => { load(page); }, [page, load]);
  const reload = useCallback(() => load(page), [load, page]);
  return { data, page, setPage, reload };
}

// Prev / "Page X of Y" / Next footer for a paginated table.
export function Pagination({ page, totalPages, total, onPage }: { page: number; totalPages: number; total: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  const btn = (disabled: boolean): React.CSSProperties => ({
    background: "#fff",
    border: "1px solid #e3ddd1",
    borderRadius: 9,
    padding: "7px 13px",
    fontSize: 12.5,
    fontWeight: 700,
    fontFamily: "'Manrope', sans-serif",
    cursor: disabled ? "default" : "pointer",
    color: disabled ? "#cbc3b6" : "#1b1714",
  });
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 14, marginTop: 4, borderTop: "1px solid #f1ece2" }}>
      <span style={{ fontSize: 12, color: "#8c8378", fontWeight: 600 }}>{total.toLocaleString()} total</span>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} style={btn(page <= 1)}>← Prev</button>
        <span style={{ fontSize: 12.5, color: "#6b6258", fontWeight: 700, fontFamily: MONO }}>{page} / {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => onPage(page + 1)} style={btn(page >= totalPages)}>Next →</button>
      </div>
    </div>
  );
}

export function PrimaryButton({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} style={{ background: "#1b1714", color: "#fff", border: "none", borderRadius: 11, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>
      {children}
    </button>
  );
}

export function AccentButton({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} style={{ background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 11, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>
      {children}
    </button>
  );
}

export interface FormField {
  name: string;
  label: string;
  type?: "text" | "number" | "select" | "file";
  options?: { value: string; label: string }[];
  placeholder?: string;
  defaultValue?: string;
  // Conditionally show this field based on the live form values
  // (e.g. company name only when role === "OPERATOR").
  showIf?: (values: Record<string, unknown>) => boolean;
}

type FormValues = Record<string, unknown>;

// Modal form used by the operator/admin/passenger "Add…" actions.
// Validated with react-hook-form + a shared Zod schema (zodResolver).
export function FormModal({
  title,
  fields,
  submitLabel,
  schema,
  defaultValues,
  onSubmit,
  onClose,
}: {
  title: string;
  fields: FormField[];
  submitLabel: string;
  schema: z.ZodTypeAny;
  defaultValues?: FormValues;
  onSubmit: (values: FormValues) => Promise<void>;
  onClose: () => void;
}) {
  const computedDefaults: FormValues =
    defaultValues ??
    Object.fromEntries(
      fields.filter((f) => f.type !== "file").map((f) => [f.name, f.defaultValue ?? (f.type === "select" ? f.options?.[0]?.value ?? "" : "")])
    );

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) as Resolver<FormValues>, defaultValues: computedDefaults });

  const [serverError, setServerError] = useState<string | null>(null);
  // File inputs live outside RHF: zodResolver strips keys the schema doesn't
  // know, and files are validated server-side (type/size) anyway.
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});

  const watched = watch();
  const visibleFields = fields.filter((f) => !f.showIf || f.showIf(watched));

  const submit = handleSubmit(async (values) => {
    setServerError(null);
    const missing: Record<string, string> = {};
    for (const f of visibleFields) {
      if (f.type === "file" && !files[f.name]) missing[f.name] = "This document is required";
    }
    setFileErrors(missing);
    if (Object.keys(missing).length > 0) return;
    try {
      await onSubmit({ ...values, ...files });
      onClose();
    } catch (e) {
      setServerError(e instanceof Error ? e.message : "Something went wrong");
    }
  });

  const inputStyle: React.CSSProperties = { width: "100%", border: "1px solid #e3ddd1", borderRadius: 11, padding: "11px 13px", fontSize: 14, fontWeight: 600, outline: "none", fontFamily: "'Manrope', sans-serif", background: "#fff" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(27,23,20,.55)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{ width: "100%", maxWidth: 440, maxHeight: "88vh", overflowY: "auto", background: "#fff", borderRadius: 20, boxShadow: "0 40px 90px -30px rgba(0,0,0,.6)" }}>
        <div style={{ padding: "20px 22px", borderBottom: "1px solid #ece6db" }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 19, fontWeight: 700, letterSpacing: "-.4px" }}>{title}</div>
        </div>
        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
          {serverError && <div style={{ background: "#fbeae6", border: "1px solid #f0d4cc", color: "#c2553f", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, fontWeight: 600 }}>{serverError}</div>}
          {visibleFields.map((f) => {
            const err = (errors[f.name]?.message as string | undefined) ?? (f.type === "file" ? fileErrors[f.name] : undefined);
            return (
              <div key={f.name}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "#8c8378", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>{f.label}</div>
                {f.type === "select" ? (
                  <select {...register(f.name)} style={{ ...inputStyle, borderColor: err ? "#e0a99a" : "#e3ddd1" }}>
                    {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : f.type === "file" ? (
                  <label style={{ ...inputStyle, display: "flex", alignItems: "center", gap: 10, cursor: "pointer", borderStyle: "dashed", borderColor: err ? "#e0a99a" : "#cbc3b6", color: files[f.name] ? "#1b1714" : "#8c8378" }}>
                    <span style={{ width: 28, height: 28, borderRadius: 8, background: "#fff0e6", color: "#ff6a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flex: "none" }}>⇧</span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {files[f.name]?.name ?? "Choose a PDF or image (no GIFs)"}
                    </span>
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.webp"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        setFiles((prev) => ({ ...prev, [f.name]: file }));
                        if (file) setFileErrors((prev) => ({ ...prev, [f.name]: "" }));
                      }}
                    />
                  </label>
                ) : (
                  <input
                    {...register(f.name)}
                    type={f.type === "number" ? "number" : "text"}
                    placeholder={f.placeholder}
                    style={{ ...inputStyle, borderColor: err ? "#e0a99a" : "#e3ddd1" }}
                  />
                )}
                {err && <div style={{ fontSize: 11.5, color: "#c2553f", fontWeight: 600, marginTop: 5 }}>{err}</div>}
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 11, marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{ flex: 1, background: "#f4f1ea", color: "#8c8378", border: "1px solid #e9e3d8", borderRadius: 12, padding: 13, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>Cancel</button>
            <button type="submit" disabled={isSubmitting} style={{ flex: 2, background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 12, padding: 13, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>{isSubmitting ? "Saving…" : submitLabel}</button>
          </div>
        </div>
      </form>
    </div>
  );
}
