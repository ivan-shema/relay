import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../env";

// Notification emails. With SMTP_HOST configured this sends real mail; without
// it, messages are logged to the API console (mock mode, like MOCK_OTP).

export const mailEnabled = env.smtpHost.length > 0;

let transporter: Transporter | null = null;
function mailer(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
    });
  }
  return transporter;
}

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  if (!mailEnabled) {
    console.log(`[mail:mock] to=${to} subject="${subject}" body="${text}"`);
    return;
  }
  await mailer().sendMail({ from: env.mailFrom, to, subject, text });
}

// Login details for an account somebody else created (admin "Add user",
// operator driver invite). Fire-and-forget — call AFTER the creating
// transaction commits: a mail failure is logged, never surfaced, since the
// account exists either way and the password can be reset.
export function sendCredentialsEmail(to: { email: string; firstName: string }, opts: { tempPassword: string; roleLabel: string; createdBy: string }): void {
  const text = [
    `Hi ${to.firstName},`,
    "",
    `${opts.createdBy} created a Relay ${opts.roleLabel} account for you.`,
    "",
    `Sign in at ${env.webOrigin}/auth with:`,
    `  Email:    ${to.email}`,
    `  Password: ${opts.tempPassword}`,
    "",
    "This is a temporary password — please change it from your profile settings after your first sign-in.",
    "",
    "— Relay",
  ].join("\n");
  void sendMail(to.email, "Your Relay account", text).catch((e) => console.error(`[mail] failed to send credentials to ${to.email}:`, e));
}
