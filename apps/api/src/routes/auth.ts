import { randomInt, timingSafeEqual } from "crypto";
import { Router } from "express";
import { z } from "zod";
import type { AuthResponse, AuthUser, GoogleSignInResponse } from "@relay/shared";
import {
  registerSchema,
  loginSchema,
  verifyOtpSchema,
  forgotSchema,
  resetSchema,
  googleSignInSchema,
  googleCompleteSchema,
  normalizeRwandaPhone,
} from "@relay/shared";
import { prisma } from "../prisma";
import { env } from "../env";
import { asyncHandler, HttpError } from "../lib/http";
import {
  generateTempPassword,
  hashPassword,
  signAccessToken,
  signRefreshToken,
  verifyPassword,
  verifyRefreshToken,
} from "../lib/auth";
import { requireAuth } from "../middleware/auth";
import { sendMail } from "../lib/mailer";
import { verifyGoogleCredential, type GoogleIdentity } from "../lib/google";

export const authRouter = Router();

function toAuthUser(u: {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: AuthUser["role"];
  walletBalance: unknown;
}): AuthUser {
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    phone: u.phone,
    role: u.role,
    walletBalance: Number((u.walletBalance as { toString(): string }).toString()),
  };
}

function issueTokens(user: { id: string; role: AuthUser["role"] }): {
  accessToken: string;
  refreshToken: string;
} {
  const payload = { sub: user.id, role: user.role };
  return {
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
  };
}

// "Email or phone" lookups: phones are stored canonically (+2507XXXXXXXX), so
// a locally-typed 07… must be normalized before matching. The raw value is
// still tried so rows that predate normalization keep working.
function identifierWhere(identifier: string) {
  const id = identifier.trim();
  const phone = normalizeRwandaPhone(id);
  return { OR: [{ email: id }, { phone: id }, ...(phone ? [{ phone }] : [])] };
}

// Generate an OTP and email it to the user. Codes are always random — there is
// deliberately no mock/bypass code. Without SMTP the mailer logs the message
// (code included) to the API console, which is how local dev reads it.
// Returns false when throttled: at most one code per purpose per minute, so
// the public endpoints cannot be used to flood an inbox.
const OTP_TTL_MIN = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 60_000;
type OtpPurpose = "VERIFY_EMAIL" | "RESET_PASSWORD";
const OTP_SUBJECT: Record<OtpPurpose, string> = {
  VERIFY_EMAIL: "Verify your Relay email",
  RESET_PASSWORD: "Reset your Relay password",
};
async function issueOtp(user: { id: string; email: string; firstName: string }, purpose: OtpPurpose): Promise<boolean> {
  const latest = await prisma.otp.findFirst({ where: { userId: user.id, purpose }, orderBy: { createdAt: "desc" } });
  if (latest && Date.now() - latest.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) return false;

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  // One live code per purpose: issuing a new one retires the older ones.
  await prisma.otp.updateMany({ where: { userId: user.id, purpose, consumed: false }, data: { consumed: true } });
  await prisma.otp.create({
    data: {
      userId: user.id,
      code,
      purpose,
      expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60_000),
    },
  });
  const intro =
    purpose === "RESET_PASSWORD"
      ? "Use this code to reset your Relay password:"
      : "Use this code to verify your email address and activate your Relay account:";
  const text = [`Hi ${user.firstName},`, "", intro, "", `    ${code}`, "", `It expires in ${OTP_TTL_MIN} minutes. If you did not request it, you can ignore this email.`, "", "— Relay"].join("\n");
  // A mail failure should not 500 the request — the user can ask for a resend.
  await sendMail(user.email, OTP_SUBJECT[purpose], text).catch((e) => console.error(`[mail] failed to send ${purpose} code to ${user.email}:`, e));
  return true;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// Check a submitted code against the latest live OTP for that purpose and burn
// it. Wrong guesses count against the code; after OTP_MAX_ATTEMPTS it is
// retired, so a 6-digit code cannot be brute-forced within its lifetime.
async function consumeOtp(userId: string, purpose: OtpPurpose, code: string): Promise<void> {
  const otp = await prisma.otp.findFirst({
    where: { userId, purpose, consumed: false },
    orderBy: { createdAt: "desc" },
  });
  if (!otp || otp.expiresAt <= new Date()) throw new HttpError(400, "Invalid or expired code — request a new one");
  if (!safeEqual(otp.code, code)) {
    const attempts = otp.attempts + 1;
    const exhausted = attempts >= OTP_MAX_ATTEMPTS;
    await prisma.otp.update({ where: { id: otp.id }, data: { attempts, consumed: exhausted } });
    throw new HttpError(400, exhausted ? "Too many wrong attempts — request a new code" : "Invalid or expired code");
  }
  await prisma.otp.update({ where: { id: otp.id }, data: { consumed: true } });
}

// Public registration — passenger-only; the account is activated by an emailed
// OTP (see /verify-otp). Drivers are invited by operators;
// operators must apply and be approved by an admin.
authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const data = registerSchema.parse(req.body);

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: data.email }, { phone: data.phone }] },
    });
    if (existing) throw new HttpError(409, "Email or phone already registered");

    const user = await prisma.user.create({
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        passwordHash: await hashPassword(data.password),
        role: "PASSENGER",
      },
    });

    await issueOtp(user, "VERIFY_EMAIL");

    const tokens = issueTokens(user);
    const body: AuthResponse = { ...tokens, user: toAuthUser(user) };
    res.status(201).json({ ...body, requiresVerification: true });
  })
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const data = loginSchema.parse(req.body);
    const found = await prisma.user.findFirst({ where: identifierWhere(data.identifier) });
    if (!found || !(await verifyPassword(data.password, found.passwordHash))) {
      throw new HttpError(401, "Invalid credentials");
    }
    // An account somebody else created had its temp password emailed to this
    // address, so signing in with it proves the mailbox — that is when the
    // email counts as verified, never at creation time.
    const user = found.credentialsEmailed
      ? await prisma.user.update({ where: { id: found.id }, data: { emailVerified: true, credentialsEmailed: false } })
      : found;
    const tokens = issueTokens(user);
    const body: AuthResponse = { ...tokens, user: toAuthUser(user) };
    res.json(body);
  })
);

