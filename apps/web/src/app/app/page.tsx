"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  BookingDetail,
  PaymentMethod,
  Place,
  TrackingSnapshot,
  TripSummary,
} from "@relay/shared";
import { QRCodeSVG } from "qrcode.react";
import { formatRWF, topUpSchema, savedPlaceSchema, type TopUpInput, type SavedPlaceInput } from "@relay/shared";
import { api, ApiError, type SavedPlace, type WalletData, type NotificationList, type MeStats } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Pagination, FormModal } from "@/components/console";

const DISPLAY = "'Space Grotesk', sans-serif";
const MONO = "'JetBrains Mono', monospace";

type PlanScreen = "home" | "search" | "available" | "planAhead" | "pay" | "track" | "done";
type Tab = "plan" | "trips" | "wallet" | "you";

const PAY_METHODS: { method: PaymentMethod; name: string; sub: string; glyph: string; gbg: string; gink: string }[] = [
  { method: "MOBILE_MONEY", name: "MTN MoMo", sub: "•••• 4821", glyph: "M", gbg: "#ffd400", gink: "#1b1714" },
  { method: "WALLET", name: "Relay Wallet", sub: "balance", glyph: "◈", gbg: "#1b1714", gink: "#ff6a1a" },
  { method: "QR", name: "QR Code", sub: "scan to pay", glyph: "▦", gbg: "#e9f0ff", gink: "#2f6bff" },
];

export default function PassengerApp() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();

  const [tab, setTab] = useState<Tab>("plan");
  const [screen, setScreen] = useState<PlanScreen>("home");

  const [origin, setOrigin] = useState("Kabeza");
  const [dest, setDest] = useState("Central Market");

  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [selected, setSelected] = useState<TripSummary | null>(null);
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("MOBILE_MONEY");
  const [trackPhase, setTrackPhase] = useState<"approaching" | "boarded">("approaching");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const requireAuth = useCallback(() => {
    if (!user) {
      router.push("/auth?mode=login");
      return false;
    }
    return true;
  }, [user, router]);

  const loadTrips = useCallback(async () => {
    setError(null);
    try {
      setTrips(await api.trips(origin, dest));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load trips");
    }
  }, [origin, dest]);

  const goAvailable = useCallback(async () => {
    setScreen("available");
    await loadTrips();
  }, [loadTrips]);

  const startBooking = useCallback(
    async (trip: TripSummary) => {
      if (!requireAuth()) return;
      setSelected(trip);
      setError(null);
      setBusy(true);
      try {
        const b = await api.createBooking({ tripId: trip.id, seats: 1 });
        setBooking(b);
        setScreen("pay");
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Could not reserve seat");
      } finally {
        setBusy(false);
      }
    },
    [requireAuth]
  );

  const pay = useCallback(async () => {
    if (!booking) return;
    setBusy(true);
    setError(null);
    try {
      await api.pay({ bookingId: booking.id, method: payMethod });
      await refreshUser();
      setTrackPhase("approaching");
      setScreen("track");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  }, [booking, payMethod, refreshUser]);

  const submitRating = useCallback(
    async (score: number) => {
      if (!booking) return;
      try {
        await api.rate({ bookingId: booking.id, score });
      } catch {
        /* ignore — already completed is fine */
      }
    },
    [booking]
  );

  const resetToHome = () => {
    setScreen("home");
    setSelected(null);
    setBooking(null);
    setTab("plan");
  };

  return (
    <div className="pax-shell">
      <PassengerSidebar
        tab={tab}
        walletBalance={user?.walletBalance ?? null}
        onChange={(t) => {
          setTab(t);
          if (t === "plan") setScreen("home");
        }}
      />
      <main className="pax-main">
        {error && (
          <div className="rel-narrow" style={{ background: "#fff0e6", border: "1px solid #ffd9c2", color: "#c2553f", borderRadius: 12, padding: "11px 14px", fontSize: 13, fontWeight: 600, marginBottom: 18 }}>
            {error}
          </div>
        )}

        {tab === "plan" && screen === "home" && (
          <div className="rel-wide">
            <HomeScreen
              origin={origin}
              dest={dest}
              walletBalance={user?.walletBalance ?? null}
              busy={busy}
              onSearch={() => setScreen("search")}
              onSeeTrips={goAvailable}
              onPlanAhead={() => setScreen("planAhead")}
              onBook={startBooking}
            />
          </div>
        )}
        {tab === "plan" && screen === "search" && (
          <div className="rel-narrow">
            <SearchScreen origin={origin} dest={dest} setOrigin={setOrigin} setDest={setDest} onBack={() => setScreen("home")} onDone={goAvailable} />
          </div>
        )}
        {tab === "plan" && screen === "available" && (
          <AvailableScreen origin={origin} dest={dest} trips={trips} busy={busy} onBack={() => setScreen("home")} onBook={startBooking} />
        )}
        {tab === "plan" && screen === "planAhead" && (
          <div className="rel-narrow">
            <PlanAheadScreen origin={origin} dest={dest} requireAuth={requireAuth} onBack={() => setScreen("home")} onDone={() => setScreen("home")} />
          </div>
        )}
        {tab === "plan" && screen === "pay" && selected && booking && (
          <PayScreen trip={selected} bookingId={booking.id} method={payMethod} setMethod={setPayMethod} busy={busy} onBack={() => setScreen("available")} onPay={pay} />
        )}
        {tab === "plan" && screen === "track" && selected && booking && (
          <TrackScreen booking={booking} trip={selected} phase={trackPhase} onBoard={() => setTrackPhase("boarded")} onArrived={() => setScreen("done")} />
        )}
        {tab === "plan" && screen === "done" && selected && (
          <div className="rel-narrow">
            <DoneScreen trip={selected} onRate={submitRating} onNewTrip={resetToHome} />
          </div>
        )}

        {tab === "trips" && <div className="rel-mid"><TripsTab /></div>}
        {tab === "wallet" && <div className="rel-mid"><WalletTab /></div>}
        {tab === "you" && <div className="rel-mid"><YouTab /></div>}
      </main>
    </div>
  );
}

/* ============ HOME ============ */
const MODE_CARDS = [
  { code: "B", label: "Buses", color: "#2f6bff", bg: "#e9f0ff", from: "RWF 700" },
  { code: "M", label: "Moto-taxis", color: "#ff6a1a", bg: "#fff0e6", from: "RWF 1,000" },
  { code: "R", label: "Shared rides", color: "#7c5cff", bg: "#efeaff", from: "RWF 3,000" },
];

