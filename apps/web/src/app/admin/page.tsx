"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api,
  type AdminOverview,
  type AdminUser,
  type AdminOperator,
  type AdminOperatorDetail,
  type AdminApproval,
  type AdminPayments,
  type AdminReports,
  type KycDocument,
  type AdminRideDispute,
  type AdminReportType,
} from "@/lib/api";
import { formatRWF, createUserSchema, type CreateUserInput } from "@relay/shared";
import { useAuth } from "@/lib/auth-context";
import { PeriodPicker, ExportButtons, StatTile, ReportTable, downloadAuthed, fetchAuthedCsv, exportReportPdf, rangeQuery, isRangeReady, fmtMoney, type ReportRangeValue, type PdfSection } from "@/components/reports";
import { ConsoleShell, ProfileSettingsPage, KpiGrid, StatusPill, Card, CardTitle, BarChart, PrimaryButton, FormModal, Pagination, usePaged, type NavItem } from "@/components/console";

const DISPLAY = "'Space Grotesk', sans-serif";
const MONO = "'JetBrains Mono', monospace";

type ToastMsg = { kind: "success" | "error"; msg: string };

export default function AdminConsole() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState("dashboard");
  const [reportOpen, setReportOpen] = useState(false);
  const [pending, setPending] = useState(0);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [operatorDetailId, setOperatorDetailId] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [toast, setToast] = useState<ToastMsg | null>(null);

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
    { key: "disputes", label: "Ride disputes", icon: "⚖" },
    { key: "settings", label: "Settings", icon: "⚙" },
  ];

  const titles: Record<string, string> = {
    dashboard: "Platform overview",
    users: "Users",
    operators: "Operators",
    approvals: "Operator approvals",
    payments: "Payments",
    reports: "Reports & analytics",
    complaints: "Complaints & feedback",
    disputes: "Moto ride disputes",
    settings: "Platform settings",
  };

  return (
    <div className="rel-console-page">
      <Toast toast={toast} onClose={() => setToast(null)} />
      <ConsoleShell
        role="Admin"
        nav={nav}
        active={profileOpen ? "" : reviewId || operatorDetailId ? "operators" : tab}
        onNav={(k) => { setReviewId(null); setOperatorDetailId(null); setProfileOpen(false); setTab(k); setReportOpen(false); }}
        onOpenProfile={() => { setReviewId(null); setOperatorDetailId(null); setReportOpen(false); setProfileOpen(true); }}
        title={profileOpen ? "Profile & settings" : reviewId ? "Operator approvals" : operatorDetailId ? "Operators" : reportOpen ? "Generate report" : titles[tab]}
        subtitle={profileOpen ? "Your account" : reviewId ? "Reviewing an application" : operatorDetailId ? "Operator details" : reportOpen ? "Build and export a custom platform report" : "All operators · all modes · live"}
        actions={profileOpen || reviewId || operatorDetailId || reportOpen ? undefined : (
          <PrimaryButton onClick={() => setReportOpen(true)}>Generate report</PrimaryButton>
        )}
      >
        {profileOpen ? (
          <ProfileSettingsPage role="Admin" onBack={() => setProfileOpen(false)} />
        ) : reviewId ? (
          <ApprovalReviewPage
            id={reviewId}
            onNavigate={setReviewId}
            onClose={(changed) => { setReviewId(null); if (changed) loadPending(); }}
            onToast={setToast}
          />
        ) : operatorDetailId ? (
          <OperatorDetailPage
            id={operatorDetailId}
            onBack={() => setOperatorDetailId(null)}
            onReview={(id) => { setOperatorDetailId(null); setReviewId(id); }}
            onToast={setToast}
          />
        ) : reportOpen ? (
          <GenerateReport onClose={() => setReportOpen(false)} onToast={setToast} />
        ) : (
          <>
            {tab === "dashboard" && <Dashboard onReview={setReviewId} onReviewAll={() => setTab("approvals")} />}
            {tab === "users" && <UsersTab />}
            {tab === "operators" && <OperatorsTab onView={setOperatorDetailId} />}
            {tab === "approvals" && <ApprovalsTab onReview={setReviewId} />}
            {tab === "payments" && <PaymentsTab />}
            {tab === "reports" && <ReportsTab onToast={setToast} />}
            {tab === "complaints" && <ComplaintsTab />}
            {tab === "disputes" && <DisputesTab onToast={setToast} />}
            {tab === "settings" && <SettingsTab onToast={setToast} />}
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

function Dashboard({ onReview, onReviewAll }: { onReview: (id: string) => void; onReviewAll: () => void }) {
  const [data] = useData<AdminOverview>(() => api.adminOverview());
  if (!data) return <Loading />;

  return (
    <>
      <KpiGrid kpis={data.kpis} />
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16 }} className="op-two">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card>
            <CardTitle right={data.approvals.length > 0 ? <button onClick={onReviewAll} style={{ background: "none", border: "none", fontSize: 12, fontWeight: 700, color: "#ff6a1a", cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>Review all →</button> : <span style={{ fontSize: 12, fontWeight: 700, color: "#1f9d6b" }}>All clear</span>}>Operator approvals</CardTitle>
            <div style={{ fontSize: 12.5, color: "#8c8378", marginBottom: 6 }}>New companies awaiting verification before they can onboard drivers.</div>
            {data.approvals.length === 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "18px 0 6px", borderTop: "1px solid #f1ece2", color: "#1f9d6b" }}>
                <span style={{ width: 26, height: 26, borderRadius: "50%", background: "#e7f6ee", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>✓</span>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>Queue cleared — all operators verified.</span>
              </div>
            )}
            {data.approvals.map((a) => <ApprovalRow key={a.id} a={a} onReview={() => onReview(a.id)} />)}
          </Card>
          <Card>
            <CardTitle right={<span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: "#1f9d6b" }}>+19% MoM</span>}>Platform revenue</CardTitle>
            <BarChart bars={data.revenueBars} />
          </Card>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <PaypackBalancesCard paypack={data.paypack} />
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
      </div>
    </>
  );
}

