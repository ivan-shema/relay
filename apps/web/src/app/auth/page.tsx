"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { AuthUser, UserRole, TransportMode } from "@relay/shared";
import { loginSchema, registerSchema, forgotSchema, otpFormSchema, newPasswordSchema, applyOperatorSchema } from "@relay/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth, homePathForRole } from "@/lib/auth-context";

const DISPLAY = "'Space Grotesk', sans-serif";
const MONO = "'JetBrains Mono', monospace";

type Screen = "login" | "register" | "apply-operator" | "verify" | "forgot" | "sent" | "newpass";

export default function AuthPage() {
  return (
    <Suspense fallback={null}>
      <AuthInner />
    </Suspense>
  );
}

function AuthInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { signIn, setSession } = useAuth();

  const mode = params.get("mode");
  const [screen, setScreen] = useState<Screen>(mode === "apply-operator" ? "apply-operator" : mode === "register" ? "register" : "login");
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [resetCode, setResetCode] = useState("");

  const goHome = (u: AuthUser | UserRole) => router.push(homePathForRole(typeof u === "string" ? u : u.role));

  const onRegistered = (userId: string, role: UserRole, needsVerify: boolean) => {
    setPendingUserId(userId);
    if (needsVerify) setScreen("verify");
    else goHome(role);
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
      <div style={{ width: "100%", maxWidth: 960, background: "#fff", border: "1px solid #e3ddd1", borderRadius: 24, overflow: "hidden", display: "flex", boxShadow: "0 40px 90px -40px rgba(27,23,20,.45)", minHeight: 600 }}>
        <BrandPanel />
        <div style={{ flex: 1, padding: "42px 46px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          {screen === "login" && (
            <LoginForm signIn={signIn} onForgot={() => setScreen("forgot")} onRegister={() => setScreen("register")} onDone={goHome} />
          )}
          {screen === "register" && (
            <RegisterForm
              setSession={setSession}
              onLogin={() => setScreen("login")}
              onApplyOperator={() => setScreen("apply-operator")}
              onRegistered={onRegistered}
            />
          )}
          {screen === "apply-operator" && (
            <ApplyOperatorForm setSession={setSession} onBack={() => setScreen("register")} onApplied={onRegistered} />
          )}
          {screen === "verify" && <VerifyForm userId={pendingUserId} onBack={() => setScreen("register")} onDone={goHome} />}
          {screen === "forgot" && <ForgotForm onLogin={() => setScreen("login")} onSent={(userId) => { setPendingUserId(userId); setScreen("sent"); }} />}
          {screen === "sent" && <SentForm onVerified={(code) => { setResetCode(code); setScreen("newpass"); }} onLogin={() => setScreen("login")} />}
          {screen === "newpass" && <NewPasswordForm userId={pendingUserId} code={resetCode} onLogin={() => setScreen("login")} />}
        </div>
      </div>
    </div>
  );
}

/* ---------------- forms ---------------- */

function LoginForm({ signIn, onForgot, onRegister, onDone }: { signIn: (id: string, pw: string) => Promise<AuthUser>; onForgot: () => void; onRegister: () => void; onDone: (u: AuthUser) => void }) {
  const { register, handleSubmit, formState: { errors, isSubmitting }, setError } = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: "amara@relay.app", password: "password123" },
  });
  const submit = handleSubmit(async (v) => {
    try {
      onDone(await signIn(v.identifier, v.password));
    } catch (e) {
      setError("root", { message: e instanceof ApiError ? e.message : "Sign in failed" });
    }
  });
  return (
    <Panel>
      <form onSubmit={submit} noValidate>
        <Title sub="Sign in to continue to Relay">Welcome back</Title>
        <ErrorBanner message={errors.root?.message} />
        <Label>Email or phone</Label>
        <TextField reg={register("identifier")} error={errors.identifier?.message} placeholder="amara@relay.app" />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "16px 0 7px" }}>
          <Label inline>Password</Label>
          <LinkBtn onClick={onForgot}>Forgot?</LinkBtn>
        </div>
        <PasswordField reg={register("password")} error={errors.password?.message} />
        <PrimaryButton busy={isSubmitting}>Sign in</PrimaryButton>
        <Divider />
        <GoogleButton />
        <Switcher prompt="New to Relay?" actionLabel="Create account" onClick={onRegister} />
      </form>
    </Panel>
  );
}