function HomeScreen({
  origin,
  dest,
  walletBalance,
  busy,
  onSearch,
  onSeeTrips,
  onPlanAhead,
  onBook,
}: {
  origin: string;
  dest: string;
  walletBalance: number | null;
  busy: boolean;
  onSearch: () => void;
  onSeeTrips: () => void;
  onPlanAhead: () => void;
  onBook: (t: TripSummary) => void;
}) {
  const { user } = useAuth();
  const [planned, setPlanned] = useState<{ id: string; from: string; to: string; when: string }[]>([]);
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [live, setLive] = useState<TripSummary[]>([]);

  useEffect(() => {
    api.trips(origin, dest).then(setLive).catch(() => undefined);
    if (user) {
      api.planned().then(setPlanned).catch(() => undefined);
      api.savedPlaces().then(setPlaces).catch(() => undefined);
    }
  }, [user, origin, dest]);

  const firstName = user ? user.fullName.split(" ")[0] : "there";

  return (
    <div className="rel-up">
      {/* greeting band */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12, marginBottom: 22 }}>
        <div>
          <div style={{ fontSize: 13.5, color: "#8c8378", fontWeight: 600 }}>Good morning, {firstName}</div>
          <div style={{ fontFamily: DISPLAY, fontSize: 34, fontWeight: 700, letterSpacing: "-1px", lineHeight: 1.05 }}>Where to today?</div>
        </div>
        {walletBalance !== null && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #e9e3d8", borderRadius: 30, padding: "8px 14px", fontSize: 13, fontWeight: 700 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#1f9d6b" }} />
            <span style={{ color: "#8c8378" }}>Wallet</span>
            <span style={{ fontFamily: MONO }}>{formatRWF(walletBalance)}</span>
          </div>
        )}
      </div>

      <div className="rel-home-grid">
        {/* LEFT — search + planned + saved */}
        <div>
          <button onClick={onSearch} style={{ display: "block", width: "100%", textAlign: "left", background: "#fff", border: "1px solid #e9e3d8", borderRadius: 22, padding: 8, boxShadow: "0 18px 44px -28px rgba(27,23,20,.4)", cursor: "pointer" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "16px 16px" }}>
              <div style={{ width: 11, height: 11, borderRadius: "50%", border: "3px solid #ff6a1a", flex: "none" }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: "#8c8378", fontWeight: 700, letterSpacing: ".04em" }}>FROM</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{origin}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", padding: "0 16px" }}>
              <div style={{ flex: 1, height: 1, background: "#e9e3d8" }} />
              <div style={{ width: 26, height: 26, borderRadius: 8, border: "1px solid #e9e3d8", background: "#f4f1ea", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#8c8378" }}>⇅</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "16px 16px" }}>
              <div style={{ width: 11, height: 11, borderRadius: 3, background: "#1b1714", flex: "none" }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: "#8c8378", fontWeight: 700, letterSpacing: ".04em" }}>TO</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{dest}</div>
              </div>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: "#ff6a1a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flex: "none" }}>→</div>
            </div>
          </button>

          <div style={{ display: "flex", gap: 11, marginTop: 14 }}>
            <button onClick={onSeeTrips} style={{ flex: 1, background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 15, padding: 16, fontSize: 14.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 14px 30px -14px rgba(255,106,26,.75)" }}>See trips now</button>
            <button onClick={onPlanAhead} style={{ flex: 1, background: "#fff", color: "#1b1714", border: "1px solid #e3ddd1", borderRadius: 15, padding: 16, fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}>Plan ahead</button>
          </div>

          {/* mode chips */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 11, marginTop: 14 }}>
            {MODE_CARDS.map((m) => (
              <div key={m.code} style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 16, padding: 14 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: m.bg, color: m.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800, fontFamily: MONO, marginBottom: 10 }}>{m.code}</div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{m.label}</div>
                <div style={{ fontSize: 11.5, color: "#8c8378", fontWeight: 600, marginTop: 2 }}>from <span style={{ fontFamily: MONO, color: "#ff6a1a" }}>{m.from}</span></div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "26px 0 12px" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#8c8378", letterSpacing: ".05em", textTransform: "uppercase" }}>Planned trips</span>
            <span style={{ fontSize: 11.5, color: "#ff6a1a", fontWeight: 700 }}>Relay watches for matches</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            {planned.length === 0 && (
              <div style={{ background: "#fff", border: "1px dashed #d8d1c4", borderRadius: 16, padding: 16, fontSize: 12.5, color: "#8c8378", fontWeight: 600 }}>
                No watches yet — use “Plan ahead” to get notified when a matching trip is scheduled.
              </div>
            )}
            {planned.map((p) => (
              <div key={p.id} style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 16, padding: 15 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{p.from} → {p.to}</div>
                  <span style={{ fontSize: 10.5, fontWeight: 800, color: "#ff6a1a", background: "#fff0e6", borderRadius: 7, padding: "3px 8px", textTransform: "uppercase" }}>Watching</span>
                </div>
                <div style={{ fontSize: 12.5, color: "#8c8378", fontWeight: 600 }}>{p.when}</div>
              </div>
            ))}
          </div>

          {places.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#8c8378", letterSpacing: ".05em", textTransform: "uppercase", margin: "24px 0 12px" }}>Saved places</div>
              <div style={{ display: "flex", gap: 11 }}>
                {places.slice(0, 2).map((p) => (
                  <SavedPlaceBtn key={p.id} icon={p.icon} name={p.label} sub={p.area} onClick={onSeeTrips} />
                ))}
              </div>
            </>
          )}
        </div>

        {/* RIGHT — live-trips rail */}
        <aside style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 24, overflow: "hidden", boxShadow: "0 24px 60px -34px rgba(27,23,20,.4)", position: "sticky", top: 30 }}>
          <div style={{ position: "relative", height: 168, background: "#e9efe8" }}>
            <HomeMapArt />
            <div style={{ position: "absolute", left: 14, top: 14, background: "rgba(255,255,255,.94)", borderRadius: 11, padding: "7px 12px", display: "flex", alignItems: "center", gap: 8, boxShadow: "0 4px 14px -6px rgba(0,0,0,.25)" }}>
              <span className="rel-pulse" style={{ width: 8, height: 8, borderRadius: "50%", background: "#1f9d6b" }} />
              <span style={{ fontSize: 12, fontWeight: 700 }}>{live.length} live near you</span>
            </div>
          </div>
          <div style={{ padding: "18px 18px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <div style={{ fontFamily: DISPLAY, fontSize: 17, fontWeight: 700, letterSpacing: "-.3px" }}>Departing now</div>
                <div style={{ fontSize: 12, color: "#8c8378", fontWeight: 600 }}>{origin} → {dest}</div>
              </div>
              <button onClick={onSeeTrips} style={{ background: "none", border: "none", color: "#ff6a1a", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>See all →</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {live.length === 0 && <div style={{ fontSize: 12.5, color: "#8c8378", fontWeight: 600, padding: "6px 0" }}>No live trips on this route right now.</div>}
              {live.slice(0, 4).map((t) => (
                <button key={t.id} disabled={busy || t.seatsLeft === 0} onClick={() => onBook(t)} style={{ textAlign: "left", background: t.seatsLeft === 0 ? "#faf8f4" : "#fff", border: "1px solid #e9e3d8", borderRadius: 15, padding: "12px 13px", cursor: busy ? "default" : "pointer", opacity: t.seatsLeft === 0 ? 0.6 : 1, display: "flex", alignItems: "center", gap: 11 }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    {t.legs.map((lg, i) => (
                      <span key={i} style={{ width: 22, height: 22, borderRadius: 6, background: lg.color, color: "#fff", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO }}>{lg.code}</span>
                    ))}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.legs.map((l) => l.label).join(" → ")}</div>
                    <div style={{ fontSize: 11.5, color: "#8c8378", fontWeight: 600 }}>{fmtTime(t.departAt)} · {t.departsInLabel}</div>
                  </div>
                  <div style={{ textAlign: "right", flex: "none" }}>
                    <div style={{ fontFamily: MONO, fontSize: 13.5, fontWeight: 700, color: "#ff6a1a" }}>{formatRWF(t.fare)}</div>
                    <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", color: t.status === "BOARDING" ? "#ff6a1a" : t.status === "RUNNING" ? "#1f9d6b" : "#8c8378" }}>{t.status.toLowerCase()}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function HomeMapArt() {
  return (
    <svg viewBox="0 0 500 200" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <rect width="500" height="200" fill="#e9efe8" />
      <path d="M-20 70 C 120 40, 200 110, 360 90 S 520 120, 540 100 L 540 150 C 420 165, 300 110, 180 130 S 20 110, -20 130 Z" fill="#cfe0ec" />
      <circle cx="110" cy="150" r="34" fill="#d6e6cf" />
      <rect x="330" y="26" width="80" height="52" rx="12" fill="#d6e6cf" />
      <g stroke="#fff" strokeWidth="8" fill="none" strokeLinecap="round"><path d="M20 44 C 150 66, 220 150, 470 160" /><path d="M80 14 C 110 100, 60 160, 130 200" /></g>
      <path d="M50 50 C 170 74, 240 150, 430 158" fill="none" stroke="#ff6a1a" strokeWidth="4" strokeLinecap="round" strokeDasharray="1 9" />
      <circle cx="50" cy="50" r="7" fill="#1b1714" stroke="#fff" strokeWidth="3" />
      <rect x="423" y="151" width="14" height="14" rx="4" fill="#ff6a1a" stroke="#fff" strokeWidth="3" />
      <g transform="translate(250,110)"><circle r="12" fill="#1b1714" opacity="0.14" /><circle r="8" fill="#1b1714" stroke="#fff" strokeWidth="3" /></g>
    </svg>
  );
}

function SavedPlaceBtn({ icon, name, sub, onClick }: { icon: string; name: string; sub: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ flex: 1, textAlign: "left", background: "#fff", border: "1px solid #e9e3d8", borderRadius: 16, padding: 15, cursor: "pointer" }}>
      <div style={{ width: 32, height: 32, borderRadius: 9, background: "#f4f1ea", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, marginBottom: 9 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 700 }}>{name}</div>
      <div style={{ fontSize: 12, color: "#8c8378" }}>{sub}</div>
    </button>
  );
}

/* ============ SEARCH ============ */
function SearchScreen({
  origin,
  dest,
  setOrigin,
  setDest,
  onBack,
  onDone,
}: {
  origin: string;
  dest: string;
  setOrigin: (v: string) => void;
  setDest: (v: string) => void;
  onBack: () => void;
  onDone: () => void;
}) {
  const [suggest, setSuggest] = useState<Place[]>([]);
  useEffect(() => {
    api.places().then(setSuggest).catch(() => undefined);
  }, []);

  return (
    <div style={{ padding: "8px 22px 28px" }} className="rel-up">
      <ScreenHeader onBack={onBack} title="Set your trip" />
      <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 18, padding: 8, marginBottom: 16 }}>
        <FromToRow dotBorder value={origin} onChange={setOrigin} label="FROM" />
        <div style={{ display: "flex", alignItems: "center", padding: "0 14px" }}>
          <div style={{ flex: 1, height: 1, background: "#e9e3d8" }} />
          <button onClick={() => { const o = origin; setOrigin(dest); setDest(o); }} style={{ width: 32, height: 32, borderRadius: 9, border: "1px solid #e9e3d8", background: "#f4f1ea", cursor: "pointer", fontSize: 14 }}>⇅</button>
        </div>
        <FromToRow value={dest} onChange={setDest} label="TO" highlight />
      </div>
      <SectionLabel>Suggestions</SectionLabel>
      <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 16, overflow: "hidden", marginBottom: 16 }}>
        {suggest.map((g) => (
          <button key={g.id} onClick={() => setDest(g.name)} style={{ display: "flex", alignItems: "center", gap: 13, width: "100%", textAlign: "left", padding: "14px 16px", border: "none", borderBottom: "1px solid #f1ece2", background: "none", cursor: "pointer" }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: "#f4f1ea", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flex: "none" }}>◎</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{g.name}</div>
              <div style={{ fontSize: 12, color: "#8c8378" }}>{g.area}</div>
            </div>
          </button>
        ))}
      </div>
      <PrimaryBtn onClick={onDone}>See available trips</PrimaryBtn>
    </div>
  );
}

