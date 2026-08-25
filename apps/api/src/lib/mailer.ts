import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../env";

// Notification emails. With SMTP_HOST configured this sends real mail; without
// it, messages are logged to the API console (mock mode) — OTP codes included,
// which is how local dev reads them.

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

// "Come drive for X" for someone who isn't a Relay user yet: the link opens
// registration with their email pre-filled; the invitation is waiting in their
// dashboard right after. Fire-and-forget, like the credentials email.
export function sendDriverInviteEmail(to: string, opts: { company: string; note?: string | null; token: string }): void {
  const link = `${env.webOrigin}/auth?mode=register&invite=${encodeURIComponent(opts.token)}`;
  const text = [
    "Hi,",
    "",
    `${opts.company} would like you to drive for them on Relay.`,
    ...(opts.note ? ["", `Message from ${opts.company}: ${opts.note}`] : []),
    "",
    "Create your Relay account with this email address, then submit your driving licence and national ID from your dashboard. Once the operator approves them, your driver console is unlocked:",
    `  ${link}`,
    "",
    "If you weren't expecting this, you can ignore this email.",
    "",
    "— Relay",
  ].join("\n");
  void sendMail(to, `${opts.company} invited you to drive on Relay`, text).catch((e) => console.error(`[mail] failed to send driver invite to ${to}:`, e));
}
