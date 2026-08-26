-- Lock Relay's booking commission onto each payment at pay time (mirrors
-- commissionPct / commissionAmount on RideRequest), so changing the platform
-- setting later never rewrites what an operator was owed.

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "commissionAmount" DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS "commissionPct" DOUBLE PRECISION;

-- Backfill: existing PAID payments were settled at the rate in force until now
-- (the configured booking commission, or the historical 12% default).
UPDATE "Payment"
SET "commissionPct" = COALESCE(
      (SELECT NULLIF("value", '')::double precision FROM "PlatformSetting" WHERE "key" = 'bookingCommissionPct'),
      12
    )
WHERE "status" = 'PAID' AND "commissionPct" IS NULL;

UPDATE "Payment"
SET "commissionAmount" = ROUND(("amount" * ("commissionPct" / 100.0))::numeric, 2)
WHERE "status" = 'PAID' AND "commissionAmount" IS NULL AND "commissionPct" IS NOT NULL;
