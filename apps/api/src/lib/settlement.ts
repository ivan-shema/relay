import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { publish } from "./realtime";
import { notify } from "./notify";

// Finalizers for pending Paypack transfers. Both the webhook and the client's
// status poll can try to settle the same ref, so each one claims the PENDING
// row with a guarded updateMany — whoever loses the race becomes a no-op.
// After the commit, the outcome is pushed over SSE (and the notification is
// created + emailed via notify) so open tabs update immediately; the client's
// slow poll covers the case where no stream is connected.

export async function settleWalletTopup(ref: string, outcome: "successful" | "failed"): Promise<void> {
  const status = outcome === "successful" ? "COMPLETED" : "FAILED";

  const settled = await prisma.$transaction(async (tx) => {
    const claimed = await tx.walletTransaction.updateMany({
      where: { momoRef: ref, status: "PENDING", kind: "CREDIT" },
      data: { status },
    });
    if (claimed.count === 0) return null; // unknown ref or already settled

    const txn = await tx.walletTransaction.findUnique({ where: { momoRef: ref } });
    if (!txn) return null;

    let balance: Prisma.Decimal;
    if (outcome === "successful") {
      const user = await tx.user.findUnique({ where: { id: txn.userId } });
      balance = new Prisma.Decimal(user!.walletBalance).plus(txn.amount);
      await tx.user.update({ where: { id: txn.userId }, data: { walletBalance: balance } });
    } else {
      const user = await tx.user.findUnique({ where: { id: txn.userId } });
      balance = new Prisma.Decimal(user!.walletBalance);
    }
    return { userId: txn.userId, amount: Number(txn.amount), balance: Number(balance) };
  });

  if (!settled) return;
  publish(settled.userId, "wallet:topup", { ref, status, amount: settled.amount, balance: settled.balance });
  if (outcome === "successful") {
    await notify(
      settled.userId,
      "Wallet topped up",
      `You added RWF ${Math.round(settled.amount).toLocaleString("en-US")} to your Relay wallet.`
    );
  } else {
    await notify(settled.userId, "Top-up failed", "Your mobile money top-up was declined or timed out. No money was taken.");
  }
}

export async function settlePayout(ref: string, outcome: "successful" | "failed"): Promise<void> {
  const status = outcome === "successful" ? "COMPLETED" : "FAILED";

  const settled = await prisma.$transaction(async (tx) => {
    const claimed = await tx.payout.updateMany({
      where: { momoRef: ref, status: "PENDING" },
      data: { status },
    });
    if (claimed.count === 0) return null;

    const payout = await tx.payout.findUnique({ where: { momoRef: ref } });
    if (!payout) return null;

    // Resolve who to tell: the operator's owner, or the driver's user.
    let userId: string | null = null;
    if (payout.operatorId) {
      const operator = await tx.operator.findUnique({ where: { id: payout.operatorId } });
      userId = operator?.ownerUserId ?? null;
    } else if (payout.driverId) {
      const driver = await tx.driver.findUnique({ where: { id: payout.driverId } });
      userId = driver?.userId ?? null;
    }
    if (!userId) return null;
    return { ownerUserId: userId, reference: payout.reference, amount: Number(payout.amount), method: payout.method };
  });

  if (!settled) return;
  publish(settled.ownerUserId, "payout", { reference: settled.reference, status, amount: settled.amount });
  if (outcome === "successful") {
    await notify(
      settled.ownerUserId,
      "Payout sent",
      `RWF ${Math.round(settled.amount).toLocaleString("en-US")} was sent to your ${settled.method} account (${settled.reference}).`
    );
  } else {
    await notify(
      settled.ownerUserId,
      "Payout failed",
      `Your withdrawal ${settled.reference} could not be processed. The amount stays available to withdraw.`
    );
  }
}
