-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "idempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "RideRequest" ADD COLUMN     "payIdempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "RideRequest_payIdempotencyKey_key" ON "RideRequest"("payIdempotencyKey");
