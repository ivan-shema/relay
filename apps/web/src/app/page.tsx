"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const DISPLAY = "'Space Grotesk', sans-serif";
const MONO = "'JetBrains Mono', monospace";

function Logo({ size = 32 }: { size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 10,
          background: "#1b1714",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ width: size * 0.375, height: size * 0.375, borderRadius: "50%", background: "#ff6a1a" }} />
      </div>
      <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 22, letterSpacing: "-.5px" }}>Relay</div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "#8c8378",
          letterSpacing: ".04em",
          textTransform: "uppercase",
          paddingTop: 3,
        }}
      >
        Transit OS
      </div>
    </div>
  );
}

const modeCards = [
  { code: "B", color: "#2f6bff", bg: "#e9f0ff", title: "City buses", body: "Scheduled routes across town with live seat counts and exact arrival times.", from: "RWF 700" },
  { code: "M", color: "#ff6a1a", bg: "#fff0e6", title: "Moto-taxis", body: "On-demand rides for the last mile — matched to a nearby driver in seconds.", from: "RWF 1,000" },
  { code: "R", color: "#7c5cff", bg: "#efeaff", title: "Shared rides", body: "Direct, comfortable trips you split with others heading the same way.", from: "RWF 3,000" },
];

const steps = [
  { n: "1", title: "Browse live trips", body: "See what every operator is running right now — real seats, fares and arrival times." },
  { n: "2", title: "Book & pay in seconds", body: "Reserve your seat and pay contactless with Mobile Money or your Relay wallet." },
  { n: "3", title: "Track to your seat", body: "Follow your vehicle live on the map until you board, then all the way to your stop." },
];

const realtime = [
  { big: "ETAs", title: "Live arrival times", body: "Countdowns that update as vehicles move — including delays." },
  { big: "Seats", title: "Live availability", body: "See seats left before you commit — full trips are marked." },
  { big: "Pay", title: "Contactless", body: "Mobile Money, Relay wallet or QR — one tap." },
  { big: "Fares", title: "Clear & upfront", body: "Know the price before you book — surge shown honestly." },
];

const faqs = [
  { q: "Do I need an account to see trips?", a: "No — browse live routes, fares and arrival times freely. You only sign in when you're ready to book a seat." },
  { q: "How do I pay?", a: "Pay contactless with Mobile Money, your Relay wallet or a QR code — all from the booking screen." },
  { q: "Can I plan a trip for later?", a: "Yes. Set a trip in Plan ahead and Relay watches for a matching operator departure, then alerts you." },
  { q: "I run a transport business — how do I join?", a: "Apply as an operator partner with your RDB business certificate and ID. Once our team verifies your business, you get a console to list your fleet, publish schedules riders can book, and receive daily payouts." },
];

