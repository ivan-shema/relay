import { Router, raw } from "express";
import { asyncHandler, HttpError } from "../lib/http";
import { verifyPaypackSignature } from "../lib/paypack";
import { settleWalletTopup, settlePayout } from "../lib/settlement";

export const webhooksRouter = Router();

// POST /webhooks/paypack — Paypack calls this when a transfer is processed.
// Mounted BEFORE express.json() (see app.ts): the signature is an HMAC of the
// exact raw bytes, so the body must not be parsed before verification.
webhooksRouter.post(
  "/paypack",
  raw({ type: () => true }),
  asyncHandler(async (req, res) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || !verifyPaypackSignature(body, req.header("x-paypack-signature"))) {
      throw new HttpError(401, "Invalid webhook signature");
    }

    let event: { kind?: string; event_kind?: string; data?: { ref?: string; kind?: string; status?: string } };
    try {
      event = JSON.parse(body.toString("utf8"));
    } catch {
      throw new HttpError(400, "Malformed webhook body");
    }

    const kind = event.kind ?? event.event_kind;
    const data = event.data;
    if (kind === "transaction:processed" && data?.ref) {
      const outcome = data.status === "successful" || data.status === "success" ? "successful" : "failed";
      if (data.kind === "CASHIN") await settleWalletTopup(data.ref, outcome);
      else if (data.kind === "CASHOUT") await settlePayout(data.ref, outcome);
    }

    res.json({ received: true });
  })
);
