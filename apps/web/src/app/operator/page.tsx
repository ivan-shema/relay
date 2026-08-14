"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api,
  type OperatorOverview,
  type OperatorVehicle,
  type OperatorRoute,
  type OperatorScheduleRow,
  type OperatorDriverRow,
  type OperatorDriverDetail,
  type OperatorDriverTrip,
  type OperatorBookingRow,
  type OperatorPayments,
} from "@/lib/api";
import {
  formatRWF,
  createVehicleSchema,
  createRouteSchema,
  createDepartureSchema,
  inviteDriverSchema,
  assignVehicleSchema,
  assignTripSchema,
  type CreateVehicleInput,
  type CreateRouteInput,
  type CreateDepartureInput,
  type InviteDriverInput,
} from "@relay/shared";
import { useAuth } from "@/lib/auth-context";
import { ConsoleShell, ProfileSettingsPage, KpiGrid, StatusPill, Card, CardTitle, ProgressBar, AccentButton, PrimaryButton, FormModal, Pagination, usePaged, TicketVerifyForm, type NavItem } from "@/components/console";
import { NotificationBell } from "@/components/notification-bell";

const MONO = "'JetBrains Mono', monospace";

const NAV: NavItem[] = [
  { key: "overview", label: "Overview", icon: "▦" },
  { key: "live", label: "Live map", icon: "◉" },
  { key: "fleet", label: "Vehicles", icon: "▤" },
  { key: "routes", label: "Routes", icon: "⋔" },
  { key: "schedule", label: "Schedule", icon: "◷" },
  { key: "drivers", label: "Drivers", icon: "☻" },
  { key: "bookings", label: "Bookings", icon: "≡" },
  { key: "payments", label: "Payments", icon: "◈" },
];

const TITLES: Record<string, string> = {
  overview: "Overview",
  live: "Live map",
  fleet: "Fleet",
  routes: "Routes",
  schedule: "Schedule",
  drivers: "Drivers",
  bookings: "Bookings",
  payments: "Payments & payouts",
};

export default function OperatorConsole() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState("overview");
  const [company, setCompany] = useState("Operator");
  const [status, setStatus] = useState<string | null>(null);
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  const checkStatus = useCallback(() => {
    api
      .operatorMe()
      .then((o) => {
        setCompany(o.companyName);
        setStatus(o.status);
      })
      .catch(() => setStatus("ERROR"));
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user || (user.role !== "OPERATOR" && user.role !== "ADMIN")) {
      router.replace("/auth?mode=login");
      return;
    }
    checkStatus();
  }, [user, loading, router, checkStatus]);

  if (!user || (user.role !== "OPERATOR" && user.role !== "ADMIN")) return null;
  // Only a VERIFIED company gets the console — pending applications see a
  // review screen, rejected ones a not-approved screen.
  if (status === null) return <OperatorStatusScreen kind="loading" company={company} />;
  if (status === "PENDING") return <OperatorStatusScreen kind="pending" company={company} onRefresh={checkStatus} />;
  if (status === "SUSPENDED") return <OperatorStatusScreen kind="rejected" company={company} />;
  if (status === "ERROR") return <OperatorStatusScreen kind="no-operator" company={company} isAdmin={user.role === "ADMIN"} />;

  return (
    <div className="rel-console-page">
      <ConsoleShell
        role="Operator"
        nav={NAV}
        active={profileOpen ? "" : tab}
        onNav={(k) => { setProfileOpen(false); setTab(k); setSelectedDriver(null); }}
        onOpenProfile={() => setProfileOpen(true)}
        title={profileOpen ? "Profile & settings" : TITLES[tab]}
        subtitle={profileOpen ? "Your account" : `${company} · live`}
        actions={profileOpen ? undefined : <>
          <button style={{ background: "#fff", border: "1px solid #e3ddd1", borderRadius: 11, padding: "10px 15px", fontSize: 13, fontWeight: 700, fontFamily: "'Manrope', sans-serif", cursor: "pointer" }}>Last 24h ▾</button>
          <PrimaryButton>Export report</PrimaryButton>
          <NotificationBell />
        </>}
      >
        {profileOpen && <ProfileSettingsPage role="Operator" onBack={() => setProfileOpen(false)} />}
        {!profileOpen && (
          <>
            {tab === "overview" && <OverviewTab />}
            {tab === "live" && <LiveTab />}
            {tab === "fleet" && <FleetTab />}
            {tab === "routes" && <RoutesTab />}
            {tab === "schedule" && <ScheduleTab />}
            {tab === "drivers" && <DriversTab selected={selectedDriver} onSelect={setSelectedDriver} />}
            {tab === "bookings" && <BookingsTab />}
            {tab === "payments" && <PaymentsTab />}
          </>
        )}
      </ConsoleShell>
    </div>
  );
}

