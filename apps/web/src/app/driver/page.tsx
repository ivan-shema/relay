"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatRWF } from "@relay/shared";
import { api, ApiError, type DriverMe, type DriverRequest, type DriverTrip, type DriverMotoRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { StatusPill, TicketVerifyForm, ProfileSettingsPage } from "@/components/console";

const DISPLAY = "'Space Grotesk', sans-serif";
const MONO = "'JetBrains Mono', monospace";

export default function DriverConsole() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();

  const [me, setMe] = useState<DriverMe | null>(null);
  const [requests, setRequests] = useState<DriverRequest[]>([]);
  const [trips, setTrips] = useState<DriverTrip[]>([]);
  const [busy, setBusy] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const reload = useCallback(async () => {
    const [m, r, t] = await Promise.all([api.driverMe(), api.driverRequests(), api.driverTrips()]);
    setMe(m);
    setRequests(r);
    setTrips(t);
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user || user.role !== "DRIVER") {
      router.replace("/auth?mode=login");
      return;
    }
    reload().catch(() => undefined);
  }, [user, loading, router, reload]);

  const toggleOnline = async () => {
    if (!me) return;
    try {
      const { online } = await api.driverSetOnline(!me.online);
      setMe({ ...me, online });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Could not update your status");
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "That didn't go through — please try again");
    } finally {
      setBusy(false);
    }
  };

  const cashOut = async () => {
    try {
      const r = await api.driverCashout();
      window.alert(`Payout of ${formatRWF(r.amount)} sent to MTN MoMo.\nRef: ${r.reference}`);
      await reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Cash out failed");
    }
  };

  if (!user || user.role !== "DRIVER" || !me) return null;

  const s = me.stats;

  return (
    <div className="rel-console-page" style={{ maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ background: "#fff", border: "1px solid #e3ddd1", borderRadius: 20, overflow: "hidden", boxShadow: "0 30px 70px -34px rgba(27,23,20,.4)" }}>
        {/* header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 28px", borderBottom: "1px solid #ece6db", background: "#faf8f4", flexWrap: "wrap", gap: 12 }}>
          <button onClick={() => setProfileOpen(true)} title="Profile & settings" style={{ display: "flex", alignItems: "center", gap: 13, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
            <div style={{ width: 44, height: 44, borderRadius: 13, background: "linear-gradient(135deg,#ff8a3d,#e0560c)", flex: "none" }} />
            <div>
              <div style={{ fontFamily: DISPLAY, fontSize: 18, fontWeight: 700, letterSpacing: "-.4px" }}>{me.name}</div>
              <div style={{ fontSize: 12.5, color: "#8c8378", fontWeight: 600 }}>
                {me.vehicle ? `${me.vehicle.label} · ${me.vehicle.plate}` : "No vehicle"} · ★ {me.rating.toFixed(1)}
              </div>
            </div>
          </button>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button onClick={toggleOnline} style={{ display: "flex", alignItems: "center", gap: 8, background: me.online ? "#e7f6ee" : "#f4f1ea", color: me.online ? "#1f9d6b" : "#8c8378", border: `1px solid ${me.online ? "#bfe6d2" : "#e9e3d8"}`, borderRadius: 12, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: me.online ? "#1f9d6b" : "#a39a8d" }} />
              {me.online ? "Online" : "Offline"}
            </button>
            <button onClick={() => { signOut(); router.push("/"); }} style={{ background: "#fff", border: "1px solid #e3ddd1", borderRadius: 12, padding: "10px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif", color: "#8c8378" }}>Sign out</button>
          </div>
        </div>

        {profileOpen ? (
          <div style={{ padding: "24px 28px" }}>
            <ProfileSettingsPage role="Driver" onBack={() => { setProfileOpen(false); reload().catch(() => undefined); }} />
          </div>
        ) : (
        <div className="rel-track-grid" style={{ padding: "24px 28px", gap: 20 }}>
          {/* left column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div className="rel-driver-tiles" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
              <Tile dark label="Today" value={formatRWF(s.earningsToday)} />
              <Tile label="Trips" value={String(s.tripsToday)} />
              <Tile label="Online" value={`${s.onlineHours}h`} />
              <Tile label="Accept" value={`${s.acceptance}%`} />
            </div>

            {/* on-demand moto hails — only for drivers riding a moto */}
            {me.vehicle?.type === "MOTO" && <MotoHailSection online={me.online} />}

            {/* requests */}
            {requests.length > 0 ? (
              requests.map((r) => (
                <div key={r.id} style={{ background: "#fff", border: "2px solid #ff6a1a", borderRadius: 20, padding: 20, boxShadow: "0 14px 36px -18px rgba(255,106,26,.5)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="rel-pulse" style={{ width: 9, height: 9, borderRadius: "50%", background: "#ff6a1a" }} />
                      <span style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "#ff6a1a" }}>New ride request</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 13, flex: 1 }}>
                      <div style={{ width: 48, height: 48, borderRadius: 14, background: "linear-gradient(135deg,#ff8a3d,#e0560c)", flex: "none" }} />
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 700 }}>{r.passenger}</div>
                        <div style={{ fontSize: 12.5, color: "#8c8378" }}>★ {r.passengerRating} · {r.distanceKm} km</div>
                        <div style={{ fontSize: 12.5, color: "#6b6258", marginTop: 5 }}>{r.from} → {r.to}</div>
                      </div>
                    </div>
                    <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 700, color: "#ff6a1a" }}>{formatRWF(r.fare)}</div>
                  </div>
                  {r.ticketsTotal > 0 && (
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #f1ece2" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#8c8378", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>Confirm boarding</div>
                      <TicketVerifyForm onVerify={api.verifyTicket} boarded={r.ticketsBoarded} total={r.ticketsTotal} />
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 12, marginTop: 18 }}>
                    <button disabled={busy} onClick={() => act(() => api.driverDecline(r.id))} style={{ flex: 1, background: "#f4f1ea", color: "#8c8378", border: "1px solid #e9e3d8", borderRadius: 13, padding: 14, fontSize: 14.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>Decline</button>
                    <button disabled={busy} onClick={() => act(() => api.driverAccept(r.id))} style={{ flex: 2, background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 13, padding: 14, fontSize: 14.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif", boxShadow: "0 10px 22px -10px rgba(255,106,26,.7)" }}>Accept ride</button>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 18, padding: 18, display: "flex", alignItems: "center", gap: 13 }}>
                <span style={{ width: 34, height: 34, borderRadius: "50%", background: "#f4f1ea", color: "#8c8378", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>↺</span>
                <div style={{ flex: 1, fontSize: 13.5, color: "#8c8378", fontWeight: 600 }}>No incoming requests. Looking for the next ride…</div>
              </div>
            )}

            <div style={{ background: "#fff", border: "1px solid #ece6db", borderRadius: 18, padding: "18px 20px" }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Today&apos;s trips</div>
              {trips.length === 0 && <div style={{ fontSize: 13, color: "#8c8378", fontWeight: 600 }}>No trips yet today.</div>}
              {trips.map((t) => (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderTop: "1px solid #f1ece2" }}>
                  <div style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 700, color: "#8c8378", width: 44 }}>{t.time}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700 }}>{t.from} → {t.to}</div>
                    <div style={{ fontSize: 11.5, color: "#8c8378" }}>{t.mode}</div>
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700 }}>{formatRWF(t.fare)}</div>
                  <StatusPill status={t.status} />
                </div>
              ))}
            </div>
          </div>

          {/* right column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ position: "relative", height: 230, borderRadius: 18, overflow: "hidden", background: "#e9efe8", border: "1px solid #d8e0d6" }}>
              <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(27,23,20,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(27,23,20,.05) 1px,transparent 1px)", backgroundSize: "30px 30px" }} />
              <svg viewBox="0 0 400 230" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
                <path d="M50 40 C 140 70, 120 150, 260 150 S 330 200, 350 200" fill="none" stroke="#ff6a1a" strokeWidth="5" strokeLinecap="round" strokeDasharray="2 11" />
                <circle cx="50" cy="40" r="7" fill="#1b1714" stroke="#fff" strokeWidth="3" />
                <rect x="343" y="193" width="14" height="14" rx="4" fill="#ff6a1a" stroke="#fff" strokeWidth="3" />
              </svg>
              <div style={{ position: "absolute", left: 16, top: 16, background: "rgba(255,255,255,.94)", borderRadius: 11, padding: "8px 13px", display: "flex", alignItems: "center", gap: 9, boxShadow: "0 4px 14px -6px rgba(0,0,0,.25)" }}>
                <div className="rel-pulse" style={{ width: 8, height: 8, borderRadius: "50%", background: "#1f9d6b" }} />
                <span style={{ fontSize: 12, fontWeight: 700 }}>Your location · live</span>
              </div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #ece6db", borderRadius: 18, padding: "18px 20px" }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>This week</div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 54, margin: "14px 0 16px" }}>
                {[40, 65, 50, 85, 70, 95, 55].map((h, i) => (
                  <div key={i} style={{ flex: 1, height: `${h}%`, background: h >= 85 ? "#ff6a1a" : "#f1ece2", borderRadius: 3 }} />
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", fontSize: 13, borderTop: "1px solid #f1ece2" }}>
                <span style={{ color: "#8c8378" }}>Trips completed</span>
                <span style={{ fontFamily: MONO, fontWeight: 700 }}>{s.tripsWeek}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", fontSize: 13, borderTop: "1px solid #f1ece2" }}>
                <span style={{ color: "#8c8378" }}>Earnings</span>
                <span style={{ fontFamily: MONO, fontWeight: 700, color: "#1f9d6b" }}>{formatRWF(s.earningsWeek)}</span>
              </div>
              <button onClick={cashOut} style={{ width: "100%", marginTop: 12, background: "#1b1714", color: "#fff", border: "none", borderRadius: 12, padding: 13, fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>Cash out to MoMo</button>
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

// On-demand moto hails: open requests (broadcast + targeted at this driver)
// with an Accept that races other motos — the backend's atomic claim means a
// second acceptance gets a 409, surfaced here as "already taken".
function MotoHailSection({ online }: { online: boolean }) {
  const [open, setOpen] = useState<DriverMotoRequest[]>([]);
  const [current, setCurrent] = useState<DriverMotoRequest | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    api.driverMotoRequests().then((r) => { setOpen(r.open); setCurrent(r.current); }).catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const accept = async (id: string) => {
    setBusyId(id);
    try {
      await api.driverAcceptMotoRide(id);
    } catch (e) {
      window.alert(e instanceof ApiError ? e.message : "Could not accept this ride");
    } finally {
      setBusyId(null);
      load();
    }
  };

  const complete = async () => {
    if (!current) return;
    setBusyId(current.id);
    try {
      await api.driverCompleteMotoRide(current.id);
    } catch (e) {
      window.alert(e instanceof ApiError ? e.message : "Could not complete the ride");
    } finally {
      setBusyId(null);
      load();
    }
  };

  return (
    <div style={{ background: "#fff", border: "1px solid #ece6db", borderRadius: 18, padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Moto hails</div>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: current ? "#ff6a1a" : "#8c8378" }}>
          {current ? "On a ride" : `${open.length} open`}
        </span>
      </div>

      {current ? (
        <div style={{ border: "2px solid #1f9d6b", borderRadius: 15, padding: 15 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
            <span className="rel-pulse" style={{ width: 8, height: 8, borderRadius: "50%", background: "#1f9d6b" }} />
            <span style={{ fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", color: "#1f9d6b" }}>Current ride</span>
          </div>
          <div style={{ fontSize: 14.5, fontWeight: 700 }}>{current.from} → {current.to}</div>
          <div style={{ fontSize: 12.5, color: "#8c8378", fontWeight: 600, marginTop: 3 }}>
            {current.passenger} · <span style={{ fontFamily: MONO }}>{current.passengerPhone}</span>
            {current.offerFare !== null && <> · offer <span style={{ fontFamily: MONO, color: "#ff6a1a", fontWeight: 700 }}>{formatRWF(current.offerFare)}</span></>}
          </div>
          <button onClick={complete} disabled={busyId === current.id} style={{ width: "100%", marginTop: 13, background: "#1f9d6b", color: "#fff", border: "none", borderRadius: 12, padding: 12, fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>
            {busyId === current.id ? "Saving…" : "Complete ride"}
          </button>
        </div>
      ) : !online ? (
        <div style={{ fontSize: 13, color: "#8c8378", fontWeight: 600 }}>Go online to receive hails from passengers nearby.</div>
      ) : open.length === 0 ? (
        <div style={{ fontSize: 13, color: "#8c8378", fontWeight: 600 }}>No open hails right now — new requests appear here automatically.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {open.map((r) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, border: `1px solid ${r.targeted ? "#ffd9c2" : "#ece6db"}`, background: r.targeted ? "#fff6f0" : "#fff", borderRadius: 14, padding: "12px 14px" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                  {r.from} → {r.to}
                  {r.targeted && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: "#ff6a1a", background: "#fff0e6", borderRadius: 20, padding: "2px 8px", textTransform: "uppercase" }}>Asked for you</span>}
                </div>
                <div style={{ fontSize: 11.5, color: "#8c8378", fontWeight: 600, marginTop: 2 }}>
                  {r.passenger} · ~{r.distanceKm} km away
                  {r.offerFare !== null && <> · offers <span style={{ fontFamily: MONO, color: "#ff6a1a", fontWeight: 700 }}>{formatRWF(r.offerFare)}</span></>}
                </div>
              </div>
              <button onClick={() => accept(r.id)} disabled={busyId === r.id} style={{ background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 10, padding: "9px 15px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif", flex: "none" }}>
                {busyId === r.id ? "…" : "Accept"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, dark }: { label: string; value: string; dark?: boolean }) {
  return (
    <div style={{ background: dark ? "#1b1714" : "#fff", border: dark ? "none" : "1px solid #ece6db", borderRadius: 16, padding: 16, color: dark ? "#fff" : "#1b1714" }}>
      <div style={{ fontSize: 11.5, color: dark ? "#cfc7bb" : "#8c8378", fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: MONO, fontSize: 23, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
