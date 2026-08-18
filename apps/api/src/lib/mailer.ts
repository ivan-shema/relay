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
