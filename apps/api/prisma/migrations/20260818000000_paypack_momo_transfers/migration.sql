-- CreateEnum
CREATE TYPE "MomoTransferStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "Payout" ADD COLUMN     "momoRef" TEXT,
ADD COLUMN     "status" "MomoTransferStatus" NOT NULL DEFAULT 'COMPLETED';

-- AlterTable
ALTER TABLE "WalletTransaction" ADD COLUMN     "momoRef" TEXT,
ADD COLUMN     "status" "MomoTransferStatus" NOT NULL DEFAULT 'COMPLETED';

-- CreateIndex
CREATE UNIQUE INDEX "Payout_momoRef_key" ON "Payout"("momoRef");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_momoRef_key" ON "WalletTransaction"("momoRef");