// Non-console states: application pending / rejected / no linked company.
function OperatorStatusScreen({ kind, company, isAdmin, onRefresh }: { kind: "loading" | "pending" | "rejected" | "no-operator"; company: string; isAdmin?: boolean; onRefresh?: () => void }) {
  const router = useRouter();
  const { signOut } = useAuth();
  const DISPLAY = "'Space Grotesk', sans-serif";

  const content = {
    loading: { icon: "◌", title: "Loading…", body: "Checking your operator profile.", accent: "#8c8378", bg: "#f1ece2" },
    pending: {
      icon: "◔",
      title: "Your application is under review",
      body: `Thanks for applying${company !== "Operator" ? `, ${company}` : ""}. Our team is verifying your documents and business certificate — this usually takes 1–2 business days. We'll notify you as soon as you're approved.`,
      accent: "#ff6a1a",
      bg: "#fff0e6",
    },
    rejected: {
      icon: "✕",
      title: "Your application was not approved",
      body: "Unfortunately your operator application didn't pass verification. If you believe this is a mistake or want to reapply with updated documents, contact support@relay.app.",
      accent: "#c2553f",
      bg: "#fbeae6",
    },
    "no-operator": {
      icon: "▤",
      title: "No operator profile linked",
      body: isAdmin
        ? "This admin account doesn't own an operator company. Use the Admin console to manage operators across the platform."
        : "No operator company is linked to this account. Apply as an operator to get started.",
      accent: "#8c8378",
      bg: "#f1ece2",
    },
  }[kind];

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      {kind === "pending" && (
        <div style={{ position: "fixed", top: 24, right: 24, zIndex: 10 }}>
          <NotificationBell />
        </div>
      )}
      <div style={{ width: "100%", maxWidth: 480, background: "#fff", border: "1px solid #e3ddd1", borderRadius: 24, padding: "44px 40px", textAlign: "center", boxShadow: "0 40px 90px -40px rgba(27,23,20,.45)" }} className="rel-up">
        <div style={{ width: 64, height: 64, borderRadius: 18, background: content.bg, color: content.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 20px" }} className={kind === "pending" ? "rel-pulse" : undefined}>
          {content.icon}
        </div>
        <div style={{ fontFamily: DISPLAY, fontSize: 24, fontWeight: 700, letterSpacing: "-.6px", marginBottom: 10 }}>{content.title}</div>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "#6b6258", margin: "0 0 26px" }}>{content.body}</p>
        {kind !== "loading" && (
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            {kind === "pending" ? (
              <button onClick={onRefresh} style={{ background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 13, padding: "13px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>Check status</button>
            ) : kind === "no-operator" && isAdmin ? (
              <button onClick={() => router.push("/admin")} style={{ background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 13, padding: "13px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>Go to Admin console</button>
            ) : (
              <button onClick={() => router.push("/")} style={{ background: "#fff", color: "#1b1714", border: "1px solid #e3ddd1", borderRadius: 13, padding: "13px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>Back to Relay</button>
            )}
            <button onClick={() => { signOut(); router.push("/"); }} style={{ background: "none", color: "#a39a8d", border: "none", borderRadius: 13, padding: "13px 16px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>Sign out</button>
          </div>
        )}
      </div>
    </div>
  );
}

function useData<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const load = useCallback(() => { fn().then(setData).catch(() => undefined); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return [data, load] as const;
}

function OverviewTab() {
  const [data] = useData<OperatorOverview>(() => api.operatorOverview());
  if (!data) return <Loading />;
  return (
    <>
      <KpiGrid kpis={data.kpis} />
      <div style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: 16 }} className="op-two">
        <Card>
          <CardTitle right={<span style={{ fontSize: 12, color: "#ff6a1a", fontWeight: 700 }}>View all →</span>}>Live bookings</CardTitle>
          <TableHead cols={["Passenger", "Route", "Time", "Fare", "Status"]} template="1.1fr 1.4fr .7fr .6fr 1fr" />
          {data.liveBookings.map((b, i) => (
            <Row key={i} template="1.1fr 1.4fr .7fr .6fr 1fr">
              <span style={{ fontWeight: 700 }}>{b.passenger}</span>
              <span style={{ color: "#6b6258" }}>{b.route}</span>
              <span style={{ fontFamily: MONO, color: "#8c8378", fontSize: 12 }}>{b.time}</span>
              <span style={{ fontFamily: MONO, fontWeight: 700 }}>{formatRWF(b.fare)}</span>
              <span style={{ textAlign: "right" }}><StatusPill status={b.status} /></span>
            </Row>
          ))}
        </Card>
        <Card>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Route performance</div>
          {data.routePerformance.map((r) => (
            <div key={r.name} style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{r.name}</span>
                <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: "#8c8378" }}>{r.trips}</span>
              </div>
              <ProgressBar pct={r.util} />
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #f1ece2", paddingTop: 13, marginTop: 4, fontSize: 12.5 }}>
            <span style={{ color: "#8c8378" }}>Fleet utilisation</span>
            <span style={{ fontFamily: MONO, fontWeight: 700, color: "#1f9d6b" }}>{data.fleetUtilization}%</span>
          </div>
        </Card>
      </div>
    </>
  );
}

function LiveTab() {
  const [data] = useData<OperatorOverview>(() => api.operatorOverview());
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 16 }} className="op-two">
      <div style={{ position: "relative", height: 560, borderRadius: 18, overflow: "hidden", background: "#eef0e9", border: "1px solid #d8e0d6" }}>
        <OperatorMap />
        <div style={{ position: "absolute", left: 16, top: 16, background: "rgba(255,255,255,.94)", borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "center", gap: 9, boxShadow: "0 6px 18px -8px rgba(0,0,0,.25)" }}>
          <span className="rel-pulse" style={{ width: 8, height: 8, borderRadius: "50%", background: "#1f9d6b" }} />
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>Fleet live · updated just now</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
          <MiniStat value={data?.fleetUtilization ?? 0} label="Utilisation %" color="#1f9d6b" />
          <MiniStat value={data?.liveBookings.length ?? 0} label="Live bookings" color="#8c8378" />
          <MiniStat value={data?.kpis.length ?? 0} label="Alerts" color="#c2553f" />
        </div>
        <Card style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Recent bookings on the map</div>
          <div style={{ fontSize: 12, color: "#8c8378", marginBottom: 8 }}>Live telemetry from active units</div>
          {data?.liveBookings.map((b, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 0", borderTop: "1px solid #f1ece2" }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#1f9d6b", flex: "none" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{b.passenger}</div>
                <div style={{ fontSize: 11.5, color: "#8c8378" }}>{b.route}</div>
              </div>
              <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700 }}>{formatRWF(b.fare)}</div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

function FleetTab() {
  const { data, page, setPage, reloadFirst } = usePaged<OperatorVehicle>(useCallback((pg) => api.operatorVehicles(pg), []));
  const [modal, setModal] = useState(false);
  if (!data) return <Loading />;
  return (
    <Card>
      {modal && (
        <FormModal
          title="Add vehicle"
          submitLabel="Add vehicle"
          schema={createVehicleSchema}
          fields={[
            { name: "plateNumber", label: "Plate number", placeholder: "RAD 500 X" },
            { name: "type", label: "Type", type: "select", options: [{ value: "BUS", label: "Bus" }, { value: "MOTO", label: "Moto-taxi" }, { value: "RIDE", label: "Shared ride" }] },
            { name: "capacity", label: "Capacity", type: "number", defaultValue: "33" },
            { name: "model", label: "Model", placeholder: "Coaster HD" },
          ]}
          onSubmit={async (v) => { const d = v as CreateVehicleInput; await api.operatorAddVehicle({ plateNumber: d.plateNumber, type: d.type, capacity: d.capacity, model: d.model }); reloadFirst(); }}
          onClose={() => setModal(false)}
        />
      )}
      <CardTitle right={<AccentButton onClick={() => setModal(true)}>+ Add vehicle</AccentButton>}>Fleet · {data.total} vehicles</CardTitle>
      <TableHead cols={["Plate", "Type", "Model", "Cap", "Driver", "Util", "Status"]} template="1.1fr .7fr 1.2fr .5fr 1fr .6fr .9fr" />
      {data.items.map((v) => (
        <Row key={v.id} template="1.1fr .7fr 1.2fr .5fr 1fr .6fr .9fr">
          <span style={{ fontFamily: MONO, fontWeight: 700 }}>{v.plate}</span>
          <span style={{ color: "#6b6258" }}>{v.type}</span>
          <span style={{ color: "#6b6258" }}>{v.model}</span>
          <span style={{ fontFamily: MONO, color: "#8c8378" }}>{v.capacity}</span>
          <span style={{ fontWeight: 600 }}>{v.driver}</span>
          <span style={{ fontFamily: MONO, color: "#8c8378" }}>{v.util}</span>
          <span style={{ textAlign: "right" }}><StatusPill status={v.status} /></span>
        </Row>
      ))}
      <Pagination page={page} totalPages={data.totalPages} total={data.total} onPage={setPage} />
    </Card>
  );
}

function RoutesTab() {
  const { data, page, setPage, reloadFirst } = usePaged<OperatorRoute>(useCallback((pg) => api.operatorRoutes(pg), []));
  const [modal, setModal] = useState(false);
  const [placeNames, setPlaceNames] = useState<string[]>([]);
  useEffect(() => { api.places().then((ps) => setPlaceNames(ps.map((p) => p.name))).catch(() => undefined); }, []);
  if (!data) return <Loading />;
  return (
    <Card>
      {modal && (
        <FormModal
          title="New route"
          submitLabel="Create route"
          schema={createRouteSchema}
          fields={[
            { name: "origin", label: "Origin", placeholder: "Pick a stop or type a new one", suggestions: placeNames },
            { name: "destination", label: "Destination", placeholder: "Pick a stop or type a new one", suggestions: placeNames },
            { name: "distanceKm", label: "Distance (km)", type: "number", defaultValue: "5" },
          ]}
          onSubmit={async (v) => { const d = v as CreateRouteInput; await api.operatorAddRoute({ origin: d.origin, destination: d.destination, distanceKm: d.distanceKm }); reloadFirst(); }}
          onClose={() => setModal(false)}
        />
      )}
      <CardTitle right={<AccentButton onClick={() => setModal(true)}>+ New route</AccentButton>}>Routes · {data.total}</CardTitle>
      {data.items.map((r) => (
        <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 18, padding: "15px 0", borderTop: "1px solid #f1ece2" }}>
          <div style={{ width: 150, flex: "none" }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{r.name}</div>
            <div style={{ fontSize: 12, color: "#8c8378" }}>{r.from} → {r.to}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#8c8378", marginBottom: 6 }}>
              <span>{r.stops} · {r.buses} · {r.freq}</span>
              <span style={{ fontFamily: MONO, fontWeight: 700, color: "#1b1714" }}>{r.util}% full</span>
            </div>
            <ProgressBar pct={r.util} />
          </div>
          <div style={{ width: 64, textAlign: "right", flex: "none", fontFamily: MONO, fontSize: 15, fontWeight: 700, color: "#ff6a1a" }}>{formatRWF(r.fare)}</div>
        </div>
      ))}
      <Pagination page={page} totalPages={data.totalPages} total={data.total} onPage={setPage} />
    </Card>
  );
}

function ScheduleTab() {
  const { data, page, setPage, reloadFirst } = usePaged<OperatorScheduleRow>(useCallback((pg) => api.operatorSchedule(pg), []));
  const [modal, setModal] = useState(false);
  const [routes, setRoutes] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => { api.operatorRouteLookup().then(setRoutes).catch(() => undefined); }, []);
  if (!data) return <Loading />;
  return (
    <Card>
      {modal && routes.length > 0 && (
        <FormModal
          title="Add departure"
          submitLabel="Publish departure"
          schema={createDepartureSchema}
          fields={[
            { name: "routeId", label: "Route", type: "select", options: routes },
            { name: "mode", label: "Mode", type: "select", options: [{ value: "BUS", label: "Bus" }, { value: "MOTO", label: "Moto-taxi" }, { value: "RIDE", label: "Shared ride" }] },
            { name: "fare", label: "Fare (RWF)", type: "number", defaultValue: "800" },
            { name: "departInMinutes", label: "Departs in (min)", type: "number", defaultValue: "30" },
            { name: "durationMinutes", label: "Duration (min)", type: "number", defaultValue: "30" },
            { name: "capacity", label: "Capacity", type: "number", defaultValue: "33" },
          ]}
          onSubmit={async (v) => { const d = v as CreateDepartureInput; await api.operatorAddDeparture({ routeId: d.routeId, mode: d.mode, fare: d.fare, departInMinutes: d.departInMinutes, durationMinutes: d.durationMinutes, capacity: d.capacity }); reloadFirst(); }}
          onClose={() => setModal(false)}
        />
      )}
      <CardTitle
        right={
          <AccentButton
            onClick={() => {
              // without a route there's nothing to publish on — say so instead
              // of a click that silently does nothing
              if (routes.length === 0) {
                window.alert("Create a route first (Routes tab) — departures are published on a route.");
                return;
              }
              setModal(true);
            }}
          >
            + Add departure
          </AccentButton>
        }
      >
        Schedule · {data.total} departures
      </CardTitle>
      <TableHead cols={["Time", "Route", "Vehicle", "Driver", "Seats booked", "Status"]} template=".6fr 1.7fr .8fr .9fr 1fr .9fr" />
      {data.items.map((t) => (
        <Row key={t.id} template=".6fr 1.7fr .8fr .9fr 1fr .9fr">
          <span style={{ fontFamily: MONO, fontWeight: 700 }}>{t.time}</span>
          <span style={{ fontWeight: 600 }}>{t.route}</span>
          <span style={{ fontFamily: MONO, color: "#8c8378", fontSize: 12 }}>{t.vehicle}</span>
          <span style={{ color: "#6b6258" }}>{t.driver}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ flex: 1, maxWidth: 70 }}><ProgressBar pct={(t.booked / Math.max(1, t.capacity)) * 100} /></span>
            <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700 }}>{t.booked}/{t.capacity}</span>
          </span>
          <span style={{ textAlign: "right" }}><StatusPill status={t.status} /></span>
        </Row>
      ))}
      <Pagination page={page} totalPages={data.totalPages} total={data.total} onPage={setPage} />
    </Card>
  );
}

function DriversTab({ selected, onSelect }: { selected: string | null; onSelect: (id: string | null) => void }) {
  const { data: list, page, setPage, reload, reloadFirst } = usePaged<OperatorDriverRow>(useCallback((pg) => api.operatorDrivers(pg), []));
  const [detail, setDetail] = useState<OperatorDriverDetail | null>(null);
  const [history, setHistory] = useState<OperatorDriverTrip[]>([]);
  const [lookups, setLookups] = useState<{ vehicles: { value: string; label: string }[]; trips: { value: string; label: string }[] }>({ vehicles: [], trips: [] });
  const [inviteModal, setInviteModal] = useState(false);
  const [action, setAction] = useState<"vehicle" | "trip" | null>(null);

  const loadDetail = useCallback((id: string) => {
    api.operatorDriver(id).then(setDetail).catch(() => undefined);
    api.operatorDriverTrips(id).then(setHistory).catch(() => undefined);
    api.operatorDriverLookups(id).then(setLookups).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (selected) loadDetail(selected);
    else { setDetail(null); setHistory([]); }
  }, [selected, loadDetail]);

  const suspend = async () => {
    if (!detail) return;
    try {
      await api.operatorSuspend(detail.id);
      loadDetail(detail.id);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Could not update this driver");
    }
  };
  const remove = async () => {
    if (!detail) return;
    if (!window.confirm(`Remove ${detail.name} from your fleet? Their account stays, but they'll no longer be under your company.`)) return;
    try {
      await api.operatorRemoveDriver(detail.id);
      onSelect(null);
      reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Could not remove this driver");
    }
  };

  if (selected && detail) {
    return (
      <div>
        {action === "vehicle" && (
          <FormModal
            title="Reassign vehicle"
            submitLabel="Save assignment"
            schema={assignVehicleSchema}
            fields={[{ name: "vehicleId", label: "Vehicle", type: "select", options: [{ value: "", label: "— Unassigned —" }, ...lookups.vehicles] }]}
            onSubmit={async (v) => { await api.operatorAssignVehicle(detail.id, (v.vehicleId as string) || null); loadDetail(detail.id); reload(); }}
            onClose={() => setAction(null)}
          />
        )}
        {action === "trip" && (
          <FormModal
            title="Assign to a departure"
            submitLabel="Assign driver"
            schema={assignTripSchema}
            fields={[{ name: "tripId", label: "Upcoming departure", type: "select", options: lookups.trips.length ? lookups.trips : [{ value: "", label: "No upcoming departures" }] }]}
            onSubmit={async (v) => {
              if (!v.tripId) return;
              await api.operatorAssignTrip(detail.id, v.tripId as string);
              loadDetail(detail.id);
              // the assignment lives on the Schedule tab, not this screen —
              // without an explicit confirmation the action looks like a no-op
              window.alert(`${detail.name} assigned to the departure — you can see it on the Schedule tab.`);
            }}
            onClose={() => setAction(null)}
          />
        )}

        <button onClick={() => onSelect(null)} style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, marginBottom: 16 }}>← Back to drivers</button>
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }} className="op-two">
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Card>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 56, height: 56, borderRadius: 16, background: "linear-gradient(135deg,#ff8a3d,#e0560c)", flex: "none" }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 19, fontWeight: 700 }}>{detail.name}</div>
                  <div style={{ fontSize: 12.5, color: "#8c8378", fontFamily: MONO }}>{detail.phone}</div>
                </div>
                <StatusPill status={detail.status} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginTop: 18 }}>
                <MgTile value={String(detail.trips)} label="Trips" />
                <MgTile value={`${detail.rating.toFixed(1)}★`} label="Rating" />
                <MgTile value={formatRWF(detail.revenue)} label="Revenue" color="#1f9d6b" />
                <MgTile value={detail.joined} label="Joined" />
              </div>
              <div style={{ fontSize: 10.5, color: "#a39a8d", marginTop: 8 }}>Revenue = fares collected on this driver&apos;s trips (company revenue), not their personal pay.</div>
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #f1ece2", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: "#8c8378", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>Assigned vehicle</div>
                  <div style={{ fontSize: 14.5, fontWeight: 700 }}>{detail.vehicle}</div>
                </div>
                <button onClick={() => setAction("vehicle")} style={{ background: "#fff", border: "1px solid #e3ddd1", borderRadius: 10, padding: "9px 14px", fontSize: 12.5, fontWeight: 700, color: "#1b1714", cursor: "pointer", fontFamily: "'Manrope', sans-serif", flex: "none" }}>Reassign</button>
              </div>
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #f1ece2" }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "#8c8378", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>KYC</div>
                <div style={{ fontSize: 12.5, color: "#6b6258", fontWeight: 600, marginBottom: 8 }}>
                  ID <span style={{ fontFamily: MONO }}>{detail.nationalId ?? "—"}</span> · Licence <span style={{ fontFamily: MONO }}>{detail.licenseNumber}</span>
                </div>
                {detail.documents.length > 0 ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {detail.documents.map((doc) => (
                      <button
                        key={doc.id}
                        onClick={() => api.openDocument(doc.id).catch(() => window.alert("Could not open document"))}
                        style={{ display: "flex", alignItems: "center", gap: 6, background: "#faf8f4", border: "1px solid #ece6db", borderRadius: 8, padding: "5px 10px", fontSize: 11.5, fontWeight: 700, color: "#6b6258", cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}
                      >
                        <span style={{ color: "#ff6a1a" }}>▤</span> {doc.kind === "DRIVING_LICENSE" ? "Driving licence" : "ID document"}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: "#a39a8d", fontWeight: 600 }}>No documents on file (onboarded before KYC).</div>
                )}
              </div>
            </Card>

            <Card>
              <div id="op-history" style={{ scrollMarginTop: 90 }} />
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Trip history</div>
              <div style={{ fontSize: 12, color: "#8c8378", marginBottom: 10 }}>Recent trips this driver ran</div>
              {history.length === 0 && <div style={{ fontSize: 13, color: "#8c8378", fontWeight: 600, padding: "6px 0" }}>No completed trips yet.</div>}
              {history.map((t) => (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderTop: "1px solid #f1ece2" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700 }}>{t.route}</div>
                    <div style={{ fontSize: 11.5, color: "#8c8378", fontFamily: MONO }}>{t.time}</div>
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700 }}>{formatRWF(t.fare)}</div>
                  <StatusPill status={t.status} />
                </div>
              ))}
            </Card>
          </div>

          <Card style={{ height: "fit-content" }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "#8c8378", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 13 }}>Actions</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <ActionBtn icon="▤" label="Reassign vehicle" onClick={() => setAction("vehicle")} />
              <ActionBtn icon="◷" label="Assign to a departure" onClick={() => setAction("trip")} />
              <ActionBtn icon="✆" label="View trip history" onClick={() => { const el = document.getElementById("op-history"); el?.scrollIntoView({ behavior: "smooth" }); }} />
            </div>
            <div style={{ height: 1, background: "#f1ece2", margin: "16px 0" }} />
            <button onClick={suspend} style={{ width: "100%", background: detail.suspended ? "#e7f6ee" : "#fbeae6", color: detail.suspended ? "#1f9d6b" : "#c2553f", border: "none", borderRadius: 12, padding: 13, fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>
              {detail.suspended ? "Reinstate driver" : "Suspend driver"}
            </button>
            <button onClick={remove} style={{ width: "100%", marginTop: 10, background: "none", border: "none", color: "#a39a8d", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>Remove from fleet</button>
          </Card>
        </div>
      </div>
    );
  }

  if (!list) return <Loading />;
  return (
    <Card>
      {inviteModal && (
        <FormModal
          title="Invite a driver"
          submitLabel="Send invite"
          schema={inviteDriverSchema}
          fields={[
            { name: "firstName", label: "First name", placeholder: "Patrick" },
            { name: "lastName", label: "Last name", placeholder: "Habimana" },
            { name: "phone", label: "Phone number", placeholder: "+250 78 000 0000" },
            { name: "email", label: "Email (optional)", placeholder: "driver@email.com" },
            { name: "idNumber", label: "National ID number", placeholder: "1199…" },
            { name: "licenseNumber", label: "Driving licence number", placeholder: "RW-DRV-…" },
            { name: "idDocument", label: "ID document", type: "file" },
            { name: "licenseDocument", label: "Driving licence document", type: "file" },
          ]}
          onSubmit={async (v) => {
            const d = v as InviteDriverInput & { idDocument: File; licenseDocument: File };
            const fd = new FormData();
            fd.append("firstName", d.firstName);
            fd.append("lastName", d.lastName);
            fd.append("phone", d.phone);
            if (d.email) fd.append("email", d.email);
            fd.append("idNumber", d.idNumber);
            fd.append("licenseNumber", d.licenseNumber);
            fd.append("idDocument", d.idDocument);
            fd.append("licenseDocument", d.licenseDocument);
            await api.operatorInviteDriver(fd);
            reloadFirst();
          }}
          onClose={() => setInviteModal(false)}
        />
      )}
      <CardTitle right={<AccentButton onClick={() => setInviteModal(true)}>+ Invite driver</AccentButton>}>Drivers · {list.total}</CardTitle>
      <TableHead cols={["Driver", "Vehicle", "Trips", "Rating", "Revenue", "Status", ""]} template="1.2fr 1.4fr .6fr .6fr .8fr .9fr 24px" />
      {list.items.map((d) => (
        <button key={d.id} onClick={() => onSelect(d.id)} style={{ display: "grid", gridTemplateColumns: "1.2fr 1.4fr .6fr .6fr .8fr .9fr 24px", alignItems: "center", padding: "13px 0", border: "none", borderBottom: "1px solid #f6f2ea", fontSize: 13, width: "100%", textAlign: "left", background: "none", cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 700 }}>
            <span style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,#ff8a3d,#e0560c)", flex: "none" }} />{d.name}
          </span>
          <span style={{ color: "#6b6258" }}>{d.vehicle}</span>
          <span style={{ fontFamily: MONO, color: "#8c8378" }}>{d.trips}</span>
          <span style={{ fontFamily: MONO, fontWeight: 700 }}>{d.rating.toFixed(1)}★</span>
          <span style={{ fontFamily: MONO, fontWeight: 700, color: "#1f9d6b" }}>{formatRWF(d.revenue)}</span>
          <span><StatusPill status={d.status} /></span>
          <span style={{ color: "#cbc3b6", textAlign: "right" }}>›</span>
        </button>
      ))}
      <Pagination page={page} totalPages={list.totalPages} total={list.total} onPage={setPage} />
    </Card>
  );
}

function ActionBtn({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", textAlign: "left", background: "#fff", border: "1px solid #e3ddd1", borderRadius: 12, padding: "12px 14px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>
      <span style={{ width: 30, height: 30, borderRadius: 9, background: "#f4f1ea", color: "#1b1714", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flex: "none" }}>{icon}</span>
      {label}
    </button>
  );
}

function BookingsTab() {
  const { data, page, setPage } = usePaged<OperatorBookingRow>(useCallback((pg) => api.operatorBookings(pg), []));
  if (!data) return <Loading />;
  return (
    <Card>
      <CardTitle right={<button style={{ background: "#fff", border: "1px solid #e3ddd1", borderRadius: 10, padding: "8px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>Export</button>}>All bookings · {data.total}</CardTitle>
      <TableHead cols={["ID", "Passenger", "Route", "Mode", "Fare", "Status"]} template=".9fr 1.1fr 1.4fr .8fr .6fr 1fr" />
      {data.items.map((b) => (
        <div key={b.id}>
          <Row template=".9fr 1.1fr 1.4fr .8fr .6fr 1fr">
            <span style={{ fontFamily: MONO, color: "#8c8378", fontSize: 12 }}>{b.id}</span>
            <span style={{ fontWeight: 700 }}>{b.passenger}</span>
            <span style={{ color: "#6b6258" }}>{b.route}</span>
            <span style={{ color: "#6b6258" }}>{b.mode}</span>
            <span style={{ fontFamily: MONO, fontWeight: 700 }}>{formatRWF(b.fare)}</span>
            <span style={{ textAlign: "right" }}><StatusPill status={b.status} /></span>
          </Row>
          {b.status === "CONFIRMED" && b.ticketsTotal > 0 && (
            <div style={{ padding: "2px 0 12px", marginTop: -1 }}>
              <TicketVerifyForm onVerify={api.verifyTicket} boarded={b.ticketsBoarded} total={b.ticketsTotal} />
            </div>
          )}
        </div>
      ))}
      <Pagination page={page} totalPages={data.totalPages} total={data.total} onPage={setPage} />
    </Card>
  );
}

function PaymentsTab() {
  const [data, setData] = useState<OperatorPayments | null>(null);
  const [page, setPage] = useState(1);
  const load = useCallback((pg: number) => { api.operatorPayments(pg).then(setData).catch(() => undefined); }, []);
  useEffect(() => { load(page); }, [page, load]);
  const withdraw = async () => {
    try {
      const r = await api.operatorWithdraw();
      window.alert(`Withdrawal of ${formatRWF(r.amount)} sent to MTN MoMo.\nRef: ${r.reference}`);
      load(page);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Withdrawal failed");
    }
  };
  if (!data) return <Loading />;
  const tx = data.transactions;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16 }} className="op-two">
      <Card>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Transactions · {tx.total}</div>
        <TableHead cols={["Txn", "Booking", "Method", "Amount", "Status"]} template="1fr .9fr 1fr .8fr 1fr" />
        {tx.items.map((p) => (
          <Row key={p.id} template="1fr .9fr 1fr .8fr 1fr">
            <span style={{ fontFamily: MONO, color: "#8c8378", fontSize: 12 }}>{p.id}</span>
            <span style={{ fontFamily: MONO, color: "#6b6258", fontSize: 12 }}>{p.booking}</span>
            <span style={{ color: "#6b6258" }}>{p.method.replace("_", " ")}</span>
            <span style={{ fontFamily: MONO, fontWeight: 700 }}>{formatRWF(p.amount)}</span>
            <span style={{ textAlign: "right" }}><StatusPill status={p.status} /></span>
          </Row>
        ))}
        <Pagination page={page} totalPages={tx.totalPages} total={tx.total} onPage={setPage} />
      </Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ background: "#1b1714", borderRadius: 18, padding: 20, color: "#fff" }}>
          <div style={{ fontSize: 12.5, color: "#cfc7bb", fontWeight: 600 }}>Next payout · Friday</div>
          <div style={{ fontFamily: MONO, fontSize: 30, fontWeight: 700, margin: "4px 0 2px" }}>{formatRWF(data.payout.nextPayout)}</div>
          <div style={{ fontSize: 11.5, color: "#9a9186" }}>to MTN MoMo · ••• 0042</div>
          <button onClick={withdraw} style={{ width: "100%", marginTop: 16, background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 12, padding: 12, fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>Withdraw now</button>
        </div>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", fontSize: 13 }}><span style={{ color: "#8c8378" }}>Gross today</span><span style={{ fontFamily: MONO, fontWeight: 700 }}>{formatRWF(data.payout.grossToday)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", fontSize: 13, borderTop: "1px solid #f1ece2" }}><span style={{ color: "#8c8378" }}>Relay fee (12%)</span><span style={{ fontFamily: MONO, fontWeight: 700 }}>-{formatRWF(data.payout.fee)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "11px 0", fontSize: 14, fontWeight: 800, borderTop: "1px solid #f1ece2" }}><span>Net</span><span style={{ fontFamily: MONO, color: "#1f9d6b" }}>{formatRWF(data.payout.net)}</span></div>
        </Card>
      </div>
    </div>
  );
}

/* helpers */
function Loading() {
  return <div style={{ padding: 40, textAlign: "center", color: "#a39a8d", fontWeight: 600 }}>Loading…</div>;
}
function TableHead({ cols, template }: { cols: string[]; template: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: template, fontSize: 11, fontWeight: 700, color: "#a39a8d", textTransform: "uppercase", letterSpacing: ".04em", padding: "0 0 10px", borderBottom: "1px solid #f1ece2" }}>
      {cols.map((c, i) => <span key={i} style={{ textAlign: i === cols.length - 1 ? "right" : "left" }}>{c}</span>)}
    </div>
  );
}
function Row({ children, template }: { children: React.ReactNode; template: string }) {
  return <div style={{ display: "grid", gridTemplateColumns: template, alignItems: "center", padding: "12px 0", borderBottom: "1px solid #f6f2ea", fontSize: 13 }}>{children}</div>;
}
function MiniStat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #ece6db", borderRadius: 14, padding: 14, textAlign: "center" }}>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 22, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: "#8c8378", fontWeight: 600 }}>{label}</div>
    </div>
  );
}
function MgTile({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div style={{ background: "#faf8f4", borderRadius: 12, padding: 13, textAlign: "center" }}>
      <div style={{ fontFamily: MONO, fontSize: 18, fontWeight: 700, color: color ?? "#1b1714" }}>{value}</div>
      <div style={{ fontSize: 11, color: "#8c8378", fontWeight: 600 }}>{label}</div>
    </div>
  );
}
function OperatorMap() {
  return (
    <svg viewBox="0 0 800 560" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <defs>
        <pattern id="opmapgrid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#000" strokeOpacity="0.025" strokeWidth="1" /></pattern>
      </defs>
      <rect width="800" height="560" fill="#eef0e9" />
      <rect width="800" height="560" fill="url(#opmapgrid)" />
      <path d="M70 360 q40 -70 130 -54 q60 30 24 96 q-50 70 -130 30 q-44 -28 -24 -72 Z" fill="#d6e6cf" />
      <rect x="560" y="70" width="150" height="110" rx="18" fill="#d6e6cf" />
      <circle cx="300" cy="120" r="46" fill="#d6e6cf" />
      <path d="M-20 150 C 160 110, 230 250, 420 240 S 700 330, 840 300 L 840 360 C 690 392, 540 300, 410 312 S 150 200, -20 240 Z" fill="#cfe0ec" />
      <g stroke="#ffffff" strokeWidth="11" fill="none" strokeLinecap="round">
        <path d="M40 250 C 220 210, 360 300, 540 270 S 760 210, 820 230" />
        <path d="M120 40 C 150 200, 90 360, 180 540" />
        <path d="M520 20 C 560 180, 470 360, 560 540" />
      </g>
      <path d="M150 170 C 260 210, 320 360, 470 320" fill="none" stroke="#2f6bff" strokeWidth="4" strokeLinecap="round" strokeDasharray="1 9" />
      <path d="M330 300 C 430 330, 520 420, 560 350" fill="none" stroke="#ff6a1a" strokeWidth="4" strokeLinecap="round" strokeDasharray="1 9" />
      <circle cx="240" cy="250" r="9" fill="#2f6bff" stroke="#fff" strokeWidth="3" />
      <circle cx="470" cy="300" r="9" fill="#ff6a1a" stroke="#fff" strokeWidth="3" />
      <circle cx="560" cy="360" r="9" fill="#1f9d6b" stroke="#fff" strokeWidth="3" />
    </svg>
  );
}
