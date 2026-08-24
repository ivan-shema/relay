-- AlterTable
ALTER TABLE "User" ADD COLUMN     "credentialsEmailed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Otp" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0;

-- Codes issued under the removed mock mode (fixed 000000) must not stay valid.
UPDATE "Otp" SET "consumed" = true WHERE "consumed" = false;
