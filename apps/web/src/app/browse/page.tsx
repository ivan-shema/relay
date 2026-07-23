"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Place, TripSummary } from "@relay/shared";
import { formatRWF } from "@relay/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth, homePathForRole } from "@/lib/auth-context";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

const DISPLAY = "'Space Grotesk', sans-serif";
const MONO = "'JetBrains Mono', monospace";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function TripCardSkeleton() {
  return (
    <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 18, padding: 18 }}>
      <div className="rel-skel" style={{ width: "70%", height: 15, borderRadius: 6, marginBottom: 16 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div className="rel-skel" style={{ width: 46, height: 20, borderRadius: 6 }} />
        <div className="rel-skel" style={{ width: 46, height: 20, borderRadius: 6 }} />
      </div>
      <div style={{ borderTop: "1px solid #f1ece2", paddingTop: 11, display: "flex", justifyContent: "space-between" }}>
        <div className="rel-skel" style={{ width: "40%", height: 13, borderRadius: 6 }} />
        <div className="rel-skel" style={{ width: 60, height: 13, borderRadius: 6 }} />
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { c: string; bg: string; label: string }> = {
    ON_TIME: { c: "#1f9d6b", bg: "#e7f6ee", label: "On time" },
    DELAYED: { c: "#c2553f", bg: "#fbeae6", label: "Delayed" },
    BOARDING: { c: "#2f6bff", bg: "#e9f0ff", label: "Boarding" },
    SCHEDULED: { c: "#8c8378", bg: "#f1ece2", label: "Scheduled" },
  };
  const s = map[status] ?? { c: "#8c8378", bg: "#f1ece2", label: status };
  return <span style={{ fontSize: 10.5, fontWeight: 800, color: s.c, background: s.bg, borderRadius: 6, padding: "3px 8px" }}>{s.label}</span>;
}

// Dedicated public page for browsing live trips without an account — the
// landing page's "Browse live trips" CTA lands here instead of inside the
// authenticated passenger app shell, since Trips/Wallet/You mean nothing to
// a guest. Booking a seat still requires signing in.
export default function BrowsePage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [origin, setOrigin] = useState("Kabeza");
  const [dest, setDest] = useState("Central Market");
  const [suggest, setSuggest] = useState<Place[]>([]);
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) router.replace(homePathForRole(user.role));
  }, [user, loading, router]);

  useEffect(() => {
    api.places().then(setSuggest).catch(() => undefined);
  }, []);

  const search = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setTrips(await api.trips(origin, dest));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load trips");
    } finally {
      setBusy(false);
    }
  }, [origin, dest]);

  useEffect(() => {
    search();
  }, [search]);

  if (loading || user) return null;

  const bookTrip = () => router.push("/auth?mode=login");

  return (
    <div className="rel-landing" style={{ minHeight: "100vh" }}>
      <SiteHeader active="/browse" />

      <div className="rel-page rel-up">
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 32, fontWeight: 700, letterSpacing: "-1px" }}>Browse live trips</div>
          <div style={{ fontSize: 14, color: "#8c8378", fontWeight: 600, marginTop: 4 }}>Real seats, fares and arrival times from every operator — no account needed. Sign in only when you're ready to book.</div>
        </div>

        {/* search bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1px solid #e9e3d8", borderRadius: 18, padding: 8, marginBottom: 10, flexWrap: "wrap", boxShadow: "0 18px 44px -28px rgba(27,23,20,.4)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", flex: 1, minWidth: 200 }}>
            <div style={{ width: 11, height: 11, borderRadius: "50%", border: "3px solid #ff6a1a", flex: "none" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "#8c8378", fontWeight: 700, letterSpacing: ".04em" }}>FROM</div>
              <input value={origin} onChange={(e) => setOrigin(e.target.value)} list="browse-places" style={{ border: "none", outline: "none", background: "transparent", fontSize: 15, fontWeight: 700, width: "100%", fontFamily: "'Manrope', sans-serif", color: "#1b1714" }} />
            </div>
          </div>
          <button onClick={() => { const o = origin; setOrigin(dest); setDest(o); }} style={{ width: 32, height: 32, borderRadius: 9, border: "1px solid #e9e3d8", background: "#f4f1ea", cursor: "pointer", fontSize: 14, flex: "none" }}>⇅</button>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", flex: 1, minWidth: 200 }}>
            <div style={{ width: 11, height: 11, borderRadius: 3, background: "#1b1714", flex: "none" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "#8c8378", fontWeight: 700, letterSpacing: ".04em" }}>TO</div>
              <input value={dest} onChange={(e) => setDest(e.target.value)} list="browse-places" style={{ border: "none", outline: "none", background: "transparent", fontSize: 15, fontWeight: 700, width: "100%", fontFamily: "'Manrope', sans-serif", color: "#1b1714" }} />
            </div>
          </div>
          <button onClick={search} disabled={busy} style={{ background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 12, padding: "13px 22px", fontSize: 14, fontWeight: 700, cursor: busy ? "default" : "pointer", flex: "none" }}>
            {busy ? "Searching…" : "Search"}
          </button>
          <datalist id="browse-places">
            {suggest.map((g) => <option key={g.id} value={g.name} />)}
          </datalist>
        </div>

        {error && (
          <div style={{ background: "#fff0e6", border: "1px solid #ffd9c2", color: "#c2553f", borderRadius: 12, padding: "11px 14px", fontSize: 13, fontWeight: 600, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "18px 0 14px" }}>
          <span className="rel-pulse" style={{ width: 7, height: 7, borderRadius: "50%", background: busy ? "#a39a8d" : "#2f6bff" }} />
          <span style={{ fontSize: 12, color: busy ? "#8c8378" : "#2f6bff", fontWeight: 700 }}>
            {busy ? "Searching for trips…" : `Live · ${trips.length} ${trips.length === 1 ? "trip" : "trips"}`}
          </span>
        </div>

        <div className="rel-trip-grid">
          {busy && [0, 1, 2].map((i) => <TripCardSkeleton key={i} />)}
          {!busy && trips.length === 0 && <div style={{ fontSize: 13, color: "#8c8378", fontWeight: 600, padding: "8px 0" }}>No live trips on this route right now.</div>}
          {!busy && trips.map((t) => (
            <button
              key={t.id}
              disabled={t.seatsLeft === 0}
              onClick={bookTrip}
              style={{ textAlign: "left", background: "#fff", border: "1px solid #e9e3d8", borderRadius: 18, padding: 18, cursor: "pointer", opacity: t.seatsLeft === 0 ? 0.55 : 1 }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 11 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {t.legs.map((lg, i) => (
                    <span key={i} style={{ width: 22, height: 22, borderRadius: 6, background: lg.color, color: "#fff", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO }}>{lg.code}</span>
                  ))}
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>{t.legs.map((l) => l.label).join(" → ")}</span>
                  {t.tag && <span style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", color: "#ff6a1a", background: "#fff0e6", borderRadius: 6, padding: "3px 7px" }}>{t.tag}</span>}
                </div>
                <StatusPill status={t.status} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div>
                  <div style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 700, letterSpacing: "-.5px", lineHeight: 1 }}>{fmtTime(t.departAt)}</div>
                  <div style={{ fontSize: 11, color: "#8c8378", fontWeight: 600, marginTop: 3 }}>{t.departsInLabel}</div>
                </div>
                <span style={{ color: "#cbc3b6", fontSize: 14 }}>→</span>
                <div>
                  <div style={{ fontFamily: DISPLAY, fontSize: 16, fontWeight: 700, color: "#6b6258", lineHeight: 1 }}>{fmtTime(t.arriveAt)}</div>
                  <div style={{ fontSize: 11, color: "#a39a8d", fontWeight: 600, marginTop: 3 }}>{t.durationLabel}</div>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #f1ece2", paddingTop: 11 }}>
                <div style={{ fontSize: 12, color: "#8c8378", fontWeight: 600 }}>
                  {t.operatorName} · <span style={{ color: t.seatsLeft <= 3 ? "#c2553f" : "#1f9d6b", fontWeight: 700 }}>{t.seatsLeft === 0 ? "Full" : `${t.seatsLeft} seats left`}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, color: "#ff6a1a" }}>{formatRWF(t.fare)}</span>
                  {t.surge && <span style={{ fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", color: "#c2553f", background: "#fbeae6", borderRadius: 5, padding: "2px 5px" }}>surge</span>}
                </div>
              </div>
            </button>
          ))}
        </div>

        <div style={{ textAlign: "center", marginTop: 34, padding: "22px 0 6px", borderTop: "1px solid #f1ece2" }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Ready to book a seat?</div>
          <button onClick={() => router.push("/auth?mode=register")} style={{ background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 14, padding: "14px 26px", fontSize: 14.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 14px 30px -12px rgba(255,106,26,.7)" }}>
            Create a free account
          </button>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}