// Live Paypack merchant balances — the real money the platform holds across
// MTN MoMo and Airtel Money (deposits in, payouts out).
function PaypackBalancesCard({ paypack }: { paypack: AdminOverview["paypack"] }) {
  return (
    <div style={{ background: "#1b1714", borderRadius: 18, padding: 20, color: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 12.5, color: "#cfc7bb", fontWeight: 700 }}>Paypack float</span>
        <span style={{ fontSize: 11, fontWeight: 800, borderRadius: 20, padding: "3px 9px", background: paypack ? "#1f9d6b22" : "#c2553f22", color: paypack ? "#4cd396" : "#e0a99a" }}>
          {paypack ? "● live" : "not connected"}
        </span>
      </div>
      {paypack ? (
        <>
          <div style={{ fontFamily: MONO, fontSize: 28, fontWeight: 700, margin: "2px 0 12px" }}>{formatRWF(paypack.balance)}</div>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1, background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, padding: "10px 12px" }}>
              <div style={{ fontSize: 10.5, color: "#9a9186", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".05em" }}>MTN MoMo</div>
              <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, marginTop: 3 }}>{formatRWF(paypack.mtn)}</div>
            </div>
            <div style={{ flex: 1, background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, padding: "10px 12px" }}>
              <div style={{ fontSize: 10.5, color: "#9a9186", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".05em" }}>Airtel Money</div>
              <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, marginTop: 3 }}>{formatRWF(paypack.airtel)}</div>
            </div>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12.5, color: "#9a9186", fontWeight: 600, lineHeight: 1.5, marginTop: 4 }}>
          Set PAYPACK_CLIENT_ID / PAYPACK_CLIENT_SECRET in apps/api/.env to see the platform&apos;s live MoMo &amp; Airtel balances here.
        </div>
      )}
    </div>
  );
}

const DOC_LABELS: Record<string, string> = {
  NATIONAL_ID: "ID document",
  PASSPORT: "Passport",
  DRIVING_LICENSE: "Driving licence",
  BUSINESS_CERTIFICATE: "RDB business certificate",
};

// Compact dashboard row — summary + a "Review" jump to the full review page.
// There is deliberately no inline approve here: verifying an operator requires
// reading their documents on the review page first.
function ApprovalRow({ a, onReview }: { a: AdminApproval; onReview: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "13px 0", borderTop: "1px solid #f1ece2" }}>
      <div style={{ width: 40, height: 40, borderRadius: 11, background: a.bg, color: a.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, flex: "none" }}>{a.initial}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{a.company}</div>
        <div style={{ fontSize: 12, color: "#8c8378" }}>
          <span style={{ fontWeight: 700, color: a.color }}>{a.type}</span>
          {a.applicant && <> · {a.applicant}</>} · {a.date}
          {(a.documents?.length ?? 0) > 0 && <> · {a.documents!.length} docs</>}
        </div>
      </div>
      <button onClick={onReview} style={{ background: "#1b1714", border: "none", color: "#fff", borderRadius: 10, padding: "8px 15px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>Review →</button>
    </div>
  );
}

