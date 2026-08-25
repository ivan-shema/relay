-- CreateEnum
CREATE TYPE "DriverInviteStatus" AS ENUM ('INVITED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'DECLINED', 'CANCELLED');

-- CreateTable
CREATE TABLE "DriverInvite" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "token" TEXT NOT NULL,
    "note" TEXT,
    "status" "DriverInviteStatus" NOT NULL DEFAULT 'INVITED',
    "licenseNumber" TEXT,
    "nationalId" TEXT,
    "rejectionReason" TEXT,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "DriverInvite_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "inviteId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "DriverInvite_token_key" ON "DriverInvite"("token");
CREATE INDEX "DriverInvite_email_idx" ON "DriverInvite"("email");
CREATE INDEX "DriverInvite_operatorId_status_idx" ON "DriverInvite"("operatorId", "status");

-- AddForeignKey
ALTER TABLE "DriverInvite" ADD CONSTRAINT "DriverInvite_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriverInvite" ADD CONSTRAINT "DriverInvite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "DriverInvite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