function FromToRow({ value, onChange, label, dotBorder, highlight }: { value: string; onChange: (v: string) => void; label: string; dotBorder?: boolean; highlight?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", background: highlight ? "#fff6f0" : "transparent", borderRadius: 12 }}>
      <div style={{ width: 11, height: 11, borderRadius: dotBorder ? "50%" : 3, border: dotBorder ? "3px solid #ff6a1a" : "none", background: dotBorder ? "transparent" : "#1b1714", flex: "none" }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, color: highlight ? "#ff6a1a" : "#8c8378", fontWeight: highlight ? 700 : 600 }}>{label}</div>
        <input value={value} onChange={(e) => onChange(e.target.value)} style={{ border: "none", outline: "none", background: "transparent", fontSize: 15, fontWeight: 700, width: "100%", fontFamily: "'Manrope', sans-serif", color: "#1b1714" }} />
      </div>
    </div>
  );
}

/* ============ AVAILABLE ============ */
function AvailableScreen({ origin, dest, trips, busy, onBack, onBook }: { origin: string; dest: string; trips: TripSummary[]; busy: boolean; onBack: () => void; onBook: (t: TripSummary) => void }) {
  return (
    <div className="rel-up rel-wide">
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
        <BackBtn onClick={onBack} />
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: "#fff", border: "1px solid #e9e3d8", borderRadius: 18, padding: "15px 20px", flexWrap: "wrap", boxShadow: "0 12px 34px -26px rgba(27,23,20,.4)" }}>
          <div>
            <div style={{ fontSize: 11.5, color: "#8c8378", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" }}>Available trips</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 5, flexWrap: "wrap" }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", border: "3px solid #ff6a1a" }} />
              <span style={{ fontFamily: DISPLAY, fontSize: 21, fontWeight: 700, letterSpacing: "-.4px" }}>{origin}</span>
              <span style={{ color: "#cbc3b6", fontSize: 16 }}>→</span>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: "#1b1714" }} />
              <span style={{ fontFamily: DISPLAY, fontSize: 21, fontWeight: 700, letterSpacing: "-.4px" }}>{dest}</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#eef5ff", border: "1px solid #d8e6ff", borderRadius: 30, padding: "8px 14px" }}>
            <span className="rel-pulse" style={{ width: 7, height: 7, borderRadius: "50%", background: "#2f6bff" }} />
            <span style={{ fontSize: 12, color: "#2f6bff", fontWeight: 700 }}>Live · {trips.length} {trips.length === 1 ? "trip" : "trips"}</span>
          </div>
        </div>
      </div>
      <div className="rel-trip-grid">
        {trips.length === 0 && <div style={{ fontSize: 13, color: "#8c8378", fontWeight: 600, padding: "8px 0" }}>No live trips on this route right now.</div>}
        {trips.map((t) => (
          <button key={t.id} disabled={busy || t.seatsLeft === 0} onClick={() => onBook(t)} style={{ textAlign: "left", background: "#fff", border: "1px solid #e9e3d8", borderRadius: 18, padding: 18, cursor: busy ? "default" : "pointer", opacity: t.seatsLeft === 0 ? 0.55 : 1 }}>
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
    </div>
  );
}

/* ============ PLAN AHEAD ============ */
function PlanAheadScreen({ origin, dest, requireAuth, onBack, onDone }: { origin: string; dest: string; requireAuth: () => boolean; onBack: () => void; onDone: () => void }) {
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!requireAuth()) return;
    setBusy(true);
    try {
      await api.createPlanned({ originLabel: origin, destLabel: dest, whenLabel: "Tomorrow 08:00 · weekdays", notify });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: "8px 22px 28px" }} className="rel-up">
      <ScreenHeader onBack={onBack} title="Plan ahead" />
      <div style={{ background: "#fff6f0", border: "1px solid #ffd9c2", borderRadius: 14, padding: 14, marginBottom: 16, display: "flex", gap: 11, alignItems: "flex-start" }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, background: "#ff6a1a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flex: "none" }}>◔</span>
        <div style={{ fontSize: 12.5, color: "#6b6258", lineHeight: 1.5 }}>Set a trip and Relay notifies you the moment an operator schedules a matching departure — no need to keep checking.</div>
      </div>
      <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 18, padding: 8, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 14px" }}>
          <div style={{ width: 11, height: 11, borderRadius: "50%", border: "3px solid #ff6a1a", flex: "none" }} />
          <div style={{ flex: 1 }}><div style={{ fontSize: 11, color: "#8c8378", fontWeight: 600 }}>FROM</div><div style={{ fontSize: 15, fontWeight: 700 }}>{origin}</div></div>
        </div>
        <div style={{ height: 1, background: "#e9e3d8", margin: "0 14px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 14px" }}>
          <div style={{ width: 11, height: 11, borderRadius: 3, background: "#1b1714", flex: "none" }} />
          <div style={{ flex: 1 }}><div style={{ fontSize: 11, color: "#8c8378", fontWeight: 600 }}>TO</div><div style={{ fontSize: 15, fontWeight: 700 }}>{dest}</div></div>
        </div>
      </div>
      <SectionLabel>When</SectionLabel>
      <div style={{ display: "flex", gap: 9, marginBottom: 14, flexWrap: "wrap" }}>
        <Chip active>Tomorrow</Chip>
        <Chip>08:00</Chip>
        <Chip>Repeat weekdays</Chip>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", border: "1px solid #e9e3d8", borderRadius: 14, padding: "14px 16px", marginBottom: 20 }}>
        <div><div style={{ fontSize: 14, fontWeight: 700 }}>Notify me of matches</div><div style={{ fontSize: 12, color: "#8c8378" }}>Push + in-app alert</div></div>
        <button onClick={() => setNotify((n) => !n)} style={{ width: 42, height: 24, borderRadius: 20, background: notify ? "#ff6a1a" : "#cbc3b6", position: "relative", border: "none", cursor: "pointer" }}>
          <div style={{ position: "absolute", top: 3, left: notify ? 21 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
        </button>
      </div>
      <PrimaryBtn onClick={save} busy={busy}>Start watching for trips</PrimaryBtn>
    </div>
  );
}

/* ============ PAY ============ */
function PayScreen({ trip, bookingId, method, setMethod, busy, onBack, onPay }: { trip: TripSummary; bookingId: string; method: PaymentMethod; setMethod: (m: PaymentMethod) => void; busy: boolean; onBack: () => void; onPay: () => void }) {
  const fee = 100;
  const total = trip.fare + fee;
  const [showQr, setShowQr] = useState(false);

  // QR method shows a scannable code first; other methods pay instantly.
  const handlePay = () => {
    if (method === "QR") setShowQr(true);
    else onPay();
  };

  return (
    <div className="rel-up">
      {showQr && (
        <QrPayOverlay
          amount={total}
          payload={`relay:pay?ref=${bookingId}&amt=${Math.round(total)}&cur=RWF`}
          busy={busy}
          onConfirm={onPay}
          onCancel={() => setShowQr(false)}
        />
      )}
      <ScreenHeader onBack={onBack} title="Confirm & pay" sub="Contactless · secured by Relay" />
      <div className="rel-pay-grid">
        {/* left — trip summary + fare */}
        <div>
          <div style={{ background: "#1b1714", borderRadius: 20, padding: 22, color: "#fff", marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                {trip.legs.map((lg, i) => (
                  <span key={i} style={{ width: 26, height: 26, borderRadius: 7, background: lg.color, color: "#fff", fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO }}>{lg.code}</span>
                ))}
                <span style={{ fontSize: 14, fontWeight: 700, marginLeft: 2 }}>{trip.legs.map((l) => l.label).join(" → ")}</span>
              </div>
              <div style={{ fontFamily: DISPLAY, fontSize: 17, fontWeight: 700 }}>{trip.durationLabel}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 14, color: "#cfc7bb" }}><span style={{ width: 9, height: 9, border: "2px solid #ff6a1a", borderRadius: "50%" }} />{trip.origin}</div>
            <div style={{ width: 1, height: 14, background: "#48413a", marginLeft: 4 }} />
            <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 14, color: "#fff", fontWeight: 600 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: "#fff" }} />{trip.destination}</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16, paddingTop: 15, borderTop: "1px solid #3a332c" }}>
              <div><div style={{ fontSize: 11, color: "#9a9186", fontWeight: 600 }}>DEPARTS</div><div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 700 }}>{fmtTime(trip.departAt)} · {trip.departsInLabel}</div></div>
              <div style={{ textAlign: "right" }}><div style={{ fontSize: 11, color: "#9a9186", fontWeight: 600 }}>OPERATOR</div><div style={{ fontSize: 13, fontWeight: 700 }}>{trip.operatorName}</div></div>
            </div>
          </div>

          <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 16, padding: "6px 18px" }}>
            <Row label="Fare · seat reserved" value={formatRWF(trip.fare)} />
            <Row label="Service fee" value={formatRWF(fee)} />
            <Row label="Total" value={formatRWF(total)} total />
          </div>
        </div>

        {/* right — payment methods + pay */}
        <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 20, padding: 22 }}>
          <SectionLabel>Pay with</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
            {PAY_METHODS.map((m) => {
              const sel = method === m.method;
              return (
                <button key={m.method} onClick={() => setMethod(m.method)} style={{ display: "flex", alignItems: "center", gap: 13, width: "100%", textAlign: "left", background: sel ? "#fff6f0" : "#fff", border: `2px solid ${sel ? "#ff6a1a" : "#e9e3d8"}`, borderRadius: 15, padding: "13px 15px", cursor: "pointer" }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: m.gbg, color: m.gink, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 800, flex: "none" }}>{m.glyph}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700 }}>{m.name}</div>
                    <div style={{ fontSize: 12, color: "#8c8378", fontFamily: MONO }}>{m.sub}</div>
                  </div>
                  {sel && <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#ff6a1a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>✓</div>}
                </button>
              );
            })}
          </div>
          <PrimaryBtn onClick={handlePay} busy={busy}>
            {method === "QR" ? `Show QR to pay ${formatRWF(total)}` : `Pay ${formatRWF(total)} & book seat`}
          </PrimaryBtn>
          <div style={{ textAlign: "center", fontSize: 11.5, color: "#a39a8d", marginTop: 11 }}>⊘ Encrypted · seat held until departure</div>
        </div>
      </div>
    </div>
  );
}