// Resolve the account a Google identity maps to: by Google subject first, then
// by verified email — an existing password account with the same address is
// linked on its first Google sign-in rather than duplicated. Either way the
// email is now proven, so the account is marked verified.
async function findGoogleUser(g: GoogleIdentity) {
  const bySub = await prisma.user.findUnique({ where: { googleId: g.sub } });
  if (bySub) {
    if (bySub.emailVerified) return bySub;
    return prisma.user.update({ where: { id: bySub.id }, data: { emailVerified: true } });
  }
  const byEmail = await prisma.user.findFirst({
    where: { email: { equals: g.email, mode: "insensitive" } },
  });
  if (!byEmail) return null;
  return prisma.user.update({
    where: { id: byEmail.id },
    data: { googleId: g.sub, emailVerified: true },
  });
}

// Google sign-in, step 1. Known/linkable account → session tokens. Unknown
// account → `needsPhone`, and the client finishes via /google/complete with
// the same credential (ID tokens stay valid for about an hour).
authRouter.post(
  "/google",
  asyncHandler(async (req, res) => {
    const { credential } = googleSignInSchema.parse(req.body);
    const g = await verifyGoogleCredential(credential);
    const user = await findGoogleUser(g);
    const body: GoogleSignInResponse = user
      ? { ...issueTokens(user), user: toAuthUser(user) }
      : { needsPhone: true, profile: { firstName: g.firstName, lastName: g.lastName, email: g.email } };
    res.json(body);
  })
);

// Step 2: create the passenger account. Google already verified who they are,
// so unlike /register there is no OTP step — the account is active at once
// (emailVerified). The password is unknown to the user: they sign in with
// Google, and can set one later through "Forgot password".
authRouter.post(
  "/google/complete",
  asyncHandler(async (req, res) => {
    const data = googleCompleteSchema.parse(req.body);
    const g = await verifyGoogleCredential(data.credential);

    // The account may have appeared between the two steps (double submit,
    // second tab) — treat that as a plain sign-in.
    const existing = await findGoogleUser(g);
    if (existing) {
      const body: AuthResponse = { ...issueTokens(existing), user: toAuthUser(existing) };
      res.json(body);
      return;
    }
    if (await prisma.user.findUnique({ where: { phone: data.phone } })) {
      throw new HttpError(409, "That phone number is already registered to another account");
    }

    const user = await prisma.user.create({
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        email: g.email,
        phone: data.phone,
        googleId: g.sub,
        emailVerified: true,
        passwordHash: await hashPassword(generateTempPassword(24)),
        role: "PASSENGER",
      },
    });

    const body: AuthResponse = { ...issueTokens(user), user: toAuthUser(user) };
    res.status(201).json({ ...body, requiresVerification: false });
  })
);

authRouter.post(
  "/verify-otp",
  asyncHandler(async (req, res) => {
    const { userId, code } = verifyOtpSchema.parse(req.body);
    await consumeOtp(userId, "VERIFY_EMAIL", code);
    const user = await prisma.user.update({
      where: { id: userId },
      data: { emailVerified: true },
    });
    res.json({ verified: true, user: toAuthUser(user) });
  })
);

// Re-send the verification code (lost or expired email). Always 200 so the
// endpoint does not reveal whether an id exists or is verified; only the
// per-user cooldown in issueOtp surfaces, as a 429.
authRouter.post(
  "/resend-otp",
  asyncHandler(async (req, res) => {
    const { userId } = z.object({ userId: z.string().min(1) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user && !user.emailVerified && !(await issueOtp(user, "VERIFY_EMAIL"))) {
      throw new HttpError(429, "Please wait a minute before requesting another code");
    }
    res.json({ sent: true });
  })
);

authRouter.post(
  "/forgot-password",
  asyncHandler(async (req, res) => {
    const { identifier } = forgotSchema.parse(req.body);
    const user = await prisma.user.findFirst({ where: identifierWhere(identifier) });
    // Always 200 to avoid account enumeration (a throttled resend is silent too).
    if (user) await issueOtp(user, "RESET_PASSWORD");
    res.json({ sent: true, userId: user?.id ?? null });
  })
);

authRouter.post(
  "/reset-password",
  asyncHandler(async (req, res) => {
    const { userId, code, password } = resetSchema.parse(req.body);
    await consumeOtp(userId, "RESET_PASSWORD", code);
    // Completing an emailed reset code proves the mailbox as well.
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(password), emailVerified: true, credentialsEmailed: false },
    });
    res.json({ reset: true });
  })
);

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const token = z.object({ refreshToken: z.string() }).parse(req.body).refreshToken;
    let payload;
    try {
      payload = verifyRefreshToken(token);
    } catch {
      throw new HttpError(401, "Invalid refresh token");
    }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new HttpError(401, "User no longer exists");
    res.json(issueTokens(user));
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.auth!.sub } });
    if (!user) throw new HttpError(404, "User not found");
    res.json(toAuthUser(user));
  })
);
