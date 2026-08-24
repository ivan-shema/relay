-- AlterEnum
ALTER TYPE "OperatorStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "Operator" ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3);