/* ============ QR PAY OVERLAY ============ */
function QrPayOverlay({ amount, payload, busy, onConfirm, onCancel }: { amount: number; payload: string; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const [seconds, setSeconds] = useState(120);
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);
  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(27,23,20,.55)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 400, background: "#fff", borderRadius: 24, overflow: "hidden", boxShadow: "0 40px 90px -30px rgba(0,0,0,.6)" }} className="rel-up">
        <div style={{ background: "#1b1714", color: "#fff", padding: "22px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: DISPLAY, fontSize: 19, fontWeight: 700, letterSpacing: "-.4px" }}>Scan to pay</div>
            <div style={{ fontSize: 12.5, color: "#cfc7bb", fontWeight: 600, marginTop: 2 }}>Open your bank or Mobile Money app</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10.5, color: "#9a9186", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" }}>Expires</div>
            <div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 700, color: "#ff6a1a" }}>{mm}:{ss}</div>
          </div>
        </div>

        <div style={{ padding: "26px 24px 22px", textAlign: "center" }}>
          <div style={{ display: "inline-block", padding: 16, background: "#fff", border: "1px solid #e9e3d8", borderRadius: 20, boxShadow: "0 10px 30px -18px rgba(27,23,20,.4)" }}>
            <QRCodeSVG value={payload} size={196} level="M" fgColor="#1b1714" bgColor="#ffffff" marginSize={0} />
          </div>
          <div style={{ fontFamily: DISPLAY, fontSize: 28, fontWeight: 700, letterSpacing: "-.8px", marginTop: 18 }}>{formatRWF(amount)}</div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 8, background: "#fff6f0", border: "1px solid #ffd9c2", borderRadius: 30, padding: "6px 13px" }}>
            <span className="rel-pulse" style={{ width: 8, height: 8, borderRadius: "50%", background: "#ff6a1a" }} />
            <span style={{ fontSize: 12.5, color: "#c2553f", fontWeight: 700 }}>Waiting for scan…</span>
          </div>
          <div style={{ fontSize: 12.5, color: "#8c8378", fontWeight: 600, lineHeight: 1.5, margin: "16px 0 20px" }}>
            Point your phone camera at the code to confirm payment. The seat is held until the code expires.
          </div>

          <PrimaryBtn onClick={onConfirm} busy={busy}>
            {busy ? "Confirming…" : "I've scanned · confirm payment"}
          </PrimaryBtn>
          <button onClick={onCancel} disabled={busy} style={{ width: "100%", marginTop: 10, background: "none", border: "none", fontSize: 13, fontWeight: 700, color: "#a39a8d", cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>
            Choose another method
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============ TRACK ============ */
function TrackScreen({ booking, trip, phase, onBoard, onArrived }: { booking: BookingDetail; trip: TripSummary; phase: "approaching" | "boarded"; onBoard: () => void; onArrived: () => void }) {
  const [snap, setSnap] = useState<TrackingSnapshot | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let active = true;
    const poll = () => api.tracking(booking.id).then((s) => active && setSnap(s)).catch(() => undefined);
    poll();
    timer.current = setInterval(poll, 3000);
    return () => {
      active = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, [booking.id]);

  const eta = snap?.etaMinutes ?? 3;
  const banner = phase === "approaching" ? `${trip.operatorName} · arriving in ${eta} min` : `On board · arriving in ${eta} min`;

  return (
    <div className="rel-up">
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 24, fontWeight: 700, letterSpacing: "-.5px" }}>Track your ride</div>
        <div style={{ fontSize: 13, color: "#8c8378", fontWeight: 600 }}>{trip.origin} → {trip.destination}</div>
      </div>
      <div className="rel-track-grid">
        <TrackMap progress={snap?.progressPct ?? 0} banner={banner} />
        <div style={{ position: "relative" }}>
        {phase === "approaching" ? (
          <>
            <div style={{ background: "#fff", border: "2px solid #ff6a1a", borderRadius: 20, padding: 17, boxShadow: "0 14px 40px -20px rgba(255,106,26,.5)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 15 }}>
                <div><div style={{ fontSize: 12, color: "#8c8378", fontWeight: 600 }}>Your {trip.legs.map((l) => l.label).join(" → ")} arrives in</div><div style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 700, letterSpacing: "-.6px" }}>{eta} min</div></div>
                <div style={{ textAlign: "right" }}><div style={{ fontSize: 11, color: "#8c8378", fontWeight: 600 }}>SEAT</div><div style={{ fontFamily: MONO, fontSize: 18, fontWeight: 700 }}>{snap?.seatNumber ?? "12A"}</div></div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 13, paddingTop: 15, borderTop: "1px solid #f1ece2" }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: "linear-gradient(135deg,#ff8a3d,#e0560c)", flex: "none" }} />
                <div style={{ flex: 1 }}><div style={{ fontSize: 15, fontWeight: 700 }}>{snap?.driver?.name ?? "Driver"}</div><div style={{ fontSize: 12.5, color: "#8c8378" }}>{trip.operatorName} · <span style={{ fontFamily: MONO }}>{snap?.driver?.plate ?? "—"}</span> · ★ 4.9</div></div>
                <button style={{ width: 42, height: 42, borderRadius: 12, border: "1px solid #e9e3d8", background: "#f4f1ea", fontSize: 16, cursor: "pointer" }}>✆</button>
              </div>
              <button onClick={onBoard} style={{ width: "100%", marginTop: 15, background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 14, padding: 15, fontSize: 15, fontWeight: 700, cursor: "pointer", boxShadow: "0 12px 26px -12px rgba(255,106,26,.7)" }}>I&apos;ve boarded · scan to confirm</button>
            </div>
            <div style={{ marginTop: 16, background: "#fff", border: "1px solid #e9e3d8", borderRadius: 16, padding: "6px 16px" }}>
              <Step done label="Seat booked & paid" right={formatRWF(trip.fare)} />
              <Step pulse label="Vehicle approaching pickup" right="now" rightColor="#ff6a1a" />
              <Step label={`Board & ride to ${trip.destination}`} muted />
            </div>
          </>
        ) : (
          <>
            <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 20, padding: 17, boxShadow: "0 14px 40px -20px rgba(27,23,20,.4)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <span style={{ width: 22, height: 22, borderRadius: "50%", background: "#e7f6ee", color: "#1f9d6b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>✓</span>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: "#1f9d6b" }}>On board · seat {snap?.seatNumber ?? "12A"} confirmed</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 13, borderTop: "1px solid #f1ece2" }}>
                <div><div style={{ fontSize: 12, color: "#8c8378", fontWeight: 600 }}>Arriving at {trip.destination} in</div><div style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 700, letterSpacing: "-.6px" }}>{eta} min</div></div>
                <div style={{ textAlign: "right" }}><div style={{ fontSize: 12, color: "#8c8378", fontWeight: 600 }}>{trip.operatorName}</div><div style={{ display: "flex", gap: 5, marginTop: 6, justifyContent: "flex-end" }}><Bar /><Bar /><Bar dim /></div></div>
              </div>
            </div>
            <button onClick={onArrived} style={{ width: "100%", marginTop: 18, background: "#1b1714", color: "#fff", border: "none", borderRadius: 16, padding: 16, fontSize: 15, fontWeight: 700, cursor: "pointer" }}>I&apos;ve arrived</button>
          </>
        )}
        </div>
      </div>
    </div>
  );
}

