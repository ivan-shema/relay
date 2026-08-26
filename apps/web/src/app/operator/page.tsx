"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api,
  ApiError,
  type OperatorOverview,
  type OperatorVehicle,
  type OperatorRoute,
  type OperatorScheduleRow,
  type OperatorDriverRow,
  type OperatorDriverDetail,
  type OperatorDriverTrip,
  type PlatformFees,
  type OperatorBookingRow,
  type OperatorPayments,
  type OperatorReports,
  type ScheduleLookups,
  type UserSuggestion,
  type DriverInviteRow,
  type OperatorMotoHails,
  type OperatorMotoHail,
} from "@/lib/api";
import {
  formatRWF,
  createVehicleSchema,
  createRouteSchema,
  createDepartureSchema,
  assignVehicleSchema,
  assignTripSchema,
  assignDepartureSchema,
  assignDriverSchema,
  type CreateVehicleInput,
  type CreateRouteInput,
  type CreateDepartureInput,
  type AssignDepartureInput,
} from "@relay/shared";
import { useAuth } from "@/lib/auth-context";
import { ConsoleShell, ProfileSettingsPage, KpiGrid, StatusPill, Card, CardTitle, ProgressBar, AccentButton, PrimaryButton, FormModal, Pagination, usePaged, TicketVerifyForm, BarChart, type NavItem } from "@/components/console";
import { PeriodPicker, ExportButtons, StatTile, ReportTable, downloadAuthed, exportReportPdf, rangeQuery, isRangeReady, fmtMoney, type ReportRangeValue } from "@/components/reports";
import { NotificationBell } from "@/components/notification-bell";
import { Avatar } from "@/components/avatar";

const MONO = "'JetBrains Mono', monospace";

const NAV: NavItem[] = [
  { key: "overview", label: "Overview", icon: "▦" },
  { key: "live", label: "Live map", icon: "◉" },
  { key: "fleet", label: "Vehicles", icon: "▤" },
  { key: "routes", label: "Routes", icon: "⋔" },
  { key: "schedule", label: "Schedule", icon: "◷" },
  { key: "drivers", label: "Drivers", icon: "☻" },
  { key: "moto", label: "Moto hails", icon: "⚡" },
  { key: "bookings", label: "Bookings", icon: "≡" },
  { key: "payments", label: "Payments", icon: "◈" },
  { key: "reports", label: "Reports", icon: "▧" },
];

const TITLES: Record<string, string> = {
  overview: "Overview",
  live: "Live map",
  fleet: "Fleet",
  routes: "Routes",
  schedule: "Schedule",
  drivers: "Drivers",
  moto: "Moto hails",
  bookings: "Bookings",
  payments: "Payments & payouts",
  reports: "Reports & analytics",
};

