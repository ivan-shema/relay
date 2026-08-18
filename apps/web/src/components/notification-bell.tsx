"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type NotificationList } from "@/lib/api";
import { Pagination } from "@/components/console";

const DISPLAY = "'Space Grotesk', sans-serif";
const MONO = "'JetBrains Mono', monospace";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

// Persistent notifications bell (top bar). Shows an unread count and opens a
// dropdown panel anchored to the bell's top-right corner. Refreshes the count
// whenever the panel closes. Shared by the passenger app and operator console.
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  // Bumped on every SSE push so an open panel reloads its list live.
  const [liveVersion, setLiveVersion] = useState(0);

  const refresh = useCallback(() => {
    api.notifications().then((n) => setUnread(n.unread)).catch(() => undefined);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // Real-time: the API pushes a "notification" event over SSE whenever one is
  // created (payment settled, driver assigned, …). The count/list refresh on
  // push; the refresh-on-open/close behaviour below stays as the fallback.
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let stream: EventSource | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      stream = new EventSource(api.streamUrl());
      stream.addEventListener("notification", () => {
        refresh();
        setLiveVersion((v) => v + 1);
      });
      // On error (network change, expired token) the browser gives up for
      // non-200s — close and retry with the current token after a pause.
      stream.onerror = () => {
        stream?.close();
        if (!closed) retryRef.current = setTimeout(connect, 15_000);
      };
    };
    connect();

    return () => {
      closed = true;
      stream?.close();
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [refresh]);

  const close = () => { setOpen(false); refresh(); };

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => (open ? close() : setOpen(true))}
        aria-label="Notifications"
        style={{ position: "relative", width: 44, height: 44, borderRadius: 13, background: open ? "#1b1714" : "#fff", border: `1px solid ${open ? "#1b1714" : "#e9e3d8"}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 18px -12px rgba(27,23,20,.4)" }}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={open ? "#fff" : "#1b1714"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span style={{ position: "absolute", top: -5, right: -5, minWidth: 18, height: 18, padding: "0 5px", borderRadius: 20, background: "#ff6a1a", color: "#fff", fontSize: 10.5, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #f4f1ea" }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          {/* invisible click-catcher closes the dropdown on outside click */}
          <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 55 }} />
          <div
            className="rel-up"
            style={{ position: "absolute", top: "calc(100% + 10px)", right: 0, zIndex: 60, width: "min(384px, calc(100vw - 32px))", maxHeight: "min(70vh, 540px)", background: "#fff", borderRadius: 18, border: "1px solid #e9e3d8", boxShadow: "0 30px 70px -30px rgba(27,23,20,.5)", display: "flex", flexDirection: "column", overflow: "hidden" }}
          >
            <NotificationsPanel onClose={close} liveVersion={liveVersion} />
          </div>
        </>
      )}
    </div>
  );
}

function NotificationsPanel({ onClose, liveVersion }: { onClose: () => void; liveVersion: number }) {
  const [data, setData] = useState<NotificationList | null>(null);
  const [page, setPage] = useState(1);
  // liveVersion in the deps reloads the open panel when an SSE push arrives
  const load = useCallback(() => { api.notifications(page).then(setData).catch(() => undefined); }, [page, liveVersion]);
  useEffect(() => { load(); }, [load]);

  const readAll = async () => { await api.markAllNotificationsRead(); load(); };
  const readOne = async (id: string) => { await api.markNotificationRead(id); load(); };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "15px 16px", borderBottom: "1px solid #f1ece2" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ fontFamily: DISPLAY, fontSize: 16, fontWeight: 700, letterSpacing: "-.3px" }}>Notifications</span>
          {data && data.unread > 0 && <span style={{ background: "#fff0e6", color: "#ff6a1a", fontSize: 10.5, fontWeight: 800, borderRadius: 20, padding: "2px 8px" }}>{data.unread} new</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {data && data.unread > 0 && <button onClick={readAll} style={{ background: "none", border: "none", color: "#ff6a1a", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Mark all read</button>}
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "#a39a8d", fontSize: 19, fontWeight: 700, cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 9 }}>
        {data && data.items.length === 0 && (
          <div style={{ textAlign: "center", padding: "36px 0", color: "#8c8378" }}>
            <div style={{ width: 50, height: 50, borderRadius: 15, background: "#f4f1ea", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#cbc3b6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>You&apos;re all caught up</div>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 3 }}>No notifications yet.</div>
          </div>
        )}
        {data?.items.map((n) => (
          <button key={n.id} onClick={() => !n.read && readOne(n.id)} style={{ textAlign: "left", display: "flex", gap: 11, background: n.read ? "#fff" : "#fff6f0", border: `1px solid ${n.read ? "#eee7da" : "#ffd9c2"}`, borderRadius: 13, padding: 12, cursor: n.read ? "default" : "pointer" }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "#fff0e6", color: "#ff6a1a", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>{n.title}</span>
                {!n.read && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ff6a1a", flex: "none" }} />}
              </div>
              <div style={{ fontSize: 12, color: "#6b6258", lineHeight: 1.4, marginTop: 2 }}>{n.body}</div>
            </div>
            <div style={{ fontSize: 10.5, color: "#a39a8d", fontFamily: MONO, flex: "none" }}>{fmtDate(n.time)}</div>
          </button>
        ))}
      </div>

      {data && data.totalPages > 1 && (
        <div style={{ borderTop: "1px solid #f1ece2", padding: "6px 12px" }}>
          <Pagination page={page} totalPages={data.totalPages} total={data.total} onPage={setPage} />
        </div>
      )}
    </>
  );
}