/* ============ DONE ============ */
function DoneScreen({ trip, onRate, onNewTrip }: { trip: TripSummary; onRate: (score: number) => void; onNewTrip: () => void }) {
  const [stars, setStars] = useState(0);
  return (
    <div style={{ padding: "8px 22px 28px" }} className="rel-up">
      <div style={{ textAlign: "center", padding: "26px 0 10px" }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#e7f6ee", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34, color: "#1f9d6b", margin: "0 auto 16px" }}>✓</div>
        <div style={{ fontFamily: DISPLAY, fontSize: 24, fontWeight: 700, letterSpacing: "-.5px" }}>You&apos;ve arrived</div>
        <div style={{ fontSize: 13.5, color: "#8c8378", fontWeight: 600, marginTop: 4 }}>{trip.destination} · {trip.durationLabel} trip</div>
      </div>
      <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 16, padding: "6px 16px", margin: "18px 0" }}>
        <Row label="Charged" value="Paid" valueColor="#1f9d6b" />
        <Row label={`${trip.legs.length} legs`} value={formatRWF(trip.fare)} />
      </div>
      <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 20, padding: 20, textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Rate your trip</div>
        <div style={{ fontSize: 12.5, color: "#8c8378", marginBottom: 14 }}>How was your {trip.operatorName} ride?</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 9, marginBottom: 16 }}>
          {[1, 2, 3, 4, 5].map((s) => (
            <button key={s} onClick={() => { setStars(s); onRate(s); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 32, lineHeight: 1, color: s <= stars ? "#ff6a1a" : "#e0dbd0", padding: 0 }}>★</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          {["Clean ride", "On time", "Safe driver"].map((t) => (
            <span key={t} style={{ fontSize: 12, fontWeight: 600, border: "1px solid #e9e3d8", borderRadius: 9, padding: "7px 12px" }}>{t}</span>
          ))}
        </div>
      </div>
      <PrimaryBtn onClick={onNewTrip}>Done · plan another trip</PrimaryBtn>
    </div>
  );
}

/* ============ TRIPS TAB ============ */
function TripsTab() {
  const { user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.bookings>> | null>(null);
  const [page, setPage] = useState(1);
  useEffect(() => {
    if (!user) { router.push("/auth?mode=login"); return; }
    api.bookings(page).then(setData).catch(() => undefined);
  }, [user, router, page]);

  const statusStyle: Record<string, { c: string; b: string }> = {
    CONFIRMED: { c: "#1f9d6b", b: "#e7f6ee" },
    COMPLETED: { c: "#6b6258", b: "#f1ece2" },
    PENDING: { c: "#ff6a1a", b: "#fff0e6" },
    IN_PROGRESS: { c: "#2f6bff", b: "#e9f0ff" },
    CANCELLED: { c: "#c2553f", b: "#fbeae6" },
  };
  const bookings = data?.items ?? [];

  return (
    <div style={{ padding: "14px 22px 28px" }} className="rel-up">
      <div style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 700, letterSpacing: "-.5px", margin: "6px 0 16px" }}>Your trips</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {data && bookings.length === 0 && <div style={{ fontSize: 13, color: "#8c8378", fontWeight: 600 }}>No trips yet — book your first ride from the Plan tab.</div>}
        {bookings.map((b) => {
          const s = statusStyle[b.status] ?? statusStyle.PENDING;
          return (
            <div key={b.id} style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 16, padding: 15 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 11 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 14.5, fontWeight: 700 }}>
                  <span style={{ width: 9, height: 9, border: "2px solid #ff6a1a", borderRadius: "50%" }} />{b.trip.origin}<span style={{ color: "#cbc3b6" }}>→</span>{b.trip.destination}
                </div>
                <span style={{ fontSize: 10.5, fontWeight: 800, color: s.c, background: s.b, borderRadius: 7, padding: "3px 8px" }}>{b.status}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #f1ece2", paddingTop: 11 }}>
                <div style={{ fontSize: 12.5, color: "#8c8378", fontWeight: 600 }}>{fmtDate(b.createdAt)} · {b.trip.legs.map((l) => l.label).join(", ")}</div>
                <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: "#ff6a1a" }}>{formatRWF(b.fare)}</div>
              </div>
            </div>
          );
        })}
      </div>
      {data && <Pagination page={page} totalPages={data.totalPages} total={data.total} onPage={setPage} />}
    </div>
  );
}