export default function OperatorConsole() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState("overview");
  const [company, setCompany] = useState("Operator");
  const [status, setStatus] = useState<string | null>(null);
  const [modes, setModes] = useState<string[]>([]);
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  const checkStatus = useCallback(() => {
    api
      .operatorMe()
      .then((o) => {
        setCompany(o.companyName);
        setStatus(o.status);
        setModes(o.modes);
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
        nav={modes.includes("MOTO") ? NAV : NAV.filter((n) => n.key !== "moto")}
        active={profileOpen ? "" : tab}
        onNav={(k) => { setProfileOpen(false); setTab(k); setSelectedDriver(null); }}
        onOpenProfile={() => setProfileOpen(true)}
        title={profileOpen ? "Profile & settings" : TITLES[tab]}
        subtitle={profileOpen ? "Your account" : `${company} · live`}
        actions={profileOpen ? undefined : <>
          {tab !== "reports" && <PrimaryButton onClick={() => { setProfileOpen(false); setSelectedDriver(null); setTab("reports"); }}>Reports</PrimaryButton>}
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
            {tab === "moto" && <MotoHailsTab />}
            {tab === "bookings" && <BookingsTab />}
            {tab === "payments" && <PaymentsTab />}
            {tab === "reports" && <ReportsTab />}
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
  const [assignFor, setAssignFor] = useState<OperatorVehicle | null>(null);
  const [lookups, setLookups] = useState<ScheduleLookups>({ vehicles: [], drivers: [] });
  const loadLookups = useCallback(() => { api.operatorScheduleLookups().then(setLookups).catch(() => undefined); }, []);
  useEffect(() => { loadLookups(); }, [loadLookups]);
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
            { name: "capacity", label: "Capacity", type: "number", defaultValue: "33", lockedValue: (v) => (v.type === "MOTO" || v.mode === "MOTO" ? "1" : undefined) },
            { name: "model", label: "Model", placeholder: "Coaster HD" },
          ]}
          onSubmit={async (v) => { const d = v as CreateVehicleInput; await api.operatorAddVehicle({ plateNumber: d.plateNumber, type: d.type, capacity: d.capacity, model: d.model }); reloadFirst(); }}
          onClose={() => setModal(false)}
        />
      )}
      {assignFor && (
        <FormModal
          title={`Driver for ${assignFor.plate}`}
          submitLabel="Save assignment"
          schema={assignDriverSchema}
          defaultValues={{ driverId: assignFor.driverId ?? "" }}
          fields={[{ name: "driverId", label: "Driver", type: "select", options: [{ value: "", label: "— Unassigned —" }, ...lookups.drivers.map(({ value, label }) => ({ value, label }))] }]}
          onSubmit={async (v) => { await api.operatorAssignDriverToVehicle(assignFor.id, (v.driverId as string) || null); reloadFirst(); loadLookups(); }}
          onClose={() => setAssignFor(null)}
        />
      )}
      <CardTitle right={<AccentButton onClick={() => setModal(true)}>+ Add vehicle</AccentButton>}>Fleet · {data.total} vehicles</CardTitle>
      <TableHead cols={["Plate", "Type", "Model", "Cap", "Driver", "Util", "Status", ""]} template="1.1fr .7fr 1.2fr .5fr 1fr .6fr .9fr .7fr" />
      {data.items.map((v) => (
        <Row key={v.id} template="1.1fr .7fr 1.2fr .5fr 1fr .6fr .9fr .7fr">
          <span style={{ fontFamily: MONO, fontWeight: 700 }}>{v.plate}</span>
          <span style={{ color: "#6b6258" }}>{v.type}</span>
          <span style={{ color: "#6b6258" }}>{v.model}</span>
          <span style={{ fontFamily: MONO, color: "#8c8378" }}>{v.capacity}</span>
          <span style={{ fontWeight: 600 }}>{v.driver}</span>
          <span style={{ fontFamily: MONO, color: "#8c8378" }}>{v.util}</span>
          <span style={{ textAlign: "right" }}><StatusPill status={v.status} /></span>
          <span style={{ textAlign: "right" }}>
            <button onClick={() => setAssignFor(v)} style={{ background: v.driverId ? "#fff" : "#ff6a1a", color: v.driverId ? "#1b1714" : "#fff", border: v.driverId ? "1px solid #e3ddd1" : "none", borderRadius: 9, padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>{v.driverId ? "Change" : "Assign"}</button>
          </span>
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
  const [assignFor, setAssignFor] = useState<OperatorScheduleRow | null>(null);
  const [routes, setRoutes] = useState<{ value: string; label: string }[]>([]);
  const [lookups, setLookups] = useState<ScheduleLookups>({ vehicles: [], drivers: [] });
  const loadLookups = useCallback(() => {
    api.operatorScheduleLookups().then(setLookups).catch(() => undefined);
  }, []);
  useEffect(() => {
    api.operatorRouteLookup().then(setRoutes).catch(() => undefined);
    loadLookups();
  }, [loadLookups]);

  // Pickers only offer what can actually run the departure: vehicles of the
  // same mode, and drivers who are either free or already on a matching vehicle.
  const NONE = { value: "", label: "— not assigned yet —" };
  // Relay's cut of each fare — shown next to the price so there's no surprise
  // at payout time.
  const [fees, setFees] = useState<PlatformFees | null>(null);
  useEffect(() => { api.operatorFees().then(setFees).catch(() => undefined); }, []);
  const fareHint = (v: Record<string, unknown>) => {
    const fare = Number(v.fare);
    if (!fees || !Number.isFinite(fare) || fare <= 0) return fees ? `Relay keeps ${fees.bookingCommissionPct}% of every fare paid; the rest is yours to withdraw.` : null;
    const pct = fees.bookingCommissionPct;
    const cut = Math.round((fare * pct) / 100);
    return <>Passengers pay <b>{formatRWF(fare)}</b> per seat · Relay keeps {pct}% ({formatRWF(cut)}) · you receive <b style={{ color: "#1f9d6b" }}>{formatRWF(fare - cut)}</b> per seat.</>;
  };
  const vehiclesFor = (mode: unknown) => [NONE, ...lookups.vehicles.filter((v) => v.type === mode).map(({ value, label }) => ({ value, label }))];
  const driversFor = (mode: unknown) => [NONE, ...lookups.drivers.filter((d) => !d.vehicleType || d.vehicleType === mode).map(({ value, label }) => ({ value, label }))];

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
            { name: "fare", label: "Fare (RWF) — what the passenger pays", type: "number", defaultValue: "800", hint: fareHint },
            { name: "departInMinutes", label: "Departs in (min)", type: "number", defaultValue: "30" },
            { name: "durationMinutes", label: "Duration (min)", type: "number", defaultValue: "30" },
            { name: "capacity", label: "Capacity", type: "number", defaultValue: "33", lockedValue: (v) => (v.mode === "MOTO" ? "1" : undefined) },
            { name: "vehicleId", label: "Vehicle", type: "select", optionsFor: (v) => vehiclesFor(v.mode) },
            { name: "driverId", label: "Driver", type: "select", optionsFor: (v) => driversFor(v.mode) },
          ]}
          onSubmit={async (v) => {
            const d = v as CreateDepartureInput;
            await api.operatorAddDeparture({ routeId: d.routeId, mode: d.mode, fare: d.fare, departInMinutes: d.departInMinutes, durationMinutes: d.durationMinutes, capacity: d.capacity, vehicleId: d.vehicleId || undefined, driverId: d.driverId || undefined });
            reloadFirst();
            loadLookups();
          }}
          onClose={() => setModal(false)}
        />
      )}
      {assignFor && (
        <FormModal
          title={`Assign · ${assignFor.time} ${assignFor.route}`}
          submitLabel="Save assignment"
          schema={assignDepartureSchema}
          defaultValues={{ vehicleId: assignFor.vehicleId ?? "", driverId: assignFor.driverId ?? "" }}
          fields={[
            { name: "vehicleId", label: `Vehicle (${assignFor.mode.toLowerCase()})`, type: "select", options: vehiclesFor(assignFor.mode) },
            { name: "driverId", label: "Driver", type: "select", options: driversFor(assignFor.mode) },
          ]}
          onSubmit={async (v) => {
            const d = v as AssignDepartureInput;
            await api.operatorAssignDeparture(assignFor.id, { vehicleId: d.vehicleId ?? "", driverId: d.driverId ?? "" });
            reloadFirst();
            loadLookups();
          }}
          onClose={() => setAssignFor(null)}
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
      <TableHead cols={["Time", "Route", "Vehicle", "Driver", "Seats booked", "Status", ""]} template=".6fr 1.6fr .8fr .9fr 1fr .8fr .6fr" />
      {data.items.map((t) => {
        const assignable = t.status === "SCHEDULED" || t.status === "BOARDING";
        const unassigned = !t.vehicleId || !t.driverId;
        return (
          <Row key={t.id} template=".6fr 1.6fr .8fr .9fr 1fr .8fr .6fr">
            <span style={{ fontFamily: MONO, fontWeight: 700 }}>{t.time}</span>
            <span style={{ fontWeight: 600 }}>{t.route}<span style={{ display: "block", fontSize: 11, color: "#8c8378", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" }}>{t.mode}</span></span>
            <span style={{ fontFamily: MONO, color: t.vehicleId ? "#1b1714" : "#c2553f", fontSize: 12 }}>{t.vehicle}</span>
            <span style={{ color: t.driverId ? "#6b6258" : "#c2553f" }}>{t.driver}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ flex: 1, maxWidth: 70 }}><ProgressBar pct={(t.booked / Math.max(1, t.capacity)) * 100} /></span>
              <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700 }}>{t.booked}/{t.capacity}</span>
            </span>
            <span style={{ textAlign: "right" }}><StatusPill status={t.status} /></span>
            <span style={{ textAlign: "right" }}>
              {assignable && (
                <button onClick={() => setAssignFor(t)} style={{ background: unassigned ? "#ff6a1a" : "#fff", color: unassigned ? "#fff" : "#1b1714", border: unassigned ? "none" : "1px solid #e3ddd1", borderRadius: 9, padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>
                  {unassigned ? "Assign" : "Change"}
                </button>
              )}
            </span>
          </Row>
        );
      })}
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
  // Shown once after sending an invitation.
  const [sent, setSent] = useState<{ registered: boolean; email: string } | null>(null);
  const [inviteTick, setInviteTick] = useState(0);
  const [assignFor, setAssignFor] = useState<OperatorDriverRow | null>(null);
  const [fleet, setFleet] = useState<ScheduleLookups>({ vehicles: [], drivers: [] });
  const loadFleet = useCallback(() => { api.operatorScheduleLookups().then(setFleet).catch(() => undefined); }, []);
  useEffect(() => { loadFleet(); }, [loadFleet]);
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
      {inviteModal && <InviteDriverModal onClose={() => setInviteModal(false)} onSent={(r) => { setSent(r); setInviteTick((t) => t + 1); }} />}
      {assignFor && (
        <FormModal
          title={`Vehicle for ${assignFor.name}`}
          submitLabel="Save assignment"
          schema={assignVehicleSchema}
          defaultValues={{ vehicleId: assignFor.vehicleId ?? "" }}
          fields={[{ name: "vehicleId", label: "Vehicle", type: "select", options: [{ value: "", label: "— Unassigned —" }, ...fleet.vehicles.map((v) => ({ value: v.value, label: v.driverId && v.driverId !== assignFor.id ? `${v.label} (assigned)` : v.label }))] }]}
          onSubmit={async (v) => { await api.operatorAssignVehicle(assignFor.id, (v.vehicleId as string) || null); reload(); loadFleet(); }}
          onClose={() => setAssignFor(null)}
        />
      )}
      {sent && (
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "#e7f6ee", border: "1px solid #bfe6d1", borderRadius: 14, padding: "12px 14px", marginBottom: 14, fontSize: 13 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700 }}>Invitation sent to <span style={{ fontFamily: MONO }}>{sent.email}</span></div>
            <div style={{ fontSize: 12, color: "#8c8378", marginTop: 3 }}>{sent.registered ? "They've been notified in the app and by email. Once they submit their licence and ID, review them below." : "They'll get an email with a link to register. Once they submit their licence and ID, review them below."}</div>
          </div>
          <button onClick={() => setSent(null)} style={{ background: "none", border: "none", color: "#8c8378", fontSize: 16, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
      )}
      <DriverInvitesCard refreshKey={inviteTick} onApproved={reloadFirst} />
      <CardTitle right={<AccentButton onClick={() => setInviteModal(true)}>+ Invite driver</AccentButton>}>Drivers · {list.total}</CardTitle>
      <TableHead cols={["Driver", "Vehicle", "Trips", "Rating", "Revenue", "Status", "", ""]} template="1.2fr 1.4fr .6fr .6fr .8fr .9fr .7fr 24px" />
      {list.items.map((d) => (
        <button key={d.id} onClick={() => onSelect(d.id)} style={{ display: "grid", gridTemplateColumns: "1.2fr 1.4fr .6fr .6fr .8fr .9fr .7fr 24px", alignItems: "center", padding: "13px 0", border: "none", borderBottom: "1px solid #f6f2ea", fontSize: 13, width: "100%", textAlign: "left", background: "none", cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 700 }}>
            <span style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,#ff8a3d,#e0560c)", flex: "none" }} />{d.name}
          </span>
          <span style={{ color: "#6b6258" }}>{d.vehicle}</span>
          <span style={{ fontFamily: MONO, color: "#8c8378" }}>{d.trips}</span>
          <span style={{ fontFamily: MONO, fontWeight: 700 }}>{d.rating.toFixed(1)}★</span>
          <span style={{ fontFamily: MONO, fontWeight: 700, color: "#1f9d6b" }}>{formatRWF(d.revenue)}</span>
          <span><StatusPill status={d.status} /></span>
          <span style={{ textAlign: "right" }} onClick={(e) => { e.stopPropagation(); setAssignFor(d); }}>
            <span role="button" style={{ display: "inline-block", background: d.vehicleId ? "#fff" : "#ff6a1a", color: d.vehicleId ? "#1b1714" : "#fff", border: d.vehicleId ? "1px solid #e3ddd1" : "none", borderRadius: 9, padding: "7px 12px", fontSize: 12, fontWeight: 700 }}>{d.vehicleId ? "Change" : "Assign"}</span>
          </span>
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
  // Reference of a withdrawal still processing at Paypack
  const [pendingPayout, setPendingPayout] = useState<string | null>(null);

  // Primary signal: SSE push when the Paypack webhook settles the cashout.
  // Backup: a slow status poll (which checks the local record first and only
  // asks Paypack — updating the local record — when the webhook hasn't landed).
  useEffect(() => {
    if (!pendingPayout) return;
    let done = false;

    const finish = (status: "COMPLETED" | "FAILED") => {
      if (done) return;
      done = true;
      setPendingPayout(null);
      if (status === "FAILED") {
        window.alert(`Withdrawal ${pendingPayout} failed — the amount is available to withdraw again.`);
      }
      load(page);
    };

    const stream = new EventSource(api.streamUrl());
    stream.addEventListener("payout", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as { reference: string; status: string };
        if (d.reference === pendingPayout && (d.status === "COMPLETED" || d.status === "FAILED")) finish(d.status);
      } catch { /* malformed push — the poll will catch up */ }
    });

    const startedAt = Date.now();
    const timer = setInterval(async () => {
      try {
        const s = await api.operatorPayoutStatus(pendingPayout);
        if (done) return;
        if (s.status === "COMPLETED" || s.status === "FAILED") finish(s.status);
        else if (Date.now() - startedAt > 180_000) { done = true; setPendingPayout(null); }
      } catch { /* transient — keep polling */ }
    }, 10_000);

    return () => { done = true; stream.close(); clearInterval(timer); };
  }, [pendingPayout, load, page]);

  const withdraw = async () => {
    try {
      const r = await api.operatorWithdraw();
      if (r.status === "PENDING") {
        window.alert(`Withdrawal of ${formatRWF(r.amount)} is on its way to your mobile money account.\nRef: ${r.reference}`);
        setPendingPayout(r.reference);
      } else {
        window.alert(`Withdrawal of ${formatRWF(r.amount)} sent to mobile money.\nRef: ${r.reference}`);
      }
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
          <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", fontSize: 13, borderTop: "1px solid #f1ece2" }}><span style={{ color: "#8c8378" }}>Relay fee ({data.payout.feePct}%)</span><span style={{ fontFamily: MONO, fontWeight: 700 }}>-{formatRWF(data.payout.fee)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", fontSize: 13, borderTop: "1px solid #f1ece2" }}><span style={{ color: "#8c8378" }}>Moto hails today ({data.payout.motoRidesToday}, net of commission)</span><span style={{ fontFamily: MONO, fontWeight: 700 }}>+{formatRWF(data.payout.motoNetToday)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "11px 0", fontSize: 14, fontWeight: 800, borderTop: "1px solid #f1ece2" }}><span>Net</span><span style={{ fontFamily: MONO, color: "#1f9d6b" }}>{formatRWF(data.payout.net)}</span></div>
        </Card>
      </div>
    </div>
  );
}

/* helpers */
// Company reports for one time window: revenue and Relay's fee, bookings and
// cancellations, occupancy of the trips that ran, route and driver
// performance — exportable as CSV (every booking) or PDF (this summary).
function ReportsTab() {
  const [range, setRange] = useState<ReportRangeValue>({ period: "month" });
  const [data, setData] = useState<OperatorReports | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const q = rangeQuery(range);

  useEffect(() => {
    if (!isRangeReady(range)) return;
    let active = true;
    setData(null);
    setError(null);
    api.operatorReports(q).then((d) => active && setData(d)).catch((e) => active && setError(e instanceof Error ? e.message : "Could not load the report"));
    return () => { active = false; };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = (v: number) => Math.round(v).toLocaleString("en-US");
  const exportCsv = async () => {
    setBusy(true);
    try { await downloadAuthed(api.operatorReportExportUrl(q), "bookings.csv"); }
    catch (e) { window.alert(e instanceof Error ? e.message : "Export failed"); }
    finally { setBusy(false); }
  };
  const exportPdf = async () => {
    if (!data) return;
    setBusy(true);
    try {
      await exportReportPdf({
        title: "Operator report",
        subtitle: data.label,
        fileName: `operator-report_${data.from.slice(0, 10)}.pdf`,
        kpis: [
          { label: "Revenue (gross)", value: fmtMoney(data.kpis.revenue) },
          { label: "Net to you", value: fmtMoney(data.kpis.net) },
          { label: "Moto hails (gross)", value: `${fmtMoney(data.kpis.motoRevenue)} · ${data.kpis.motoRides} rides` },
          { label: "Bookings", value: `${data.kpis.bookings} (${data.kpis.cancelled} cancelled)` },
          { label: "Occupancy", value: `${data.kpis.occupancyPct}%` },
        ],
        sections: [
          { title: "Revenue by period", columns: ["Period", "Revenue (RWF)"], rows: data.revenueBars.map((b) => [b.m, n(b.value)]), align: ["l", "r"] },
          { title: "Route performance", columns: ["Route", "Trips", "Bookings", "Seats", "Occupancy", "Revenue (RWF)"], rows: data.byRoute.map((r) => [r.route, r.trips, r.bookings, r.seats, `${r.occupancyPct}%`, n(r.revenue)]), align: ["l", "r", "r", "r", "r", "r"] },
          { title: "Driver performance", columns: ["Driver", "Bookings", "Completed", "Revenue (RWF)", "Rating"], rows: data.byDriver.map((d) => [d.driver, d.bookings, d.completed, n(d.revenue), d.rating ?? "—"]), align: ["l", "r", "r", "r", "r"] },
          { title: "By transport mode", columns: ["Mode", "Bookings", "Revenue (RWF)", "Share"], rows: data.byMode.map((m) => [m.label, m.bookings, n(m.revenue), `${m.pct}%`]), align: ["l", "r", "r", "r"] },
        ],
      });
    } catch (e) { window.alert(e instanceof Error ? e.message : "PDF export failed"); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <PeriodPicker value={range} onChange={setRange} />
        <ExportButtons onCsv={exportCsv} onPdf={exportPdf} busy={busy || !data} />
      </div>
      {error && <div style={{ background: "#fbeae6", border: "1px solid #f0d4cc", color: "#c2553f", borderRadius: 12, padding: "11px 14px", fontSize: 13, fontWeight: 600, marginBottom: 14 }}>{error}</div>}
      {!data ? (!error && <Loading />) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
            <StatTile label="Revenue (gross)" value={formatRWF(data.kpis.revenue)} sub={`${data.kpis.paidBookings} paid bookings · avg ${formatRWF(data.kpis.avgFare)}`} />
            <StatTile label="Net to you" value={formatRWF(data.kpis.net)} sub={`${data.kpis.platformFeePct}% fee ${formatRWF(data.kpis.platformFee)}${data.kpis.motoCommission ? ` · moto commission ${formatRWF(data.kpis.motoCommission)}` : ""}`} accent="#1f9d6b" />
            <StatTile label="Moto hails" value={formatRWF(data.kpis.motoRevenue)} sub={`${data.kpis.motoRides} rides · gross, by your motos`} />
            <StatTile label="Bookings" value={String(data.kpis.bookings)} sub={`${data.kpis.cancelled} cancelled (${data.kpis.cancelRate}%)`} />
            <StatTile label="Occupancy" value={`${data.kpis.occupancyPct}%`} sub={`${data.kpis.seatsSold} of ${data.kpis.capacity} seats · ${data.kpis.tripsRun} trips ran`} />
            <StatTile label="Passenger rating" value={data.kpis.avgRating !== null ? `★ ${data.kpis.avgRating.toFixed(1)}` : "—"} sub={`${data.kpis.ratingsCount} ratings`} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: 16, marginBottom: 16 }} className="op-two">
            <Card>
              <CardTitle right={<span style={{ fontSize: 12, color: "#8c8378", fontWeight: 700 }}>{data.label}</span>}>Revenue</CardTitle>
              <BarChart bars={data.revenueBars} height={150} />
            </Card>
            <Card>
              <CardTitle>By transport mode</CardTitle>
              <ReportTable columns={["Mode", "Bookings", "Revenue", "Share"]} align={["l", "r", "r", "r"]}
                rows={data.byMode.map((m) => [m.label, m.bookings, formatRWF(m.revenue), `${m.pct}%`])} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14, paddingTop: 12, borderTop: "1px solid #f1ece2" }}>
                {data.byStatus.map((s) => (
                  <span key={s.status} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <StatusPill status={s.status} /><span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 700 }}>{s.count}</span>
                  </span>
                ))}
              </div>
            </Card>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }} className="op-two">
            <Card>
              <CardTitle>Route performance</CardTitle>
              <ReportTable columns={["Route", "Trips", "Bookings", "Occupancy", "Revenue"]} align={["l", "r", "r", "l", "r"]}
                rows={data.byRoute.map((r) => [
                  r.route, r.trips, r.bookings,
                  <span key="occ" style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 110 }}><span style={{ flex: 1 }}><ProgressBar pct={r.occupancyPct} /></span><span style={{ fontFamily: MONO, fontSize: 12 }}>{r.occupancyPct}%</span></span>,
                  formatRWF(r.revenue),
                ])} />
            </Card>
            <Card>
              <CardTitle>Driver performance</CardTitle>
              <ReportTable columns={["Driver", "Bookings", "Done", "Revenue", "Rating"]} align={["l", "r", "r", "r", "r"]}
                rows={data.byDriver.map((d) => [d.driver, d.bookings, d.completed, formatRWF(d.revenue), d.rating !== null ? `★ ${d.rating.toFixed(1)}` : "—"])} />
            </Card>
          </div>
        </>
      )}
    </>
  );
}

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




