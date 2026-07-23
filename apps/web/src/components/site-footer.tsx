"use client";

import { useRouter } from "next/navigation";

const DISPLAY = "'Space Grotesk', sans-serif";

function Logo({ size = 28 }: { size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
      <div style={{ width: size, height: size, borderRadius: 10, background: "#1b1714", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: size * 0.375, height: size * 0.375, borderRadius: "50%", background: "#ff6a1a" }} />
      </div>
      <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 22, letterSpacing: "-.5px" }}>Relay</div>
    </div>
  );
}

const COLUMNS = [
  { h: "Product", items: ["Browse trips", "Plan ahead", "Wallet", "Live tracking"] },
  { h: "Operators", items: ["Become a partner", "Operator console", "Driver app", "Payouts"] },
  { h: "Company", items: ["About", "Careers", "Contact", "Privacy"] },
];

// Shared footer for the public marketing pages (landing, browse, about, contact).
export function SiteFooter() {
  const router = useRouter();
  const goAuth = (mode: "login" | "register") => router.push(`/auth?mode=${mode}`);

  return (
    <footer style={{ borderTop: "1px solid #e9e3d8", background: "#fbf9f4" }}>
      <div className="rel-footer-grid" style={{ maxWidth: 1180, margin: "0 auto", padding: "44px 40px", display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 32 }}>
        <div>
          <button onClick={() => router.push("/")} style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
            <Logo />
          </button>
          <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "#8c8378", margin: "12px 0 0", maxWidth: 260 }}>
            The transport operating system for the city — every operator, every ride, one app.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.h}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#1b1714", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 13 }}>{col.h}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9, fontSize: 13.5, color: "#6b6258", fontWeight: 600 }}>
              {col.items.map((it) => {
                if (it === "Become a partner") {
                  return (
                    <button key={it} onClick={() => goAuth("register")} style={{ background: "none", border: "none", padding: 0, textAlign: "left", fontSize: 13.5, color: "#ff6a1a", fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>
                      {it} →
                    </button>
                  );
                }
                if (it === "Browse trips" || it === "About" || it === "Contact") {
                  const href = it === "Browse trips" ? "/browse" : `/${it.toLowerCase()}`;
                  return (
                    <button key={it} onClick={() => router.push(href)} style={{ background: "none", border: "none", padding: 0, textAlign: "left", fontSize: 13.5, color: "#6b6258", fontWeight: 600, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>
                      {it}
                    </button>
                  );
                }
                return <span key={it}>{it}</span>;
              })}
            </div>
          </div>
        ))}
      </div>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 40px 36px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, borderTop: "1px solid #ece6db", paddingTop: 24 }}>
        <div style={{ fontSize: 13, color: "#a39a8d", fontWeight: 600 }}>© 2026 Relay Transit OS · Kigali</div>
        <div style={{ display: "flex", gap: 18, fontSize: 13, color: "#a39a8d", fontWeight: 600 }}>
          <span>Terms</span><span>Privacy</span><span>Status</span>
        </div>
      </div>
    </footer>
  );
}
