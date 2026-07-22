"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api,
  type AdminOverview,
  type AdminUser,
  type AdminOperator,
  type AdminApproval,
  type AdminPayments,
  type AdminReports,
} from "@/lib/api";
import { formatRWF, createUserSchema, type CreateUserInput } from "@relay/shared";
import { tokenStore } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { ConsoleShell, KpiGrid, StatusPill, Card, CardTitle, BarChart, PrimaryButton, FormModal, Pagination, usePaged, type NavItem } from "@/components/console";

async function downloadReport() {
  const res = await fetch(api.adminReportCsvUrl(), { headers: { Authorization: `Bearer ${tokenStore.access}` } });
  if (!res.ok) { window.alert("Could not generate report"); return; }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "relay-report.csv";
  a.click();
  URL.revokeObjectURL(url);
}

const DISPLAY = "'Space Grotesk', sans-serif";
const MONO = "'JetBrains Mono', monospace";

export default function AdminConsole() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState("dashboard");
  const [reportOpen, setReportOpen] = useState(false);
  const [pending, setPending] = useState(0);

  const loadPending = useCallback(() => {
    api.adminApprovals().then((a) => setPending(a.length)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user || user.role !== "ADMIN") {
      router.replace("/auth?mode=login");
      return;
    }
    loadPending();
  }, [user, loading, router, loadPending]);

  if (!user || user.role !== "ADMIN") return null;

  const nav: NavItem[] = [
    { key: "dashboard", label: "Dashboard", icon: "▦" },
    { key: "users", label: "Users", icon: "☻" },
    { key: "operators", label: "Operators", icon: "▤" },
    { key: "approvals", label: "Approvals", icon: "✓", badge: pending || undefined },
    { key: "payments", label: "Payments", icon: "◈" },
    { key: "reports", label: "Reports", icon: "▧" },
    { key: "complaints", label: "Complaints", icon: "!" },
  ];

  const titles: Record<string, string> = {
    dashboard: "Platform overview",
    users: "Users",
    operators: "Operators",
    approvals: "Operator approvals",
    payments: "Payments",
    reports: "Reports & analytics",
    complaints: "Complaints & feedback",
  };

  return (
    <div style={{ padding: "28px 24px 80px" }}>
      <ConsoleShell
        role="Admin"
        nav={nav}
        active={tab}
        onNav={(k) => { setTab(k); setReportOpen(false); }}
        title={reportOpen ? "Generate report" : titles[tab]}
        subtitle={reportOpen ? "Build and export a custom platform report" : "All operators · all modes · live"}
        actions={reportOpen ? undefined : (
          <>
            <button style={{ background: "#fff", border: "1px solid #e3ddd1", borderRadius: 11, padding: "10px 15px", fontSize: 13, fontWeight: 700, fontFamily: "'Manrope', sans-serif", cursor: "pointer" }}>This month ▾</button>
            <PrimaryButton onClick={() => setReportOpen(true)}>Generate report</PrimaryButton>
          </>
        )}
      >
        {reportOpen ? (
          <GenerateReport onClose={() => setReportOpen(false)} />
        ) : (
          <>
            {tab === "dashboard" && <Dashboard onApprovalsChanged={loadPending} />}
            {tab === "users" && <UsersTab />}
            {tab === "operators" && <OperatorsTab />}
            {tab === "approvals" && <ApprovalsTab onChanged={loadPending} />}
            {tab === "payments" && <PaymentsTab />}
            {tab === "reports" && <ReportsTab />}
            {tab === "complaints" && <ComplaintsTab />}
          </>
        )}
      </ConsoleShell>
    </div>
  );
}

