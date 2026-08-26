"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type DriverMe, type DriverScheduleTrip, type DriverMotoRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { StatusPill, TicketVerifyForm, ProfileSettingsPage } from "@/components/console";

const DISPLAY = "'Space Grotesk', sans-serif";
const MONO = "'JetBrains Mono', monospace";

function fmtHm(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function fmtDay(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - today.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

// The driver works for an operator: the operator schedules departures, puts
// the driver on them, handles moto hails and collects the fares. This console
// is purely operational — no earnings, no cash-out, no accepting/declining:
// board the passengers who show up, start, finish; take the moto hail the
// operator assigned.
export default function DriverConsole() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();

  const [me, setMe] = useState<DriverMe | null>(null);
  const [schedule, setSchedule] = useState<DriverScheduleTrip[]>([]);
  const [busy, setBusy] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const reload = useCallback(async () => {
    const [m, s] = await Promise.all([api.driverMe(), api.driverSchedule()]);
    setMe(m);
    setSchedule(s);
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user || user.role !== "DRIVER") {
      router.replace("/auth?mode=login");
      return;
    }
    reload().catch(() => undefined);
  }, [user, loading, router, reload]);

  // New bookings land on assigned trips without the driver doing anything —
  // keep the passenger lists fresh.
  useEffect(() => {
    if (!me) return;
    const t = setInterval(() => api.driverSchedule().then(setSchedule).catch(() => undefined), 15_000);
    return () => clearInterval(t);
  }, [me]);

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

  if (!user || user.role !== "DRIVER" || !me) return null;

  const s = me.stats;
  const active = schedule.filter((t) => t.status !== "COMPLETED");
  const finished = schedule.filter((t) => t.status === "COMPLETED");

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
                {me.operatorName && <> · {me.operatorName}</>}
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
              <Tile dark label="Trips today" value={String(s.tripsToday)} />
              <Tile label="Passengers" value={String(s.passengersToday)} />
              <Tile label="Online" value={`${s.onlineHours}h`} />
              <Tile label="This week" value={`${s.tripsWeek} trips`} />
            </div>

            {/* on-demand moto hails — only for drivers riding a moto */}
            {me.vehicle?.type === "MOTO" && <MotoHailSection online={me.online} />}

            {/* assigned departures */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Your departures</div>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "#8c8378" }}>{me.operatorName ? `Scheduled by ${me.operatorName}` : "Scheduled by your operator"}</span>
            </div>
            {active.length === 0 && (
              <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 18, padding: 18, display: "flex", alignItems: "center", gap: 13 }}>
                <span style={{ width: 34, height: 34, borderRadius: "50%", background: "#f4f1ea", color: "#8c8378", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>↺</span>
                <div style={{ flex: 1, fontSize: 13.5, color: "#8c8378", fontWeight: 600 }}>No departures assigned to you right now. Your operator adds you to a trip from their schedule — it shows up here.</div>
              </div>
            )}
            {active.map((t) => <TripCard key={t.id} trip={t} busy={busy} onAct={act} />)}

            {finished.length > 0 && (
              <div style={{ background: "#fff", border: "1px solid #ece6db", borderRadius: 18, padding: "18px 20px" }}>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Completed today</div>
                {finished.map((t) => (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderTop: "1px solid #f1ece2" }}>
                    <div style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 700, color: "#8c8378", width: 44 }}>{fmtHm(t.departAt)}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700 }}>{t.from} → {t.to}</div>
                      <div style={{ fontSize: 11.5, color: "#8c8378" }}>{t.mode} · {t.boarded} of {t.ticketsTotal} boarded</div>
                    </div>
                    <StatusPill status={t.status} />
                  </div>
                ))}
              </div>
            )}
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
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>How it works</div>
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "#6b6258", lineHeight: 1.7 }}>
                <li>Your operator schedules a departure and puts you on it.</li>
                <li>Passengers book seats — they appear on the trip card as they come in.</li>
                <li>At the stop, enter each passenger&apos;s ticket code to board them, then <b>Start trip</b>.</li>
                <li>At the destination tap <b>End trip</b>. Fares are settled with your operator.</li>
              </ol>
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