/* ============ WALLET TAB ============ */
function WalletTab() {
  const { refreshUser } = useAuth();
  const [data, setData] = useState<WalletData | null>(null);
  const [showTopup, setShowTopup] = useState(false);

  const load = useCallback(() => { api.wallet().then(setData).catch(() => undefined); }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ padding: "14px 22px 28px" }} className="rel-up">
      {showTopup && (
        <FormModal
          title="Top up wallet"
          submitLabel="Top up"
          schema={topUpSchema}
          fields={[{ name: "amount", label: "Amount (RWF)", type: "number", defaultValue: "5000", placeholder: "5000" }]}
          onSubmit={async (v) => { await api.walletTopup((v as TopUpInput).amount); await Promise.all([load(), refreshUser()]); }}
          onClose={() => setShowTopup(false)}
        />
      )}
      <div style={{ background: "#1b1714", borderRadius: 22, padding: 22, color: "#fff", marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12.5, color: "#cfc7bb", fontWeight: 600 }}>Relay Wallet</span>
          <span style={{ fontSize: 12, color: "#9a9186", fontFamily: MONO }}>•••• 4821</span>
        </div>
        <div style={{ fontFamily: MONO, fontSize: 30, fontWeight: 700, letterSpacing: "-1px", margin: "8px 0 18px" }}>{data ? formatRWF(data.balance) : "…"}</div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => setShowTopup(true)} style={{ flex: 1, background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 12, padding: 12, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>Top up</button>
          <button onClick={() => window.alert("Send money — coming soon")} style={{ flex: 1, background: "#2a2520", color: "#fff", border: "none", borderRadius: 12, padding: 12, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>Send</button>
        </div>
      </div>
      <SectionLabel>Payment methods</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
        <PayMethodRow glyph="M" bg="#ffd400" ink="#1b1714" name="MTN MoMo" sub="•••• 4821" badge="Default" />
        <PayMethodRow glyph="◈" bg="#1b1714" ink="#ff6a1a" name="Relay Wallet" sub="Airtel Money linked" />
      </div>
      <SectionLabel>Recent activity</SectionLabel>
      <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 16, overflow: "hidden" }}>
        {data && data.transactions.length === 0 && (
          <div style={{ padding: "16px", fontSize: 13, color: "#8c8378", fontWeight: 600 }}>No wallet activity yet.</div>
        )}
        {data?.transactions.map((w) => {
          const credit = w.kind === "CREDIT";
          return (
            <div key={w.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 16px", borderBottom: "1px solid #f1ece2" }}>
              <div><div style={{ fontSize: 13.5, fontWeight: 600 }}>{w.label}</div><div style={{ fontSize: 11.5, color: "#8c8378", fontFamily: MONO }}>{fmtDateTime(w.date)}</div></div>
              <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: credit ? "#1f9d6b" : "#1b1714" }}>{credit ? "+" : "-"}{formatRWF(w.amount)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PayMethodRow({ glyph, bg, ink, name, sub, badge }: { glyph: string; bg: string; ink: string; name: string; sub: string; badge?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 13, background: "#fff", border: "1px solid #e9e3d8", borderRadius: 15, padding: "13px 15px" }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, background: bg, color: ink, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 800 }}>{glyph}</div>
      <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 700 }}>{name}</div><div style={{ fontSize: 12, color: "#8c8378", fontFamily: MONO }}>{sub}</div></div>
      {badge && <span style={{ fontSize: 11, fontWeight: 800, color: "#1f9d6b", background: "#e7f6ee", borderRadius: 6, padding: "3px 8px" }}>{badge}</span>}
    </div>
  );
}

/* ============ YOU TAB ============ */
type YouView = "menu" | "notifications" | "saved" | "wallet";

function YouTab() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [view, setView] = useState<YouView>("menu");
  const [stats, setStats] = useState<MeStats | null>(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    api.meStats().then(setStats).catch(() => undefined);
    api.notifications().then((n) => setUnread(n.unread)).catch(() => undefined);
  }, []);

  if (view === "notifications") return <NotificationsView onBack={() => { setView("menu"); api.notifications().then((n) => setUnread(n.unread)).catch(() => undefined); }} />;
  if (view === "saved") return <SavedPlacesView onBack={() => setView("menu")} />;
  if (view === "wallet") return <div className="rel-up"><ScreenHeader onBack={() => setView("menu")} title="Payment & wallet" /><WalletTab /></div>;

  const menu: { label: string; icon: string; view?: YouView; badge?: number }[] = [
    { label: "Saved places", icon: "⌂", view: "saved" },
    { label: "Notifications", icon: "◔", view: "notifications", badge: unread },
    { label: "Payment & wallet", icon: "◈", view: "wallet" },
    { label: "Settings", icon: "⚙" },
  ];

  return (
    <div style={{ padding: "14px 22px 28px" }} className="rel-up">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "14px 0 20px" }}>
        <div style={{ width: 74, height: 74, borderRadius: "50%", background: "linear-gradient(135deg,#ff8a3d,#e0560c)", marginBottom: 12 }} />
        <div style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 700 }}>{user?.fullName ?? "Guest"}</div>
        <div style={{ fontSize: 12.5, color: "#8c8378", fontWeight: 600 }}>{user?.phone ?? "Not signed in"} · ★ {stats?.rating.toFixed(1) ?? "4.8"} rider</div>
      </div>
      <div style={{ display: "flex", gap: 11, marginBottom: 18 }}>
        <Stat big={stats ? String(stats.trips) : "—"} label="Trips" />
        <Stat big={stats ? `${stats.co2SavedKg}kg` : "—"} label="CO₂ saved" />
        <Stat big={stats ? `${stats.memberYears}y` : "—"} label="Member" />
      </div>
      <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 16, overflow: "hidden" }}>
        {menu.map((it, i, a) => (
          <button key={it.label} onClick={() => it.view && setView(it.view)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 13, padding: "15px 16px", border: "none", borderBottom: i < a.length - 1 ? "1px solid #f1ece2" : "none", fontSize: 14, fontWeight: 600, background: "none", cursor: "pointer", textAlign: "left" }}>
            <span style={{ width: 26, textAlign: "center" }}>{it.icon}</span>{it.label}
            <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
              {it.badge ? <span style={{ background: "#ff6a1a", color: "#fff", fontSize: 10, fontWeight: 800, borderRadius: 20, padding: "1px 7px" }}>{it.badge}</span> : null}
              <span style={{ color: "#cbc3b6" }}>›</span>
            </span>
          </button>
        ))}
      </div>
      <button onClick={() => { signOut(); router.push("/"); }} style={{ width: "100%", marginTop: 16, background: "#fff", border: "1px solid #f0d4cc", borderRadius: 14, padding: 15, fontSize: 14, fontWeight: 700, color: "#c2553f", cursor: "pointer" }}>Sign out</button>
    </div>
  );
}