// Public registration — passenger accounts only. Drivers are invited by their
// operator; transport businesses use the operator application below.
function RegisterForm({ setSession, onLogin, onApplyOperator, onRegistered }: { setSession: (r: import("@relay/shared").AuthResponse) => void; onLogin: () => void; onApplyOperator: () => void; onRegistered: (userId: string, role: UserRole, needsVerify: boolean) => void }) {
  const { register, handleSubmit, formState: { errors, isSubmitting }, setError } = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { firstName: "", lastName: "", email: "", phone: "", password: "" },
  });
  const submit = handleSubmit(async (v) => {
    try {
      const resp = await api.register(v);
      setSession(resp);
      onRegistered(resp.user.id, resp.user.role, !!resp.requiresVerification);
    } catch (e) {
      setError("root", { message: e instanceof ApiError ? e.message : "Could not create account" });
    }
  });
  return (
    <Panel width={400}>
      <form onSubmit={submit} noValidate>
        <Title sub="Join Relay in under a minute">Create your account</Title>
        <ErrorBanner message={errors.root?.message} />
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <Label>First name</Label>
            <TextField reg={register("firstName")} error={errors.firstName?.message} placeholder="Amara" />
          </div>
          <div style={{ flex: 1 }}>
            <Label>Last name</Label>
            <TextField reg={register("lastName")} error={errors.lastName?.message} placeholder="Niyonsaba" />
          </div>
        </div>
        <div style={{ height: 14 }} />
        <Label>Phone number</Label>
        <TextField reg={register("phone")} error={errors.phone?.message} placeholder="+250 78 000 4821" mono />
        <div style={{ height: 14 }} />
        <Label>Email</Label>
        <TextField reg={register("email")} error={errors.email?.message} placeholder="you@email.com" />
        <div style={{ height: 14 }} />
        <Label>Password</Label>
        <PasswordField reg={register("password")} error={errors.password?.message} />
        <PrimaryButton busy={isSubmitting}>Create account</PrimaryButton>
        <Switcher prompt="Already have an account?" actionLabel="Sign in" onClick={onLogin} />
        <div style={{ textAlign: "center", marginTop: 10 }}>
          <LinkBtn onClick={onApplyOperator}>Run a transport business? Apply as an operator →</LinkBtn>
        </div>
      </form>
    </Panel>
  );
}

const MODE_OPTIONS: { value: TransportMode; label: string }[] = [
  { value: "BUS", label: "Buses" },
  { value: "MOTO", label: "Moto-taxis" },
  { value: "RIDE", label: "Shared rides" },
];

