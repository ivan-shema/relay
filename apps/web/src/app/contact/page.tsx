"use client";

import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

const DISPLAY = "'Space Grotesk', sans-serif";
const MONO = "'JetBrains Mono', monospace";

const channels = [
  { icon: "◈", title: "Rider support", body: "Questions about a trip, payment or your account.", label: "support@relay.app", href: "mailto:support@relay.app" },
  { icon: "◉", title: "Operator partnerships", body: "Bring your fleet onto Relay or ask about the console.", label: "partners@relay.app", href: "mailto:partners@relay.app" },
  { icon: "◷", title: "Press & media", body: "Interview requests and press enquiries.", label: "hello@relay.app", href: "mailto:hello@relay.app" },
];

export default function ContactPage() {
  return (
    <div className="rel-landing" style={{ minHeight: "100vh" }}>
      <SiteHeader active="/contact" />

      {/* hero */}
      <section style={{ maxWidth: 780, margin: "0 auto", padding: "48px 40px 8px", textAlign: "center" }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: "#ff6a1a", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 14 }}>Contact</div>
        <h1 style={{ fontFamily: DISPLAY, fontSize: 46, lineHeight: 1.08, fontWeight: 700, letterSpacing: "-1.3px", margin: "0 0 18px" }}>
          Talk to us.
        </h1>
        <p style={{ fontSize: 17, lineHeight: 1.6, color: "#6b6258", margin: "0 auto", maxWidth: 520 }}>
          Whether you&apos;re a rider with a question, an operator looking to join the platform, or press — here&apos;s
          the fastest way to reach the right team.
        </p>
      </section>

      {/* channels */}
      <section style={{ maxWidth: 1180, margin: "0 auto", padding: "36px 40px", display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
        {channels.map((c) => (
          <a key={c.title} href={c.href} style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 20, padding: 26, textDecoration: "none", color: "inherit", display: "block" }}>
            <div style={{ width: 46, height: 46, borderRadius: 13, background: "#fff0e6", color: "#ff6a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontFamily: MONO, marginBottom: 16 }}>{c.icon}</div>
            <div style={{ fontFamily: DISPLAY, fontSize: 19, fontWeight: 700, marginBottom: 7 }}>{c.title}</div>
            <p style={{ fontSize: 14, lineHeight: 1.55, color: "#6b6258", margin: "0 0 14px" }}>{c.body}</p>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "#ff6a1a", fontFamily: MONO }}>{c.label} →</div>
          </a>
        ))}
      </section>

      {/* office */}
      <section style={{ maxWidth: 1180, margin: "0 auto", padding: "8px 40px 56px" }}>
        <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 24, padding: 44, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: "#ff6a1a", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>Office</div>
            <h2 style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 700, letterSpacing: "-.6px", margin: "0 0 14px" }}>Kigali, Rwanda</h2>
            <p style={{ fontSize: 14.5, lineHeight: 1.7, color: "#6b6258", margin: 0 }}>
              KG 7 Ave, Kigali Heights<br />
              Kacyiru, Gasabo District<br />
              Kigali, Rwanda
            </p>
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: "#ff6a1a", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>Phone</div>
            <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 700, marginBottom: 14 }}>+250 788 000 000</div>
            <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "#6b6258", margin: 0 }}>Mon – Sat, 7:00 – 20:00 CAT</p>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
