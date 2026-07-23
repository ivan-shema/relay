"use client";

import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

const DISPLAY = "'Space Grotesk', sans-serif";
const MONO = "'JetBrains Mono', monospace";

const stats = [
  { n: "37", label: "Operators live on the platform" },
  { n: "3", label: "Modes unified — bus, moto, shared ride" },
  { n: "2026", label: "Founded in Kigali" },
];

const values = [
  { icon: "◉", title: "Transparent by default", body: "Live fares, seats and arrival times — no surprises, no hidden surge, no guessing at the stop." },
  { icon: "◈", title: "Built for every operator", body: "From a single moto driver to a city-wide bus fleet, the same tools apply — list routes, get paid daily." },
  { icon: "◷", title: "Reliable, real-time data", body: "Vehicle positions and ETAs update continuously, so what you see on your phone matches the street." },
];

export default function AboutPage() {
  const router = useRouter();
  const goAuth = (mode: "login" | "register") => router.push(`/auth?mode=${mode}`);

  return (
    <div className="rel-landing" style={{ minHeight: "100vh" }}>
      <SiteHeader active="/about" />

      {/* hero */}
      <section style={{ maxWidth: 780, margin: "0 auto", padding: "48px 40px 8px", textAlign: "center" }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: "#ff6a1a", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 14 }}>About Relay</div>
        <h1 style={{ fontFamily: DISPLAY, fontSize: 46, lineHeight: 1.08, fontWeight: 700, letterSpacing: "-1.3px", margin: "0 0 18px" }}>
          The operating system for how a city moves.
        </h1>
        <p style={{ fontSize: 17, lineHeight: 1.6, color: "#6b6258", margin: "0 auto", maxWidth: 560 }}>
          Kigali runs on dozens of independent bus companies, moto-taxi cooperatives and ride-share operators — each with
          their own schedules, fares and radios. Relay brings them into one app, so a rider never has to guess what&apos;s
          running or where.
        </p>
      </section>

      {/* stats */}
      <section style={{ maxWidth: 1180, margin: "0 auto", padding: "36px 40px", display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
        {stats.map((s) => (
          <div key={s.label} style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 18, padding: 26, textAlign: "center" }}>
            <div style={{ fontFamily: DISPLAY, fontSize: 34, fontWeight: 700, color: "#ff6a1a", letterSpacing: "-1px", marginBottom: 8 }}>{s.n}</div>
            <div style={{ fontSize: 13.5, color: "#6b6258", fontWeight: 600, lineHeight: 1.4 }}>{s.label}</div>
          </div>
        ))}
      </section>

      {/* story */}
      <section style={{ maxWidth: 1180, margin: "0 auto", padding: "24px 40px 44px" }}>
        <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 24, padding: 44, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: "#ff6a1a", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>Why we built this</div>
            <h2 style={{ fontFamily: DISPLAY, fontSize: 28, fontWeight: 700, letterSpacing: "-.7px", margin: "0 0 14px" }}>One app, instead of one app per operator.</h2>
            <p style={{ fontSize: 15, lineHeight: 1.6, color: "#6b6258", margin: 0 }}>
              Riders were juggling word-of-mouth schedules and cash fares. Operators were stuck managing bookings on
              paper and WhatsApp. Relay gives both sides the same real-time layer — live trips for riders, and a single
              console for operators to run their fleet and get paid daily.
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {["Verified operators, checked against RDB business records", "Contactless payment — Mobile Money, wallet or QR", "Every trip trackable end to end, for riders and support alike"].map((t) => (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 11, fontSize: 14, fontWeight: 600 }}>
                <span style={{ width: 24, height: 24, borderRadius: 7, background: "#e7f6ee", color: "#1f9d6b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flex: "none" }}>✓</span>
                {t}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* values */}
      <section style={{ maxWidth: 1180, margin: "0 auto", padding: "8px 40px 44px" }}>
        <div style={{ textAlign: "center", maxWidth: 560, margin: "0 auto 28px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "#ff6a1a", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>What we care about</div>
          <h2 style={{ fontFamily: DISPLAY, fontSize: 34, fontWeight: 700, letterSpacing: "-1px", margin: 0 }}>Built on a few simple rules.</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
          {values.map((v) => (
            <div key={v.title} style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 20, padding: 26 }}>
              <div style={{ width: 46, height: 46, borderRadius: 13, background: "#fff0e6", color: "#ff6a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontFamily: MONO, marginBottom: 16 }}>{v.icon}</div>
              <div style={{ fontFamily: DISPLAY, fontSize: 19, fontWeight: 700, marginBottom: 7 }}>{v.title}</div>
              <p style={{ fontSize: 14, lineHeight: 1.55, color: "#6b6258", margin: 0 }}>{v.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* bottom CTA */}
      <section style={{ maxWidth: 1180, margin: "0 auto", padding: "8px 40px 56px" }}>
        <div style={{ background: "#1b1714", borderRadius: 24, padding: 48, textAlign: "center", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", right: -90, top: -90, width: 280, height: 280, borderRadius: "50%", background: "radial-gradient(circle,rgba(255,106,26,.25),transparent 68%)" }} />
          <div style={{ position: "relative", zIndex: 1 }}>
            <h2 style={{ fontFamily: DISPLAY, fontSize: 32, fontWeight: 700, letterSpacing: "-.9px", color: "#fff", margin: "0 0 12px" }}>Want to bring your fleet on board?</h2>
            <p style={{ fontSize: 15, color: "#cfc7bb", margin: "0 0 24px" }}>Apply as an operator partner and reach every rider searching your route.</p>
            <div style={{ display: "flex", gap: 13, justifyContent: "center", flexWrap: "wrap" }}>
              <button onClick={() => goAuth("register")} style={{ background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 15, padding: "17px 30px", fontSize: 16, fontWeight: 700, cursor: "pointer", boxShadow: "0 14px 30px -12px rgba(255,106,26,.7)" }}>
                Partner with Relay
              </button>
              <button onClick={() => router.push("/contact")} style={{ background: "transparent", color: "#fff", border: "1px solid #4a433b", borderRadius: 15, padding: "17px 30px", fontSize: 16, fontWeight: 700, cursor: "pointer" }}>
                Contact us
              </button>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
