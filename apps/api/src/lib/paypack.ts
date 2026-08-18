import crypto from "crypto";
// paypack-js ships CommonJS with the class on `module.exports.default` and no
// __esModule flag, so a plain default import resolves to the namespace object
// at runtime — unwrap it manually.
import PaypackModule from "paypack-js";
import { env } from "../env";
import { HttpError } from "./http";

const Paypack = (PaypackModule as unknown as { default?: typeof PaypackModule }).default ?? PaypackModule;

// Real mobile money is live only when Paypack app credentials are configured;
// otherwise deposits/withdrawals use the instant mock provider.
export const paypackEnabled = env.paypackClientId.length > 0 && env.paypackClientSecret.length > 0;

let client: InstanceType<typeof Paypack> | null = null;
function paypack() {
  if (!paypackEnabled) throw new HttpError(503, "Mobile money is not configured");
  if (!client) client = new Paypack({ client_id: env.paypackClientId, client_secret: env.paypackClientSecret });
  return client;
}

// Accepts 078x…, +250 78x…, 250 78x… (spaces/dashes tolerated) and returns the
// local 07XXXXXXXX form Paypack expects. MTN: 078/079 · Airtel: 072/073.
export function normalizeMomoNumber(input: string): string {
  let n = input.replace(/[\s-]/g, "");
  if (n.startsWith("+")) n = n.slice(1);
  if (n.startsWith("250")) n = n.slice(3);
  if (n.length === 9 && n.startsWith("7")) n = "0" + n;
  if (!/^07[2389]\d{7}$/.test(n)) {
    throw new HttpError(400, "Enter a valid MTN MoMo or Airtel Money number (07XXXXXXXX)");
  }
  return n;
}

export function momoProviderLabel(number: string): string {
  return /^07[89]/.test(number) ? "MTN MoMo" : "Airtel Money";
}

function providerError(e: unknown): HttpError {
  const err = e as { response?: { data?: { message?: string } }; message?: string };
  const detail = err.response?.data?.message ?? err.message;
  return new HttpError(502, detail ? `Mobile money request failed: ${detail}` : "Mobile money request failed");
}

export interface MomoTransfer {
  ref: string;
  status: string;
}

// Pull money from a customer's mobile money account into the merchant account.
// The customer must approve the USSD prompt, so the transfer starts "pending".
export async function requestCashin(amount: number, number: string): Promise<MomoTransfer> {
  try {
    const res = await paypack().cashin({ amount: Math.round(amount), number, environment: env.paypackMode } as never);
    return { ref: res.data.ref, status: res.data.status };
  } catch (e) {
    throw providerError(e);
  }
}

// Send money from the merchant account to a mobile money account.
export async function requestCashout(amount: number, number: string): Promise<MomoTransfer> {
  try {
    const res = await paypack().cashout({ amount: Math.round(amount), number, environment: env.paypackMode } as never);
    return { ref: res.data.ref, status: res.data.status };
  } catch (e) {
    throw providerError(e);
  }
}

// Poll a transfer's outcome via the events feed. "pending" until Paypack
// records a processed event for the ref.
export async function fetchTransferOutcome(ref: string, kind: "CASHIN" | "CASHOUT"): Promise<"successful" | "failed" | "pending"> {
  try {
    const res = await paypack().events({ ref, kind });
    for (const ev of res.data.transactions ?? []) {
      const status = ev.data?.status;
      if (status === "successful" || status === "success") return "successful";
      if (status === "failed") return "failed";
    }
    return "pending";
  } catch (e) {
    throw providerError(e);
  }
}

// Webhook bodies are signed with HMAC-SHA256 (base64) over the raw bytes.
export function verifyPaypackSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!env.paypackWebhookSecret || !signature) return false;
  const expected = crypto.createHmac("sha256", env.paypackWebhookSecret).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, "base64");
  } catch {
    return false;
  }
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