export default function LandingPage() {
  const router = useRouter();
  const [openFaq, setOpenFaq] = useState(0);

  const goAuth = (mode: "login" | "register" | "apply-operator") => router.push(`/auth?mode=${mode}`);
  const browse = () => router.push("/browse");

  return (
    <div style={{ minHeight: "100vh" }}>
      {/* header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 24,
          padding: "20px 40px",
          maxWidth: 1180,
          margin: "0 auto",
        }}
      >
        <Logo />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => goAuth("login")} style={{ background: "none", border: "none", fontSize: 14, fontWeight: 700, color: "#1b1714", cursor: "pointer", padding: "10px 14px" }}>
            Sign in
          </button>
          <button onClick={() => goAuth("register")} style={{ background: "#1b1714", color: "#fff", border: "none", borderRadius: 12, padding: "11px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            Get started
          </button>
        </div>
      </header>

      {/* hero */}
      <section style={{ maxWidth: 1180, margin: "0 auto", padding: "48px 40px 36px", display: "grid", gridTemplateColumns: "1.1fr .9fr", gap: 48, alignItems: "center" }}>
        <div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #e9e3d8", borderRadius: 30, padding: "7px 14px", marginBottom: 22 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#1f9d6b" }} />
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "#6b6258" }}>Live across 37 operators</span>
          </div>
          <h1 style={{ fontFamily: DISPLAY, fontSize: 54, lineHeight: 1.04, fontWeight: 700, letterSpacing: "-1.6px", margin: "0 0 18px" }}>
            Every ride in your city, one app.
          </h1>
          <p style={{ fontSize: 17, lineHeight: 1.6, color: "#6b6258", margin: "0 0 28px", maxWidth: 480 }}>
            Relay brings buses, moto-taxis and shared rides from every operator into a single place — see live routes, fares,
            seats and arrival times, then book and track in seconds.
          </p>
          <div style={{ display: "flex", gap: 13, marginBottom: 18 }}>
            <button onClick={browse} style={{ background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 15, padding: "17px 28px", fontSize: 16, fontWeight: 700, cursor: "pointer", boxShadow: "0 14px 30px -12px rgba(255,106,26,.7)" }}>
              Browse live trips
            </button>
            <button onClick={() => goAuth("register")} style={{ background: "#fff", color: "#1b1714", border: "1px solid #e3ddd1", borderRadius: 15, padding: "17px 28px", fontSize: 16, fontWeight: 700, cursor: "pointer" }}>
              Create account
            </button>
          </div>
          <div style={{ fontSize: 13, color: "#a39a8d", fontWeight: 600 }}>No account needed to browse — sign in only when you book.</div>
        </div>

        {/* live card */}
        <div style={{ position: "relative" }}>
          <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 22, padding: 18, boxShadow: "0 30px 70px -34px rgba(27,23,20,.4)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#8c8378" }}>Kabeza → Central Market</div>
              <span style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", color: "#ff6a1a", background: "#fff0e6", borderRadius: 7, padding: "4px 9px" }}>Live</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              <HeroTripCard codes={[{ c: "B", bg: "#2f6bff" }, { c: "M", bg: "#ff6a1a" }]} name="Bus 12 → Moto" status="Boarding" statusColor="#ff6a1a" statusBg="#fff0e6" time="09:46" inLabel="· in 4 min" fare="RWF 1,200" />
              <div style={{ opacity: 0.85 }}>
                <HeroTripCard codes={[{ c: "R", bg: "#7c5cff" }]} name="Shared ride" status="Running" statusColor="#1f9d6b" statusBg="#e7f6ee" time="09:44" inLabel="· in 2 min" fare="RWF 3,500" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* trust bar */}
      <section style={{ maxWidth: 1180, margin: "0 auto", padding: "8px 40px" }}>
        <div style={{ textAlign: "center", fontSize: 12, fontWeight: 700, color: "#a39a8d", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 18 }}>
          Trusted by operators across the city
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, flexWrap: "wrap" }}>
          {["Kigali Bus Co.", "Volcano Shuttle", "Twiga Moto", "RideLink Pool", "City Transit"].map((n, i) => (
            <span key={n} style={{ display: "flex", gap: 14, alignItems: "center" }}>
              {i > 0 && <span style={{ color: "#d8d1c4" }}>·</span>}
              <span style={{ fontFamily: DISPLAY, fontSize: 17, fontWeight: 700, color: "#b3aa9c" }}>{n}</span>
            </span>
          ))}
        </div>
      </section>

      {/* modes */}
      <section style={{ maxWidth: 1180, margin: "0 auto", padding: "44px 40px 8px" }}>
        <div style={{ textAlign: "center", maxWidth: 560, margin: "0 auto 28px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "#ff6a1a", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>One app, every mode</div>
          <h2 style={{ fontFamily: DISPLAY, fontSize: 34, fontWeight: 700, letterSpacing: "-1px", margin: 0 }}>Whatever&apos;s running, you can ride it.</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
          {modeCards.map((m) => (
            <div key={m.title} style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 20, padding: 26 }}>
              <div style={{ width: 46, height: 46, borderRadius: 13, background: m.bg, color: m.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 800, fontFamily: MONO, marginBottom: 16 }}>{m.code}</div>
              <div style={{ fontFamily: DISPLAY, fontSize: 19, fontWeight: 700, marginBottom: 7 }}>{m.title}</div>
              <p style={{ fontSize: 14, lineHeight: 1.55, color: "#6b6258", margin: "0 0 14px" }}>{m.body}</p>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "#1b1714" }}>
                from <span style={{ fontFamily: MONO, color: "#ff6a1a" }}>{m.from}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* live tracking */}
      <section style={{ maxWidth: 1180, margin: "0 auto", padding: "44px 40px" }}>
        <div style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 24, padding: 40, display: "grid", gridTemplateColumns: ".9fr 1.1fr", gap: 40, alignItems: "center" }}>
          <div style={{ position: "relative", height: 300, borderRadius: 18, overflow: "hidden", background: "#eef0e9", border: "1px solid #d8e0d6" }}>
            <MapArt />
            <div style={{ position: "absolute", left: 16, top: 16, background: "rgba(255,255,255,.94)", borderRadius: 11, padding: "8px 13px", display: "flex", alignItems: "center", gap: 9, boxShadow: "0 4px 14px -6px rgba(0,0,0,.25)" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#1f9d6b" }} />
              <span style={{ fontSize: 12, fontWeight: 700 }}>Bus 12 · arriving in 3 min</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: "#ff6a1a", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>Live tracking</div>
            <h2 style={{ fontFamily: DISPLAY, fontSize: 32, fontWeight: 700, letterSpacing: "-.9px", lineHeight: 1.1, margin: "0 0 14px" }}>Watch your ride come to you.</h2>
            <p style={{ fontSize: 15, lineHeight: 1.6, color: "#6b6258", margin: "0 0 20px" }}>
              Once you book, follow your vehicle on the map in real time — know exactly when to step outside, board with a tap,
              then track every leg to your stop.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {["Live vehicle position & heading", "Board confirmation & seat number", "Driver details & one-tap contact"].map((t) => (
                <div key={t} style={{ display: "flex", alignItems: "center", gap: 11, fontSize: 14, fontWeight: 600 }}>
                  <span style={{ width: 24, height: 24, borderRadius: 7, background: "#e7f6ee", color: "#1f9d6b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flex: "none" }}>✓</span>
                  {t}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* steps */}
      <section style={{ maxWidth: 1180, margin: "0 auto", padding: "36px 40px", display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
        {steps.map((s) => (
          <div key={s.n} style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 18, padding: 24 }}>
            <div style={{ width: 40, height: 40, borderRadius: 11, background: "#fff0e6", color: "#ff6a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800, marginBottom: 14 }}>{s.n}</div>
            <div style={{ fontFamily: DISPLAY, fontSize: 18, fontWeight: 700, marginBottom: 7 }}>{s.title}</div>
            <p style={{ fontSize: 14, lineHeight: 1.55, color: "#6b6258", margin: 0 }}>{s.body}</p>
          </div>
        ))}
      </section>

      {/* realtime */}
      <section style={{ maxWidth: 1180, margin: "0 auto", padding: "44px 40px 16px" }}>
        <div style={{ textAlign: "center", maxWidth: 560, margin: "0 auto 28px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "#ff6a1a", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>Real-time everything</div>
          <h2 style={{ fontFamily: DISPLAY, fontSize: 34, fontWeight: 700, letterSpacing: "-1px", margin: 0 }}>No more guessing at the stop.</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
          {realtime.map((r) => (
            <div key={r.big} style={{ background: "#fff", border: "1px solid #e9e3d8", borderRadius: 18, padding: 22 }}>
              <div style={{ fontFamily: DISPLAY, fontSize: 24, fontWeight: 700, letterSpacing: "-.5px", marginBottom: 8 }}>{r.big}</div>
              <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 5 }}>{r.title}</div>
              <p style={{ fontSize: 13, lineHeight: 1.5, color: "#6b6258", margin: 0 }}>{r.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* operators */}
      <section style={{ maxWidth: 1180, margin: "0 auto", padding: "24px 40px" }}>
        <div style={{ background: "#1b1714", borderRadius: 24, padding: 44, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", right: -90, top: -90, width: 280, height: 280, borderRadius: "50%", background: "radial-gradient(circle,rgba(255,106,26,.2),transparent 68%)" }} />
          <div style={{ color: "#fff", position: "relative", zIndex: 1 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: "#ff6a1a", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 12 }}>For operators &amp; drivers</div>
            <div style={{ fontFamily: DISPLAY, fontSize: 28, fontWeight: 700, letterSpacing: "-.7px", marginBottom: 12 }}>Put your fleet on the map.</div>
            <p style={{ fontSize: 15, lineHeight: 1.6, color: "#cfc7bb", margin: "0 0 22px", maxWidth: 440 }}>
              Manage vehicles, drivers and schedules from one console — and reach every rider searching your route. Drivers get
              assigned trips, live navigation and instant payouts.
            </p>
            <button onClick={() => goAuth("apply-operator")} style={{ background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 14, padding: "15px 24px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
              Partner with Relay
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, position: "relative", zIndex: 1 }}>
            {[
              { icon: "◉", title: "Live fleet monitoring", sub: "Track every vehicle in real time" },
              { icon: "◷", title: "Schedule & dispatch", sub: "Publish departures riders can book" },
              { icon: "◈", title: "Instant payouts", sub: "Daily settlement to Mobile Money" },
            ].map((f) => (
              <div key={f.title} style={{ background: "#2a2520", borderRadius: 14, padding: "16px 18px", display: "flex", alignItems: "center", gap: 13 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: "#3a332c", color: "#ff6a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flex: "none" }}>{f.icon}</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{f.title}</div>
                  <div style={{ fontSize: 12.5, color: "#9a9186" }}>{f.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* faq */}
      <section style={{ maxWidth: 780, margin: "0 auto", padding: "44px 40px" }}>
        <h2 style={{ fontFamily: DISPLAY, fontSize: 30, fontWeight: 700, letterSpacing: "-.8px", textAlign: "center", margin: "0 0 28px" }}>Questions, answered</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {faqs.map((f, i) => (
            <button key={f.q} onClick={() => setOpenFaq(openFaq === i ? -1 : i)} style={{ textAlign: "left", background: "#fff", border: "1px solid #e9e3d8", borderRadius: 16, padding: "20px 22px", cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 15.5, fontWeight: 700 }}>{f.q}</div>
                <span style={{ color: openFaq === i ? "#ff6a1a" : "#cbc3b6", fontSize: 18 }}>{openFaq === i ? "–" : "+"}</span>
              </div>
              {openFaq === i && <p style={{ fontSize: 14, lineHeight: 1.55, color: "#6b6258", margin: "10px 0 0" }}>{f.a}</p>}
            </button>
          ))}
        </div>
      </section>

      {/* bottom CTA */}
      <section style={{ maxWidth: 1180, margin: "0 auto", padding: "8px 40px 56px" }}>
        <div style={{ background: "#fff6f0", border: "1px solid #ffd9c2", borderRadius: 24, padding: 48, textAlign: "center" }}>
          <h2 style={{ fontFamily: DISPLAY, fontSize: 36, fontWeight: 700, letterSpacing: "-1.1px", margin: "0 0 12px" }}>Your next ride is already running.</h2>
          <p style={{ fontSize: 16, color: "#6b6258", margin: "0 0 24px" }}>See what&apos;s departing near you right now.</p>
          <div style={{ display: "flex", gap: 13, justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={browse} style={{ background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 15, padding: "17px 30px", fontSize: 16, fontWeight: 700, cursor: "pointer", boxShadow: "0 14px 30px -12px rgba(255,106,26,.7)" }}>Browse live trips</button>
            <button onClick={() => goAuth("register")} style={{ background: "#fff", color: "#1b1714", border: "1px solid #e3ddd1", borderRadius: 15, padding: "17px 30px", fontSize: 16, fontWeight: 700, cursor: "pointer" }}>Create account</button>
          </div>
        </div>
      </section>

      {/* footer */}
      <footer style={{ borderTop: "1px solid #e9e3d8", background: "#fbf9f4" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "44px 40px", display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 32 }}>
          <div>
            <Logo size={28} />
            <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "#8c8378", margin: "12px 0 0", maxWidth: 260 }}>
              The transport operating system for the city — every operator, every ride, one app.
            </p>
          </div>
          {[
            { h: "Product", items: ["Browse trips", "Plan ahead", "Wallet", "Live tracking"] },
            { h: "Operators", items: ["Become a partner", "Operator console", "Driver app", "Payouts"] },
            { h: "Company", items: ["About", "Careers", "Support", "Privacy"] },
          ].map((col) => (
            <div key={col.h}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#1b1714", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 13 }}>{col.h}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 9, fontSize: 13.5, color: "#6b6258", fontWeight: 600 }}>
                {col.items.map((it) =>
                  it === "Become a partner" ? (
                    <button key={it} onClick={() => goAuth("apply-operator")} style={{ background: "none", border: "none", padding: 0, textAlign: "left", fontSize: 13.5, color: "#ff6a1a", fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif" }}>
                      {it} →
                    </button>
                  ) : (
                    <span key={it}>{it}</span>
                  )
                )}
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
    </div>
  );
}

function HeroTripCard(props: {
  codes: { c: string; bg: string }[];
  name: string;
  status: string;
  statusColor: string;
  statusBg: string;
  time: string;
  inLabel: string;
  fare: string;
}) {
  return (
    <div style={{ border: "1px solid #e9e3d8", borderRadius: 14, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          {props.codes.map((c, i) => (
            <span key={i} style={{ width: 20, height: 20, borderRadius: 6, background: c.bg, color: "#fff", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO }}>{c.c}</span>
          ))}
          <span style={{ fontSize: 13, fontWeight: 700 }}>{props.name}</span>
        </div>
        <span style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", color: props.statusColor, background: props.statusBg, borderRadius: 6, padding: "3px 8px" }}>{props.status}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 18, fontWeight: 700 }}>
          {props.time} <span style={{ fontSize: 12, color: "#8c8378", fontWeight: 600 }}>{props.inLabel}</span>
        </div>
        <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, color: "#ff6a1a" }}>{props.fare}</span>
      </div>
    </div>
  );
}

function MapArt() {
  return (
    <svg viewBox="0 0 500 300" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <rect width="500" height="300" fill="#eef0e9" />
      <path d="M-20 90 C 120 60, 200 150, 360 130 S 520 170, 540 150 L 540 200 C 420 220, 300 150, 180 175 S 20 150, -20 170 Z" fill="#cfe0ec" />
      <circle cx="120" cy="220" r="40" fill="#d6e6cf" />
      <rect x="330" y="40" width="90" height="64" rx="14" fill="#d6e6cf" />
      <g stroke="#fff" strokeWidth="9" fill="none" strokeLinecap="round">
        <path d="M30 60 C 160 90, 240 220, 470 240" />
        <path d="M90 20 C 120 140, 70 220, 140 290" />
      </g>
      <g stroke="#f3c98b" strokeWidth="5" fill="none" strokeLinecap="round">
        <path d="M30 60 C 160 90, 240 220, 470 240" />
      </g>
      <path d="M60 70 C 180 100, 250 210, 430 235" fill="none" stroke="#ff6a1a" strokeWidth="4" strokeLinecap="round" strokeDasharray="1 9" />
      <circle cx="60" cy="70" r="8" fill="#1b1714" stroke="#fff" strokeWidth="3" />
      <circle cx="430" cy="235" r="8" fill="#ff6a1a" stroke="#fff" strokeWidth="3" />
      <g transform="translate(250,165)">
        <circle r="14" fill="#1b1714" opacity="0.14" />
        <circle r="10" fill="#1b1714" stroke="#fff" strokeWidth="3" />
      </g>
    </svg>
  );
}