// Operator/partner application — collects company info + KYC (ID/passport
// number, ID document, RDB business certificate). Creates a PENDING company
// that an admin must approve before the console unlocks.
function ApplyOperatorForm({ setSession, onBack, onApplied }: { setSession: (r: import("@relay/shared").AuthResponse) => void; onBack: () => void; onApplied: (userId: string, role: UserRole, needsVerify: boolean) => void }) {
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting }, setError } = useForm<z.infer<typeof applyOperatorSchema>>({
    resolver: zodResolver(applyOperatorSchema),
    defaultValues: { firstName: "", lastName: "", email: "", phone: "", password: "", companyName: "", contactInfo: "", idNumber: "", modes: [] },
  });
  const modes = watch("modes") ?? [];
  const [idDocument, setIdDocument] = useState<File | null>(null);
  const [businessCertificate, setBusinessCertificate] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const toggleMode = (m: TransportMode) => {
    const next = modes.includes(m) ? modes.filter((x) => x !== m) : [...modes, m];
    setValue("modes", next, { shouldValidate: true });
  };

  const submit = handleSubmit(async (v) => {
    if (!idDocument || !businessCertificate) {
      setFileError("Upload your ID document and RDB business certificate (PDF or image, no GIFs).");
      return;
    }
    setFileError(null);
    try {
      const fd = new FormData();
      fd.append("firstName", v.firstName);
      fd.append("lastName", v.lastName);
      fd.append("email", v.email);
      fd.append("phone", v.phone);
      fd.append("password", v.password);
      fd.append("companyName", v.companyName);
      fd.append("contactInfo", v.contactInfo);
      fd.append("idNumber", v.idNumber);
      for (const m of v.modes) fd.append("modes", m);
      fd.append("idDocument", idDocument);
      fd.append("businessCertificate", businessCertificate);
      const resp = await api.applyOperator(fd);
      setSession(resp);
      onApplied(resp.user.id, resp.user.role, !!resp.requiresVerification);
    } catch (e) {
      setError("root", { message: e instanceof ApiError ? e.message : "Could not submit application" });
    }
  });

  return (
    <Panel width={420}>
      <form onSubmit={submit} noValidate>
        <Title sub="Tell us about your business — our team reviews every application before the console unlocks.">Apply as an operator</Title>
        <ErrorBanner message={errors.root?.message} />
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <Label>First name</Label>
            <TextField reg={register("firstName")} error={errors.firstName?.message} placeholder="Chantal" />
          </div>
          <div style={{ flex: 1 }}>
            <Label>Last name</Label>
            <TextField reg={register("lastName")} error={errors.lastName?.message} placeholder="Mukamana" />
          </div>
        </div>
        <div style={{ height: 12 }} />
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <Label>Phone number</Label>
            <TextField reg={register("phone")} error={errors.phone?.message} placeholder="+250 78 000 0000" mono />
          </div>
          <div style={{ flex: 1 }}>
            <Label>Email</Label>
            <TextField reg={register("email")} error={errors.email?.message} placeholder="you@company.rw" />
          </div>
        </div>
        <div style={{ height: 12 }} />
        <Label>Password</Label>
        <PasswordField reg={register("password")} error={errors.password?.message} />
        <div style={{ height: 12 }} />
        <Label>Company name</Label>
        <TextField reg={register("companyName")} error={errors.companyName?.message} placeholder="Kigali Bus Co." />
        <div style={{ height: 12 }} />
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <Label>Company contact</Label>
            <TextField reg={register("contactInfo")} error={errors.contactInfo?.message} placeholder="+250 78 000 0042" mono />
          </div>
          <div style={{ flex: 1 }}>
            <Label>ID / passport number</Label>
            <TextField reg={register("idNumber")} error={errors.idNumber?.message} placeholder="1199…" mono />
          </div>
        </div>
        <div style={{ height: 12 }} />
        <Label>Modes you operate</Label>
        <div style={{ display: "flex", gap: 10, marginBottom: errors.modes ? 4 : 12 }}>
          {MODE_OPTIONS.map((m) => (
            <RoleButton key={m.value} active={modes.includes(m.value)} onClick={() => toggleMode(m.value)}>
              {m.label}
            </RoleButton>
          ))}
        </div>
        {errors.modes && <div style={{ fontSize: 12, color: "#c2553f", fontWeight: 600, marginBottom: 10 }}>{errors.modes.message as string}</div>}
        <Label>ID / passport document</Label>
        <FilePick file={idDocument} onPick={setIdDocument} placeholder="Upload your ID or passport" />
        <div style={{ height: 12 }} />
        <Label>RDB business certificate</Label>
        <FilePick file={businessCertificate} onPick={setBusinessCertificate} placeholder="Upload your business certificate" />
        {fileError && <div style={{ fontSize: 12, color: "#c2553f", fontWeight: 600, marginTop: 8 }}>{fileError}</div>}
        <PrimaryButton busy={isSubmitting}>Submit application</PrimaryButton>
        <div style={{ textAlign: "center", fontSize: 11.5, color: "#a39a8d", fontWeight: 600, marginTop: 10 }}>PDF, JPG, PNG or WebP · max 5 MB per file</div>
        <BackBtn onClick={onBack} full>← Back to passenger sign-up</BackBtn>
      </form>
    </Panel>
  );
}

function FilePick({ file, onPick, placeholder }: { file: File | null; onPick: (f: File | null) => void; placeholder: string }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, border: "1px dashed #cbc3b6", borderRadius: 13, padding: "12px 14px", cursor: "pointer", fontSize: 13.5, fontWeight: 600, color: file ? "#1b1714" : "#8c8378", background: "#fff" }}>
      <span style={{ width: 28, height: 28, borderRadius: 8, background: "#fff0e6", color: "#ff6a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flex: "none" }}>⇧</span>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file?.name ?? placeholder}</span>
      <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ display: "none" }} onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
    </label>
  );
}