// Dispatch board for operators that offer MOTO. The operator handles each
// hail: pick one of its free motos and accept at the passenger's price or send
// a quote on that driver's behalf; withdraw an unpaid acceptance; hand a paid
// ride to another driver. Drivers themselves only see their assigned ride.
function MotoHailsTab() {
  const [data, setData] = useState<OperatorMotoHails | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [quoteFor, setQuoteFor] = useState<string | null>(null);
  const [quoteAmount, setQuoteAmount] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    api.operatorMotoHails().then(setData).catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  if (!data) return <Loading />;
  if (!data.enabled) {
    return (
      <Card>
        <CardTitle>Moto hails</CardTitle>
        <div style={{ padding: "14px 0", fontSize: 13.5, color: "#8c8378", fontWeight: 600 }}>Your company is not registered for moto-taxi service, so passengers&apos; hails are not routed to you.</div>
      </Card>
    );
  }

  const free = data.drivers.filter((d) => d.available);
  // What lands with the operator once the passenger confirms: fare minus Relay's cut.
  const netOf = (fare: number) => fare - Math.round((fare * data.commissionPct) / 100);
  // Default driver for a hail: the moto the passenger asked for (if free), else the first free one.
  const chosen = (h: OperatorMotoHail) => pick[h.id] ?? (h.requested && free.some((d) => d.id === h.requested!.id) ? h.requested.id : free[0]?.id) ?? "";
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
  const fmtAgo = (iso: string) => {
    const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    return m < 1 ? "just now" : `${m} min ago`;
  };
  const fmtHm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const btn = (bg: string, color = "#fff", border = "none"): React.CSSProperties => ({ background: bg, color, border, borderRadius: 9, padding: "8px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif", flex: "none" });
  const select = (h: OperatorMotoHail | { id: string }, exclude?: string | null) => {
    const opts = free.filter((d) => d.id !== exclude);
    return (
      <select value={pick[h.id] ?? ("requested" in h ? chosen(h) : opts[0]?.id ?? "")} onChange={(e) => setPick((p) => ({ ...p, [h.id]: e.target.value }))} disabled={opts.length === 0} style={{ flex: 1, minWidth: 150, border: "1px solid #e3ddd1", borderRadius: 9, padding: "7px 9px", fontSize: 12.5, fontWeight: 600, fontFamily: "'Manrope', sans-serif", background: "#fff" }}>
        {opts.length === 0 ? <option value="">No free moto online</option> : opts.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.plate}</option>)}
      </select>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Card>
        <CardTitle>Moto fleet · {data.drivers.filter((d) => d.online).length} online of {data.drivers.length}</CardTitle>
        {data.drivers.length === 0 ? (
          <div style={{ padding: "12px 0", fontSize: 13.5, color: "#8c8378", fontWeight: 600 }}>No driver has a moto assigned yet — assign a MOTO vehicle from the Drivers tab.</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, paddingTop: 6 }}>
            {data.drivers.map((d) => {
              const tone = d.suspended ? { c: "#c2553f", b: "#fbeae6", t: "Suspended" } : !d.online ? { c: "#8c8378", b: "#f1ede4", t: "Offline" } : d.busy ? { c: "#2f6bff", b: "#e9f0ff", t: "On a ride" } : { c: "#1f9d6b", b: "#e7f6ee", t: "Available" };
              return (
                <div key={d.id} style={{ border: "1px solid #e9e3d8", borderRadius: 13, padding: "10px 13px", minWidth: 180, display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: tone.c, flex: "none" }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                    <span style={{ display: "block", fontSize: 11.5, fontFamily: MONO, color: "#8c8378" }}>{d.plate}</span>
                  </span>
                  <span style={{ fontSize: 10.5, fontWeight: 800, color: tone.c, background: tone.b, borderRadius: 7, padding: "3px 8px", textTransform: "uppercase" }}>{tone.t}</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>Open hails · {data.open.length}</CardTitle>
        {data.open.length === 0 ? (
          <div style={{ padding: "12px 0", fontSize: 13.5, color: "#8c8378", fontWeight: 600 }}>No passenger is hailing a moto right now — new requests appear here automatically.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 6 }}>
            {data.open.map((h) => {
              const driverId = chosen(h);
              return (
                <div key={h.id} style={{ border: `1px solid ${h.requested ? "#ffd9c2" : "#ece6db"}`, background: h.requested ? "#fff6f0" : "#fff", borderRadius: 14, padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                        {h.from} → {h.to}
                        {h.requested && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: "#ff6a1a", background: "#fff0e6", borderRadius: 20, padding: "2px 8px", textTransform: "uppercase" }}>asked for {h.requested.name.split(" ")[0]}</span>}
                        {h.prepaid && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: "#1f9d6b", background: "#e7f6ee", borderRadius: 20, padding: "2px 8px", textTransform: "uppercase" }}>prepaid</span>}
                      </div>
                      <div style={{ fontSize: 11.5, color: "#8c8378", fontWeight: 600, marginTop: 2 }}>
                        {h.passenger} · {fmtAgo(h.requestedAt)}{h.departAt && <> · leave {fmtHm(h.departAt)}</>}
                        {h.fare !== null
                          ? <> · {h.prepaid ? "pays" : "offers"} <span style={{ fontFamily: MONO, color: h.prepaid ? "#1f9d6b" : "#ff6a1a", fontWeight: 700 }}>{formatRWF(h.fare)}</span> <span title={`Relay keeps ${data.commissionPct}% of the fare`}>(you receive {formatRWF(netOf(h.fare))})</span></>
                          : <> · <span style={{ color: "#ff6a1a", fontWeight: 700 }}>no price — send a quote</span></>}
                        {h.offers.length > 0 && <> · quoted: {h.offers.map((o) => `${o.driverName.split(" ")[0]} ${formatRWF(o.amount)}`).join(", ")}</>}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
                      {select(h)}
                      {h.fare !== null && (
                        <button disabled={!driverId || busyId === h.id} onClick={() => run(h.id, () => api.operatorAcceptMotoHail(h.id, driverId))} style={{ ...btn("#ff6a1a"), opacity: driverId ? 1 : 0.5 }}>
                          {busyId === h.id ? "…" : `Accept ${formatRWF(h.fare)}`}
                        </button>
                      )}
                      {!h.prepaid && (
                        <button disabled={!driverId} onClick={() => { setQuoteFor(quoteFor === h.id ? null : h.id); setQuoteAmount(""); }} style={{ ...btn("#fff", "#1b1714", "1px solid #e3ddd1"), opacity: driverId ? 1 : 0.5 }}>
                          {h.fare !== null ? "Counter" : "Quote price"}
                        </button>
                      )}
                    </div>
                  </div>
                  {quoteFor === h.id && (
                    <div style={{ display: "flex", gap: 8, marginTop: 10, paddingTop: 10, borderTop: "1px solid #f1ece2" }}>
                      <input value={quoteAmount} onChange={(e) => setQuoteAmount(e.target.value.replace(/[^0-9]/g, ""))} placeholder="Price (RWF)" inputMode="numeric" style={{ flex: 1, border: "1px solid #e3ddd1", borderRadius: 10, padding: "9px 12px", fontSize: 12.5, fontWeight: 700, fontFamily: MONO, outline: "none" }} />
                      <button disabled={busyId === h.id || !quoteAmount || !driverId} onClick={() => run(h.id, async () => { await api.operatorQuoteMotoHail(h.id, driverId, Number(quoteAmount)); setQuoteFor(null); setQuoteAmount(""); })} style={btn("#1b1714")}>
                        {busyId === h.id ? "…" : "Send quote"}
                      </button>
                    </div>
                  )}
                  {quoteFor === h.id && (
                    <div style={{ fontSize: 11.5, color: "#8c8378", fontWeight: 600, marginTop: 6 }}>
                      {quoteAmount
                        ? <>The passenger pays <b>{formatRWF(Number(quoteAmount))}</b> · Relay keeps {data.commissionPct}% · you receive <b style={{ color: "#1f9d6b" }}>{formatRWF(netOf(Number(quoteAmount)))}</b>.</>
                        : <>Quote what the passenger pays — Relay keeps {data.commissionPct}% of it.</>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>Rides in progress · {data.active.length}</CardTitle>
        {data.active.length === 0 ? (
          <div style={{ padding: "12px 0", fontSize: 13.5, color: "#8c8378", fontWeight: 600 }}>None of your motos is on a ride right now.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 6 }}>
            {data.active.map((r) => {
              const movable = r.status === "ACCEPTED" || r.status === "CONFIRMED";
              const target = pick[r.id] ?? free.find((d) => d.id !== r.driver?.id)?.id ?? "";
              return (
                <div key={r.id} style={{ border: "1px solid #ece6db", borderRadius: 14, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700 }}>{r.from} → {r.to} <StatusPill status={r.status} /></div>
                    <div style={{ fontSize: 11.5, color: "#8c8378", fontWeight: 600, marginTop: 2 }}>
                      {r.driver?.name ?? "—"} <span style={{ fontFamily: MONO }}>{r.driver?.plate ?? ""}</span> · {r.passenger}
                      {r.fare !== null && <> · <span style={{ fontFamily: MONO, fontWeight: 700 }}>{formatRWF(r.fare)}</span></>}
                      {r.status === "ACCEPTED" && <> · waiting for the passenger to pay</>}
                      {r.status === "CONFIRMED" && r.pickupDeadline && <> · pick up by {fmtHm(r.pickupDeadline)}</>}
                    </div>
                  </div>
                  {movable && (
                    <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
                      {select(r, r.driver?.id)}
                      <button disabled={!target || busyId === r.id} onClick={() => run(r.id, () => api.operatorReassignMotoHail(r.id, target))} style={{ ...btn("#fff", "#1b1714", "1px solid #e3ddd1"), opacity: target ? 1 : 0.5 }}>{busyId === r.id ? "…" : "Hand to"}</button>
                      {r.status === "ACCEPTED" && (
                        <button disabled={busyId === r.id} onClick={() => { if (window.confirm("Withdraw this acceptance? The hail reopens for other operators.")) run(r.id, () => api.operatorWithdrawMotoHail(r.id)); }} style={btn("#fff", "#c2553f", "1px solid #f0d4cc")}>Withdraw</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}


/* -------- Driver onboarding by invitation -------- */

const inviteInput: React.CSSProperties = { width: "100%", border: "1px solid #e3ddd1", borderRadius: 11, padding: "11px 13px", fontSize: 14, fontWeight: 600, outline: "none", fontFamily: "'Manrope', sans-serif", boxSizing: "border-box", background: "#fff" };
const inviteLabel: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, color: "#8c8378", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 };
const inviteBtn = (bg: string, color = "#fff", border = "none", disabled = false): React.CSSProperties => ({ background: bg, color, border, borderRadius: 10, padding: "9px 14px", fontSize: 12.5, fontWeight: 700, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1, fontFamily: "'Manrope', sans-serif", flex: "none" });
const splitName = (name: string) => ({ firstName: name.split(" ")[0] ?? "", lastName: name.split(" ").slice(1).join(" ") });

// Invite a driver: pick a registered passenger from the typeahead, or type an
// email for someone not on Relay yet. That's all the operator provides — the
// candidate submits their own licence and ID, and the operator approves below.
function InviteDriverModal({ onClose, onSent }: { onClose: () => void; onSent: (r: { registered: boolean; email: string }) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<UserSuggestion[]>([]);
  const [picked, setPicked] = useState<UserSuggestion | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (picked || q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      api.operatorSearchUsers(q.trim()).then(setHits).catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, picked]);

  const typedEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q.trim()) ? q.trim().toLowerCase() : null;
  const email = picked?.email ?? typedEmail;
  const send = async () => {
    if (!email) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.operatorInviteDriver({ email, note: note.trim() || undefined });
      onSent({ registered: r.registered, email });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not send the invitation");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(27,23,20,.55)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 470, background: "#fff", borderRadius: 20, boxShadow: "0 40px 90px -40px rgba(27,23,20,.6)", overflow: "visible" }}>
        <div style={{ padding: "20px 22px", borderBottom: "1px solid #ece6db" }}>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 19, fontWeight: 700, letterSpacing: "-.4px" }}>Invite a driver</div>
          <div style={{ fontSize: 12.5, color: "#8c8378", fontWeight: 600, marginTop: 3 }}>They submit their own licence and ID; you approve, and their driver console unlocks.</div>
        </div>
        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
          {error && <div style={{ background: "#fbeae6", border: "1px solid #f0d4cc", color: "#c2553f", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, fontWeight: 600 }}>{error}</div>}
          <div>
            <div style={inviteLabel}>Who</div>
            {picked ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid #e3ddd1", borderRadius: 11, padding: "9px 12px" }}>
                <Avatar user={{ ...splitName(picked.id ? picked.name : picked.email), avatarUrl: picked.avatarUrl }} size={30} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 700 }}>{picked.id ? picked.name : "Invite by email"}</span>
                  <span style={{ display: "block", fontSize: 12, color: "#8c8378", fontFamily: MONO, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{picked.email}{picked.phone ? ` · ${picked.phone}` : " · not on Relay yet"}</span>
                </span>
                <button type="button" onClick={() => { setPicked(null); setQ(""); }} style={{ background: "none", border: "none", color: "#ff6a1a", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>Change</button>
              </div>
            ) : (
              <div style={{ position: "relative" }}>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone or email" autoFocus style={inviteInput} />
                {(hits.length > 0 || typedEmail) && (
                  <div style={{ position: "absolute", left: 0, right: 0, top: "calc(100% + 6px)", background: "#fff", border: "1px solid #e3ddd1", borderRadius: 12, boxShadow: "0 18px 40px -18px rgba(27,23,20,.4)", zIndex: 5, overflow: "hidden" }}>
                    {hits.map((u) => (
                      <button type="button" key={u.id} onClick={() => { setPicked(u); setHits([]); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: "1px solid #f1ece2", padding: "9px 12px", cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>
                        <Avatar user={{ ...splitName(u.name), avatarUrl: u.avatarUrl }} size={28} />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: "block", fontSize: 13, fontWeight: 700 }}>{u.name}</span>
                          <span style={{ display: "block", fontSize: 11.5, color: "#8c8378", fontFamily: MONO, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email} · {u.phone}</span>
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 800, color: "#1f9d6b", background: "#e7f6ee", borderRadius: 7, padding: "3px 7px", textTransform: "uppercase" }}>on Relay</span>
                      </button>
                    ))}
                    {typedEmail && !hits.some((h) => h.email.toLowerCase() === typedEmail) && (
                      <button type="button" onClick={() => { setPicked({ id: "", name: typedEmail, email: typedEmail, phone: "", avatarUrl: null }); setHits([]); }} style={{ display: "block", width: "100%", textAlign: "left", background: "#fff8f5", border: "none", padding: "10px 12px", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#1b1714", fontFamily: "'Manrope', sans-serif" }}>
                        Invite <b style={{ fontFamily: MONO }}>{typedEmail}</b> by email — they&apos;ll register first
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {!picked && q.trim().length >= 2 && hits.length === 0 && !typedEmail && (
              <div style={{ fontSize: 12, color: "#8c8378", fontWeight: 600, marginTop: 6 }}>No registered passenger matches — type their email to invite them to join Relay.</div>
            )}
          </div>
          <div>
            <div style={inviteLabel}>Message (optional)</div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={300} placeholder="e.g. We run motos around Remera — have your licence and ID ready." style={{ ...inviteInput, resize: "vertical" }} />
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" onClick={onClose} style={inviteBtn("#fff", "#1b1714", "1px solid #e3ddd1")}>Cancel</button>
            <button type="button" disabled={!email || busy} onClick={send} style={inviteBtn("#ff6a1a", "#fff", "none", !email || busy)}>{busy ? "Sending…" : "Send invitation"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Invitations and their KYC submissions. "Approve" is the moment the
// candidate becomes a driver (Driver record + role flip); "Send back" returns
// a reason they can act on; "Withdraw" cancels the invitation.
function DriverInvitesCard({ refreshKey, onApproved }: { refreshKey: number; onApproved: () => void }) {
  const [rows, setRows] = useState<DriverInviteRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<{ id: string; reason: string } | null>(null);

  const load = useCallback(() => {
    api.operatorDriverInvites().then(setRows).catch(() => setRows([]));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load, refreshKey]);

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
  if (!rows || rows.length === 0) return null;

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });
  const docLabel: Record<string, string> = { NATIONAL_ID: "National ID", DRIVING_LICENSE: "Driving licence", PASSPORT: "Passport" };
  return (
    <Card>
      <CardTitle>Invitations · {rows.length}</CardTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 6 }}>
        {rows.map((r) => {
          const open = r.status === "INVITED" || r.status === "SUBMITTED" || r.status === "REJECTED";
          return (
            <div key={r.id} style={{ border: `1px solid ${r.status === "SUBMITTED" ? "#ffd9c2" : "#ece6db"}`, background: r.status === "SUBMITTED" ? "#fff8f5" : "#fff", borderRadius: 14, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <Avatar user={{ ...splitName(r.name ?? r.email), avatarUrl: r.avatarUrl }} size={34} />
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                    {r.name ?? r.email}
                    <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: r.registered ? "#1f9d6b" : "#8c8378", background: r.registered ? "#e7f6ee" : "#f1ede4", borderRadius: 20, padding: "2px 8px", textTransform: "uppercase" }}>{r.registered ? "on Relay" : "invited by email"}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "#8c8378", fontWeight: 600, marginTop: 2, fontFamily: MONO }}>
                    {r.email}{r.phone ? ` · ${r.phone}` : ""} · invited {fmtDate(r.invitedAt)}
                  </div>
                  {r.status === "SUBMITTED" && r.submittedAt && (
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#1b1714", marginTop: 6 }}>
                      Licence <span style={{ fontFamily: MONO }}>{r.licenseNumber}</span> · ID <span style={{ fontFamily: MONO }}>{r.nationalId}</span> · submitted {fmtDate(r.submittedAt)}
                      <span style={{ display: "inline-flex", gap: 6, marginLeft: 8 }}>
                        {r.documents.map((d) => (
                          <button key={d.id} type="button" onClick={() => downloadAuthed(api.documentUrl(d.id), d.fileName)} style={{ background: "#fff", border: "1px solid #e3ddd1", borderRadius: 8, padding: "3px 9px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>View {docLabel[d.kind] ?? d.kind}</button>
                        ))}
                      </span>
                    </div>
                  )}
                  {r.status === "REJECTED" && r.rejectionReason && <div style={{ fontSize: 12, color: "#c2553f", fontWeight: 600, marginTop: 6 }}>Sent back: “{r.rejectionReason}” — waiting for a resubmission.</div>}
                  {r.status === "INVITED" && <div style={{ fontSize: 12, color: "#8c8378", fontWeight: 600, marginTop: 6 }}>{r.registered ? "Waiting for them to submit their documents." : "Waiting for them to register and submit their documents."}</div>}
                </div>
                <StatusPill status={r.status} />
                {open && (
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                    {r.status === "SUBMITTED" && (
                      <>
                        <button disabled={busyId === r.id} onClick={() => run(r.id, async () => { await api.operatorApproveDriverInvite(r.id); onApproved(); })} style={inviteBtn("#1f9d6b")}>{busyId === r.id ? "…" : "Approve — make driver"}</button>
                        <button disabled={busyId === r.id} onClick={() => setRejecting(rejecting?.id === r.id ? null : { id: r.id, reason: "" })} style={inviteBtn("#fff", "#c2553f", "1px solid #f0d4cc")}>Send back</button>
                      </>
                    )}
                    <button disabled={busyId === r.id} onClick={() => { if (window.confirm("Withdraw this invitation? Any documents they uploaded are deleted.")) run(r.id, () => api.operatorCancelDriverInvite(r.id)); }} style={inviteBtn("#fff", "#8c8378", "1px solid #e3ddd1")}>Withdraw</button>
                  </div>
                )}
              </div>
              {rejecting?.id === r.id && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #f1ece2" }}>
                  <div style={inviteLabel}>What should they fix? (sent to the candidate)</div>
                  <textarea value={rejecting.reason} onChange={(e) => setRejecting({ id: r.id, reason: e.target.value })} rows={2} autoFocus placeholder="e.g. The licence photo is blurry — please upload a readable scan." style={{ ...inviteInput, resize: "vertical" }} />
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
                    <button onClick={() => setRejecting(null)} style={inviteBtn("#fff", "#8c8378", "1px solid #e3ddd1")}>Cancel</button>
                    <button disabled={rejecting.reason.trim().length < 10 || busyId === r.id} onClick={() => run(r.id, async () => { await api.operatorRejectDriverInvite(r.id, rejecting.reason.trim()); setRejecting(null); })} style={inviteBtn("#c2553f", "#fff", "none", rejecting.reason.trim().length < 10)}>Send back with reason</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
