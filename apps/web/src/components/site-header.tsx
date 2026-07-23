"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { homePathForRole, useAuth } from "@/lib/auth-context";

const DISPLAY = "'Space Grotesk', sans-serif";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/browse", label: "Browse trips" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
] as const;

function Logo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
      <div style={{ width: 32, height: 32, borderRadius: 10, background: "#1b1714", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff6a1a" }} />
      </div>
      <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 22, letterSpacing: "-.5px" }}>Relay</div>
    </div>
  );
}

function UserMenu({ user, signOut }: { user: { firstName: string; lastName: string; role: string }; signOut: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const initials = `${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}`.toUpperCase();
  const dashboardPath = homePathForRole(user.role as Parameters<typeof homePathForRole>[0]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: 9, background: "none", border: "1px solid #e3ddd1", borderRadius: 30, padding: "6px 14px 6px 6px", cursor: "pointer" }}
      >
        <span style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,#ff8a3d,#e0560c)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800 }}>
          {initials}
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: "#1b1714" }}>{user.firstName}</span>
        <span style={{ fontSize: 10, color: "#a39a8d" }}>▾</span>
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            background: "#fff",
            border: "1px solid #e9e3d8",
            borderRadius: 14,
            boxShadow: "0 20px 44px -18px rgba(27,23,20,.28)",
            minWidth: 190,
            padding: 6,
            zIndex: 20,
          }}
        >
          {[
            { label: "Dashboard", onClick: () => router.push(dashboardPath) },
            { label: "Profile", onClick: () => router.push(dashboardPath) },
          ].map((item) => (
            <button
              key={item.label}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderRadius: 9, padding: "10px 12px", fontSize: 13.5, fontWeight: 600, color: "#1b1714", cursor: "pointer" }}
            >
              {item.label}
            </button>
          ))}
          <div style={{ height: 1, background: "#eee7da", margin: "4px 6px" }} />
          <button
            onClick={() => {
              setOpen(false);
              signOut();
              router.push("/");
            }}
            style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderRadius: 9, padding: "10px 12px", fontSize: 13.5, fontWeight: 600, color: "#c4432a", cursor: "pointer" }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

// Shared top nav for the public marketing pages (landing, browse, about, contact).
// Authenticated app/console pages use their own ConsoleShell nav instead.
export function SiteHeader({ active }: { active?: (typeof NAV_LINKS)[number]["href"] }) {
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const goAuth = (mode: "login" | "register") => router.push(`/auth?mode=${mode}`);

  return (
    <header className="rel-site-header" style={{ background: "#fff", borderBottom: "1px solid #e9e3d8" }}>
      <div
        className="rel-header-inner"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 24,
          padding: "20px 40px",
          maxWidth: 1180,
          margin: "0 auto",
          flexWrap: "wrap",
        }}
      >
        <button onClick={() => router.push("/")} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
          <Logo />
        </button>

        <nav className="rel-site-nav" style={{ display: "flex", alignItems: "center", gap: 26 }}>
          {NAV_LINKS.map((l) => (
            <button
              key={l.href}
              onClick={() => router.push(l.href)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                fontSize: 14,
                fontWeight: 700,
                color: active === l.href ? "#ff6a1a" : "#6b6258",
              }}
            >
              {l.label}
            </button>
          ))}
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {loading ? null : user ? (
            <UserMenu user={user} signOut={signOut} />
          ) : (
            <>
              <button onClick={() => goAuth("login")} style={{ background: "none", border: "none", fontSize: 14, fontWeight: 700, color: "#1b1714", cursor: "pointer", padding: "10px 14px" }}>
                Sign in
              </button>
              <button onClick={() => goAuth("register")} style={{ background: "#1b1714", color: "#fff", border: "none", borderRadius: 12, padding: "11px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                Get started
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