function useData<T>(fn: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const load = useCallback(() => { fn().then(setData).catch(() => undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return [data, load] as const;
}

function Dashboard({ onApprovalsChanged }: { onApprovalsChanged: () => void }) {
  const [data, reload] = useData<AdminOverview>(() => api.adminOverview());
  if (!data) return <Loading />;

  const act = async (id: string, approve: boolean) => {
    await (approve ? api.adminApprove(id) : api.adminReject(id));
    reload();
    onApprovalsChanged();
  };

  return (
    <>
      <KpiGrid kpis={data.kpis} />
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16 }} className="op-two">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card>
            <CardTitle right={<span style={{ fontSize: 12, fontWeight: 700, color: "#ff6a1a" }}>{data.approvals.length} pending</span>}>Operator approvals</CardTitle>
            <div style={{ fontSize: 12.5, color: "#8c8378", marginBottom: 6 }}>New companies awaiting verification before they can onboard drivers.</div>
            {data.approvals.length === 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "18px 0 6px", borderTop: "1px solid #f1ece2", color: "#1f9d6b" }}>
                <span style={{ width: 26, height: 26, borderRadius: "50%", background: "#e7f6ee", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>✓</span>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>Queue cleared — all operators verified.</span>
              </div>
            )}
            {data.approvals.map((a) => <ApprovalRow key={a.id} a={a} onAct={act} />)}
          </Card>
          <Card>
            <CardTitle right={<span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: "#1f9d6b" }}>+19% MoM</span>}>Platform revenue</CardTitle>
            <BarChart bars={data.revenueBars} />
          </Card>
        </div>
        <Card>
          <CardTitle right={<span style={{ fontSize: 12, fontWeight: 700, color: "#ff6a1a" }}>{data.complaints.length} open</span>}>Complaints &amp; feedback</CardTitle>
          {data.complaints.map((c) => (
            <div key={c.id} style={{ padding: "14px 0", borderTop: "1px solid #f1ece2" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#8c8378" }}>{c.who}</span>
                <StatusPill status={c.priority} />
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.4 }}>{c.message}</div>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}

function ApprovalRow({ a, onAct }: { a: AdminApproval; onAct: (id: string, approve: boolean) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "13px 0", borderTop: "1px solid #f1ece2" }}>
      <div style={{ width: 40, height: 40, borderRadius: 11, background: a.bg, color: a.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, flex: "none" }}>{a.initial}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{a.company}</div>
        <div style={{ fontSize: 12, color: "#8c8378" }}><span style={{ fontWeight: 700, color: a.color }}>{a.type}</span> · {a.vehicles} · {a.date}</div>
      </div>
      <button onClick={() => onAct(a.id, false)} style={{ background: "#fff", border: "1px solid #e3ddd1", color: "#8c8378", borderRadius: 10, padding: "8px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>Reject</button>
      <button onClick={() => onAct(a.id, true)} style={{ background: "#1f9d6b", border: "none", color: "#fff", borderRadius: 10, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>Approve</button>
    </div>
  );
}

function UsersTab() {
  const { data, page, setPage, reload } = usePaged<AdminUser>(useCallback((pg) => api.adminUsers(pg), []));
  const [modal, setModal] = useState(false);
  if (!data) return <Loading />;
  return (
    <Card>
      {modal && (
        <FormModal
          title="Add user"
          submitLabel="Create user"
          schema={createUserSchema}
          fields={[
            { name: "fullName", label: "Full name", placeholder: "Jane D." },
            { name: "phone", label: "Phone number", placeholder: "+250 78 000 0000" },
            { name: "email", label: "Email", placeholder: "jane@email.com" },
            { name: "role", label: "Role", type: "select", options: [{ value: "PASSENGER", label: "Passenger" }, { value: "DRIVER", label: "Driver" }, { value: "OPERATOR", label: "Operator" }, { value: "ADMIN", label: "Admin" }] },
          ]}
          onSubmit={async (v) => { const d = v as CreateUserInput; await api.adminAddUser({ fullName: d.fullName, phone: d.phone, email: d.email, role: d.role }); reload(); }}
          onClose={() => setModal(false)}
        />
      )}
      <CardTitle right={<PrimaryButton onClick={() => setModal(true)}>+ Add user</PrimaryButton>}>Users · {data.total}</CardTitle>
      <TableHead cols={["Name", "Role", "Phone", "Joined", "Status"]} template="1.3fr .9fr 1.2fr .8fr 1fr" />
      {data.items.map((u) => (
        <Row key={u.id} template="1.3fr .9fr 1.2fr .8fr 1fr">
          <span style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 700 }}>
            <span style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,#ff8a3d,#e0560c)", flex: "none" }} />{u.name}
          </span>
          <span style={{ color: "#6b6258" }}>{u.role}</span>
          <span style={{ fontFamily: MONO, color: "#8c8378", fontSize: 12 }}>{u.phone}</span>
          <span style={{ color: "#8c8378", fontSize: 12 }}>{u.joined}</span>
          <span style={{ textAlign: "right" }}><StatusPill status={u.status} /></span>
        </Row>
      ))}
      <Pagination page={page} totalPages={data.totalPages} total={data.total} onPage={setPage} />
    </Card>
  );
}

function OperatorsTab() {
  const { data, page, setPage } = usePaged<AdminOperator>(useCallback((pg) => api.adminOperators(pg), []));
  if (!data) return <Loading />;
  return (
    <Card>
      <CardTitle>Operators · {data.total}</CardTitle>
      <TableHead cols={["Company", "Type", "Vehicles", "Drivers", "Revenue", "Status"]} template="1.4fr 1fr .7fr .7fr 1fr .9fr" />
      {data.items.map((o) => (
        <Row key={o.id} template="1.4fr 1fr .7fr .7fr 1fr .9fr">
          <span style={{ fontWeight: 700 }}>{o.company}</span>
          <span><span style={{ fontSize: 11, fontWeight: 700, color: o.color, background: o.bg, borderRadius: 7, padding: "3px 9px" }}>{o.type}</span></span>
          <span style={{ fontFamily: MONO, color: "#8c8378" }}>{o.vehicles}</span>
          <span style={{ fontFamily: MONO, color: "#8c8378" }}>{o.drivers}</span>
          <span style={{ fontFamily: MONO, fontWeight: 700, color: "#1f9d6b" }}>{formatRWF(o.revenue)}</span>
          <span style={{ textAlign: "right" }}><StatusPill status={o.status} /></span>
        </Row>
      ))}
      <Pagination page={page} totalPages={data.totalPages} total={data.total} onPage={setPage} />
    </Card>
  );
}

function ApprovalsTab({ onChanged }: { onChanged: () => void }) {
  const [data, reload] = useData<AdminApproval[]>(() => api.adminApprovals());
  if (!data) return <Loading />;
  const act = async (id: string, approve: boolean) => {
    await (approve ? api.adminApprove(id) : api.adminReject(id));
    reload();
    onChanged();
  };
  return (
    <Card style={{ maxWidth: 760 }}>
      <CardTitle right={<span style={{ fontSize: 12, fontWeight: 700, color: "#ff6a1a" }}>{data.length} pending</span>}>Pending verification</CardTitle>
      <div style={{ fontSize: 12.5, color: "#8c8378", marginBottom: 8 }}>Review documents and fleet before a company can onboard drivers and accept bookings.</div>
      {data.length === 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "22px 0 6px", borderTop: "1px solid #f1ece2", color: "#1f9d6b" }}>
          <span style={{ width: 28, height: 28, borderRadius: "50%", background: "#e7f6ee", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>✓</span>
          <span style={{ fontSize: 14, fontWeight: 700 }}>Queue cleared — every operator is verified.</span>
        </div>
      )}
      {data.map((a) => <ApprovalRow key={a.id} a={a} onAct={act} />)}
    </Card>
  );
}

function PaymentsTab() {
  const [data, setData] = useState<AdminPayments | null>(null);
  const [page, setPage] = useState(1);
  useEffect(() => { api.adminPayments(page).then(setData).catch(() => undefined); }, [page]);
  if (!data) return <Loading />;
  const tx = data.transactions;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16 }} className="op-two">
      <Card>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Platform transactions · {tx.total}</div>
        <TableHead cols={["Txn", "User", "Operator", "Method", "Amt", "Status"]} template=".9fr 1fr 1.2fr .9fr .8fr 1fr" />
        {tx.items.map((p) => (
          <Row key={p.id} template=".9fr 1fr 1.2fr .9fr .8fr 1fr">
            <span style={{ fontFamily: MONO, color: "#8c8378", fontSize: 11.5 }}>{p.id}</span>
            <span style={{ fontWeight: 600 }}>{p.user}</span>
            <span style={{ color: "#6b6258" }}>{p.operator}</span>
            <span style={{ color: "#6b6258" }}>{p.method.replace("_", " ")}</span>
            <span style={{ fontFamily: MONO, fontWeight: 700 }}>{formatRWF(p.amount)}</span>
            <span style={{ textAlign: "right" }}><StatusPill status={p.status} /></span>
          </Row>
        ))}
        <Pagination page={page} totalPages={tx.totalPages} total={tx.total} onPage={setPage} />
      </Card>
      <div style={{ background: "#1b1714", borderRadius: 18, padding: 20, color: "#fff", height: "fit-content" }}>
        <div style={{ fontSize: 12.5, color: "#cfc7bb", fontWeight: 600 }}>Processed (all time)</div>
        <div style={{ fontFamily: MONO, fontSize: 28, fontWeight: 700, margin: "4px 0 16px" }}>{formatRWF(data.summary.total)}</div>
        <SplitRow label="Mobile Money" value={`${data.summary.mobileMoney}%`} />
        <SplitRow label="Wallet" value={`${data.summary.wallet}%`} />
        <SplitRow label="QR code" value={`${data.summary.qrCard}%`} />
      </div>
    </div>
  );
}