function VerifyForm({ userId, onBack, onDone }: { userId: string | null; onBack: () => void; onDone: (role: UserRole) => void }) {
  const { register, handleSubmit, watch, formState: { errors, isSubmitting }, setError } = useForm<z.infer<typeof otpFormSchema>>({
    resolver: zodResolver(otpFormSchema),
    defaultValues: { code: "" },
  });
  const submit = handleSubmit(async (v) => {
    if (!userId) return setError("root", { message: "Missing session" });
    try {
      const r = await api.verifyOtp({ userId, code: v.code });
      onDone(r.user.role);
    } catch (e) {
      setError("code", { message: e instanceof ApiError ? e.message : "Invalid code" });
    }
  });
  return (
    <Panel center>
      <form onSubmit={submit} noValidate>
        <IconBadge>✉</IconBadge>
        <Title center sub="We sent a 6-digit code to your phone">Verify your number</Title>
        <OtpField reg={register("code")} value={watch("code")} error={errors.code?.message || errors.root?.message} />
        <PrimaryButton busy={isSubmitting}>Verify &amp; continue</PrimaryButton>
        <Hint>Didn&apos;t get it? <b style={{ color: "#ff6a1a" }}>Mock mode — use 000000</b></Hint>
        <BackBtn onClick={onBack}>← Back</BackBtn>
      </form>
    </Panel>
  );
}

function ForgotForm({ onLogin, onSent }: { onLogin: () => void; onSent: (userId: string | null) => void }) {
  const { register, handleSubmit, formState: { errors, isSubmitting }, setError } = useForm<z.infer<typeof forgotSchema>>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { identifier: "amara@relay.app" },
  });
  const submit = handleSubmit(async (v) => {
    try {
      const resp = await api.forgotPassword(v);
      onSent(resp.userId);
    } catch (e) {
      setError("root", { message: e instanceof ApiError ? e.message : "Could not send code" });
    }
  });
  return (
    <Panel>
      <form onSubmit={submit} noValidate>
        <Title sub="Enter your email or phone and we'll send you a reset code.">Reset password</Title>
        <ErrorBanner message={errors.root?.message} />
        <Label>Email or phone</Label>
        <TextField reg={register("identifier")} error={errors.identifier?.message} placeholder="amara@relay.app" />
        <PrimaryButton busy={isSubmitting}>Send reset code</PrimaryButton>
        <BackBtn onClick={onLogin} full>← Back to sign in</BackBtn>
      </form>
    </Panel>
  );
}

function SentForm({ onVerified, onLogin }: { onVerified: (code: string) => void; onLogin: () => void }) {
  const { register, handleSubmit, watch, formState: { errors } } = useForm<z.infer<typeof otpFormSchema>>({
    resolver: zodResolver(otpFormSchema),
    defaultValues: { code: "" },
  });
  const submit = handleSubmit((v) => onVerified(v.code));
  return (
    <Panel center>
      <form onSubmit={submit} noValidate>
        <IconBadge>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
        </IconBadge>
        <Title center sub="Enter the 6-digit code we sent you.">Enter reset code</Title>
        <OtpField reg={register("code")} value={watch("code")} error={errors.code?.message} />
        <PrimaryButton busy={false}>Verify code</PrimaryButton>
        <Hint>Mock mode — use <b style={{ color: "#ff6a1a" }}>000000</b></Hint>
        <BackBtn onClick={onLogin}>← Back to sign in</BackBtn>
      </form>
    </Panel>
  );
}

function NewPasswordForm({ userId, code, onLogin }: { userId: string | null; code: string; onLogin: () => void }) {
  const { register, handleSubmit, watch, formState: { errors, isSubmitting }, setError } = useForm<z.infer<typeof newPasswordSchema>>({
    resolver: zodResolver(newPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });
  const pw = watch("password");
  const submit = handleSubmit(async (v) => {
    if (!userId) return setError("root", { message: "No account matched" });
    try {
      await api.resetPassword({ userId, code, password: v.password });
      onLogin();
    } catch (e) {
      setError("root", { message: e instanceof ApiError ? e.message : "Could not reset password" });
    }
  });
  return (
    <Panel>
      <form onSubmit={submit} noValidate>
        <Title sub="Choose a strong password you haven't used before.">Set a new password</Title>
        <ErrorBanner message={errors.root?.message} />
        <Label>New password</Label>
        <PasswordField reg={register("password")} error={errors.password?.message} />
        <Strength value={pw} />
        <Label>Confirm password</Label>
        <PasswordField reg={register("confirmPassword")} error={errors.confirmPassword?.message} />
        <PrimaryButton busy={isSubmitting}>Update password</PrimaryButton>
      </form>
    </Panel>
  );
}

/* ---------------- pieces ---------------- */

function BrandPanel() {
  return (
    <div style={{ width: 380, flex: "none", background: "#1b1714", color: "#fff", padding: "38px 36px", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, position: "relative", zIndex: 1 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: "#2a2520", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 13, height: 13, borderRadius: "50%", background: "#ff6a1a" }} />
        </div>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 22, letterSpacing: "-.5px" }}>Relay</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#9a9186", letterSpacing: ".04em", textTransform: "uppercase", paddingTop: 3 }}>Transit OS</div>
      </div>
      <div style={{ marginTop: "auto", position: "relative", zIndex: 1 }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 30, fontWeight: 700, lineHeight: 1.2, letterSpacing: "-.8px", marginBottom: 14 }}>One account for every ride in the city.</div>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "#cfc7bb", margin: "0 0 28px" }}>Buses, moto-taxis and shared rides — planned, paid and tracked from a single login.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
          {["Contactless payment built in", "Live journey tracking", "Works for riders, drivers & operators"].map((t) => (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 11, fontSize: 13.5, color: "#e8e1d6" }}>
              <span style={{ width: 22, height: 22, borderRadius: 6, background: "#2a2520", color: "#ff6a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>✓</span>
              {t}
            </div>
          ))}
        </div>
      </div>
      <div style={{ position: "absolute", right: -80, bottom: -80, width: 280, height: 280, borderRadius: "50%", background: "radial-gradient(circle,rgba(255,106,26,.22),transparent 68%)" }} />
    </div>
  );
}

