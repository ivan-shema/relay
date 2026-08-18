import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";

// Finalizers for pending Paypack transfers. Both the webhook and the client's
// status poll can try to settle the same ref, so each one claims the PENDING
// row with a guarded updateMany — whoever loses the race becomes a no-op.

export async function settleWalletTopup(ref: string, outcome: "successful" | "failed"): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.walletTransaction.updateMany({
      where: { momoRef: ref, status: "PENDING", kind: "CREDIT" },
      data: { status: outcome === "successful" ? "COMPLETED" : "FAILED" },
    });
    if (claimed.count === 0) return; // unknown ref or already settled

    const txn = await tx.walletTransaction.findUnique({ where: { momoRef: ref } });
    if (!txn) return;

    if (outcome === "successful") {
      const user = await tx.user.findUnique({ where: { id: txn.userId } });
      const balance = new Prisma.Decimal(user!.walletBalance).plus(txn.amount);
      await tx.user.update({ where: { id: txn.userId }, data: { walletBalance: balance } });
      await tx.notification.create({
        data: {
          userId: txn.userId,
          title: "Wallet topped up",
          message: `You added RWF ${Math.round(Number(txn.amount)).toLocaleString("en-US")} to your Relay wallet.`,
        },
      });
    } else {
      await tx.notification.create({
        data: {
          userId: txn.userId,
          title: "Top-up failed",
          message: "Your mobile money top-up was declined or timed out. No money was taken.",
        },
      });
    }
  });
}

export async function settlePayout(ref: string, outcome: "successful" | "failed"): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.payout.updateMany({
      where: { momoRef: ref, status: "PENDING" },
      data: { status: outcome === "successful" ? "COMPLETED" : "FAILED" },
    });
    if (claimed.count === 0) return;

    const payout = await tx.payout.findUnique({ where: { momoRef: ref } });
    if (!payout?.operatorId) return;
    const operator = await tx.operator.findUnique({ where: { id: payout.operatorId } });
    if (!operator?.ownerUserId) return;
    await tx.notification.create({
      data: {
        userId: operator.ownerUserId,
        title: outcome === "successful" ? "Payout sent" : "Payout failed",
        message:
          outcome === "successful"
            ? `RWF ${Math.round(Number(payout.amount)).toLocaleString("en-US")} was sent to your ${payout.method} account (${payout.reference}).`
            : `Your withdrawal ${payout.reference} could not be processed. The amount stays available to withdraw.`,
      },
    });
  });
}