function ReportsTab() {
  const [data] = useData<AdminReports>(() => api.adminReports());
  if (!data) return <Loading />;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16 }} className="op-two">
      <Card>
        <CardTitle right={<span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: "#1f9d6b" }}>+19% MoM</span>}>Platform revenue</CardTitle>
        <BarChart bars={data.revenueBars} height={150} />
      </Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <StatCard label="Trips this month" value={data.tripsThisMonth.toLocaleString()} />
        <StatCard label="Avg fare" value={formatRWF(data.avgFare)} />
        <StatCard label="Multimodal trips" value={`${data.multimodalPct}%`} />
        <button onClick={downloadReport} style={{ background: "#1b1714", color: "#fff", border: "none", borderRadius: 13, padding: 14, fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>Download full report</button>
      </div>
    </div>
  );
}

function ComplaintsTab() {
  const [data, reload] = useData<AdminOverview>(() => api.adminOverview());
  if (!data) return <Loading />;
  const resolve = async (id: string) => { await api.adminResolveComplaint(id); reload(); };
  return (
    <Card style={{ maxWidth: 760 }}>
      <CardTitle right={<span style={{ fontSize: 12, color: "#ff6a1a", fontWeight: 700 }}>Avg resolve 4h</span>}>Open complaints · {data.complaints.length}</CardTitle>
      {data.complaints.map((c) => (
        <div key={c.id} style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "16px 0", borderTop: "1px solid #f1ece2" }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#8c8378" }}>{c.who}</span>
              <StatusPill status={c.priority} />
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4 }}>{c.message}</div>
          </div>
          <button onClick={() => resolve(c.id)} style={{ background: "#1b1714", color: "#fff", border: "none", borderRadius: 10, padding: "9px 15px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif", flex: "none" }}>Resolve</button>
        </div>
      ))}
    </Card>
  );
}

