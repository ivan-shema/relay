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
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { formatRWF, topUpSchema, savedPlaceSchema, operatorOnboardingSchema, updateProfileSchema, changePasswordSchema, type TopUpInput, type SavedPlaceInput, type UpdateProfileInput, type ChangePasswordInput, type TransportMode } from "@relay/shared";
import { api, ApiError, type SavedPlace, type WalletData, type MeStats, type Insights, type PlannedWatch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Pagination, FormModal } from "@/components/console";
import { NotificationBell } from "@/components/notification-bell";

const DISPLAY = "'Space Grotesk', sans-serif";
const MONO = "'JetBrains Mono', monospace";

type PlanScreen = "home" | "search" | "available" | "planAhead" | "pay" | "track" | "done";
type Tab = "plan" | "trips" | "orders" | "wallet" | "you";

// Operator application status for the current passenger: undefined = still
// loading, null = never applied, object = has an application on file.
type OperatorStatus = { status: string; companyName: string } | null | undefined;

const PAY_METHODS: { method: PaymentMethod; name: string; sub: string; glyph: string; gbg: string; gink: string }[] = [
  { method: "MOBILE_MONEY", name: "MTN MoMo", sub: "•••• 4821", glyph: "M", gbg: "#ffd400", gink: "#1b1714" },
  { method: "WALLET", name: "Relay Wallet", sub: "balance", glyph: "◈", gbg: "#1b1714", gink: "#ff6a1a" },
  { method: "QR", name: "QR Code", sub: "scan to pay", glyph: "▦", gbg: "#e9f0ff", gink: "#2f6bff" },
];