// One assigned departure: its passengers (boarded / pending), ticket-code
// boarding, and the start / end controls.
function TripCard({ trip, busy, onAct }: { trip: DriverScheduleTrip; busy: boolean; onAct: (fn: () => Promise<unknown>) => Promise<void> }) {
  const running = trip.status === "RUNNING";
  const accent = running ? "#1f9d6b" : "#ff6a1a";
  return (
    <div style={{ background: "#fff", border: `2px solid ${accent}`, borderRadius: 20, padding: 20, boxShadow: `0 14px 36px -18px ${running ? "rgba(31,157,107,.45)" : "rgba(255,106,26,.5)"}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="rel-pulse" style={{ width: 9, height: 9, borderRadius: "50%", background: accent }} />
          <span style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: accent }}>
            {running ? "Trip in progress" : trip.status === "BOARDING" ? "Boarding" : "Assigned departure"}
          </span>
        </div>
        <span style={{ fontSize: 12.5, color: "#8c8378", fontWeight: 700 }}>{fmtDay(trip.departAt)} · {fmtHm(trip.departAt)} → {fmtHm(trip.arriveAt)}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 700, letterSpacing: "-.4px" }}>{trip.from} → {trip.to}</div>
          <div style={{ fontSize: 12.5, color: "#8c8378", fontWeight: 600, marginTop: 3 }}>{trip.mode} · {trip.capacity - trip.seatsLeft} of {trip.capacity} seats booked</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 700, color: accent }}>{trip.boarded}/{trip.ticketsTotal}</div>
          <div style={{ fontSize: 11, color: "#8c8378", fontWeight: 700, textTransform: "uppercase" }}>boarded</div>
        </div>
      </div>

      {trip.passengers.length > 0 ? (
        <div style={{ marginTop: 14, borderTop: "1px solid #f1ece2" }}>
          {trip.passengers.map((p) => (
            <div key={p.bookingId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #f1ece2" }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: p.boarded >= p.seats ? "#e7f6ee" : "#f4f1ea", color: p.boarded >= p.seats ? "#1f9d6b" : "#8c8378", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, flex: "none" }}>
                {p.boarded >= p.seats ? "✓" : p.seats}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                <div style={{ fontSize: 11.5, color: "#8c8378", fontWeight: 600 }}>
                  {p.seats} {p.seats === 1 ? "seat" : "seats"}{p.seatNumbers ? ` · ${p.seatNumbers}` : ""} · {p.boarded}/{p.seats} boarded
                </div>
              </div>
              <StatusPill status={p.status} />
            </div>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f1ece2", fontSize: 12.5, color: "#8c8378", fontWeight: 600 }}>No passengers booked yet — bookings appear here as they come in.</div>
      )}

      {!running && trip.ticketsTotal > 0 && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #f1ece2" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#8c8378", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>Board a passenger — ticket code</div>
          <TicketVerifyForm onVerify={api.verifyTicket} boarded={trip.boarded} total={trip.ticketsTotal} />
        </div>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 18 }}>
        {running ? (
          <button disabled={busy} onClick={() => { if (window.confirm("End this trip? All passengers on board are marked as arrived.")) onAct(() => api.driverCompleteTrip(trip.id)); }} style={{ flex: 1, background: "#1b1714", color: "#fff", border: "none", borderRadius: 13, padding: 14, fontSize: 14.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>
            End trip — arrived
          </button>
        ) : (
          <button
            disabled={busy}
            onClick={() => {
              const pending = trip.ticketsTotal - trip.boarded;
              if (pending > 0 && !window.confirm(`${pending} booked ${pending === 1 ? "seat hasn't" : "seats haven't"} boarded yet. Depart anyway?`)) return;
              onAct(() => api.driverStartTrip(trip.id));
            }}
            style={{ flex: 1, background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 13, padding: 14, fontSize: 14.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif", boxShadow: "0 10px 22px -10px rgba(255,106,26,.7)" }}
          >
            Start trip
          </button>
        )}
      </div>
    </div>
  );
}

// The driver's side of moto hailing. Hails are accepted or quoted by the
// operator, who assigns one of its motos; the driver only sees the ride that
// was assigned to them and takes it from pickup to completion (disputes stay
// with the driver — they're about what physically happened). The fare is the
// operator's business, so none of it is shown here.
function MotoHailSection({ online }: { online: boolean }) {
  const [current, setCurrent] = useState<DriverMotoRequest | null>(null);
  const [hailing, setHailing] = useState<{ enabled: boolean; reason: string | null } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    api.driverMotoRequests().then((r) => { setCurrent(r.current); setHailing(r.hailing ?? null); }).catch(() => undefined);
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

  const smallBtn = (bg: string, color = "#fff", border = "none"): React.CSSProperties => ({
    background: bg, color, border, borderRadius: 10, padding: "9px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif", flex: "none",
  });

  return (
    <div style={{ background: "#fff", border: "1px solid #ece6db", borderRadius: 18, padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Moto rides</div>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: current ? "#ff6a1a" : "#8c8378" }}>
          {current ? "Assigned ride" : "Standing by"}
        </span>
      </div>

      {current ? (
        <div style={{ border: `2px solid ${current.pickupOverdue || current.status === "DISPUTED" ? "#c2553f" : "#1f9d6b"}`, borderRadius: 15, padding: 15 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
            <span className="rel-pulse" style={{ width: 8, height: 8, borderRadius: "50%", background: current.pickupOverdue || current.status === "DISPUTED" ? "#c2553f" : "#1f9d6b" }} />
            <span style={{ fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", color: current.pickupOverdue || current.status === "DISPUTED" ? "#c2553f" : "#1f9d6b" }}>
              {current.status === "ACCEPTED" && "Assigned — waiting for passenger payment"}
              {current.status === "CONFIRMED" && (current.pickupOverdue ? "Pickup overdue!" : "Paid — go to pickup")}
              {current.status === "IN_PROGRESS" && "Ride in progress"}
              {current.status === "AWAITING_CONFIRM" && "Waiting for passenger confirmation"}
              {current.status === "DISPUTED" && "Pickup disputed!"}
            </span>
          </div>
          <div style={{ fontSize: 14.5, fontWeight: 700 }}>{current.from} → {current.to}</div>
          <div style={{ fontSize: 12.5, color: "#8c8378", fontWeight: 600, marginTop: 3 }}>
            {current.passenger} · <span style={{ fontFamily: MONO }}>{current.passengerPhone}</span>
            {current.departAt && <> · departure {fmtHm(current.departAt)}</>}
            {" · "}{current.distanceKm} km away
          </div>

          {current.status === "ACCEPTED" && (
            <div style={{ fontSize: 12, color: "#8c8378", fontWeight: 600, marginTop: 8 }}>
              Your operator assigned this ride to you. It confirms once the passenger pays — then head to the pickup. If you can&apos;t take it, tell your operator so they can reassign it.
            </div>
          )}

          {current.status === "CONFIRMED" && (
            <>
              <div style={{ fontSize: 12, color: current.pickupOverdue ? "#c2553f" : "#8c8378", fontWeight: 700, marginTop: 8 }}>
                {current.pickupOverdue
                  ? "The pickup window has passed — the passenger can reassign this ride any moment. Pick up NOW if you're there."
                  : `Pick up by ${current.pickupDeadline ? fmtHm(current.pickupDeadline) : "—"}`}
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
              The passenger confirms on their side — the ride closes and the fare is settled with your operator.
            </div>
          )}

          {current.status === "DISPUTED" && (
            <>
              <div style={{ background: "#fbeae6", border: "1px solid #f0d4cc", color: "#c2553f", borderRadius: 11, padding: "9px 12px", fontSize: 12, fontWeight: 700, marginTop: 10 }}>
                {current.disputeContested
                  ? "You contested the report — Relay is reviewing the ride. The fare stays held until it's resolved."
                  : "The passenger reported they were NOT picked up. Respond now — if you don't within 10 minutes, the ride is returned to them."}
              </div>
              {!current.disputeContested && (
                <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
                  <button
                    onClick={() => { if (window.confirm("Confirm you DID pick up this passenger? Relay will review the dispute — false claims can lead to suspension.")) run(current.id, () => api.driverContestDispute(current.id)); }}
                    disabled={busyId === current.id}
                    style={{ ...smallBtn("#1b1714"), flex: 1 }}
                  >
                    I DID pick them up
                  </button>
                  <button
                    onClick={() => run(current.id, () => api.driverAcknowledgeNoPickup(current.id))}
                    disabled={busyId === current.id}
                    style={{ ...smallBtn("#fff", "#c2553f", "1px solid #f0d4cc"), flex: 1 }}
                  >
                    They&apos;re right — no pickup yet
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ) : hailing && !hailing.enabled ? (
        <div style={{ background: "#fff8f5", border: "1px solid #f0d4cc", borderRadius: 12, padding: "11px 14px", fontSize: 13, color: "#c2553f", fontWeight: 600 }}>Hailing is off for you: {hailing.reason}</div>
      ) : !online ? (
        <div style={{ fontSize: 13, color: "#8c8378", fontWeight: 600 }}>Go online so your operator can assign you passengers&apos; hails.</div>
      ) : (
        <div style={{ fontSize: 13, color: "#8c8378", fontWeight: 600 }}>You&apos;re available. Your operator assigns hails to you — an assigned ride appears here automatically with the pickup details.</div>
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
