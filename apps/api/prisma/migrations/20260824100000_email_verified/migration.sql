-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerified" BOOLEAN NOT NULL DEFAULT false;

-- Accounts already linked to Google proved their email through Google.
UPDATE "User" SET "emailVerified" = true WHERE "googleId" IS NOT NULL;
