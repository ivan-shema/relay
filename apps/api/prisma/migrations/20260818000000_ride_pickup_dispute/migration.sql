-- AlterEnum
ALTER TYPE "RideRequestStatus" ADD VALUE 'DISPUTED';

-- AlterTable
ALTER TABLE "RideRequest" ADD COLUMN     "disputeContestedAt" TIMESTAMP(3),
ADD COLUMN     "disputedAt" TIMESTAMP(3);
