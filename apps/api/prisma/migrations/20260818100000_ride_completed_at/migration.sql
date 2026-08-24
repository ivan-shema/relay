-- AlterTable
ALTER TABLE "RideRequest" ADD COLUMN     "completedAt" TIMESTAMP(3);

-- Backfill: rides completed before this column existed settle at the time
-- the driver requested completion (closest recorded moment to the payout).
UPDATE "RideRequest" SET "completedAt" = COALESCE("completionRequestedAt", "paidAt", "createdAt") WHERE status = 'COMPLETED' AND "completedAt" IS NULL;
