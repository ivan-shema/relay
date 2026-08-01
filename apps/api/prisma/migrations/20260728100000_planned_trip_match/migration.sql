-- AlterTable
ALTER TABLE "PlannedTrip" ADD COLUMN     "matchedTripId" TEXT;

-- AddForeignKey
ALTER TABLE "PlannedTrip" ADD CONSTRAINT "PlannedTrip_matchedTripId_fkey" FOREIGN KEY ("matchedTripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

