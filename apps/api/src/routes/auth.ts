import { Router } from "express";
import { z } from "zod";
import type { AuthResponse, AuthUser } from "@relay/shared";
import {
  registerSchema,
  loginSchema,
  verifyOtpSchema,
  forgotSchema,
  resetSchema,
  normalizeRwandaPhone,
} from "@relay/shared";
import { prisma } from "../prisma";
import { env } from "../env";
import { asyncHandler, HttpError } from "../lib/http";
import {
  hashPassword,
  signAccessToken,
  signRefreshToken,
  verifyPassword,
  verifyRefreshToken,
} from "../lib/auth";
import { requireAuth } from "../middleware/auth";

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

// Generate + "send" an OTP (mock: logged to console).
async function issueOtp(userId: string, purpose: string): Promise<void> {
  const code = env.mockOtp
    ? env.mockOtpCode
    : String(Math.floor(100000 + Math.random() * 900000));
  await prisma.otp.create({
    data: {
      userId,
      code,
      purpose,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    },
  });
  console.log(`[OTP:${purpose}] user=${userId} code=${code}`);
}

// Public registration — passenger-only. Drivers are invited by operators;
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

    await issueOtp(user.id, "VERIFY_PHONE");

    const tokens = issueTokens(user);
    const body: AuthResponse = { ...tokens, user: toAuthUser(user) };
    res.status(201).json({ ...body, requiresVerification: true });
  })
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const data = loginSchema.parse(req.body);
    const user = await prisma.user.findFirst({ where: identifierWhere(data.identifier) });
    if (!user || !(await verifyPassword(data.password, user.passwordHash))) {
      throw new HttpError(401, "Invalid credentials");
    }
    const tokens = issueTokens(user);
    const body: AuthResponse = { ...tokens, user: toAuthUser(user) };
    res.json(body);
  })
);

authRouter.post(
  "/verify-otp",
  asyncHandler(async (req, res) => {
    const { userId, code } = verifyOtpSchema.parse(req.body);
    const otp = await prisma.otp.findFirst({
      where: { userId, purpose: "VERIFY_PHONE", consumed: false },
      orderBy: { createdAt: "desc" },
    });
    const ok = env.mockOtp
      ? code === env.mockOtpCode || (otp?.code === code && otp.expiresAt > new Date())
      : !!otp && otp.code === code && otp.expiresAt > new Date();
    if (!ok) throw new HttpError(400, "Invalid or expired code");

    if (otp) await prisma.otp.update({ where: { id: otp.id }, data: { consumed: true } });
    const user = await prisma.user.update({
      where: { id: userId },
      data: { phoneVerified: true },
    });
    res.json({ verified: true, user: toAuthUser(user) });
  })
);

authRouter.post(
  "/forgot-password",
  asyncHandler(async (req, res) => {
    const { identifier } = forgotSchema.parse(req.body);
    const user = await prisma.user.findFirst({ where: identifierWhere(identifier) });
    // Always 200 to avoid account enumeration.
    if (user) await issueOtp(user.id, "RESET_PASSWORD");
    res.json({ sent: true, userId: user?.id ?? null });
  })
);

authRouter.post(
  "/reset-password",
  asyncHandler(async (req, res) => {
    const { userId, code, password } = resetSchema.parse(req.body);
    const otp = await prisma.otp.findFirst({
      where: { userId, purpose: "RESET_PASSWORD", consumed: false },
      orderBy: { createdAt: "desc" },
    });
    const ok = env.mockOtp
      ? code === env.mockOtpCode || (otp?.code === code && otp.expiresAt > new Date())
      : !!otp && otp.code === code && otp.expiresAt > new Date();
    if (!ok) throw new HttpError(400, "Invalid or expired code");

    if (otp) await prisma.otp.update({ where: { id: otp.id }, data: { consumed: true } });
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(password) },
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