export default function PassengerApp() {
  const router = useRouter();
  const { user, loading, refreshUser } = useAuth();

  useEffect(() => {
    if (!loading && !user) router.replace("/browse");
  }, [user, loading, router]);

  const [tab, setTab] = useState<Tab>("plan");
  const [screen, setScreen] = useState<PlanScreen>("home");
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [operatorStatus, setOperatorStatus] = useState<OperatorStatus>(undefined);

  const loadOperatorStatus = useCallback(() => {
    api.operatorApplication().then(setOperatorStatus).catch(() => setOperatorStatus(null));
  }, []);

  useEffect(() => {
    if (user) loadOperatorStatus();
  }, [user, loadOperatorStatus]);

  const [origin, setOrigin] = useState("Kabeza");
  const [dest, setDest] = useState("Central Market");

  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [tripsLoading, setTripsLoading] = useState(false);
  const [selected, setSelected] = useState<TripSummary | null>(null);
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("MOBILE_MONEY");
  const [trackPhase, setTrackPhase] = useState<"approaching" | "boarded">("approaching");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // First page of the passenger's own bookings — shared by the Home banner,
  // the Trips boarding pass / recent history, and Orders' initial view.
  // Orders paginates further on its own; this covers the common case.
  const [primaryBookings, setPrimaryBookings] = useState<BookingDetail[]>([]);
  const [insights, setInsights] = useState<Insights | null>(null);

  const loadPrimaryBookings = useCallback(() => {
    api.bookings(1).then((p) => setPrimaryBookings(p.items)).catch(() => undefined);
  }, []);
  const loadInsights = useCallback(() => {
    api.insights().then(setInsights).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (user) {
      loadPrimaryBookings();
      loadInsights();
    }
  }, [user, loadPrimaryBookings, loadInsights]);

  const activeBooking = primaryBookings.find((b) => b.status === "CONFIRMED") ?? null;
  const recentHistory = primaryBookings.filter((b) => b.status === "COMPLETED").slice(0, 3);

  // Jump into the existing pay/track screens for an already-created booking —
  // used by Orders ("Pay now" / "View ticket") and the Home active-trip banner,
  // as opposed to startBooking() which creates a brand new one.
  const payExistingBooking = useCallback((b: BookingDetail) => {
    setSelected(b.trip);
    setBooking(b);
    setPayMethod("MOBILE_MONEY");
    setTab("plan");
    setScreen("pay");
  }, []);
  const trackExistingBooking = useCallback((b: BookingDetail) => {
    setSelected(b.trip);
    setBooking(b);
    setTrackPhase("approaching");
    setTab("plan");
    setScreen("track");
  }, []);
  const requireAuth = useCallback(() => {
    if (!user) {
      router.push("/auth?mode=login");
      return false;
    }
    return true;
  }, [user, router]);

  // Accepts explicit origin/dest so callers (e.g. rebooking a past route) can
  // search immediately without waiting on a state update to land first.
  const loadTrips = useCallback(async (o?: string, d?: string) => {
    setError(null);
    setTripsLoading(true);
    try {
      setTrips(await api.trips(o ?? origin, d ?? dest));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load trips");
    } finally {
      setTripsLoading(false);
    }
  }, [origin, dest]);

  const goAvailable = useCallback(async () => {
    setScreen("available");
    await loadTrips();
  }, [loadTrips]);

  const rebookRoute = useCallback(
    (originLabel: string, destLabel: string) => {
      setOrigin(originLabel);
      setDest(destLabel);
      setTab("plan");
      setScreen("available");
      loadTrips(originLabel, destLabel);
    },
    [loadTrips]
  );

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
      loadPrimaryBookings();
      setTrackPhase("approaching");
      setScreen("track");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  }, [booking, payMethod, refreshUser, loadPrimaryBookings]);

  const submitRating = useCallback(
    async (score: number, bookingId?: string, comment?: string) => {
      const id = bookingId ?? booking?.id;
      if (!id) return;
      try {
        await api.rate({ bookingId: id, score, comment });
        loadPrimaryBookings();
        loadInsights();
      } catch {
        /* ignore — already completed is fine */
      }
    },
    [booking, loadPrimaryBookings, loadInsights]
  );

  const resetToHome = () => {
    setScreen("home");
    setSelected(null);
    setBooking(null);
    setTab("plan");
  };

  if (loading || !user) return null;

  // Operator onboarding takes over the whole screen — its own full page.
  if (onboardOpen) {
    return (
      <OperatorOnboarding
        onClose={(applied) => {
          setOnboardOpen(false);
          if (applied) loadOperatorStatus();
        }}
      />
    );
  }

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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: 18 }}>
          <NotificationBell />
        </div>
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
              operatorStatus={operatorStatus}
              onApplyOperator={() => setOnboardOpen(true)}
              onSearch={() => setScreen("search")}
              onSeeTrips={goAvailable}
              onPlanAhead={() => setScreen("planAhead")}
              onBook={startBooking}
              activeBooking={activeBooking}
              onTrackActive={trackExistingBooking}
              insights={insights}
              onPickRoute={(o, d) => { setOrigin(o); setDest(d); goAvailable(); }}
              onRate={submitRating}
            />
          </div>
        )}
        {tab === "plan" && screen === "search" && (
          <div className="rel-narrow">
            <SearchScreen origin={origin} dest={dest} setOrigin={setOrigin} setDest={setDest} onBack={() => setScreen("home")} onDone={goAvailable} />
          </div>
        )}
        {tab === "plan" && screen === "available" && (
          <AvailableScreen origin={origin} dest={dest} trips={trips} loadingTrips={tripsLoading} busy={busy} onBack={() => setScreen("home")} onBook={startBooking} />
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
        {tab === "plan" && screen === "done" && selected && booking && (
          <div className="rel-narrow">
            <DoneScreen trip={selected} bookingId={booking.id} onRated={() => { loadPrimaryBookings(); loadInsights(); }} onNewTrip={resetToHome} />
          </div>
        )}

        {tab === "trips" && (
          <TripsTab
            activeBooking={activeBooking}
            recentHistory={recentHistory}
            onTrack={trackExistingBooking}
            onBook={startBooking}
          />
        )}
        {tab === "orders" && (
          <OrdersTab
            onPay={payExistingBooking}
            onTrack={trackExistingBooking}
            onRebook={rebookRoute}
          />
        )}
        {tab === "wallet" && <div className="rel-mid"><WalletTab insights={insights} /></div>}
        {tab === "you" && <div className="rel-mid"><YouTab operatorStatus={operatorStatus} onApplyOperator={() => setOnboardOpen(true)} /></div>}
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
  operatorStatus,
  onApplyOperator,
  onSearch,
  onSeeTrips,
  onPlanAhead,
  onBook,
  activeBooking,
  onTrackActive,
  insights,
  onPickRoute,
  onRate,
}: {
  origin: string;
  dest: string;
  walletBalance: number | null;
  busy: boolean;
  operatorStatus: OperatorStatus;
  onApplyOperator: () => void;
  onSearch: () => void;
  onSeeTrips: () => void;
  onPlanAhead: () => void;
  onBook: (t: TripSummary) => void;
  activeBooking: BookingDetail | null;
  onTrackActive: (b: BookingDetail) => void;
  insights: Insights | null;
  onPickRoute: (origin: string, dest: string) => void;
  onRate: (score: number, bookingId?: string) => void;
}) {
  const { user } = useAuth();
  const [planned, setPlanned] = useState<PlannedWatch[]>([]);
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [live, setLive] = useState<TripSummary[]>([]);
  const [liveLoading, setLiveLoading] = useState(true);
  const [rating, setRating] = useState(0);

  const reloadPlanned = useCallback(() => {
    api.planned().then(setPlanned).catch(() => undefined);
  }, []);

  useEffect(() => {
    setLiveLoading(true);
    api.trips(origin, dest).then(setLive).catch(() => undefined).finally(() => setLiveLoading(false));
    if (user) {
      reloadPlanned();
      api.savedPlaces().then(setPlaces).catch(() => undefined);
    }
  }, [user, origin, dest, reloadPlanned]);

  const firstName = user ? user.firstName : "there";

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

      {activeBooking && <ActiveTripBanner booking={activeBooking} onTrack={() => onTrackActive(activeBooking)} />}

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

          {insights && insights.frequentRoutes.length > 0 && (
            <>
              <div style={{ margin: "20px 0 10px", fontSize: 12, fontWeight: 700, color: "#8c8378", letterSpacing: ".05em", textTransform: "uppercase" }}>Frequent routes</div>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${insights.frequentRoutes.length},1fr)`, gap: 11 }}>
                {insights.frequentRoutes.map((r) => {
                  const [from, to] = r.route.split(" → ");
                  return (
                    <button key={r.route} onClick={() => onPickRoute(from ?? r.route, to ?? r.route)} style={{ textAlign: "left", background: "#fff", border: "1px solid #e9e3d8", borderRadius: 14, padding: "12px 13px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, fontFamily: "'Manrope', sans-serif" }}>
                      <span style={{ width: 30, height: 30, borderRadius: 9, background: r.bg, color: r.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, fontFamily: MONO, flex: "none" }}>{r.code}</span>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.route}</span>
                        <span style={{ display: "block", fontSize: 10.5, color: "#8c8378", fontWeight: 600 }}>{r.tripCount} {r.tripCount === 1 ? "trip" : "trips"}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

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
              <WatchCard key={p.id} w={p} onBook={onBook} onRemoved={reloadPlanned} />
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

          {insights?.pendingRating && (
            <div style={{ display: "flex", alignItems: "center", gap: 14, background: "#fff", border: "1px solid #e9e3d8", borderRadius: 16, padding: "15px 16px", marginTop: 18 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: "#fff0e6", color: "#ff6a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, flex: "none" }}>★</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>Rate your last ride</div>
                <div style={{ fontSize: 11.5, color: "#8c8378", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{insights.pendingRating.route}</div>
              </div>
              <div style={{ display: "flex", gap: 3, flex: "none" }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <span
                    key={n}
                    onClick={() => { setRating(n); onRate(n, insights.pendingRating!.bookingId); }}
                    style={{ cursor: "pointer", fontSize: 19, lineHeight: 1, color: n <= rating ? "#ff6a1a" : "#e0dbd0" }}
                  >★</span>
                ))}
              </div>
            </div>
          )}

          <OperatorHomeCard status={operatorStatus} onApply={onApplyOperator} />
        </div>

        {/* RIGHT — live-trips rail */}
        <aside style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 24, overflow: "hidden", boxShadow: "0 24px 60px -34px rgba(27,23,20,.4)", position: "sticky", top: 30 }}>
          <div style={{ position: "relative", height: 168, background: "#e9efe8" }}>
            <HomeMapArt />
            <div style={{ position: "absolute", left: 14, top: 14, background: "rgba(255,255,255,.94)", borderRadius: 11, padding: "7px 12px", display: "flex", alignItems: "center", gap: 8, boxShadow: "0 4px 14px -6px rgba(0,0,0,.25)" }}>
              <span className="rel-pulse" style={{ width: 8, height: 8, borderRadius: "50%", background: "#1f9d6b" }} />
              <span style={{ fontSize: 12, fontWeight: 700 }}>{liveLoading ? "Loading…" : `${live.length} live near you`}</span>
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
              {liveLoading && [0, 1, 2].map((i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 11, background: "#fff", border: "1px solid #e9e3d8", borderRadius: 15, padding: "12px 13px" }}>
                  <div className="rel-skel" style={{ width: 22, height: 22, borderRadius: 6 }} />
                  <div style={{ flex: 1 }}>
                    <div className="rel-skel" style={{ width: "70%", height: 12, borderRadius: 5, marginBottom: 6 }} />
                    <div className="rel-skel" style={{ width: "45%", height: 10, borderRadius: 5 }} />
                  </div>
                  <div className="rel-skel" style={{ width: 44, height: 12, borderRadius: 5 }} />
                </div>
              ))}
              {!liveLoading && live.length === 0 && <div style={{ fontSize: 12.5, color: "#8c8378", fontWeight: 600, padding: "6px 0" }}>No live trips on this route right now.</div>}
              {!liveLoading && live.slice(0, 4).map((t) => (
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

// Live-tracking preview for the passenger's current confirmed trip, shown at
// the top of Home. Polls the same tracking snapshot TrackScreen uses.
function ActiveTripBanner({ booking, onTrack }: { booking: BookingDetail; onTrack: () => void }) {
  const [snap, setSnap] = useState<TrackingSnapshot | null>(null);

  useEffect(() => {
    let active = true;
    const poll = () => api.tracking(booking.id).then((s) => active && setSnap(s)).catch(() => undefined);
    poll();
    const timer = setInterval(poll, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [booking.id]);

  const trip = booking.trip;
  const eta = snap?.etaMinutes ?? 4;
  const progress = snap?.progressPct ?? 10;

  return (
    <div style={{ position: "relative", overflow: "hidden", background: "#1b1714", borderRadius: 22, padding: 6, marginBottom: 20, display: "flex", gap: 6, flexWrap: "wrap" }} className="rel-up">
      <div style={{ position: "relative", flex: 1, minWidth: 260, padding: "18px 18px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="rel-pulse" style={{ width: 8, height: 8, borderRadius: "50%", background: "#1f9d6b" }} />
          <span style={{ fontSize: 11, fontWeight: 800, color: "#8fe3bd", textTransform: "uppercase", letterSpacing: ".06em" }}>On the way · tracking live</span>
        </div>
        <div style={{ fontFamily: DISPLAY, fontSize: 21, fontWeight: 700, color: "#fff", marginTop: 11, letterSpacing: "-.3px" }}>{trip.origin} → {trip.destination}</div>
        <div style={{ fontSize: 12.5, color: "#9a9186", fontWeight: 600, marginTop: 4 }}>{trip.operatorName}</div>

        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, fontWeight: 700, color: "#9a9186", marginBottom: 6 }}>
            <span>{trip.origin}</span>
            <span style={{ color: "#fff" }}>ETA {eta} min</span>
            <span>{trip.destination}</span>
          </div>
          <div style={{ height: 6, borderRadius: 4, background: "#2a2520", overflow: "hidden" }}>
            <div style={{ width: `${Math.max(4, progress)}%`, height: "100%", borderRadius: 4, background: "linear-gradient(90deg,#ff8a3d,#ff6a1a)" }} />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 11, marginTop: 16 }}>
          <div style={{ width: 38, height: 38, borderRadius: "50%", background: "#2a2520", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#fff", flex: "none" }}>
            {(snap?.driver?.name ?? "Driver").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{snap?.driver?.name ?? "Your driver"}</div>
            <div style={{ fontSize: 11.5, color: "#9a9186", fontWeight: 600 }}>Seat {snap?.seatNumber ?? "—"} · {snap?.driver?.plate ?? trip.operatorName}</div>
          </div>
          <button style={{ background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.14)", color: "#fff", borderRadius: 10, padding: "9px 13px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>Call</button>
          <button onClick={onTrack} style={{ background: "#ff6a1a", border: "none", color: "#fff", borderRadius: 10, padding: "9px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>Track</button>
        </div>
      </div>

      <div style={{ position: "relative", flex: 1, minWidth: 220, minHeight: 200, borderRadius: 18, overflow: "hidden", background: "#e9efe8" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(27,23,20,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(27,23,20,.05) 1px,transparent 1px)", backgroundSize: "26px 26px" }} />
        <svg viewBox="0 0 280 220" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          <path d="M40 30 C 120 60, 80 130, 175 140 S 235 190, 245 205" fill="none" stroke="#ff6a1a" strokeWidth="5" strokeLinecap="round" strokeDasharray="2 11" />
          <circle cx="40" cy="30" r="8" fill="#1b1714" stroke="#fff" strokeWidth="3" />
          <rect x="237" y="197" width="16" height="16" rx="4" fill="#ff6a1a" stroke="#fff" strokeWidth="3" />
        </svg>
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

/* ============ AVAILABLE ============ */
function AvailableScreen({ origin, dest, trips, loadingTrips, busy, onBack, onBook }: { origin: string; dest: string; trips: TripSummary[]; loadingTrips: boolean; busy: boolean; onBack: () => void; onBook: (t: TripSummary) => void }) {
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
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: loadingTrips ? "#f4f1ea" : "#eef5ff", border: `1px solid ${loadingTrips ? "#e9e3d8" : "#d8e6ff"}`, borderRadius: 30, padding: "8px 14px" }}>
            <span className="rel-pulse" style={{ width: 7, height: 7, borderRadius: "50%", background: loadingTrips ? "#a39a8d" : "#2f6bff" }} />
            <span style={{ fontSize: 12, color: loadingTrips ? "#8c8378" : "#2f6bff", fontWeight: 700 }}>
              {loadingTrips ? "Searching…" : `Live · ${trips.length} ${trips.length === 1 ? "trip" : "trips"}`}
            </span>
          </div>
        </div>
      </div>
      <div className="rel-trip-grid">
        {loadingTrips && [0, 1, 2].map((i) => <TripCardSkeleton key={i} />)}
        {!loadingTrips && trips.length === 0 && <div style={{ fontSize: 13, color: "#8c8378", fontWeight: 600, padding: "8px 0" }}>No live trips on this route right now.</div>}
        {!loadingTrips && trips.map((t) => (
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
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState<"Today" | "Tomorrow">("Tomorrow");
  const [time, setTime] = useState("08:00");
  const [repeat, setRepeat] = useState(false);

  const save = async () => {
    if (!requireAuth()) return;
    setBusy(true);
    setError(null);
    try {
      const whenLabel = `${day} ${time}${repeat ? " · weekdays" : ""}`;
      await api.createPlanned({ originLabel: origin, destLabel: dest, whenLabel, notify });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save your watch — please try again");
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
      <div style={{ display: "flex", gap: 9, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        {(["Today", "Tomorrow"] as const).map((d) => (
          <button key={d} onClick={() => setDay(d)} style={{ fontSize: 13, fontWeight: 700, background: day === d ? "#1b1714" : "#fff", color: day === d ? "#fff" : "#1b1714", border: day === d ? "1px solid #1b1714" : "1px solid #e3ddd1", borderRadius: 11, padding: "11px 15px", cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>{d}</button>
        ))}
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          style={{ fontSize: 13, fontWeight: 700, background: "#fff", border: "1px solid #e3ddd1", borderRadius: 11, padding: "9px 13px", fontFamily: "'JetBrains Mono', monospace", outline: "none", color: "#1b1714" }}
        />
        <button onClick={() => setRepeat((r) => !r)} style={{ fontSize: 13, fontWeight: 700, background: repeat ? "#fff6f0" : "#fff", color: repeat ? "#ff6a1a" : "#1b1714", border: repeat ? "1px solid #ff6a1a" : "1px solid #e3ddd1", borderRadius: 11, padding: "11px 15px", cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>
          {repeat ? "✓ " : ""}Repeat weekdays
        </button>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", border: "1px solid #e9e3d8", borderRadius: 14, padding: "14px 16px", marginBottom: 20 }}>
        <div><div style={{ fontSize: 14, fontWeight: 700 }}>Notify me of matches</div><div style={{ fontSize: 12, color: "#8c8378" }}>Push + in-app alert</div></div>
        <button onClick={() => setNotify((n) => !n)} style={{ width: 42, height: 24, borderRadius: 20, background: notify ? "#ff6a1a" : "#cbc3b6", position: "relative", border: "none", cursor: "pointer" }}>
          <div style={{ position: "absolute", top: 3, left: notify ? 21 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
        </button>
      </div>
      {error && <div style={{ background: "#fbeae6", border: "1px solid #f0d4cc", color: "#c2553f", borderRadius: 12, padding: "11px 14px", fontSize: 13, fontWeight: 600, marginBottom: 14 }}>{error}</div>}
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

  // Boarding is confirmed by the driver/operator scanning the ticket, not by
  // the passenger — flip to the "on board" view as soon as that's reflected
  // in the live snapshot, instead of a self-reported button.
  useEffect(() => {
    if (phase === "approaching" && snap?.anyBoarded) onBoard();
  }, [phase, snap?.anyBoarded, onBoard]);

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
              <div style={{ marginTop: 15, background: "#faf8f4", border: "1px dashed #d8d1c4", borderRadius: 12, padding: "11px 13px", fontSize: 12.5, color: "#6b6258", fontWeight: 600, textAlign: "center" }}>
                Show your ticket to the driver or conductor to board — this updates automatically once they confirm.
              </div>
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
const REVIEW_TAGS = ["Clean ride", "On time", "Safe driver"];

function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function DoneScreen({ trip, bookingId, onRated, onNewTrip }: { trip: TripSummary; bookingId: string; onRated: () => void; onNewTrip: () => void }) {
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [review, setReview] = useState("");
  const [phase, setPhase] = useState<"form" | "submitted">("form");
  const [editableUntil, setEditableUntil] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (phase !== "submitted" || !editableUntil) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase, editableUntil]);

  const toggleTag = (t: string) => setTags((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]));

  const msLeft = editableUntil ? editableUntil.getTime() - now : 0;
  const canEdit = phase === "submitted" && msLeft > 0;

  const submit = async () => {
    if (stars === 0) return;
    setBusy(true);
    setError(null);
    const comment = [tags.join(", "), review.trim()].filter(Boolean).join(" — ") || undefined;
    try {
      const r = editableUntil ? await api.updateRating(bookingId, { score: stars, comment }) : await api.rate({ bookingId, score: stars, comment });
      setEditableUntil(new Date(r.editableUntil));
      setPhase("submitted");
      onRated();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save your review");
    } finally {
      setBusy(false);
    }
  };

  const startEdit = () => setPhase("form");

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
            <button key={s} disabled={phase === "submitted"} onClick={() => setStars(s)} style={{ background: "none", border: "none", cursor: phase === "submitted" ? "default" : "pointer", fontSize: 32, lineHeight: 1, color: s <= stars ? "#ff6a1a" : "#e0dbd0", padding: 0 }}>★</button>
          ))}
        </div>

        {phase === "submitted" ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#1f9d6b", fontWeight: 700, fontSize: 13.5, padding: "6px 0" }}>
              <span style={{ width: 22, height: 22, borderRadius: "50%", background: "#e7f6ee", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>✓</span>
              Thanks for your feedback!
            </div>
            {canEdit && (
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "#8c8378", fontWeight: 600 }}>Spot a typo? You can edit for {fmtCountdown(msLeft)}</span>
                <button onClick={startEdit} style={{ background: "none", border: "none", color: "#ff6a1a", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>Edit review</button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: 14 }}>
              {REVIEW_TAGS.map((t) => {
                const active = tags.includes(t);
                return (
                  <button key={t} onClick={() => toggleTag(t)} style={{ fontSize: 12, fontWeight: 700, border: `1px solid ${active ? "#ff6a1a" : "#e9e3d8"}`, background: active ? "#fff6f0" : "#fff", color: active ? "#ff6a1a" : "#1b1714", borderRadius: 9, padding: "7px 12px", cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>{t}</button>
                );
              })}
            </div>
            <textarea
              value={review}
              onChange={(e) => setReview(e.target.value)}
              placeholder="Add a written review (optional)"
              rows={3}
              style={{ width: "100%", border: "1px solid #e9e3d8", borderRadius: 12, padding: "11px 13px", fontSize: 13, fontFamily: "'Manrope', sans-serif", resize: "vertical", marginBottom: 10, outline: "none" }}
            />
            {editableUntil && <div style={{ fontSize: 11.5, color: "#8c8378", fontWeight: 600, marginBottom: 10 }}>Editing — {fmtCountdown(msLeft)} left to save changes</div>}
            {error && <div style={{ fontSize: 12, color: "#c2553f", fontWeight: 600, marginBottom: 10 }}>{error}</div>}
            <button
              onClick={submit}
              disabled={stars === 0 || busy}
              style={{ width: "100%", background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 15, padding: 16, fontSize: 15, fontWeight: 700, cursor: stars === 0 || busy ? "default" : "pointer", opacity: stars === 0 || busy ? 0.5 : 1, boxShadow: "0 12px 26px -12px rgba(255,106,26,.7)", fontFamily: "'Manrope', sans-serif" }}
            >
              {busy ? "Saving…" : editableUntil ? "Save changes" : "Submit review"}
            </button>
          </>
        )}
      </div>
      <div style={{ marginTop: 12 }}>
        <PrimaryBtn onClick={onNewTrip}>Done · plan another trip</PrimaryBtn>
      </div>
    </div>
  );
}

/* ============ TRIPS TAB ============ */
// Downloads a simple text receipt built from real booking data — no PDF
// service in this stack, so a plain-text receipt is the honest "real" option.
async function downloadReceipt(b: BookingDetail) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: [320, 480] });
  const ink: [number, number, number] = [27, 23, 20];
  const dim: [number, number, number] = [140, 131, 120];
  const accent: [number, number, number] = [255, 106, 26];
  const pageW = 320;
  const marginX = 26;

  // header band
  doc.setFillColor(...ink);
  doc.rect(0, 0, pageW, 84, "F");
  doc.setFillColor(...accent);
  doc.circle(pageW - 40, 30, 5, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Relay", marginX, 38);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(200, 195, 188);
  doc.text("Ride receipt", marginX, 54);
  doc.setFontSize(8);
  doc.text(b.id, marginX, 68);

  let y = 112;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...ink);
  doc.text(`${b.trip.origin}  ->  ${b.trip.destination}`, marginX, y);

  y += 20;
  doc.setDrawColor(230, 224, 213);
  doc.line(marginX, y, pageW - marginX, y);

  const rows: [string, string][] = [
    ["Operator", b.trip.operatorName],
    ["Date", new Date(b.createdAt).toLocaleString()],
    ["Seats", String(b.seats)],
    ["Status", b.status],
  ];
  y += 24;
  doc.setFontSize(10);
  for (const [label, value] of rows) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...dim);
    doc.text(label, marginX, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...ink);
    doc.text(value, pageW - marginX, y, { align: "right" });
    y += 22;
  }

  y += 6;
  doc.setDrawColor(230, 224, 213);
  doc.line(marginX, y, pageW - marginX, y);

  y += 28;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...dim);
  doc.text("Total paid", marginX, y);
  doc.setFontSize(18);
  doc.setTextColor(...accent);
  doc.text(formatRWF(b.fare), pageW - marginX, y, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...dim);
  doc.text("Thanks for riding with Relay.", marginX, 456);

  doc.save(`relay-receipt-${b.id}.pdf`);
}

const ORDER_STATUS: Record<string, { c: string; b: string; label: string }> = {
  CONFIRMED: { c: "#1f9d6b", b: "#e7f6ee", label: "Confirmed" },
  COMPLETED: { c: "#6b6258", b: "#f1ece2", label: "Completed" },
  PENDING: { c: "#ff6a1a", b: "#fff0e6", label: "Awaiting payment" },
  IN_PROGRESS: { c: "#2f6bff", b: "#e9f0ff", label: "In progress" },
  CANCELLED: { c: "#c2553f", b: "#fbeae6", label: "Cancelled" },
};

/* ============ ORDERS TAB ============ */
function OrdersTab({
  onPay,
  onTrack,
  onRebook,
}: {
  onPay: (b: BookingDetail) => void;
  onTrack: (b: BookingDetail) => void;
  onRebook: (origin: string, dest: string) => void;
}) {
  const { user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.bookings>> | null>(null);
  const [page, setPage] = useState(1);
  const [ticketBooking, setTicketBooking] = useState<BookingDetail | null>(null);
  useEffect(() => {
    if (!user) { router.push("/auth?mode=login"); return; }
    api.bookings(page).then(setData).catch(() => undefined);
  }, [user, router, page]);

  const bookings = data?.items ?? [];
  const stats = [
    { big: String(data?.total ?? bookings.length), label: "Total orders" },
    { big: String(bookings.filter((b) => b.status === "CONFIRMED").length), label: "Active" },
    { big: formatRWF(bookings.reduce((sum, b) => sum + (b.status !== "CANCELLED" ? b.fare : 0), 0)), label: "This page" },
  ];

  return (
    <div className="rel-mid rel-up">
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13.5, color: "#8c8378", fontWeight: 600 }}>Orders</div>
        <div style={{ fontFamily: DISPLAY, fontSize: 32, fontWeight: 700, letterSpacing: "-.8px", lineHeight: 1.05 }}>Bookings &amp; receipts</div>
      </div>

      <div style={{ display: "flex", background: "#fff", border: "1px solid #e9e3d8", borderRadius: 18, marginBottom: 18 }}>
        {stats.map((s, i) => (
          <div key={s.label} style={{ flex: 1, padding: "16px 18px", borderLeft: i > 0 ? "1px solid #f0ebe1" : "none" }}>
            <div style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 700, letterSpacing: "-.4px" }}>{s.big}</div>
            <div style={{ fontSize: 11.5, color: "#8c8378", fontWeight: 600, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {data && bookings.length === 0 && <div style={{ fontSize: 13, color: "#8c8378", fontWeight: 600 }}>No orders yet — book your first ride from the Plan tab.</div>}
        {bookings.map((b) => {
          const s = ORDER_STATUS[b.status] ?? ORDER_STATUS.PENDING;
          const leg = b.trip.legs[0];
          const action =
            b.status === "PENDING" ? { label: "Pay now", onClick: () => onPay(b) } :
            b.status === "CONFIRMED" ? { label: "View ticket", onClick: () => setTicketBooking(b) } :
            b.status === "COMPLETED" ? { label: "Get receipt", onClick: () => downloadReceipt(b) } :
            { label: "Rebook", onClick: () => onRebook(b.trip.origin, b.trip.destination) };
          return (
            <div key={b.id} style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 16, padding: "16px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                <span style={{ width: 30, height: 30, borderRadius: 9, background: leg?.color ?? "#8c8378", color: "#fff", fontSize: 13, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, flex: "none" }}>{leg?.code ?? "?"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.trip.origin} → {b.trip.destination}</div>
                  <div style={{ fontFamily: MONO, fontSize: 11, color: "#a39a8d", fontWeight: 600, marginTop: 2 }}>{b.id}</div>
                </div>
                <span style={{ fontSize: 10.5, fontWeight: 800, color: s.c, background: s.b, borderRadius: 20, padding: "4px 10px", whiteSpace: "nowrap" }}>{s.label}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, paddingTop: 14, borderTop: "1px solid #f0ebe1", flexWrap: "wrap", gap: 10 }}>
                <div style={{ display: "flex", gap: 20 }}>
                  <div>
                    <div style={{ fontSize: 10.5, color: "#a39a8d", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em" }}>When</div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 2 }}>{fmtDate(b.createdAt)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, color: "#a39a8d", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em" }}>Seats</div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 2 }}>{b.seats}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, color: "#a39a8d", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em" }}>Total</div>
                    <div style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 700, marginTop: 2, color: "#ff6a1a" }}>{formatRWF(b.fare)}</div>
                  </div>
                </div>
                <button onClick={action.onClick} style={{ background: "#f4f1ea", border: "1px solid #e9e3d8", borderRadius: 11, padding: "9px 16px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif", whiteSpace: "nowrap" }}>{action.label}</button>
              </div>
            </div>
          );
        })}
      </div>
      {data && <Pagination page={page} totalPages={data.totalPages} total={data.total} onPage={setPage} />}

      {ticketBooking && (
        <div
          onClick={() => setTicketBooking(null)}
          style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(27,23,20,.55)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
        >
          <div onClick={(e) => e.stopPropagation()} className="rel-up" style={{ width: "100%", maxWidth: 460, maxHeight: "88vh", overflowY: "auto", position: "relative" }}>
            <button
              onClick={() => setTicketBooking(null)}
              aria-label="Close"
              style={{ position: "absolute", top: -14, right: -14, width: 34, height: 34, borderRadius: "50%", background: "#fff", border: "1px solid #e9e3d8", color: "#1b1714", fontSize: 17, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 10px 24px -10px rgba(27,23,20,.5)", zIndex: 1 }}
            >×</button>
            <BoardingTicket
              booking={ticketBooking}
              onTrack={() => { onTrack(ticketBooking); setTicketBooking(null); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// A "Plan ahead" watch. While unmatched it just shows what Relay is watching
// for; once an operator publishes a matching departure it flips to a bookable
// "match found" state with the real fare/time. Removable either way.
function WatchCard({ w, onBook, onRemoved }: { w: PlannedWatch; onBook: (t: TripSummary) => void; onRemoved: () => void }) {
  const [removing, setRemoving] = useState(false);
  const matched = w.matchedTrip;

  const remove = async () => {
    setRemoving(true);
    try {
      await api.deletePlanned(w.id);
      onRemoved();
    } catch {
      setRemoving(false);
    }
  };

  return (
    <div style={{ background: "#fff", border: `1px solid ${matched ? "#bfe6d2" : "#e9e3d8"}`, borderRadius: 16, padding: 15 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".05em", color: matched ? "#1f9d6b" : "#8c8378", background: matched ? "#e7f6ee" : "#f4f1ea", borderRadius: 20, padding: "4px 9px" }}>
          {matched ? "MATCH FOUND" : "WATCHING"}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: "#8c8378", fontWeight: 700 }}>{w.when}</span>
          <button onClick={remove} disabled={removing} title="Remove this watch" style={{ background: "none", border: "none", color: "#c2553f", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif", padding: 0 }}>
            {removing ? "…" : "Remove"}
          </button>
        </div>
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 700, marginTop: 10 }}>{w.from} → {w.to}</div>
      <div style={{ fontSize: 12, color: "#8c8378", fontWeight: 600, marginTop: 3 }}>
        {matched
          ? `${matched.operatorName} · departs ${fmtTime(matched.departAt)} · ${matched.seatsLeft} seat${matched.seatsLeft === 1 ? "" : "s"} left`
          : "No trip scheduled yet — we'll notify you"}
      </div>
      {matched && (
        <button
          onClick={() => onBook(matched)}
          style={{ width: "100%", marginTop: 13, border: "none", borderRadius: 11, padding: 11, fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "'Manrope', sans-serif", background: "#ff6a1a", color: "#fff", boxShadow: "0 12px 24px -14px rgba(255,106,26,.8)" }}
        >
          Book now — {formatRWF(matched.fare)}
        </button>
      )}
    </div>
  );
}

/* ============ TRIPS TAB ============ */
function TripsTab({
  activeBooking,
  recentHistory,
  onTrack,
  onBook,
}: {
  activeBooking: BookingDetail | null;
  recentHistory: BookingDetail[];
  onTrack: (b: BookingDetail) => void;
  onBook: (t: TripSummary) => void;
}) {
  const [planned, setPlanned] = useState<PlannedWatch[]>([]);
  const reloadPlanned = useCallback(() => { api.planned().then(setPlanned).catch(() => undefined); }, []);
  useEffect(() => { reloadPlanned(); }, [reloadPlanned]);

  return (
    <div className="rel-mid rel-up">
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 13.5, color: "#8c8378", fontWeight: 600 }}>Your trips</div>
        <div style={{ fontFamily: DISPLAY, fontSize: 32, fontWeight: 700, letterSpacing: "-.8px", lineHeight: 1.05 }}>Ready to ride</div>
      </div>

      {activeBooking ? (
        <>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: "#a39a8d", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 11 }}>Board now</div>
          <BoardingTicket booking={activeBooking} onTrack={() => onTrack(activeBooking)} />
        </>
      ) : (
        <div style={{ background: "#fff", border: "1px dashed #d8d1c4", borderRadius: 18, padding: 22, textAlign: "center", marginBottom: 22 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>No trip to board right now</div>
          <div style={{ fontSize: 12.5, color: "#8c8378", fontWeight: 600, marginTop: 3 }}>Book a seat from the Plan tab and your ticket will show up here.</div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "26px 0 11px" }}>
        <span style={{ fontSize: 11.5, fontWeight: 800, color: "#a39a8d", textTransform: "uppercase", letterSpacing: ".06em" }}>Planned · watching</span>
        {planned.length > 0 && <span style={{ fontSize: 11.5, color: "#ff6a1a", fontWeight: 700 }}>{planned.length} active</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {planned.length === 0 && (
          <div style={{ background: "#fff", border: "1px dashed #d8d1c4", borderRadius: 16, padding: 16, fontSize: 12.5, color: "#8c8378", fontWeight: 600 }}>
            No watches yet — use "Plan ahead" on the Plan tab to get notified when a matching trip is scheduled.
          </div>
        )}
        {planned.map((p) => (
          <WatchCard key={p.id} w={p} onBook={onBook} onRemoved={reloadPlanned} />
        ))}
      </div>

      <div style={{ margin: "30px 0 12px", fontSize: 11.5, fontWeight: 800, color: "#a39a8d", textTransform: "uppercase", letterSpacing: ".06em" }}>Recent</div>
      <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 18, overflow: "hidden" }}>
        {recentHistory.length === 0 && <div style={{ padding: 16, fontSize: 13, color: "#8c8378", fontWeight: 600 }}>No completed trips yet.</div>}
        {recentHistory.map((h, i) => {
          const leg = h.trip.legs[0];
          return (
            <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 13, padding: "14px 16px", borderTop: i > 0 ? "1px solid #f0ebe1" : "none" }}>
              <span style={{ width: 26, height: 26, borderRadius: 8, background: leg?.color ?? "#8c8378", color: "#fff", fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, flex: "none" }}>{leg?.code ?? "?"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{h.trip.origin} → {h.trip.destination}</div>
                <div style={{ fontSize: 11.5, color: "#8c8378", fontWeight: 600 }}>{fmtDate(h.createdAt)}</div>
              </div>
              <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700 }}>{formatRWF(h.fare)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Boarding-pass style ticket for the active confirmed booking — QR + perforation.
// One independently-boardable ticket per purchased seat — a 3-seat booking
// renders 3 cards, each with its own QR (encoding that ticket's own id, not
// the booking id) and its own "confirm boarding" state, so scanning/confirming
// one seat never marks the whole party as boarded.
function BoardingTicket({ booking, onTrack }: { booking: BookingDetail; onTrack: () => void }) {
  const trip = booking.trip;
  const leg = trip.legs[0];
  const tickets = booking.tickets;
  const boardedCount = tickets.filter((t) => t.boarded).length;

  return (
    <div>
      <div style={{ position: "relative", background: "#1b1714", borderRadius: 24, overflow: "hidden", boxShadow: "0 26px 60px -34px rgba(27,23,20,.7)", marginBottom: 14 }}>
        <div style={{ position: "absolute", right: -90, top: -90, width: 260, height: 260, borderRadius: "50%", background: "radial-gradient(circle,rgba(255,106,26,.22),transparent 68%)" }} />
        <div style={{ position: "relative", zIndex: 1, padding: "22px 24px 18px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ width: 24, height: 24, borderRadius: 7, background: leg?.color ?? "#8c8378", color: "#fff", fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO }}>{leg?.code ?? "?"}</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: "#ff9c58", textTransform: "uppercase", letterSpacing: ".08em" }}>{trip.status === "BOARDING" ? "Boarding" : "Confirmed"}</span>
            </div>
            <div style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 700, color: "#fff", marginTop: 12, letterSpacing: "-.3px" }}>{trip.origin} → {trip.destination}</div>
            <div style={{ fontSize: 12.5, color: "#9a9186", fontWeight: 600, marginTop: 3 }}>{trip.operatorName}</div>
          </div>
        </div>

        <div style={{ position: "relative", zIndex: 1, display: "flex", padding: "0 24px 20px" }}>
          {[
            { label: "Seats", value: tickets.length > 0 ? `${boardedCount}/${tickets.length} boarded` : `${booking.seats}` },
            { label: "Departs", value: fmtTime(trip.departAt) },
            { label: "Fare paid", value: formatRWF(booking.fare) },
          ].map((m, i) => (
            <div key={m.label} style={{ flex: 1, borderLeft: i > 0 ? "1px solid rgba(255,255,255,.1)" : "none", paddingLeft: i > 0 ? 16 : 0 }}>
              <div style={{ fontSize: 10.5, color: "#9a9186", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" }}>{m.label}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginTop: 3, fontFamily: m.label === "Departs" ? "'JetBrains Mono',monospace" : "'Space Grotesk',sans-serif" }}>{m.value}</div>
            </div>
          ))}
        </div>
      </div>

      {tickets.length === 0 ? (
        <div style={{ background: "#fff", border: "1px dashed #d8d1c4", borderRadius: 16, padding: 16, fontSize: 12.5, color: "#8c8378", fontWeight: 600, textAlign: "center" }}>
          Tickets are generated once payment settles.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {tickets.map((t) => (
            <div key={t.id} style={{ position: "relative", background: "#fff", border: `1px solid ${t.boarded ? "#bfe6d2" : "#e9e3d8"}`, borderRadius: 18, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 18px" }}>
                <div style={{ flex: "none" }}><QRCodeSVG value={t.code} size={62} bgColor="#fff" fgColor="#1b1714" /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "#a39a8d", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".05em" }}>Seat</span>
                    <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700 }}>{t.seatNumber}</span>
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, letterSpacing: ".08em", marginTop: 4 }}>{t.code}</div>
                  <div style={{ fontSize: 11.5, color: "#8c8378", fontWeight: 600, marginTop: 4 }}>{t.boarded ? "Checked in — the driver confirmed this seat." : "Show this code (or QR) to the driver or conductor to board."}</div>
                </div>
                <span style={{ flex: "none", fontSize: 10.5, fontWeight: 800, color: t.boarded ? "#1f9d6b" : "#ff6a1a", background: t.boarded ? "#e7f6ee" : "#fff0e6", borderRadius: 20, padding: "5px 11px", whiteSpace: "nowrap" }}>
                  {t.boarded ? "✓ Boarded" : "Awaiting scan"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 11, marginTop: 13 }}>
        <button onClick={onTrack} style={{ flex: 1, background: "#fff", border: "1px solid #e3ddd1", borderRadius: 14, padding: 14, fontSize: 13.5, fontWeight: 700, cursor: "pointer", color: "#1b1714", fontFamily: "'Manrope', sans-serif" }}>Live tracking</button>
        <button onClick={() => downloadReceipt(booking)} style={{ flex: 1, background: "#fff", border: "1px solid #e3ddd1", borderRadius: 14, padding: 14, fontSize: 13.5, fontWeight: 700, cursor: "pointer", color: "#1b1714", fontFamily: "'Manrope', sans-serif" }}>Download receipt</button>
      </div>
    </div>
  );
}

/* ============ WALLET TAB ============ */
function WalletTab({ insights }: { insights?: Insights | null }) {
  const { refreshUser } = useAuth();
  const [data, setData] = useState<WalletData | null>(null);
  const [showTopup, setShowTopup] = useState(false);
  const [txFilter, setTxFilter] = useState<"all" | "pay" | "topup">("all");

  const load = useCallback(() => { api.wallet().then(setData).catch(() => undefined); }, []);
  useEffect(() => { load(); }, [load]);

  const toggleAutoTopup = async () => {
    if (!data) return;
    const next = !data.autoTopupEnabled;
    setData({ ...data, autoTopupEnabled: next });
    try {
      await api.setAutoTopup(next);
    } catch {
      setData((d) => (d ? { ...d, autoTopupEnabled: !next } : d));
    }
  };

  const txs = (data?.transactions ?? []).filter(
    (t) => txFilter === "all" || (txFilter === "pay" && t.kind === "DEBIT") || (txFilter === "topup" && t.kind === "CREDIT")
  );
  const spend = insights?.spendThisMonth;

  return (
    <div className="rel-mid rel-up">
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

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13.5, color: "#8c8378", fontWeight: 600 }}>Payments &amp; wallet</div>
        <div style={{ fontFamily: DISPLAY, fontSize: 32, fontWeight: 700, letterSpacing: "-.8px", lineHeight: 1.05 }}>Money &amp; transactions</div>
      </div>

      <div style={{ position: "relative", overflow: "hidden", background: "#1b1714", borderRadius: 24, padding: "26px 28px", marginBottom: 18 }}>
        <div style={{ position: "absolute", right: -90, top: -90, width: 280, height: 280, borderRadius: "50%", background: "radial-gradient(circle,rgba(255,106,26,.24),transparent 68%)" }} />
        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
            <div>
              <div style={{ fontSize: 12, color: "#9a9186", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" }}>Relay Wallet</div>
              <div style={{ fontFamily: MONO, fontSize: 34, fontWeight: 700, color: "#fff", marginTop: 6, letterSpacing: "-1px" }}>{data ? formatRWF(data.balance) : "…"}</div>
              <div style={{ fontSize: 12.5, color: "#9a9186", fontWeight: 600, marginTop: 4 }}>MTN MoMo •••• 4821 linked</div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowTopup(true)} style={{ background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 12, padding: "12px 20px", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "'Manrope', sans-serif", boxShadow: "0 14px 28px -14px rgba(255,106,26,.8)" }}>Top up</button>
              <button onClick={() => window.alert("Send money — coming soon")} style={{ background: "rgba(255,255,255,.08)", color: "#fff", border: "1px solid rgba(255,255,255,.14)", borderRadius: 12, padding: "12px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>Send</button>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 20, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,.1)" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Auto top-up</div>
              <div style={{ fontSize: 11.5, color: "#9a9186", fontWeight: 600 }}>Add RWF 5,000 when balance falls below RWF 2,000</div>
            </div>
            <button onClick={toggleAutoTopup} disabled={!data} style={{ width: 42, height: 24, borderRadius: 14, background: data?.autoTopupEnabled ? "#ff6a1a" : "#3a332c", position: "relative", flex: "none", border: "none", cursor: "pointer", transition: "background .15s" }}>
              <div style={{ position: "absolute", top: 3, left: data?.autoTopupEnabled ? 21 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
            </button>
          </div>
        </div>
      </div>

      <div className="rel-cardgrid-2" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 20, padding: "18px 20px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 10 }}>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: "#a39a8d", textTransform: "uppercase", letterSpacing: ".06em" }}>Transactions</span>
              <div style={{ display: "flex", gap: 6 }}>
                {([["all", "All"], ["pay", "Payments"], ["topup", "Top-ups"]] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setTxFilter(k)} style={{ fontSize: 11, fontWeight: txFilter === k ? 800 : 700, color: txFilter === k ? "#fff" : "#8c8378", background: txFilter === k ? "#1b1714" : "#f4f1ea", borderRadius: 20, padding: "5px 11px", cursor: "pointer", border: "none", fontFamily: "'Manrope', sans-serif" }}>{label}</button>
                ))}
              </div>
            </div>
            {data && txs.length === 0 && <div style={{ padding: "10px 4px", fontSize: 13, color: "#8c8378", fontWeight: 600 }}>No wallet activity yet.</div>}
            {txs.map((w, i) => {
              const credit = w.kind === "CREDIT";
              return (
                <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 13, padding: "14px 4px", borderTop: i > 0 ? "1px solid #f0ebe1" : "none" }}>
                  <span style={{ width: 36, height: 36, borderRadius: 10, background: credit ? "#e7f6ee" : "#f7ece8", color: credit ? "#1f9d6b" : "#c2553f", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800, flex: "none" }}>{credit ? "↓" : "↑"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.label}</div>
                    <div style={{ fontSize: 11, color: "#8c8378", fontWeight: 600, marginTop: 2 }}>{fmtDateTime(w.date)}</div>
                  </div>
                  <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: credit ? "#1f9d6b" : "#1b1714", flex: "none" }}>{credit ? "+" : "−"}{formatRWF(w.amount)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 20, padding: 20 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: "#a39a8d", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 15 }}>Payment methods</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <PayMethodRow glyph="M" bg="#ffd400" ink="#1b1714" name="MTN MoMo" sub="•••• 4821" badge="Default" />
              <PayMethodRow glyph="◈" bg="#1b1714" ink="#ff6a1a" name="Relay Wallet" sub={data ? formatRWF(data.balance) : "—"} />
            </div>
          </div>

          {spend && spend.byMode.length > 0 && (
            <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 20, padding: 20 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: "#a39a8d", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>Spent this month</div>
              <div style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 700, letterSpacing: "-.6px", marginBottom: 16 }}>{formatRWF(spend.total)}</div>
              <div style={{ display: "flex", height: 10, borderRadius: 6, overflow: "hidden", marginBottom: 16 }}>
                {spend.byMode.map((m) => (
                  <div key={m.label} style={{ width: `${m.pct}%`, height: "100%", background: m.color }} />
                ))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                {spend.byMode.map((m) => (
                  <div key={m.label} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: m.color, flex: "none" }} />
                    <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700 }}>{m.label}</span>
                    <span style={{ fontSize: 11.5, color: "#8c8378", fontWeight: 700 }}>{m.pct}%</span>
                    <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, width: 78, textAlign: "right" }}>{formatRWF(m.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
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
type YouView = "menu" | "saved" | "wallet";

const PROFILE_MENU: { label: string; sub: string; icon: string; color: string; bg: string; view?: YouView; action?: "password" }[] = [
  { label: "Saved places", sub: "Home, work & favourites", icon: "⌂", color: "#2f6bff", bg: "#e9f0ff", view: "saved" },
  { label: "Payment & wallet", sub: "Top up & payment methods", icon: "◈", color: "#1f9d6b", bg: "#e7f6ee", view: "wallet" },
  { label: "Security", sub: "Change your password", icon: "⚙", color: "#7c5cff", bg: "#efeaff", action: "password" },
];

function YouTab({ operatorStatus, onApplyOperator }: { operatorStatus: OperatorStatus; onApplyOperator: () => void }) {
  const { user, signOut, refreshUser } = useAuth();
  const router = useRouter();
  const [view, setView] = useState<YouView>("menu");
  const [stats, setStats] = useState<MeStats | null>(null);
  const [editProfile, setEditProfile] = useState(false);
  const [changePass, setChangePass] = useState(false);

  useEffect(() => {
    api.meStats().then(setStats).catch(() => undefined);
  }, []);

  if (view === "saved") return <SavedPlacesView onBack={() => setView("menu")} />;
  if (view === "wallet") return <div className="rel-up"><ScreenHeader onBack={() => setView("menu")} title="Payment & wallet" /><WalletTab /></div>;

  const initials = user ? `${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}`.toUpperCase() : "?";

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "0 4px 28px" }} className="rel-up">
      <div style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 700, letterSpacing: "-.7px", marginBottom: 18 }}>Profile</div>

      <div className="pax-profile-grid">
        {/* LEFT — summary rail */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ position: "relative", overflow: "hidden", background: "#1b1714", borderRadius: 18, padding: "24px 20px", textAlign: "center" }}>
            <div style={{ position: "absolute", right: -70, top: -70, width: 200, height: 200, borderRadius: "50%", background: "radial-gradient(circle,rgba(255,106,26,.24),transparent 68%)" }} />
            <div style={{ position: "relative", zIndex: 1 }}>
              <div style={{ width: 76, height: 76, borderRadius: "50%", background: "linear-gradient(135deg,#ff8a3d,#e0560c)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: DISPLAY, fontSize: 28, fontWeight: 700, color: "#fff", margin: "0 auto 14px", boxShadow: "0 0 0 4px rgba(255,255,255,.08),0 12px 26px -12px rgba(224,86,12,.8)" }}>{initials}</div>
              <div style={{ fontFamily: DISPLAY, fontSize: 19, fontWeight: 700, letterSpacing: "-.3px", color: "#fff" }}>{user ? `${user.firstName} ${user.lastName}` : "Guest"}</div>
              <div style={{ fontSize: 12.5, color: "#9a9186", fontWeight: 600, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.email ?? "Not signed in"}</div>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(255,106,26,.16)", borderRadius: 20, padding: "5px 12px", marginTop: 12 }}>
                <span style={{ color: "#ff6a1a", fontSize: 12 }}>★</span>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: "#ff9c58" }}>{stats?.rating.toFixed(1) ?? "4.8"} rider</span>
              </span>
            </div>
          </div>

          {stats && (
            <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 16, padding: "16px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: "linear-gradient(135deg,#ff8a3d,#e0560c)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, color: "#fff", flex: "none" }}>◆</div>
                <div>
                  <div style={{ fontSize: 10.5, color: "#a39a8d", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".05em" }}>Relay tier</div>
                  <div style={{ fontFamily: DISPLAY, fontSize: 16, fontWeight: 700, letterSpacing: "-.2px" }}>{stats.tier} rider</div>
                </div>
              </div>
              <div style={{ marginTop: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
                  <span style={{ color: "#8c8378" }}>{stats.points.toLocaleString()} pts</span>
                  {stats.nextTier ? (
                    <span style={{ color: "#8c8378" }}>{stats.tripsToNextTier} trip{stats.tripsToNextTier === 1 ? "" : "s"} to <span style={{ color: "#1b1714" }}>{stats.nextTier}</span></span>
                  ) : (
                    <span style={{ color: "#1f9d6b" }}>Top tier</span>
                  )}
                </div>
                <div style={{ height: 8, borderRadius: 5, background: "#f0ebe1", overflow: "hidden" }}>
                  <div style={{ width: `${stats.tierProgressPct}%`, height: "100%", borderRadius: 5, background: "linear-gradient(90deg,#ff8a3d,#ff6a1a)" }} />
                </div>
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <ActivityStat big={stats ? String(stats.trips) : "—"} label="Trips" />
            <ActivityStat big={stats ? `${stats.co2SavedKg}kg` : "—"} label="CO₂ saved" />
            <ActivityStat big={stats ? `${stats.memberYears}y` : "—"} label="Member" />
          </div>
        </div>

        {/* RIGHT — account + preferences */}
        <div>
          {editProfile && user && (
            <FormModal
              title="Edit profile"
              submitLabel="Save changes"
              schema={updateProfileSchema}
              defaultValues={{ firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone }}
              fields={[
                { name: "firstName", label: "First name" },
                { name: "lastName", label: "Last name" },
                { name: "email", label: "Email" },
                { name: "phone", label: "Phone" },
              ]}
              onSubmit={async (v) => { await api.updateProfile(v as UpdateProfileInput); await refreshUser(); }}
              onClose={() => setEditProfile(false)}
            />
          )}
          {changePass && (
            <FormModal
              title="Change password"
              submitLabel="Change password"
              schema={changePasswordSchema}
              fields={[
                { name: "currentPassword", label: "Current password", type: "password" },
                { name: "newPassword", label: "New password", type: "password" },
                { name: "confirmPassword", label: "Confirm new password", type: "password" },
              ]}
              onSubmit={async (v) => { await api.changePassword(v as ChangePasswordInput); }}
              onClose={() => setChangePass(false)}
            />
          )}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 2px 10px" }}>
            <SectionHeading first>Account information</SectionHeading>
            <button onClick={() => setEditProfile(true)} style={{ background: "none", border: "none", color: "#ff6a1a", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif", padding: 0 }}>Edit</button>
          </div>
          <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 16, overflow: "hidden" }}>
            <InfoField label="Full name" value={user ? `${user.firstName} ${user.lastName}` : "—"} />
            <InfoField label="Email" value={user?.email ?? "—"} />
            <InfoField label="Phone" value={user?.phone ?? "—"} mono />
            <InfoField label="Member since" value={stats ? `${stats.memberYears} year${stats.memberYears === 1 ? "" : "s"}` : "—"} last />
          </div>

          <SectionHeading>Preferences</SectionHeading>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {PROFILE_MENU.map((it) => (
              <button key={it.label} onClick={() => { if (it.view) setView(it.view); else if (it.action === "password") setChangePass(true); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", background: "#fff", border: "1px solid #e9e3d8", borderRadius: 16, cursor: "pointer", textAlign: "left" }}>
                <span style={{ width: 40, height: 40, borderRadius: 12, background: it.bg, color: it.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flex: "none" }}>{it.icon}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 14.5, fontWeight: 700 }}>{it.label}</span>
                  <span style={{ display: "block", fontSize: 12, color: "#8c8378", fontWeight: 600, marginTop: 1 }}>{it.sub}</span>
                </span>
                <span style={{ color: "#cbc3b6", fontSize: 18, flex: "none" }}>›</span>
              </button>
            ))}
          </div>

          <OperatorProfileRow status={operatorStatus} onApply={onApplyOperator} />
        </div>
      </div>

      {/* mobile keeps a sign-out here since the sidebar footer is desktop-only */}
      <button className="pax-mobile-only" onClick={() => { signOut(); router.push("/"); }} style={{ width: "100%", marginTop: 16, background: "#fff", border: "1px solid #f0d4cc", borderRadius: 14, padding: 15, fontSize: 14, fontWeight: 700, color: "#c2553f", cursor: "pointer" }}>Sign out</button>
    </div>
  );
}

function SectionHeading({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return <div style={{ fontSize: 11.5, fontWeight: 800, color: "#a39a8d", textTransform: "uppercase", letterSpacing: ".06em", margin: first ? "0 0 10px 2px" : "22px 0 10px 2px" }}>{children}</div>;
}

function InfoField({ label, value, mono, last }: { label: string; value: string; mono?: boolean; last?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "14px 16px", borderBottom: last ? "none" : "1px solid #f1ece2" }}>
      <span style={{ fontSize: 13, color: "#8c8378", fontWeight: 600, flex: "none" }}>{label}</span>
      <span style={{ fontSize: 13.5, fontWeight: 700, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: mono ? MONO : undefined }}>{value}</span>
    </div>
  );
}

function ActivityStat({ big, label }: { big: string; label: string }) {
  return (
    <div style={{ flex: 1, background: "#fff", border: "1px solid #e9e3d8", borderRadius: 14, padding: "15px 12px", textAlign: "center" }}>
      <div style={{ fontFamily: DISPLAY, fontSize: 21, fontWeight: 700, letterSpacing: "-.3px" }}>{big}</div>
      <div style={{ fontSize: 11.5, color: "#8c8378", fontWeight: 600, marginTop: 3 }}>{label}</div>
    </div>
  );
}

/* ============ OPERATOR ONBOARDING ============ */

// Shared status text for the two operator entry points (Home card + Profile row).
// Returns null while the status is still loading so nothing flashes in.
function operatorCtaCopy(status: OperatorStatus): { title: string; body: string; actionable: boolean } | null {
  if (status === undefined) return null;
  if (!status) return { title: "Run a transport business?", body: "Put your fleet on Relay and reach every rider on your route.", actionable: true };
  if (status.status === "PENDING") return { title: "Operator application under review", body: "Our team is verifying your documents. We'll let you know once you're approved.", actionable: false };
  if (status.status === "SUSPENDED") return { title: "Application not approved", body: "Your operator application wasn't approved. Contact support if you think this is a mistake.", actionable: false };
  return null; // VERIFIED — the account is already an operator, handled elsewhere
}

function OperatorHomeCard({ status, onApply }: { status: OperatorStatus; onApply: () => void }) {
  const copy = operatorCtaCopy(status);
  if (!copy) return null;
  return (
    <div style={{ background: "#1b1714", borderRadius: 20, padding: 20, marginTop: 26, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", right: -70, top: -70, width: 200, height: 200, borderRadius: "50%", background: "radial-gradient(circle,rgba(255,106,26,.22),transparent 68%)" }} />
      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: "#ff6a1a", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>For operators</div>
        <div style={{ fontFamily: DISPLAY, fontSize: 18, fontWeight: 700, color: "#fff", letterSpacing: "-.3px", marginBottom: 6 }}>{copy.title}</div>
        <p style={{ fontSize: 13, lineHeight: 1.55, color: "#cfc7bb", margin: "0 0 14px" }}>{copy.body}</p>
        {copy.actionable ? (
          <button onClick={onApply} style={{ background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 12, padding: "11px 18px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>Become an operator →</button>
        ) : (
          <span style={{ display: "inline-block", background: "rgba(255,106,26,.16)", color: "#ff6a1a", borderRadius: 9, padding: "8px 13px", fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".04em" }}>
            {status && status.status === "PENDING" ? "Pending review" : "Not approved"}
          </span>
        )}
      </div>
    </div>
  );
}

function OperatorProfileRow({ status, onApply }: { status: OperatorStatus; onApply: () => void }) {
  const copy = operatorCtaCopy(status);
  if (!copy) return null;
  return (
    <button
      onClick={copy.actionable ? onApply : undefined}
      style={{ width: "100%", marginTop: 16, display: "flex", alignItems: "center", gap: 13, padding: "15px 16px", background: "#fff", border: "1px solid #e9e3d8", borderRadius: 16, fontSize: 14, fontWeight: 600, cursor: copy.actionable ? "pointer" : "default", textAlign: "left" }}
    >
      <span style={{ width: 32, height: 32, borderRadius: 9, background: "#fff0e6", color: "#ff6a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flex: "none" }}>▤</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontWeight: 700 }}>{copy.actionable ? "Become an operator" : copy.title}</span>
        <span style={{ display: "block", fontSize: 12, color: "#8c8378", fontWeight: 600, marginTop: 2 }}>{copy.actionable ? "Apply to run your fleet on Relay" : copy.body}</span>
      </span>
      {copy.actionable
        ? <span style={{ color: "#cbc3b6", flex: "none" }}>›</span>
        : <span style={{ fontSize: 10.5, fontWeight: 800, color: "#ff6a1a", background: "#fff0e6", borderRadius: 7, padding: "4px 8px", textTransform: "uppercase", flex: "none" }}>{status && status.status === "PENDING" ? "Review" : "—"}</span>}
    </button>
  );
}

const ONBOARD_MODES: { value: TransportMode; label: string }[] = [
  { value: "BUS", label: "Buses" },
  { value: "MOTO", label: "Moto-taxis" },
  { value: "RIDE", label: "Shared rides" },
];

// Full-page operator onboarding for a signed-in passenger: company details + KYC
// documents (with live previews). Creates a PENDING application; the account
// stays a passenger until an admin approves.
function OperatorOnboarding({ onClose }: { onClose: (applied: boolean) => void }) {
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting }, setError } = useForm<z.infer<typeof operatorOnboardingSchema>>({
    resolver: zodResolver(operatorOnboardingSchema),
    defaultValues: { companyName: "", contactInfo: "", idNumber: "", modes: [] },
  });
  const modes = watch("modes") ?? [];
  const [idDocument, setIdDocument] = useState<File | null>(null);
  const [businessCertificate, setBusinessCertificate] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const toggleMode = (m: TransportMode) => {
    const next = modes.includes(m) ? modes.filter((x) => x !== m) : [...modes, m];
    setValue("modes", next, { shouldValidate: true });
  };

  const submit = handleSubmit(async (v) => {
    if (!idDocument || !businessCertificate) {
      setFileError("Upload your ID document and RDB business certificate (PDF or image, no GIFs).");
      return;
    }
    setFileError(null);
    try {
      const fd = new FormData();
      fd.append("companyName", v.companyName);
      fd.append("contactInfo", v.contactInfo);
      fd.append("idNumber", v.idNumber);
      for (const m of v.modes) fd.append("modes", m);
      fd.append("idDocument", idDocument);
      fd.append("businessCertificate", businessCertificate);
      await api.applyOperator(fd);
      setSubmitted(true);
    } catch (e) {
      setError("root", { message: e instanceof ApiError ? e.message : "Could not submit application" });
    }
  });

  return (
    <div style={{ minHeight: "100vh", background: "#f4f1ea", backgroundImage: "radial-gradient(circle at 1px 1px,rgba(27,23,20,.04) 1px,transparent 0)", backgroundSize: "22px 22px" }}>
      {/* top bar */}
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: "rgba(244,241,234,.82)", backdropFilter: "blur(12px)", borderBottom: "1px solid #e9e3d8" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <button onClick={() => onClose(submitted)} style={{ display: "flex", alignItems: "center", gap: 9, background: "#fff", border: "1px solid #e3ddd1", borderRadius: 11, padding: "9px 15px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>← Back to app</button>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#8c8378" }}>Operator onboarding</div>
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "28px 24px 60px" }} className="rel-up">
        {submitted ? (
          <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 22, padding: 40, textAlign: "center" }}>
            <div style={{ width: 60, height: 60, borderRadius: 16, background: "#e7f6ee", color: "#1f9d6b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 18px" }}>✓</div>
            <div style={{ fontFamily: DISPLAY, fontSize: 24, fontWeight: 700, letterSpacing: "-.5px", marginBottom: 10 }}>Application submitted</div>
            <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "#6b6258", margin: "0 auto 22px", maxWidth: 420 }}>
              Thanks! Our team will verify your ID and business certificate. You&apos;ll keep using Relay as a passenger, and we&apos;ll unlock your operator console as soon as you&apos;re approved.
            </p>
            <button onClick={() => onClose(true)} style={{ background: "#1b1714", color: "#fff", border: "none", borderRadius: 13, padding: "14px 26px", fontSize: 14.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>Back to app</button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <div style={{ fontFamily: DISPLAY, fontSize: 28, fontWeight: 700, letterSpacing: "-.7px" }}>Become an operator</div>
            <p style={{ fontSize: 14, color: "#8c8378", fontWeight: 600, margin: "6px 0 24px" }}>Tell us about your business — our team reviews every application before your console unlocks.</p>

            {errors.root?.message && (
              <div style={{ background: "#fff0e6", border: "1px solid #ffd9c2", color: "#c2553f", borderRadius: 12, padding: "11px 14px", fontSize: 13, fontWeight: 600, marginBottom: 16 }}>{errors.root.message}</div>
            )}

            <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 18, padding: 22, marginBottom: 16 }}>
              <OnboardLabel>Company name</OnboardLabel>
              <OnboardInput reg={register("companyName")} error={errors.companyName?.message} placeholder="Kigali Bus Co." />
              <div style={{ height: 14 }} />
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <OnboardLabel>Company contact</OnboardLabel>
                  <OnboardInput reg={register("contactInfo")} error={errors.contactInfo?.message} placeholder="+250 78 000 0042" mono />
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <OnboardLabel>ID / passport number</OnboardLabel>
                  <OnboardInput reg={register("idNumber")} error={errors.idNumber?.message} placeholder="1199…" mono />
                </div>
              </div>
              <div style={{ height: 14 }} />
              <OnboardLabel>Modes you operate</OnboardLabel>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {ONBOARD_MODES.map((m) => {
                  const active = modes.includes(m.value);
                  return (
                    <button key={m.value} type="button" onClick={() => toggleMode(m.value)} style={{ flex: 1, minWidth: 100, padding: "11px 6px", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif", border: active ? "1px solid #ff6a1a" : "1px solid #e3ddd1", background: active ? "#fff6f0" : "#fff", color: active ? "#ff6a1a" : "#6b6258" }}>{m.label}</button>
                  );
                })}
              </div>
              {errors.modes && <div style={{ fontSize: 12, color: "#c2553f", fontWeight: 600, marginTop: 8 }}>{errors.modes.message as string}</div>}
            </div>

            <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 18, padding: 22, marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#8c8378", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 4 }}>Verification documents</div>
              <p style={{ fontSize: 12.5, color: "#a39a8d", fontWeight: 600, margin: "0 0 16px" }}>PDF, JPG, PNG or WebP · max 5 MB per file</p>
              <FilePreview label="ID / passport document" file={idDocument} onPick={setIdDocument} />
              <div style={{ height: 14 }} />
              <FilePreview label="RDB business certificate" file={businessCertificate} onPick={setBusinessCertificate} />
              {fileError && <div style={{ fontSize: 12, color: "#c2553f", fontWeight: 600, marginTop: 12 }}>{fileError}</div>}
            </div>

            <button type="submit" disabled={isSubmitting} style={{ width: "100%", background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 14, padding: 15, fontSize: 15, fontWeight: 700, cursor: isSubmitting ? "default" : "pointer", opacity: isSubmitting ? 0.7 : 1, boxShadow: "0 12px 26px -10px rgba(255,106,26,.7)", fontFamily: "'Manrope', sans-serif" }}>
              {isSubmitting ? "Submitting…" : "Submit application"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function OnboardLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11.5, fontWeight: 700, color: "#8c8378", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 7 }}>{children}</div>;
}

function OnboardInput({ reg, error, placeholder, mono }: { reg: UseFormRegisterReturn; error?: string; placeholder?: string; mono?: boolean }) {
  return (
    <div>
      <input {...reg} placeholder={placeholder} style={{ width: "100%", border: `1px solid ${error ? "#e0a99a" : "#e3ddd1"}`, borderRadius: 13, padding: "13px 15px", fontSize: 14, fontWeight: 600, color: "#1b1714", outline: "none", background: "#fff", fontFamily: mono ? MONO : "'Manrope', sans-serif" }} />
      {error && <div style={{ fontSize: 12, color: "#c2553f", fontWeight: 600, marginTop: 6 }}>{error}</div>}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Upload input WITH a live preview: image thumbnail for images, a document card
// for PDFs. Manages the object-URL lifecycle so previews don't leak.
function FilePreview({ label, file, onPick }: { label: string; file: File | null; onPick: (f: File | null) => void }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) { setUrl(null); return; }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const accept = ".pdf,.jpg,.jpeg,.png,.webp";

  if (!file) {
    return (
      <label style={{ display: "flex", alignItems: "center", gap: 12, border: "1px dashed #cbc3b6", borderRadius: 14, padding: "14px 16px", cursor: "pointer", background: "#faf8f4" }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, background: "#fff0e6", color: "#ff6a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flex: "none" }}>⇧</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: "#1b1714" }}>{label}</span>
          <span style={{ display: "block", fontSize: 12, color: "#8c8378", fontWeight: 600 }}>Tap to upload — PDF or image</span>
        </span>
        <input type="file" accept={accept} style={{ display: "none" }} onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      </label>
    );
  }

  const isImage = file.type.startsWith("image/");

  return (
    <div style={{ border: "1px solid #e9e3d8", borderRadius: 14, overflow: "hidden", background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 13, padding: 12 }}>
        <div style={{ width: 56, height: 56, borderRadius: 10, flex: "none", overflow: "hidden", background: "#f4f1ea", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #ece6db" }}>
          {isImage && url
            ? <img src={url} alt={file.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : <span style={{ fontSize: 10, fontWeight: 800, color: "#c2553f", letterSpacing: ".04em" }}>PDF</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#8c8378", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 3 }}>{label}</div>
          <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</div>
          <div style={{ fontSize: 11.5, color: "#a39a8d", fontWeight: 600, fontFamily: MONO }}>{formatBytes(file.size)}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: "none" }}>
          <label style={{ background: "#fff", border: "1px solid #e3ddd1", borderRadius: 9, padding: "6px 11px", fontSize: 11.5, fontWeight: 700, color: "#1b1714", cursor: "pointer", textAlign: "center", fontFamily: "'Manrope', sans-serif" }}>
            Replace
            <input type="file" accept={accept} style={{ display: "none" }} onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
          </label>
          <button type="button" onClick={() => onPick(null)} style={{ background: "none", border: "1px solid #f0d4cc", borderRadius: 9, padding: "6px 11px", fontSize: 11.5, fontWeight: 700, color: "#c2553f", cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>Remove</button>
        </div>
      </div>
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

/* ============ shared bits ============ */
function PassengerSidebar({ tab, walletBalance, onChange }: { tab: Tab; walletBalance: number | null; onChange: (t: Tab) => void }) {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const items: { key: Tab; icon: string; label: string }[] = [
    { key: "plan", icon: "◎", label: "Plan a trip" },
    { key: "trips", icon: "≡", label: "Your trips" },
    { key: "orders", icon: "▤", label: "Orders" },
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

      <div className="pax-only-desktop" style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {user ? (
          <>
            <div style={{ background: "#2a2520", borderRadius: 12, padding: 12, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: "50%", background: "linear-gradient(135deg,#ff8a3d,#e0560c)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 800, color: "#fff", flex: "none" }}>
                {`${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}`.toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{`${user.firstName} ${user.lastName}`}</div>
                <div style={{ fontSize: 10.5, color: "#9a9186" }}>Passenger</div>
              </div>
            </div>
            <button
              onClick={() => { signOut(); router.push("/"); }}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", background: "transparent", border: "1px solid #3a332c", borderRadius: 12, padding: "11px", fontSize: 13, fontWeight: 700, color: "#e0876b", cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
              Sign out
            </button>
          </>
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