function Panel({ children, width = 380, center = false }: { children: React.ReactNode; width?: number; center?: boolean }) {
  return <div style={{ maxWidth: width, width: "100%", margin: "0 auto", textAlign: center ? "center" : "left" }}>{children}</div>;
}

function Title({ children, sub, center }: { children: React.ReactNode; sub: string; center?: boolean }) {
  return (
    <>
      <div style={{ fontFamily: DISPLAY, fontSize: 25, fontWeight: 700, letterSpacing: "-.6px" }}>{children}</div>
      <div style={{ fontSize: 13.5, color: "#8c8378", fontWeight: 600, margin: center ? "6px 0 26px" : "4px 0 26px" }}>{sub}</div>
    </>
  );
}

function Label({ children, inline }: { children: React.ReactNode; inline?: boolean }) {
  return <div style={{ fontSize: 11.5, fontWeight: 700, color: "#8c8378", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: inline ? 0 : 7 }}>{children}</div>;
}

const inputBox: React.CSSProperties = { width: "100%", border: "1px solid #e3ddd1", borderRadius: 13, padding: "14px 15px", fontSize: 14, fontWeight: 600, color: "#1b1714", outline: "none", fontFamily: "'Manrope', sans-serif", background: "#fff" };

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <div style={{ fontSize: 12, color: "#c2553f", fontWeight: 600, marginTop: 6 }}>{message}</div>;
}

function TextField({ reg, error, placeholder, mono }: { reg: UseFormRegisterReturn; error?: string; placeholder?: string; mono?: boolean }) {
  return (
    <div>
      <input {...reg} placeholder={placeholder} style={{ ...inputBox, fontFamily: mono ? MONO : inputBox.fontFamily, borderColor: error ? "#e0a99a" : "#e3ddd1" }} />
      <FieldError message={error} />
    </div>
  );
}

function PasswordField({ reg, error }: { reg: UseFormRegisterReturn; error?: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", border: `1px solid ${error ? "#e0a99a" : "#e3ddd1"}`, borderRadius: 13, padding: "0 8px 0 15px" }}>
        <input {...reg} type={shown ? "text" : "password"} style={{ flex: 1, border: "none", outline: "none", fontSize: 14, fontWeight: 600, padding: "14px 0", background: "transparent", fontFamily: "'Manrope', sans-serif" }} />
        <button type="button" onClick={() => setShown((s) => !s)} style={{ background: "none", border: "none", cursor: "pointer", width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
          {shown ? (
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#ff6a1a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
          ) : (
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#8c8378" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></svg>
          )}
        </button>
      </div>
      <FieldError message={error} />
    </div>
  );
}

function OtpField({ reg, value, error }: { reg: UseFormRegisterReturn; value?: string; error?: string }) {
  const v = value ?? "";
  return (
    <div style={{ margin: "0 auto 8px", maxWidth: 320 }}>
      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          {Array.from({ length: 6 }).map((_, i) => {
            const filled = i < v.length;
            return (
              <div key={i} style={{ width: 44, height: 54, borderRadius: 12, border: `1px solid ${i === v.length ? "#ff6a1a" : error ? "#e0a99a" : "#e3ddd1"}`, background: filled ? "#fff6f0" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: 20, fontWeight: 700 }}>
                {v[i] ?? ""}
              </div>
            );
          })}
        </div>
        <input
          {...reg}
          onChange={(e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); reg.onChange(e); }}
          inputMode="numeric"
          autoFocus
          style={{ position: "absolute", inset: 0, opacity: 0, cursor: "text", width: "100%" }}
        />
      </div>
      <div style={{ textAlign: "center", marginTop: 8, marginBottom: 16 }}><FieldError message={error} /></div>
    </div>
  );
}

function Strength({ value }: { value?: string }) {
  const score = Math.min(4, Math.floor((value?.length ?? 0) / 3));
  return (
    <div style={{ display: "flex", gap: 5, margin: "8px 0 16px" }}>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} style={{ flex: 1, height: 4, borderRadius: 3, background: i < score ? "#1f9d6b" : "#e9e3d8" }} />
      ))}
    </div>
  );
}

