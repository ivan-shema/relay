"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

const DISPLAY = "'Space Grotesk', sans-serif";

export function AppHeader() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 30,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 24,
        padding: "16px 28px",
        background: "rgba(244,241,234,.82)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid #e9e3d8",
      }}
    >
      <button onClick={() => router.push("/")} style={{ display: "flex", alignItems: "center", gap: 11, background: "none", border: "none", cursor: "pointer" }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, background: "#1b1714", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 11, height: 11, borderRadius: "50%", background: "#ff6a1a" }} />
        </div>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 21, letterSpacing: "-.5px" }}>Relay</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#8c8378", letterSpacing: ".04em", textTransform: "uppercase", paddingTop: 3 }}>Transit OS</div>
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {user ? (
          <div style={{ position: "relative" }}>
            <button onClick={() => setMenuOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 7, background: "#fff", border: "1px solid #e9e3d8", borderRadius: 30, padding: "4px 10px 4px 4px", cursor: "pointer" }}>
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg,#ff8a3d,#e0560c)" }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "#1b1714" }}>{user.fullName.split(" ")[0]}</span>
              <span style={{ fontSize: 10, color: "#a39a8d" }}>▾</span>
            </button>
            {menuOpen && (
              <div style={{ position: "absolute", right: 0, top: 46, width: 248, background: "#fff", border: "1px solid #e3ddd1", borderRadius: 16, boxShadow: "0 20px 50px -22px rgba(27,23,20,.4)", overflow: "hidden", zIndex: 40 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, background: "#faf8f4", borderBottom: "1px solid #ece6db" }}>
                  <div style={{ width: 42, height: 42, borderRadius: "50%", background: "linear-gradient(135deg,#ff8a3d,#e0560c)", flex: "none" }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700 }}>{user.fullName}</div>
                    <div style={{ fontSize: 12, color: "#8c8378", fontFamily: "'JetBrains Mono', monospace", overflow: "hidden", textOverflow: "ellipsis" }}>{user.email}</div>
                  </div>
                </div>
                <div style={{ padding: "14px 16px 6px" }}>
                  <span style={{ fontSize: 10.5, fontWeight: 800, color: "#ff6a1a", background: "#fff0e6", borderRadius: 6, padding: "3px 9px", textTransform: "uppercase", letterSpacing: ".04em" }}>{user.role}</span>
                </div>
                <div style={{ padding: 6 }}>
                  <button onClick={() => { signOut(); setMenuOpen(false); router.push("/"); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 10, fontSize: 13.5, fontWeight: 700, color: "#c2553f", cursor: "pointer", background: "none", border: "none", textAlign: "left" }}>
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <button onClick={() => router.push("/auth?mode=login")} style={{ background: "#1b1714", color: "#fff", border: "none", borderRadius: 12, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            Sign in
          </button>
        )}
      </div>
    </header>
  );
}
