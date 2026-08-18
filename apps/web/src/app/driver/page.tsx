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
      window.alert(`Payout of ${formatRWF(r.amount)} is on its way to your mobile money.\nRef: ${r.reference}`);
      // The cashout settles at Paypack; the webhook notifies in real time.
      // This slow poll is the backup — it only nags again if it failed.
      void (async () => {
        for (let i = 0; i < 18; i++) {
          await new Promise((resolve) => setTimeout(resolve, 10_000));
          try {
            const s = await api.driverCashoutStatus(r.reference);
            if (s.status === "FAILED") {
              window.alert(`Payout ${r.reference} failed — the amount is available to cash out again.`);
              await reload();
              return;
            }
            if (s.status === "COMPLETED") { await reload(); return; }
          } catch { /* transient — keep polling */ }
        }
      })();
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

// On-demand moto hails, driver side. Open requests can be accepted at the
// passenger's price or countered with the driver's own quote (bargaining).
// The accept races other motos — the backend's atomic claim 409s the losers.
// After winning: wait for payment (escrow) → pick up within the deadline →
// request completion → passenger's confirmation releases the payout.
function fmtHm(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function MotoHailSection({ online }: { online: boolean }) {
  const [open, setOpen] = useState<DriverMotoRequest[]>([]);
  const [current, setCurrent] = useState<DriverMotoRequest | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [counterFor, setCounterFor] = useState<string | null>(null);
  const [counterAmount, setCounterAmount] = useState("");

  const load = useCallback(() => {
    api.driverMotoRequests().then((r) => { setOpen(r.open); setCurrent(r.current); }).catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id);
    try {
      await fn();
    } catch (e) {
      window.alert(e instanceof ApiError ? e.message : "That didn't go through — please try again");
    } finally {
      setBusyId(null);
      load();
    }
  };

  const sendCounter = (id: string) => {
    const amount = Number(counterAmount);
    if (!amount || amount <= 0) return;
    run(id, async () => {
      await api.driverOfferMotoRide(id, amount);
      setCounterFor(null);
      setCounterAmount("");
    });
  };

  const smallBtn = (bg: string, color = "#fff", border = "none"): React.CSSProperties => ({
    background: bg, color, border, borderRadius: 10, padding: "9px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif", flex: "none",
  });

  return (
    <div style={{ background: "#fff", border: "1px solid #ece6db", borderRadius: 18, padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Moto hails</div>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: current ? "#ff6a1a" : "#8c8378" }}>
          {current ? "Active ride" : `${open.length} open`}
        </span>
      </div>

      {current ? (
        <div style={{ border: `2px solid ${current.pickupOverdue ? "#c2553f" : "#1f9d6b"}`, borderRadius: 15, padding: 15 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
            <span className="rel-pulse" style={{ width: 8, height: 8, borderRadius: "50%", background: current.pickupOverdue ? "#c2553f" : "#1f9d6b" }} />
            <span style={{ fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", color: current.pickupOverdue ? "#c2553f" : "#1f9d6b" }}>
              {current.status === "ACCEPTED" && "Waiting for passenger payment"}
              {current.status === "CONFIRMED" && (current.pickupOverdue ? "Pickup overdue!" : "Paid — go pick up")}
              {current.status === "IN_PROGRESS" && "Ride in progress"}
              {current.status === "AWAITING_CONFIRM" && "Waiting for passenger confirmation"}
            </span>
          </div>
          <div style={{ fontSize: 14.5, fontWeight: 700 }}>{current.from} → {current.to}</div>
          <div style={{ fontSize: 12.5, color: "#8c8378", fontWeight: 600, marginTop: 3 }}>
            {current.passenger} · <span style={{ fontFamily: MONO }}>{current.passengerPhone}</span>
            {current.agreedFare !== null && <> · fare <span style={{ fontFamily: MONO, color: "#ff6a1a", fontWeight: 700 }}>{formatRWF(current.agreedFare)}</span></>}
          </div>

          {current.status === "ACCEPTED" && (
            <>
              <div style={{ fontSize: 12, color: "#8c8378", fontWeight: 600, marginTop: 8 }}>
                The ride confirms once the passenger pays — the money is held by Relay and paid to you (minus commission) after they confirm the trip is done.
              </div>
              <button onClick={() => run(current.id, () => api.driverWithdrawMotoRide(current.id))} disabled={busyId === current.id} style={{ ...smallBtn("#fff", "#c2553f", "1px solid #f0d4cc"), width: "100%", marginTop: 12 }}>
                {busyId === current.id ? "…" : "Withdraw — can't take this ride"}
              </button>
            </>
          )}

          {current.status === "CONFIRMED" && (
            <>
              <div style={{ fontSize: 12, color: current.pickupOverdue ? "#c2553f" : "#8c8378", fontWeight: 700, marginTop: 8 }}>
                {current.pickupOverdue
                  ? "The pickup window has passed — the passenger can reassign this ride any moment. Pick up NOW if you're there."
                  : `Pick up by ${current.pickupDeadline ? fmtHm(current.pickupDeadline) : "—"}${current.departAt ? ` (departure ${fmtHm(current.departAt)})` : ""}`}
              </div>
              <button onClick={() => run(current.id, () => api.driverPickupMotoRide(current.id))} disabled={busyId === current.id} style={{ ...smallBtn("#1f9d6b"), width: "100%", marginTop: 12 }}>
                {busyId === current.id ? "…" : "Passenger picked up"}
              </button>
            </>
          )}

          {current.status === "IN_PROGRESS" && (
            <button onClick={() => run(current.id, () => api.driverCompleteMotoRide(current.id))} disabled={busyId === current.id} style={{ ...smallBtn("#1b1714"), width: "100%", marginTop: 12 }}>
              {busyId === current.id ? "…" : "Ride done — request completion"}
            </button>
          )}

          {current.status === "AWAITING_CONFIRM" && (
            <div style={{ fontSize: 12, color: "#8c8378", fontWeight: 600, marginTop: 8 }}>
              The passenger confirms on their side — your payout lands in your wallet right after.
            </div>
          )}
        </div>
      ) : !online ? (
        <div style={{ fontSize: 13, color: "#8c8378", fontWeight: 600 }}>Go online to receive hails from passengers nearby.</div>
      ) : open.length === 0 ? (
        <div style={{ fontSize: 13, color: "#8c8378", fontWeight: 600 }}>No open hails right now — new requests appear here automatically.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {open.map((r) => (
            <div key={r.id} style={{ border: `1px solid ${r.targeted ? "#ffd9c2" : "#ece6db"}`, background: r.targeted ? "#fff6f0" : "#fff", borderRadius: 14, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                    {r.from} → {r.to}
                    {r.targeted && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: "#ff6a1a", background: "#fff0e6", borderRadius: 20, padding: "2px 8px", textTransform: "uppercase" }}>Asked for you</span>}
                    {r.prepaid && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: "#1f9d6b", background: "#e7f6ee", borderRadius: 20, padding: "2px 8px", textTransform: "uppercase" }}>Prepaid</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: "#8c8378", fontWeight: 600, marginTop: 2 }}>
                    {r.passenger} · ~{r.distanceKm} km away
                    {r.departAt && <> · departs {fmtHm(r.departAt)}</>}
                    {r.prepaid && r.agreedFare !== null
                      ? <> · pays <span style={{ fontFamily: MONO, color: "#1f9d6b", fontWeight: 700 }}>{formatRWF(r.agreedFare)}</span></>
                      : r.offerFare !== null
                        ? <> · offers <span style={{ fontFamily: MONO, color: "#ff6a1a", fontWeight: 700 }}>{formatRWF(r.offerFare)}</span></>
                        : <> · <span style={{ color: "#ff6a1a", fontWeight: 700 }}>no price — quote yours</span></>}
                    {r.myOffer !== null && <> · you offered <span style={{ fontFamily: MONO, fontWeight: 700 }}>{formatRWF(r.myOffer)}</span></>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 7, flex: "none" }}>
                  {(r.prepaid || r.offerFare !== null) && (
                    <button onClick={() => run(r.id, () => api.driverAcceptMotoRide(r.id))} disabled={busyId === r.id} style={smallBtn("#ff6a1a")}>
                      {busyId === r.id ? "…" : `Accept ${formatRWF(r.prepaid ? (r.agreedFare ?? 0) : (r.offerFare ?? 0))}`}
                    </button>
                  )}
                  {!r.prepaid && (
                    <button onClick={() => { setCounterFor(counterFor === r.id ? null : r.id); setCounterAmount(""); }} style={smallBtn("#fff", "#1b1714", "1px solid #e3ddd1")}>
                      {r.myOffer !== null ? "Re-quote" : r.offerFare !== null ? "Counter" : "Quote price"}
                    </button>
                  )}
                </div>
              </div>
              {counterFor === r.id && (
                <div style={{ display: "flex", gap: 8, marginTop: 10, paddingTop: 10, borderTop: "1px solid #f1ece2" }}>
                  <input
                    value={counterAmount}
                    onChange={(e) => setCounterAmount(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="Your price (RWF)"
                    inputMode="numeric"
                    style={{ flex: 1, border: "1px solid #e3ddd1", borderRadius: 10, padding: "9px 12px", fontSize: 12.5, fontWeight: 700, fontFamily: MONO, outline: "none" }}
                  />
                  <button onClick={() => sendCounter(r.id)} disabled={busyId === r.id || !counterAmount} style={smallBtn("#1b1714")}>
                    {busyId === r.id ? "…" : "Send offer"}
                  </button>
                </div>
              )}
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