function GenerateReport({ onClose }: { onClose: () => void }) {
  const [type, setType] = useState(0);
  const [format, setFormat] = useState(0);
  const types = [
    { t: "Revenue & payouts", d: "Gross, fees and net settlement per operator" },
    { t: "Bookings & trips", d: "Volumes by mode, route and status" },
    { t: "Passenger activity", d: "Active riders, retention and frequency" },
    { t: "Driver performance", d: "Trips, ratings and acceptance rates" },
  ];
  return (
    <div>
      <button onClick={onClose} style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, marginBottom: 20 }}>← Back</button>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }} className="op-two">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card>
            <StepLabel>1 · Report type</StepLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {types.map((r, i) => {
                const sel = i === type;
                return (
                  <button key={r.t} onClick={() => setType(i)} style={{ display: "flex", alignItems: "center", gap: 12, textAlign: "left", background: sel ? "#fff6f0" : "#fff", border: `1px solid ${sel ? "#ff6a1a" : "#e3ddd1"}`, borderRadius: 13, padding: "13px 15px", cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>
                    <span style={{ width: 20, height: 20, borderRadius: "50%", border: `2px solid ${sel ? "#ff6a1a" : "#cbc3b6"}`, display: "flex", alignItems: "center", justifyContent: "center", color: "#ff6a1a", fontSize: 11 }}>{sel ? "✓" : ""}</span>
                    <span style={{ flex: 1 }}>
                      <span style={{ display: "block", fontSize: 14.5, fontWeight: 700 }}>{r.t}</span>
                      <span style={{ display: "block", fontSize: 12, color: "#8c8378", marginTop: 2 }}>{r.d}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>
          <Card>
            <StepLabel>2 · Date range</StepLabel>
            <div style={{ display: "flex", gap: 12 }}>
              <DateBox label="From" value="01 Jun 2026" />
              <DateBox label="To" value="30 Jun 2026" />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              {["Last 7 days", "This month", "This quarter"].map((c, i) => (
                <span key={c} style={{ fontSize: 12, fontWeight: 700, background: i === 1 ? "#fff0e6" : "#f4f1ea", color: i === 1 ? "#ff6a1a" : "#1b1714", borderRadius: 8, padding: "7px 12px", cursor: "pointer" }}>{c}</span>
              ))}
            </div>
          </Card>
          <Card>
            <StepLabel>3 · Breakdown</StepLabel>
            <Toggle label="By operator" on />
            <Toggle label="By transport mode" on />
            <Toggle label="By payment method" />
          </Card>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: "#1b1714", borderRadius: 18, padding: 20, color: "#fff" }}>
            <div style={{ fontSize: 13, color: "#cfc7bb", fontWeight: 600, marginBottom: 14 }}>Report summary</div>
            <SplitRow label="Type" value={types[type].t} />
            <SplitRow label="Range" value="Jun 1–30" mono />
            <SplitRow label="Operators" value="4 included" />
            <SplitRow label="Format" value={["PDF", "CSV", "Excel"][format]} />
          </div>
          <Card>
            <StepLabel>Format</StepLabel>
            <div style={{ display: "flex", gap: 9, marginBottom: 16 }}>
              {["PDF", "CSV", "Excel"].map((f, i) => (
                <button key={f} onClick={() => setFormat(i)} style={{ flex: 1, textAlign: "center", fontSize: 13, fontWeight: 700, background: i === format ? "#1b1714" : "#fff", color: i === format ? "#fff" : "#1b1714", border: i === format ? "none" : "1px solid #e3ddd1", borderRadius: 10, padding: 10, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>{f}</button>
              ))}
            </div>
            <button onClick={async () => { await downloadReport(); onClose(); }} style={{ width: "100%", background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 13, padding: 14, fontSize: 14.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif", boxShadow: "0 12px 26px -10px rgba(255,106,26,.7)" }}>Generate &amp; download</button>
            <button onClick={onClose} style={{ width: "100%", background: "none", border: "none", fontSize: 13, fontWeight: 700, color: "#a39a8d", cursor: "pointer", fontFamily: "'Manrope', sans-serif", marginTop: 12 }}>Cancel</button>
          </Card>
        </div>
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
  return <div style={{ display: "grid", gridTemplateColumns: template, alignItems: "center", padding: "13px 0", borderBottom: "1px solid #f6f2ea", fontSize: 13 }}>{children}</div>;
}
function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #ece6db", borderRadius: 16, padding: "16px 18px" }}>
      <div style={{ fontSize: 12, color: "#8c8378", fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: DISPLAY, fontSize: 24, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
function SplitRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: 13, borderBottom: "1px solid #3a332c" }}>
      <span style={{ color: "#9a9186" }}>{label}</span>
      <span style={{ fontWeight: 700, fontFamily: mono ? MONO : undefined }}>{value}</span>
    </div>
  );
}
function StepLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11.5, fontWeight: 700, color: "#8c8378", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 13 }}>{children}</div>;
}
function DateBox({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 11.5, color: "#8c8378", fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ border: "1px solid #e3ddd1", borderRadius: 12, padding: "12px 14px", fontSize: 13.5, fontWeight: 600, fontFamily: MONO }}>{value}</div>
    </div>
  );
}
function Toggle({ label, on }: { label: string; on?: boolean }) {
  const [state, setState] = useState(!!on);
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{label}</span>
      <button onClick={() => setState((s) => !s)} style={{ width: 42, height: 24, borderRadius: 20, background: state ? "#ff6a1a" : "#e3ddd1", position: "relative", border: "none", cursor: "pointer" }}>
        <div style={{ position: "absolute", top: 3, left: state ? 21 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
      </button>
    </div>
  );
}