function PrimaryButton({ children, busy }: { children: React.ReactNode; busy: boolean }) {
  return (
    <button type="submit" disabled={busy} style={{ width: "100%", marginTop: 22, background: "#ff6a1a", color: "#fff", border: "none", borderRadius: 14, padding: 15, fontSize: 15, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1, boxShadow: "0 12px 26px -10px rgba(255,106,26,.7)" }}>
      {busy ? "Please wait…" : children}
    </button>
  );
}

function ErrorBanner({ message }: { message?: string }) {
  if (!message) return null;
  return <div style={{ background: "#fff0e6", border: "1px solid #ffd9c2", color: "#c2553f", borderRadius: 12, padding: "11px 14px", fontSize: 13, fontWeight: 600, marginBottom: 16 }}>{message}</div>;
}

function Divider() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "22px 0" }}>
      <div style={{ flex: 1, height: 1, background: "#ece6db" }} />
      <span style={{ fontSize: 12, color: "#a39a8d", fontWeight: 600 }}>or</span>
      <div style={{ flex: 1, height: 1, background: "#ece6db" }} />
    </div>
  );
}

function GoogleButton() {
  return (
    <button type="button" style={{ width: "100%", background: "#fff", border: "1px solid #e3ddd1", borderRadius: 12, padding: 12, fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 9 }}>
      <svg width="17" height="17" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" /><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1 .7-2.4 1.2-4.1 1.2-3.1 0-5.8-2.1-6.8-5H1.2v3.1A12 12 0 0 0 12 24z" /><path fill="#FBBC05" d="M5.2 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.2a12 12 0 0 0 0 10.8l4-3.1z" /><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 12 0 12 12 0 0 0 1.2 6.6l4 3.1c1-2.9 3.7-4.9 6.8-4.9z" /></svg>
      Continue with Google
    </button>
  );
}

function Switcher({ prompt, actionLabel, onClick }: { prompt: string; actionLabel: string; onClick: () => void }) {
  return (
    <div style={{ textAlign: "center", fontSize: 13.5, color: "#8c8378", fontWeight: 600, marginTop: 24 }}>
      {prompt} <button type="button" onClick={onClick} style={{ background: "none", border: "none", fontSize: 13.5, fontWeight: 800, color: "#ff6a1a", cursor: "pointer" }}>{actionLabel}</button>
    </div>
  );
}

function RoleButton({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ flex: 1, padding: "11px 6px", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif", border: active ? "1px solid #ff6a1a" : "1px solid #e3ddd1", background: active ? "#fff6f0" : "#fff", color: active ? "#ff6a1a" : "#6b6258" }}>
      {children}
    </button>
  );
}

function LinkBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} style={{ background: "none", border: "none", fontSize: 12, fontWeight: 700, color: "#ff6a1a", cursor: "pointer" }}>{children}</button>;
}

function IconBadge({ children }: { children: React.ReactNode }) {
  return <div style={{ width: 60, height: 60, borderRadius: 16, background: "#fff0e6", color: "#ff6a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, margin: "0 auto 18px" }}>{children}</div>;
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, color: "#8c8378", fontWeight: 600, marginTop: 20 }}>{children}</div>;
}

function BackBtn({ children, onClick, full }: { children: React.ReactNode; onClick: () => void; full?: boolean }) {
  return (
    <button type="button" onClick={onClick} style={{ width: full ? "100%" : "auto", display: "block", margin: full ? "18px auto 0" : "14px auto 0", background: "none", border: "none", fontSize: 13, fontWeight: 700, color: "#a39a8d", cursor: "pointer" }}>
      {children}
    </button>
  );
}