function NotificationsView({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<NotificationList | null>(null);
  const [page, setPage] = useState(1);
  const load = useCallback(() => { api.notifications(page).then(setData).catch(() => undefined); }, [page]);
  useEffect(() => { load(); }, [load]);

  const readAll = async () => { await api.markAllNotificationsRead(); load(); };
  const readOne = async (id: string) => { await api.markNotificationRead(id); load(); };

  return (
    <div style={{ padding: "14px 22px 28px" }} className="rel-up">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <ScreenHeader onBack={onBack} title="Notifications" />
        {data && data.unread > 0 && <button onClick={readAll} style={{ background: "none", border: "none", color: "#ff6a1a", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Mark all read</button>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {data && data.items.length === 0 && <div style={{ fontSize: 13, color: "#8c8378", fontWeight: 600 }}>No notifications yet.</div>}
        {data?.items.map((n) => (
          <button key={n.id} onClick={() => !n.read && readOne(n.id)} style={{ textAlign: "left", display: "flex", gap: 12, background: n.read ? "#fff" : "#fff6f0", border: `1px solid ${n.read ? "#e9e3d8" : "#ffd9c2"}`, borderRadius: 14, padding: 14, cursor: "pointer" }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: "#fff0e6", color: "#ff6a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flex: "none" }}>◔</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{n.title}</span>
                {!n.read && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ff6a1a" }} />}
              </div>
              <div style={{ fontSize: 12.5, color: "#6b6258", lineHeight: 1.4, marginTop: 2 }}>{n.body}</div>
            </div>
            <div style={{ fontSize: 11.5, color: "#a39a8d", fontFamily: MONO, flex: "none" }}>{fmtDate(n.time)}</div>
          </button>
        ))}
      </div>
      {data && <Pagination page={page} totalPages={data.totalPages} total={data.total} onPage={setPage} />}
    </div>
  );
}

function SavedPlacesView({ onBack }: { onBack: () => void }) {
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const load = useCallback(() => { api.savedPlaces().then(setPlaces).catch(() => undefined); }, []);
  useEffect(() => { load(); }, [load]);

  const remove = async (id: string) => { await api.deleteSavedPlace(id); load(); };

  return (
    <div style={{ padding: "14px 22px 28px" }} className="rel-up">
      {showAdd && (
        <FormModal
          title="Add a place"
          submitLabel="Save place"
          schema={savedPlaceSchema}
          fields={[
            { name: "label", label: "Name", placeholder: "Gym" },
            { name: "area", label: "Area / address", placeholder: "Kacyiru" },
          ]}
          onSubmit={async (v) => { const d = v as SavedPlaceInput; await api.addSavedPlace({ label: d.label, area: d.area, icon: "◎" }); load(); }}
          onClose={() => setShowAdd(false)}
        />
      )}
      <ScreenHeader onBack={onBack} title="Saved places" />
      <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 16, overflow: "hidden", marginBottom: 14 }}>
        {places.length === 0 && <div style={{ padding: 16, fontSize: 13, color: "#8c8378", fontWeight: 600 }}>No saved places yet.</div>}
        {places.map((p, i) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 13, padding: 16, borderBottom: i < places.length - 1 ? "1px solid #f1ece2" : "none" }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: "#f4f1ea", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>{p.icon}</div>
            <div style={{ flex: 1 }}><div style={{ fontSize: 14.5, fontWeight: 700 }}>{p.label}</div><div style={{ fontSize: 12, color: "#8c8378" }}>{p.area}</div></div>
            <button onClick={() => remove(p.id)} style={{ background: "none", border: "none", color: "#c2553f", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Remove</button>
          </div>
        ))}
      </div>
      <button onClick={() => setShowAdd(true)} style={{ width: "100%", background: "#fff", border: "1px dashed #cbc3b6", borderRadius: 14, padding: 14, fontSize: 13.5, fontWeight: 700, color: "#8c8378", cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>+ Add a place</button>
    </div>
  );
}

function Stat({ big, label }: { big: string; label: string }) {
  return (
    <div style={{ flex: 1, background: "#fff", border: "1px solid #e9e3d8", borderRadius: 14, padding: 14, textAlign: "center" }}>
      <div style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 700 }}>{big}</div>
      <div style={{ fontSize: 11.5, color: "#8c8378", fontWeight: 600 }}>{label}</div>
    </div>
  );
}

/* ============ shared bits ============ */
function PassengerSidebar({ tab, walletBalance, onChange }: { tab: Tab; walletBalance: number | null; onChange: (t: Tab) => void }) {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const items: { key: Tab; icon: string; label: string }[] = [
    { key: "plan", icon: "◎", label: "Plan a trip" },
    { key: "trips", icon: "≡", label: "Your trips" },
    { key: "wallet", icon: "◈", label: "Wallet" },
    { key: "you", icon: "☻", label: "Profile" },
  ];
  return (
    <aside className="pax-side">
      <button onClick={() => router.push("/")} style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px 20px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }} className="pax-brand">
        <div style={{ width: 32, height: 32, borderRadius: 10, background: "#2a2520", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff6a1a" }} />
        </div>
        <div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 18, color: "#fff", letterSpacing: "-.4px" }}>Relay</div>
          <div style={{ fontSize: 10, color: "#9a9186", letterSpacing: ".08em", textTransform: "uppercase" }}>Transit</div>
        </div>
      </button>

      {walletBalance !== null && (
        <div className="pax-only-desktop" style={{ background: "#2a2520", borderRadius: 14, padding: "13px 15px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "#9a9186", fontWeight: 600 }}>Relay Wallet</div>
          <div style={{ fontFamily: MONO, fontSize: 19, fontWeight: 700, color: "#fff", marginTop: 3 }}>{formatRWF(walletBalance)}</div>
          <button onClick={() => onChange("wallet")} style={{ marginTop: 10, width: "100%", background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 10, padding: "9px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>Top up</button>
        </div>
      )}

      <nav className="pax-nav">
        {items.map((n) => {
          const active = tab === n.key;
          return (
            <button
              key={n.key}
              onClick={() => onChange(n.key)}
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
                background: active ? "#2a2520" : "transparent",
                color: active ? "#fff" : "#9a9186",
              }}
            >
              <span style={{ fontSize: 16, color: active ? "#ff6a1a" : "#9a9186" }}>{n.icon}</span>
              {n.label}
            </button>
          );
        })}
      </nav>

      <div className="pax-only-desktop" style={{ marginTop: "auto" }}>
        {user ? (
          <div style={{ background: "#2a2520", borderRadius: 12, padding: 12, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: "50%", background: "linear-gradient(135deg,#ff8a3d,#e0560c)", flex: "none" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>{user.fullName}</div>
              <div style={{ fontSize: 10.5, color: "#9a9186" }}>Passenger</div>
            </div>
            <button onClick={() => { signOut(); router.push("/"); }} title="Sign out" style={{ background: "none", border: "none", color: "#9a9186", cursor: "pointer", fontSize: 15 }}>⎋</button>
          </div>
        ) : (
          <button onClick={() => router.push("/auth?mode=login")} style={{ width: "100%", background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 12, padding: "12px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>Sign in</button>
        )}
      </div>
    </aside>
  );
}

function ScreenHeader({ onBack, title, sub }: { onBack: () => void; title: string; sub?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 13, margin: "6px 0 18px" }}>
      <BackBtn onClick={onBack} />
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 19, fontWeight: 700, letterSpacing: "-.4px" }}>{title}</div>
        {sub && <div style={{ fontSize: 12.5, color: "#8c8378", fontWeight: 600 }}>{sub}</div>}
      </div>
    </div>
  );
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} style={{ width: 36, height: 36, borderRadius: 11, border: "1px solid #e9e3d8", background: "#fff", cursor: "pointer", fontSize: 17, display: "flex", alignItems: "center", justifyContent: "center" }}>←</button>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 700, color: "#8c8378", letterSpacing: ".05em", textTransform: "uppercase", margin: "0 0 9px" }}>{children}</div>;
}

function PrimaryBtn({ children, onClick, busy }: { children: React.ReactNode; onClick: () => void; busy?: boolean }) {
  return (
    <button onClick={onClick} disabled={busy} style={{ width: "100%", background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 15, padding: 16, fontSize: 15, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1, boxShadow: "0 12px 26px -12px rgba(255,106,26,.7)" }}>
      {busy ? "Please wait…" : children}
    </button>
  );
}

function Chip({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return <span style={{ fontSize: 13, fontWeight: 700, background: active ? "#1b1714" : "#fff", color: active ? "#fff" : "#1b1714", border: active ? "none" : "1px solid #e3ddd1", borderRadius: 11, padding: "11px 15px" }}>{children}</span>;
}

function Row({ label, value, total, valueColor }: { label: string; value: string; total?: boolean; valueColor?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: total ? "13px 0" : "11px 0", borderBottom: total ? "none" : "1px solid #f1ece2", fontSize: total ? 15 : 13.5, fontWeight: total ? 800 : 400 }}>
      <span style={{ color: total ? "#1b1714" : "#8c8378" }}>{label}</span>
      <span style={{ fontFamily: MONO, fontWeight: total ? 800 : 600, color: valueColor ?? (total ? "#ff6a1a" : "#1b1714") }}>{value}</span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { c: string; b: string }> = {
    BOARDING: { c: "#ff6a1a", b: "#fff0e6" },
    RUNNING: { c: "#1f9d6b", b: "#e7f6ee" },
    SCHEDULED: { c: "#2f6bff", b: "#e9f0ff" },
  };
  const s = map[status] ?? map.SCHEDULED;
  return <span style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", color: s.c, background: s.b, borderRadius: 6, padding: "3px 8px" }}>{status.toLowerCase()}</span>;
}

function Step({ label, right, rightColor, done, pulse, muted }: { label: string; right?: string; rightColor?: string; done?: boolean; pulse?: boolean; muted?: boolean }) {
  const dotColor = done ? "#1f9d6b" : pulse ? "#ff6a1a" : "#e0dbd0";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "12px 0", borderBottom: muted ? "none" : "1px solid #f1ece2" }}>
      <div className={pulse ? "rel-pulse" : undefined} style={{ width: 10, height: 10, borderRadius: "50%", background: dotColor }} />
      <div style={{ flex: 1, fontSize: 13.5, fontWeight: muted ? 600 : 700, color: muted ? "#a39a8d" : "#1b1714" }}>{label}</div>
      {right && <div style={{ fontSize: 12, color: rightColor ?? "#8c8378", fontFamily: MONO, fontWeight: rightColor ? 700 : 400 }}>{right}</div>}
    </div>
  );
}