// Inline preview of a KYC document (image thumbnail or embedded PDF), loaded
// through the authenticated blob endpoint.
function DocPreview({ doc, height = 200 }: { doc: KycDocument; height?: number }) {
  const [blob, setBlob] = useState<{ url: string; type: string } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let created: string | null = null;
    api
      .documentBlob(doc.id)
      .then((r) => { if (active) { created = r.url; setBlob(r); } else URL.revokeObjectURL(r.url); })
      .catch(() => active && setFailed(true));
    return () => { active = false; if (created) URL.revokeObjectURL(created); };
  }, [doc.id]);

  const mime = blob?.type || doc.mimeType || "";
  const isImage = mime.startsWith("image/");
  const isPdf = mime.includes("pdf");

  return (
    <div style={{ border: "1px solid #ece6db", borderRadius: 16, overflow: "hidden", background: "#fff", boxShadow: "0 12px 34px -26px rgba(27,23,20,.4)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: "1px solid #f1ece2", background: "#faf8f4" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{DOC_LABELS[doc.kind] ?? doc.kind}</div>
          <div style={{ fontSize: 11, color: "#a39a8d", fontFamily: MONO, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>{doc.fileName}</div>
        </div>
        <button onClick={() => api.openDocument(doc.id).catch(() => window.alert("Could not open document"))} style={{ background: "#fff", border: "1px solid #e3ddd1", borderRadius: 9, padding: "7px 12px", fontSize: 11.5, fontWeight: 700, color: "#1b1714", cursor: "pointer", fontFamily: "'Manrope', sans-serif", flex: "none" }}>Open ↗</button>
      </div>
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", background: "#f4f1ea" }}>
        {failed ? (
          <span style={{ fontSize: 12.5, color: "#c2553f", fontWeight: 600 }}>Couldn&apos;t load document</span>
        ) : !blob ? (
          <span style={{ fontSize: 12.5, color: "#a39a8d", fontWeight: 600 }}>Loading…</span>
        ) : isImage ? (
          <img src={blob.url} alt={doc.fileName} style={{ maxWidth: "100%", maxHeight: height, objectFit: "contain" }} />
        ) : isPdf ? (
          <iframe src={`${blob.url}#toolbar=0`} title={doc.fileName} style={{ width: "100%", height, border: "none" }} />
        ) : (
          <span style={{ fontSize: 12.5, color: "#8c8378", fontWeight: 600 }}>{doc.fileName}</span>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div style={{ background: "#faf8f4", border: "1px solid #f1ece2", borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: "#a39a8d", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, fontFamily: mono ? MONO : undefined, color: value ? "#1b1714" : "#cbc3b6" }}>{value || "—"}</div>
    </div>
  );
}

// Full-page operator verification review — takes over the whole screen.
function ApprovalReviewPage({ id, onClose, onNavigate, onToast }: { id: string; onClose: (changed: boolean) => void; onNavigate: (id: string) => void; onToast: (t: ToastMsg) => void }) {
  const [list, setList] = useState<AdminApproval[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rejectReason, setRejectReason] = useState<string | null>(null);
  useEffect(() => { api.adminApprovals().then(setList).catch(() => setList([])); }, []);

  const idx = list ? list.findIndex((x) => x.id === id) : -1;
  const a = idx >= 0 ? list![idx] : null;
  const prev = list && idx > 0 ? list[idx - 1] : null;
  const next = list && idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;

  // Approve/reject the operator you're actually looking at, confirm what
  // happened with a toast, then hand control back to the queue — no silent
  // jump to a different application, and failures surface instead of vanishing.
  const act = async (approve: boolean) => {
    if (!a) return;
    const reason = rejectReason?.trim() ?? "";
    if (!approve && reason.length < 10) {
      setError("Give the applicant a clear reason (at least 10 characters).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await (approve ? api.adminApprove(id) : api.adminReject(id, reason));
      onToast({ kind: "success", msg: `${a.company} ${approve ? "approved & verified" : "application rejected"}.` });
      onClose(true);
    } catch {
      setError("Something went wrong — the action didn't go through. Please try again.");
      setBusy(false);
    }
  };

  return (
    <div className="rel-up">
      {/* in-content header — the console's own sidebar + title bar stay put */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <button onClick={() => onClose(false)} style={{ display: "flex", alignItems: "center", gap: 9, background: "#fff", border: "1px solid #e3ddd1", borderRadius: 11, padding: "9px 15px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>← Back to queue</button>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "#8c8378" }}>{list && idx >= 0 ? `Application ${idx + 1} of ${list.length}` : "Operator verification"}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button disabled={!prev} onClick={() => prev && onNavigate(prev.id)} style={{ background: "#fff", border: "1px solid #e3ddd1", borderRadius: 10, padding: "9px 13px", fontSize: 13, fontWeight: 700, cursor: prev ? "pointer" : "default", color: prev ? "#1b1714" : "#cbc3b6", fontFamily: "'Manrope', sans-serif" }}>← Prev</button>
          <button disabled={!next} onClick={() => next && onNavigate(next.id)} style={{ background: "#fff", border: "1px solid #e3ddd1", borderRadius: 10, padding: "9px 13px", fontSize: 13, fontWeight: 700, cursor: next ? "pointer" : "default", color: next ? "#1b1714" : "#cbc3b6", fontFamily: "'Manrope', sans-serif" }}>Next →</button>
        </div>
      </div>

      {!list ? (
        <Loading />
      ) : !a ? (
        <div style={{ textAlign: "center", padding: "80px 0", color: "#8c8378", fontWeight: 700 }}>This application is no longer in the queue.</div>
      ) : (
        <>
          {/* hero */}
          <div style={{ background: "#1b1714", borderRadius: 24, padding: "34px 36px", color: "#fff", position: "relative", overflow: "hidden", marginBottom: 20 }}>
            <div style={{ position: "absolute", right: -80, top: -80, width: 260, height: 260, borderRadius: "50%", background: "radial-gradient(circle,rgba(255,106,26,.24),transparent 68%)" }} />
            <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
              <div style={{ width: 64, height: 64, borderRadius: 18, background: a.bg, color: a.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 800, flex: "none" }}>{a.initial}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ fontFamily: DISPLAY, fontSize: 30, fontWeight: 700, letterSpacing: "-.9px" }}>{a.company}</div>
                  <span style={{ fontSize: 11, fontWeight: 800, color: "#ff6a1a", background: "rgba(255,106,26,.16)", borderRadius: 7, padding: "5px 10px", textTransform: "uppercase", letterSpacing: ".04em" }}>Pending review</span>
                </div>
                <div style={{ fontSize: 13.5, color: "#cfc7bb", fontWeight: 600, marginTop: 6 }}>
                  {a.modes?.join(" · ")} · applied {a.date}{a.applicant && <> · by {a.applicant}</>}
                </div>
              </div>
            </div>
          </div>

          {/* applicant + company details */}
          <div style={{ fontSize: 12, fontWeight: 700, color: "#8c8378", textTransform: "uppercase", letterSpacing: ".05em", margin: "6px 0 12px" }}>Applicant &amp; company</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12, marginBottom: 26 }}>
            <InfoRow label="Applicant" value={a.applicant} />
            <InfoRow label="Email" value={a.email} />
            <InfoRow label="Phone" value={a.phone} mono />
            <InfoRow label="Company contact" value={a.contactInfo} mono />
            <InfoRow label="ID / passport no." value={a.idNumber} mono />
            <InfoRow label="Modes operated" value={a.modes?.join(", ")} />
          </div>

          {/* documents */}
          <div style={{ fontSize: 12, fontWeight: 700, color: "#8c8378", textTransform: "uppercase", letterSpacing: ".05em", margin: "6px 0 12px" }}>Verification documents</div>
          {(a.documents?.length ?? 0) === 0 ? (
            <div style={{ background: "#fff", border: "1px dashed #d8d1c4", borderRadius: 16, padding: 20, fontSize: 13.5, color: "#8c8378", fontWeight: 600, marginBottom: 24 }}>No documents were submitted with this application.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 16, marginBottom: 24 }}>
              {a.documents!.map((doc) => <DocPreview key={doc.id} doc={doc} height={320} />)}
            </div>
          )}

          {/* rejection reason — mandatory; the applicant sees it verbatim */}
          {rejectReason !== null && (
            <div style={{ background: "#fff8f5", border: "1px solid #f0d4cc", borderRadius: 16, padding: "16px 20px", marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#c2553f", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 8 }}>Reason for rejection (sent to the applicant)</div>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                autoFocus
                placeholder="e.g. The business certificate is expired — please upload a current RDB certificate and apply again."
                style={{ width: "100%", border: "1px solid #e3ddd1", borderRadius: 12, padding: "12px 14px", fontSize: 13.5, fontFamily: "'Manrope', sans-serif", fontWeight: 600, color: "#1b1714", resize: "vertical", outline: "none", boxSizing: "border-box" }}
              />
              <div style={{ fontSize: 12, color: "#8c8378", fontWeight: 600, marginTop: 6 }}>
                Shown in their dashboard, as an in-app notification and by email. They can fix the issue and apply again.
              </div>
            </div>
          )}

          {/* decision bar */}
          <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 16, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, color: error ? "#c2553f" : "#6b6258", fontWeight: error ? 700 : 600 }}>
              {error ?? "Verify the ID and business certificate before approving — this unlocks the operator console."}
            </div>
            <div style={{ display: "flex", gap: 11 }}>
              {rejectReason !== null && <button disabled={busy} onClick={() => { setRejectReason(null); setError(null); }} style={{ background: "none", border: "none", color: "#8c8378", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>Cancel</button>}
              <button disabled={busy} onClick={() => (rejectReason === null ? setRejectReason("") : act(false))} style={{ background: "#fff", border: "1px solid #f0d4cc", color: "#c2553f", borderRadius: 12, padding: "13px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>{rejectReason === null ? "Reject" : "Confirm rejection"}</button>
              <button disabled={busy} onClick={() => act(true)} style={{ background: "#1f9d6b", border: "none", color: "#fff", borderRadius: 12, padding: "13px 28px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif", boxShadow: "0 12px 26px -12px rgba(31,157,107,.7)" }}>{busy ? "Saving…" : "Approve & verify"}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function UsersTab() {
  const { data, page, setPage, reloadFirst } = usePaged<AdminUser>(useCallback((pg) => api.adminUsers(pg), []));
  const [modal, setModal] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  if (!data) return <Loading />;
  return (
    <Card>
      {created && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, background: "#e7f6ee", border: "1px solid #bfe8d2", borderRadius: 12, padding: "11px 14px", marginBottom: 14, fontSize: 13, fontWeight: 700 }}>
          <span style={{ flex: 1 }}>User created — a temporary password was emailed to <span style={{ fontFamily: MONO }}>{created}</span>.</span>
          <button onClick={() => setCreated(null)} style={{ background: "none", border: "none", color: "#8c8378", fontSize: 16, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
      )}
      {modal && (
        <FormModal
          title="Add user"
          submitLabel="Create user"
          schema={createUserSchema}
          fields={[
            { name: "firstName", label: "First name", placeholder: "Jane" },
            { name: "lastName", label: "Last name", placeholder: "Dukuze" },
            { name: "phone", label: "Phone number", placeholder: "+250 78 000 0000" },
            { name: "email", label: "Email", placeholder: "jane@email.com" },
            { name: "role", label: "Role", type: "select", options: [{ value: "PASSENGER", label: "Passenger" }, { value: "DRIVER", label: "Driver" }, { value: "OPERATOR", label: "Operator" }, { value: "ADMIN", label: "Admin" }] },
            { name: "companyName", label: "Company name", placeholder: "Kigali Bus Co.", showIf: (v) => v.role === "OPERATOR" },
            { name: "modes", label: "Primary mode", type: "select", options: [{ value: "BUS", label: "Bus" }, { value: "MOTO", label: "Moto-taxi" }, { value: "RIDE", label: "Shared ride" }], showIf: (v) => v.role === "OPERATOR" },
          ]}
          onSubmit={async (v) => { const d = v as CreateUserInput; const r = await api.adminAddUser({ firstName: d.firstName, lastName: d.lastName, phone: d.phone, email: d.email, role: d.role, companyName: d.companyName, modes: d.modes }); setCreated(r.credentialsSentTo); reloadFirst(); }}
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

function OperatorsTab({ onView }: { onView: (id: string) => void }) {
  const { data, page, setPage } = usePaged<AdminOperator>(useCallback((pg) => api.adminOperators(pg), []));
  if (!data) return <Loading />;
  return (
    <Card>
      <CardTitle>Operators · {data.total}</CardTitle>
      <TableHead cols={["Company", "Type", "Vehicles", "Drivers", "Revenue", "Status", ""]} template="1.3fr .9fr .6fr .6fr .9fr .8fr .7fr" />
      {data.items.map((o) => (
        <Row key={o.id} template="1.3fr .9fr .6fr .6fr .9fr .8fr .7fr">
          <span style={{ fontWeight: 700 }}>{o.company}</span>
          <span><span style={{ fontSize: 11, fontWeight: 700, color: o.color, background: o.bg, borderRadius: 7, padding: "3px 9px" }}>{o.type}</span></span>
          <span style={{ fontFamily: MONO, color: "#8c8378" }}>{o.vehicles}</span>
          <span style={{ fontFamily: MONO, color: "#8c8378" }}>{o.drivers}</span>
          <span style={{ fontFamily: MONO, fontWeight: 700, color: "#1f9d6b" }}>{formatRWF(o.revenue)}</span>
          <span><StatusPill status={o.status} /></span>
          <span style={{ textAlign: "right" }}>
            <button onClick={() => onView(o.id)} style={{ background: "#f4f1ea", border: "1px solid #e9e3d8", borderRadius: 9, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>View</button>
          </span>
        </Row>
      ))}
      <Pagination page={page} totalPages={data.totalPages} total={data.total} onPage={setPage} />
    </Card>
  );
}

// Full page (not a modal — this can grow: fleet/driver breakdowns, payout
// history, moderation actions) for one operator, opened from the Operators
// list "View" button. Lives inside ConsoleShell like the approval review page.
function OperatorDetailPage({ id, onBack, onReview, onToast }: { id: string; onBack: () => void; onReview: (id: string) => void; onToast: (t: ToastMsg) => void }) {
  const [o, setO] = useState<AdminOperatorDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => { api.adminOperatorDetail(id).then(setO).catch(() => setError("Could not load this operator.")); }, [id]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onToast({ kind: "success", msg: message });
      load();
    } catch {
      setError("Something went wrong — the action didn't go through. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rel-up">
      <div style={{ marginBottom: 20 }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 9, background: "#fff", border: "1px solid #e3ddd1", borderRadius: 11, padding: "9px 15px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>← Back to operators</button>
      </div>

      {!o ? (
        <Loading />
      ) : (
        <>
          {/* hero */}
          <div style={{ background: "#1b1714", borderRadius: 24, padding: "34px 36px", color: "#fff", position: "relative", overflow: "hidden", marginBottom: 20 }}>
            <div style={{ position: "absolute", right: -80, top: -80, width: 260, height: 260, borderRadius: "50%", background: "radial-gradient(circle,rgba(255,106,26,.24),transparent 68%)" }} />
            <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
              <div style={{ width: 64, height: 64, borderRadius: 18, background: o.bg, color: o.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 800, flex: "none" }}>{o.initial}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ fontFamily: DISPLAY, fontSize: 30, fontWeight: 700, letterSpacing: "-.9px" }}>{o.company}</div>
                  <StatusPill status={o.status} />
                </div>
                <div style={{ fontSize: 13.5, color: "#cfc7bb", fontWeight: 600, marginTop: 6 }}>{o.type} · on Relay since {o.date}</div>
              </div>
            </div>
          </div>

          {/* fleet stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 26 }} className="op-two">
            <StatCard label="Vehicles" value={String(o.vehicles)} />
            <StatCard label="Drivers" value={String(o.drivers)} />
            <StatCard label="Revenue (all time)" value={formatRWF(o.revenue)} />
          </div>

          {/* applicant + company details */}
          <div style={{ fontSize: 12, fontWeight: 700, color: "#8c8378", textTransform: "uppercase", letterSpacing: ".05em", margin: "6px 0 12px" }}>Applicant &amp; company</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12, marginBottom: 26 }}>
            <InfoRow label="Applicant" value={o.applicant} />
            <InfoRow label="Email" value={o.email} />
            <InfoRow label="Phone" value={o.phone} mono />
            <InfoRow label="Company contact" value={o.contactInfo} mono />
            <InfoRow label="ID / passport no." value={o.idNumber} mono />
            <InfoRow label="Modes operated" value={o.modes?.join(", ")} />
          </div>

          {/* documents */}
          <div style={{ fontSize: 12, fontWeight: 700, color: "#8c8378", textTransform: "uppercase", letterSpacing: ".05em", margin: "6px 0 12px" }}>Verification documents</div>
          {(o.documents?.length ?? 0) === 0 ? (
            <div style={{ background: "#fff", border: "1px dashed #d8d1c4", borderRadius: 16, padding: 20, fontSize: 13.5, color: "#8c8378", fontWeight: 600, marginBottom: 26 }}>No documents on file.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16, marginBottom: 26 }}>
              {o.documents!.map((doc) => <DocPreview key={doc.id} doc={doc} height={260} />)}
            </div>
          )}

          {/* actions */}
          <div style={{ fontSize: 12, fontWeight: 700, color: "#8c8378", textTransform: "uppercase", letterSpacing: ".05em", margin: "6px 0 12px" }}>Actions</div>
          <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 16, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, color: error ? "#c2553f" : "#6b6258", fontWeight: error ? 700 : 600 }}>
              {error ?? (
                o.status === "PENDING" ? "This application is still awaiting review." :
                o.status === "REJECTED" ? `Rejected${o.reviewedAt ? ` on ${new Date(o.reviewedAt).toLocaleDateString()}` : ""} — reason sent to the applicant: “${o.rejectionReason ?? "none recorded"}”` :
                o.status === "VERIFIED" ? "Suspending removes this operator's console access immediately." :
                "Reinstating restores this operator's console access."
              )}
            </div>
            <div style={{ display: "flex", gap: 11 }}>
              {o.status === "PENDING" && (
                <button onClick={() => onReview(o.id)} style={{ background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 12, padding: "12px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>Go to review</button>
              )}
              {o.status === "VERIFIED" && (
                <button disabled={busy} onClick={() => act(() => api.adminSuspendOperator(o.id), `${o.company} suspended.`)} style={{ background: "#fff", border: "1px solid #f0d4cc", color: "#c2553f", borderRadius: 12, padding: "12px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>{busy ? "Saving…" : "Suspend operator"}</button>
              )}
              {o.status === "SUSPENDED" && (
                <button disabled={busy} onClick={() => act(() => api.adminReinstateOperator(o.id), `${o.company} reinstated.`)} style={{ background: "#1f9d6b", border: "none", color: "#fff", borderRadius: 12, padding: "12px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>{busy ? "Saving…" : "Reinstate operator"}</button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Queue of pending operators as review cards — each opens the full-page review.
function ApprovalsTab({ onReview }: { onReview: (id: string) => void }) {
  const [data] = useData<AdminApproval[]>(() => api.adminApprovals());

  if (!data) return <Loading />;

  if (data.length === 0) {
    return (
      <Card style={{ maxWidth: 620 }}>
        <CardTitle>Operator verification</CardTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "22px 0 6px", borderTop: "1px solid #f1ece2", color: "#1f9d6b" }}>
          <span style={{ width: 30, height: 30, borderRadius: "50%", background: "#e7f6ee", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>✓</span>
          <span style={{ fontSize: 14, fontWeight: 700 }}>Queue cleared — every operator is verified.</span>
        </div>
      </Card>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 700, letterSpacing: "-.4px" }}>Verification queue</div>
          <div style={{ fontSize: 13, color: "#8c8378", fontWeight: 600 }}>Companies awaiting review before they can onboard drivers.</div>
        </div>
        <span style={{ fontSize: 12, fontWeight: 800, color: "#ff6a1a", background: "#fff0e6", borderRadius: 8, padding: "7px 12px" }}>{data.length} pending</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 14 }}>
        {data.map((a) => (
          <button
            key={a.id}
            onClick={() => onReview(a.id)}
            style={{ display: "block", textAlign: "left", width: "100%", background: "#fff", border: "1px solid #ece6db", borderRadius: 18, padding: 18, cursor: "pointer", fontFamily: "'Manrope', sans-serif", boxShadow: "0 14px 36px -30px rgba(27,23,20,.5)" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
              <div style={{ width: 46, height: 46, borderRadius: 13, background: a.bg, color: a.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800, flex: "none" }}>{a.initial}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.company}</div>
                <div style={{ fontSize: 12.5, color: "#8c8378", fontWeight: 600 }}><span style={{ color: a.color, fontWeight: 700 }}>{a.type}</span> · applied {a.date}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, paddingTop: 14, borderTop: "1px solid #f4f0e8" }}>
              <div style={{ fontSize: 12.5, color: "#6b6258", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {a.applicant ?? "—"} · {(a.documents?.length ?? 0)} docs
              </div>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: "#ff6a1a" }}>Review →</span>
            </div>
          </button>
        ))}
      </div>
    </div>
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

// Platform-wide reports for one time window (presets or custom dates). The
// same range feeds the on-screen numbers, the CSV, and the PDF, so what the
// admin sees is exactly what they download.
function ReportsTab({ onToast }: { onToast: (t: ToastMsg) => void }) {
  const [range, setRange] = useState<ReportRangeValue>({ period: "month" });
  const [data, setData] = useState<AdminReports | null>(null);
  const [busy, setBusy] = useState(false);
  const q = rangeQuery(range);

  useEffect(() => {
    if (!isRangeReady(range)) return;
    let active = true;
    setData(null);
    api.adminReports(q).then((d) => active && setData(d)).catch((e) => onToast({ kind: "error", msg: e instanceof Error ? e.message : "Could not load the report" }));
    return () => { active = false; };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportCsv = async () => {
    setBusy(true);
    try { await downloadAuthed(api.adminReportExportUrl("revenue", q), "relay-revenue.csv"); }
    catch (e) { onToast({ kind: "error", msg: e instanceof Error ? e.message : "Export failed" }); }
    finally { setBusy(false); }
  };
  const exportPdf = async () => {
    if (!data) return;
    setBusy(true);
    try {
      await exportReportPdf({
        title: "Platform report",
        subtitle: data.label,
        fileName: `relay-platform-report_${data.from.slice(0, 10)}.pdf`,
        kpis: [
          { label: "Gross volume", value: fmtMoney(data.kpis.grossVolume) },
          { label: "Relay take", value: fmtMoney(data.kpis.platformTake) },
          { label: "Bookings + moto rides", value: `${data.kpis.bookings} + ${data.kpis.rides}` },
          { label: "Active passengers", value: String(data.kpis.activePassengers) },
        ],
        sections: [
          { title: "Gross volume by period", columns: ["Period", "Gross (RWF)"], rows: data.revenueBars.map((b) => [b.m, Math.round(b.value).toLocaleString("en-US")]), align: ["l", "r"] },
          { title: "By transport mode", columns: ["Mode", "Bookings", "Revenue (RWF)", "Share"], rows: data.byMode.map((m) => [m.label, m.bookings, Math.round(m.revenue).toLocaleString("en-US"), `${m.pct}%`]), align: ["l", "r", "r", "r"] },
          { title: "Operators", columns: ["Operator", "Bookings", "Gross (RWF)", `Relay fee (${data.kpis.busFeePct}%)`, "Net to operator"], rows: data.byOperator.map((o) => [o.name, o.bookings, Math.round(o.revenue).toLocaleString("en-US"), Math.round(o.platformFee).toLocaleString("en-US"), Math.round(o.netToOperator).toLocaleString("en-US")]), align: ["l", "r", "r", "r", "r"] },
          { title: "Payment methods", columns: ["Method", "Transactions", "Amount (RWF)"], rows: data.byMethod.map((m) => [m.method, m.count, Math.round(m.amount).toLocaleString("en-US")]), align: ["l", "r", "r"] },
        ],
      });
    } catch (e) { onToast({ kind: "error", msg: e instanceof Error ? e.message : "PDF export failed" }); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <PeriodPicker value={range} onChange={setRange} />
        <ExportButtons onCsv={exportCsv} onPdf={exportPdf} busy={busy || !data} />
      </div>
      {!data ? <Loading /> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 16 }}>
            <StatTile label="Gross volume" value={formatRWF(data.kpis.grossVolume)} sub={`${formatRWF(data.kpis.busRevenue)} bookings · ${formatRWF(data.kpis.motoGross)} moto`} />
            <StatTile label="Relay take" value={formatRWF(data.kpis.platformTake)} sub={`${data.kpis.busFeePct}% booking fee + moto commission`} accent="#1f9d6b" />
            <StatTile label="Bookings · moto rides" value={`${data.kpis.bookings} · ${data.kpis.rides}`} sub={`${data.kpis.paidBookings} paid · ${data.kpis.cancelledBookings} cancelled`} />
            <StatTile label="Active passengers" value={String(data.kpis.activePassengers)} sub={`avg fare ${formatRWF(data.kpis.avgFare)}`} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16, marginBottom: 16 }} className="op-two">
            <Card>
              <CardTitle right={<span style={{ fontSize: 12, color: "#8c8378", fontWeight: 700 }}>{data.label}</span>}>Gross volume</CardTitle>
              <BarChart bars={data.revenueBars} height={150} />
            </Card>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <StatCard label="Moto commission earned" value={formatRWF(data.kpis.motoCommission)} />
              <StatCard label="Multimodal trips" value={`${data.kpis.multimodalPct}%`} />
              <Card>
                <div style={{ fontSize: 12, color: "#8c8378", fontWeight: 600, marginBottom: 8 }}>Bookings by status</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {data.bookingsByStatus.length === 0 && <span style={{ fontSize: 12.5, color: "#8c8378", fontWeight: 600 }}>None in this period</span>}
                  {data.bookingsByStatus.map((s) => (
                    <span key={s.status} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <StatusPill status={s.status} /><span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 700 }}>{s.count}</span>
                    </span>
                  ))}
                </div>
              </Card>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 16, marginBottom: 16 }} className="op-two">
            <Card>
              <CardTitle>By transport mode</CardTitle>
              <ReportTable columns={["Mode", "Bookings", "Revenue", "Share"]} align={["l", "r", "r", "r"]}
                rows={data.byMode.map((m) => [m.label, m.bookings, formatRWF(m.revenue), `${m.pct}%`])} />
            </Card>
            <Card>
              <CardTitle right={<span style={{ fontSize: 12, color: "#8c8378", fontWeight: 700 }}>{data.byOperator.length} with revenue</span>}>Operators</CardTitle>
              <ReportTable columns={["Operator", "Bookings", "Gross", `Relay fee`, "Net"]} align={["l", "r", "r", "r", "r"]}
                rows={data.byOperator.map((o) => [o.name, o.bookings, formatRWF(o.revenue), formatRWF(o.platformFee), formatRWF(o.netToOperator)])} />
            </Card>
          </div>
          <Card>
            <CardTitle>Payment methods</CardTitle>
            <ReportTable columns={["Method", "Transactions", "Amount"]} align={["l", "r", "r"]}
              rows={data.byMethod.map((m) => [m.method.replace("_", " "), m.count, formatRWF(m.amount)])} />
          </Card>
        </>
      )}
    </>
  );
}

// Pickup disputes on moto rides: passenger says "I wasn't picked up", driver
// contested. The escrow is frozen until an admin picks a side here (uncontested
// disputes auto-resolve for the passenger and never need this queue).
function DisputesTab({ onToast }: { onToast: (t: ToastMsg) => void }) {
  const [rows, setRows] = useState<AdminRideDispute[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    api.adminRideDisputes().then(setRows).catch(() => setRows([]));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const resolve = async (d: AdminRideDispute, outcome: "REFUND_PASSENGER" | "PAY_DRIVER") => {
    const msg = outcome === "REFUND_PASSENGER"
      ? `Side with the PASSENGER? ${d.passenger} gets the full ${d.fare !== null ? formatRWF(d.fare) : "fare"} back and ${d.driver} is not paid.`
      : `Side with the DRIVER? ${d.driver} is paid the fare minus the locked commission; ${d.passenger} gets no refund.`;
    if (!window.confirm(msg)) return;
    setBusyId(d.id);
    try {
      await api.adminResolveRideDispute(d.id, outcome);
      onToast({ kind: "success", msg: outcome === "REFUND_PASSENGER" ? "Passenger refunded in full." : "Driver paid out." });
      load();
    } catch (e) {
      onToast({ kind: "error", msg: e instanceof Error ? e.message : "Could not resolve the dispute" });
    } finally {
      setBusyId(null);
    }
  };

  if (!rows) return <Loading />;
  if (rows.length === 0) {
    return (
      <Card>
        <div style={{ padding: 22, textAlign: "center", color: "#8c8378", fontWeight: 600, fontSize: 13.5 }}>
          No open ride disputes — passenger no-pickup reports only land here when the driver contests them.
        </div>
      </Card>
    );
  }

  const fmtT = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {rows.map((d) => (
        <Card key={d.id}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, flex: 1, minWidth: 220 }}>{d.from} → {d.to}</div>
            <span style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", borderRadius: 20, padding: "3px 10px", color: d.contested ? "#c2553f" : "#8c8378", background: d.contested ? "#fbeae6" : "#f1ece2" }}>
              {d.contested ? "Contested — needs verdict" : "Awaiting driver response"}
            </span>
            {d.fare !== null && <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: "#ff6a1a" }}>{formatRWF(d.fare)}</span>}
          </div>
          <div style={{ fontSize: 12.5, color: "#6b6258", fontWeight: 600, lineHeight: 1.7 }}>
            Passenger <b>{d.passenger}</b> (<span style={{ fontFamily: MONO }}>{d.passengerPhone}</span>) reported no pickup at {fmtT(d.disputedAt)}.<br />
            Driver <b>{d.driver}</b> (<span style={{ fontFamily: MONO }}>{d.driverPhone}</span>) claimed pickup at {fmtT(d.pickedUpClaimedAt)}{d.contested && <> and contested at {fmtT(d.contestedAt)}</>}.
            {d.commissionPct !== null && <> Locked commission: {d.commissionPct}%.</>}
          </div>
          {d.contested && (
            <div style={{ display: "flex", gap: 10, marginTop: 13 }}>
              <button
                onClick={() => resolve(d, "REFUND_PASSENGER")}
                disabled={busyId === d.id}
                style={{ background: "#fff", color: "#c2553f", border: "1px solid #f0d4cc", borderRadius: 11, padding: "10px 16px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}
              >
                Refund passenger in full
              </button>
              <button
                onClick={() => resolve(d, "PAY_DRIVER")}
                disabled={busyId === d.id}
                style={{ background: "#1f9d6b", color: "#fff", border: "none", borderRadius: 11, padding: "10px 16px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}
              >
                Pay the driver
              </button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

// Platform-wide knobs. Currently: the commission Relay keeps from each
// moto hail. The rate is locked onto each ride the moment its fare is agreed,
// so changing it here only affects agreements made from now on.
function SettingsTab({ onToast }: { onToast: (t: ToastMsg) => void }) {
  const [pct, setPct] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.adminSettings().then((s) => { setPct(String(s.motoCommissionPct)); setLoaded(true); }).catch(() => setLoaded(true));
  }, []);

  const save = async () => {
    const value = Number(pct);
    if (!Number.isFinite(value) || value < 0 || value > 50) {
      onToast({ kind: "error", msg: "Commission must be between 0 and 50%." });
      return;
    }
    setBusy(true);
    try {
      const r = await api.adminUpdateSettings({ motoCommissionPct: value });
      setPct(String(r.motoCommissionPct));
      onToast({ kind: "success", msg: `Moto commission set to ${r.motoCommissionPct}%.` });
    } catch (e) {
      onToast({ kind: "error", msg: e instanceof Error ? e.message : "Could not save settings" });
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <Loading />;

  return (
    <Card style={{ maxWidth: 620 }}>
      <CardTitle>Moto ride commission</CardTitle>
      <div style={{ fontSize: 13, color: "#8c8378", fontWeight: 600, marginBottom: 16, lineHeight: 1.5 }}>
        Relay keeps this percentage of every moto hail; the driver receives the rest when the passenger confirms
        completion. The rate is locked onto each ride when its fare is agreed, so changes here only affect new agreements.
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input
          value={pct}
          onChange={(e) => setPct(e.target.value.replace(/[^0-9.]/g, ""))}
          inputMode="decimal"
          style={{ width: 120, border: "1px solid #e3ddd1", borderRadius: 11, padding: "11px 13px", fontSize: 15, fontWeight: 700, fontFamily: MONO, outline: "none" }}
        />
        <span style={{ fontSize: 14, fontWeight: 700, color: "#8c8378" }}>%</span>
        <button onClick={save} disabled={busy} style={{ background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 11, padding: "11px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      <div style={{ fontSize: 12, color: "#a39a8d", fontWeight: 600, marginTop: 12 }}>Default: 10% · allowed range 0–50%.</div>
    </Card>
  );
}

function ComplaintsTab() {
  const [data, reload] = useData<AdminOverview>(() => api.adminOverview());
  if (!data) return <Loading />;
  const resolve = async (id: string) => {
    try {
      await api.adminResolveComplaint(id);
      reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Could not resolve this complaint");
    }
  };
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

// "Generate report": pick a report type, a real date range, the breakdowns to
// include, and a format. CSV streams the server export; PDF combines the
// window's summary numbers with the same export's rows.
const REPORT_TYPES: { key: AdminReportType; t: string; d: string }[] = [
  { key: "revenue", t: "Revenue & payouts", d: "Every settled booking and moto hail, with Relay's fee and the net to operator / driver" },
  { key: "bookings", t: "Bookings & trips", d: "Every booking in the window: route, mode, driver, vehicle, payment and status" },
  { key: "passengers", t: "Passenger activity", d: "Per passenger: bookings, moto rides, spend, last activity and wallet balance" },
  { key: "drivers", t: "Driver performance", d: "Per driver: bookings, completed trips, moto rides, gross, commission and ratings" },
];

function GenerateReport({ onClose, onToast }: { onClose: () => void; onToast: (t: ToastMsg) => void }) {
  const [type, setType] = useState<AdminReportType>("revenue");
  const [format, setFormat] = useState<"pdf" | "csv">("pdf");
  const [range, setRange] = useState<ReportRangeValue>({ period: "month" });
  const [include, setInclude] = useState({ byOperator: true, byMode: true, byMethod: false });
  const [preview, setPreview] = useState<AdminReports | null>(null);
  const [busy, setBusy] = useState(false);
  const q = rangeQuery(range);

  useEffect(() => {
    if (!isRangeReady(range)) return;
    let active = true;
    setPreview(null);
    api.adminReports(q).then((d) => active && setPreview(d)).catch(() => undefined);
    return () => { active = false; };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const meta = REPORT_TYPES.find((r) => r.key === type)!;
  const n = (v: number) => Math.round(v).toLocaleString("en-US");

  const generate = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const url = api.adminReportExportUrl(type, q);
      if (format === "csv") {
        await downloadAuthed(url, `relay-${type}.csv`);
      } else {
        const csv = await fetchAuthedCsv(url);
        const k = preview.kpis;
        const kpis =
          type === "revenue" ? [{ label: "Gross volume", value: fmtMoney(k.grossVolume) }, { label: "Relay take", value: fmtMoney(k.platformTake) }, { label: "Booking revenue", value: fmtMoney(k.busRevenue) }, { label: "Moto hails", value: fmtMoney(k.motoGross) }]
          : type === "bookings" ? [{ label: "Bookings", value: String(k.bookings) }, { label: "Paid", value: String(k.paidBookings) }, { label: "Cancelled", value: String(k.cancelledBookings) }, { label: "Multimodal", value: `${k.multimodalPct}%` }]
          : type === "passengers" ? [{ label: "Active passengers", value: String(k.activePassengers) }, { label: "Bookings", value: String(k.bookings) }, { label: "Moto rides", value: String(k.rides) }, { label: "Avg fare", value: fmtMoney(k.avgFare) }]
          : [{ label: "Bookings", value: String(k.bookings) }, { label: "Moto rides", value: String(k.rides) }, { label: "Gross volume", value: fmtMoney(k.grossVolume) }, { label: "Moto commission", value: fmtMoney(k.motoCommission) }];
        const sections: PdfSection[] = [];
        if (include.byOperator) sections.push({ title: "By operator", columns: ["Operator", "Bookings", "Gross (RWF)", "Relay fee", "Net"], rows: preview.byOperator.map((o) => [o.name, o.bookings, n(o.revenue), n(o.platformFee), n(o.netToOperator)]), align: ["l", "r", "r", "r", "r"] });
        if (include.byMode) sections.push({ title: "By transport mode", columns: ["Mode", "Bookings", "Revenue (RWF)", "Share"], rows: preview.byMode.map((m) => [m.label, m.bookings, n(m.revenue), `${m.pct}%`]), align: ["l", "r", "r", "r"] });
        if (include.byMethod) sections.push({ title: "By payment method", columns: ["Method", "Transactions", "Amount (RWF)"], rows: preview.byMethod.map((m) => [m.method, m.count, n(m.amount)]), align: ["l", "r", "r"] });
        // the detail rows — keep the PDF readable by capping columns and rows
        const MAX_ROWS = 400;
        const keepCols = csv.header.map((_, i) => i).filter((i) => i < 8);
        const numeric = (h: string) => /_rwf$|^seats$|^bookings|rides$|rating$|completed|_on_trips$/.test(h);
        sections.push({
          title: `${meta.t} — detail${csv.rows.length > MAX_ROWS ? ` (first ${MAX_ROWS} of ${csv.rows.length}; full list in the CSV)` : ` (${csv.rows.length} rows)`}`,
          columns: keepCols.map((i) => csv.header[i].replace(/_/g, " ")),
          rows: csv.rows.slice(0, MAX_ROWS).map((r) => keepCols.map((i) => (/_at$|^date$|joined|last_activity/.test(csv.header[i]) && r[i] ? new Date(r[i]).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : r[i] ?? ""))),
          align: keepCols.map((i) => (numeric(csv.header[i]) ? "r" : "l")),
        });
        await exportReportPdf({ title: meta.t, subtitle: preview.label, fileName: `relay-${type}_${preview.from.slice(0, 10)}.pdf`, kpis, sections });
      }
      onToast({ kind: "success", msg: `${meta.t} (${format.toUpperCase()}) downloaded.` });
      onClose();
    } catch (e) {
      onToast({ kind: "error", msg: e instanceof Error ? e.message : "Could not generate the report" });
    } finally {
      setBusy(false);
    }
  };

  const toggle = (key: keyof typeof include, label: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{label}</span>
      <button onClick={() => setInclude((s) => ({ ...s, [key]: !s[key] }))} style={{ width: 42, height: 24, borderRadius: 20, background: include[key] ? "#ff6a1a" : "#e3ddd1", position: "relative", border: "none", cursor: "pointer" }}>
        <div style={{ position: "absolute", top: 3, left: include[key] ? 21 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
      </button>
    </div>
  );

  return (
    <div>
      <button onClick={onClose} style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, marginBottom: 20 }}>← Back</button>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }} className="op-two">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card>
            <StepLabel>1 · Report type</StepLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {REPORT_TYPES.map((r) => {
                const sel = r.key === type;
                return (
                  <button key={r.key} onClick={() => setType(r.key)} style={{ display: "flex", alignItems: "center", gap: 12, textAlign: "left", background: sel ? "#fff6f0" : "#fff", border: `1px solid ${sel ? "#ff6a1a" : "#e3ddd1"}`, borderRadius: 13, padding: "13px 15px", cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>
                    <span style={{ width: 20, height: 20, borderRadius: "50%", border: `2px solid ${sel ? "#ff6a1a" : "#cbc3b6"}`, display: "flex", alignItems: "center", justifyContent: "center", color: "#ff6a1a", fontSize: 11, flex: "none" }}>{sel ? "✓" : ""}</span>
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
            <PeriodPicker value={range} onChange={setRange} />
            <div style={{ fontSize: 12, color: "#a39a8d", fontWeight: 600, marginTop: 10 }}>
              {preview ? `${preview.label} · ${preview.kpis.bookings} bookings · ${preview.kpis.rides} moto rides` : isRangeReady(range) ? "Loading…" : "Pick both dates"}
            </div>
          </Card>
          <Card>
            <StepLabel>3 · Breakdowns (PDF summary tables)</StepLabel>
            {toggle("byOperator", "By operator")}
            {toggle("byMode", "By transport mode")}
            {toggle("byMethod", "By payment method")}
            <div style={{ fontSize: 12, color: "#a39a8d", fontWeight: 600, marginTop: 6 }}>The CSV always contains the full line-by-line detail.</div>
          </Card>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: "#1b1714", borderRadius: 18, padding: 20, color: "#fff" }}>
            <div style={{ fontSize: 13, color: "#cfc7bb", fontWeight: 600, marginBottom: 14 }}>Report summary</div>
            <SplitRow label="Type" value={meta.t} />
            <SplitRow label="Range" value={preview?.label ?? "…"} mono />
            <SplitRow label="Operators" value={preview ? `${preview.byOperator.length} with activity` : "…"} />
            <SplitRow label="Gross volume" value={preview ? formatRWF(preview.kpis.grossVolume) : "…"} mono />
            <SplitRow label="Format" value={format.toUpperCase()} />
          </div>
          <Card>
            <StepLabel>Format</StepLabel>
            <div style={{ display: "flex", gap: 9, marginBottom: 16 }}>
              {(["pdf", "csv"] as const).map((f) => (
                <button key={f} onClick={() => setFormat(f)} style={{ flex: 1, textAlign: "center", fontSize: 13, fontWeight: 700, background: f === format ? "#1b1714" : "#fff", color: f === format ? "#fff" : "#1b1714", border: f === format ? "none" : "1px solid #e3ddd1", borderRadius: 10, padding: 10, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>{f.toUpperCase()}</button>
              ))}
            </div>
            <button onClick={generate} disabled={busy || !preview} style={{ width: "100%", background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 13, padding: 14, fontSize: 14.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif", boxShadow: "0 12px 26px -10px rgba(255,106,26,.7)", opacity: busy || !preview ? 0.7 : 1 }}>
              {busy ? "Generating…" : "Generate & download"}
            </button>
            <button onClick={onClose} style={{ width: "100%", background: "none", border: "none", fontSize: 13, fontWeight: 700, color: "#a39a8d", cursor: "pointer", fontFamily: "'Manrope', sans-serif", marginTop: 12 }}>Cancel</button>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* helpers */
// Transient confirmation banner — auto-dismisses. Used to confirm the outcome
// of an approval/rejection so the action never feels silent.
function Toast({ toast, onClose }: { toast: ToastMsg | null; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClose, 4200);
    return () => clearTimeout(t);
  }, [toast]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!toast) return null;
  const success = toast.kind === "success";
  return (
    <div
      role="status"
      className="rel-up"
      style={{
        position: "fixed",
        top: 20,
        right: 20,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        gap: 11,
        maxWidth: 380,
        background: "#fff",
        border: `1px solid ${success ? "#bfe6d3" : "#f0d4cc"}`,
        borderLeft: `4px solid ${success ? "#1f9d6b" : "#c2553f"}`,
        borderRadius: 12,
        padding: "13px 16px",
        boxShadow: "0 18px 44px -20px rgba(27,23,20,.4)",
      }}
    >
      <span style={{ width: 22, height: 22, borderRadius: "50%", flex: "none", background: success ? "#e7f6ee" : "#fbeae6", color: success ? "#1f9d6b" : "#c2553f", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800 }}>
        {success ? "✓" : "!"}
      </span>
      <span style={{ fontSize: 13.5, fontWeight: 700, color: "#1b1714" }}>{toast.msg}</span>
      <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#a39a8d", fontSize: 16, fontWeight: 700, padding: 0, marginLeft: 4, flex: "none", lineHeight: 1 }}>×</button>
    </div>
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
