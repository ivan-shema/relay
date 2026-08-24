import dotenv from "dotenv";

dotenv.config();

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var: ${name}`);
  return v;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  jwtAccessSecret: required("JWT_ACCESS_SECRET", "dev-access-secret"),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET", "dev-refresh-secret"),
  jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? "15m",
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL ?? "30d",
  port: Number(process.env.PORT ?? 4000),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  // Paypack (MTN MoMo + Airtel Money). When the client id/secret are unset the
  // wallet top-up and payout flows fall back to the instant mock provider.
  paypackClientId: process.env.PAYPACK_CLIENT_ID ?? "",
  paypackClientSecret: process.env.PAYPACK_CLIENT_SECRET ?? "",
  paypackWebhookSecret: process.env.PAYPACK_WEBHOOK_SECRET ?? "",
  paypackMode: process.env.PAYPACK_MODE === "production" ? "production" : "development",
  // SMTP for notification emails. When the host is unset, emails are logged to
  // the API console instead (mock mode).
  smtpHost: process.env.SMTP_HOST ?? "",
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpSecure: (process.env.SMTP_SECURE ?? "false") === "true",
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPass: process.env.SMTP_PASS ?? "",
  mailFrom: process.env.MAIL_FROM ?? "Relay <no-reply@relay.app>",
  // Google sign-in: OAuth 2.0 Web client ID (the same one the web app embeds).
  // When unset, POST /auth/google returns 503 and the web hides the button.
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
};