function Bar({ dim }: { dim?: boolean }) {
  return <span style={{ width: 24, height: 5, borderRadius: 3, background: dim ? "#e9e3d8" : "#ff6a1a" }} />;
}

function TrackMap({ progress, banner }: { progress: number; banner: string }) {
  // Everything is drawn inside the SVG viewBox so markers stay aligned with the
  // route path at any rendered size (no absolutely-positioned px dots).
  const t = Math.min(1, Math.max(0, progress / 100));
  const x = 48 + (235 - 48) * t;
  const y = 40 + (270 - 40) * t;
  return (
    <div style={{ position: "relative", minHeight: 440, height: "100%", background: "#e9efe8", overflow: "hidden", borderRadius: 20, border: "1px solid #d8e0d6" }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(27,23,20,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(27,23,20,.05) 1px,transparent 1px)", backgroundSize: "30px 30px" }} />
      <svg viewBox="0 0 280 300" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <path d="M48 40 C 120 70, 90 150, 175 175 S 230 250, 235 270" fill="none" stroke="#ff6a1a" strokeWidth="5" strokeLinecap="round" strokeDasharray="2 11" />
        {/* origin */}
        <circle cx="48" cy="40" r="8" fill="#1b1714" stroke="#fff" strokeWidth="3" />
        {/* destination */}
        <rect x="227" y="262" width="16" height="16" rx="4" fill="#ff6a1a" stroke="#fff" strokeWidth="3" />
        {/* moving vehicle */}
        <g transform={`translate(${x},${y})`}>
          <circle r="15" fill="#1b1714" opacity="0.14" />
          <circle r="11" fill="#1b1714" />
          <circle r="11" fill="none" stroke="#fff" strokeWidth="3" />
        </g>
      </svg>
      <div style={{ position: "absolute", left: 16, top: 16, background: "rgba(255,255,255,.92)", borderRadius: 11, padding: "8px 13px", display: "flex", alignItems: "center", gap: 9, boxShadow: "0 4px 14px -6px rgba(0,0,0,.25)" }}>
        <div className="rel-pulse" style={{ width: 8, height: 8, borderRadius: "50%", background: "#1f9d6b" }} />
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>{banner}</span>
      </div>
    </div>
  );
}

/* ============ utils ============ */
function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}
