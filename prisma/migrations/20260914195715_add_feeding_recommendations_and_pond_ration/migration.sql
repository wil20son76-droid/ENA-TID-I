-- AlterTable
ALTER TABLE "ponds" ADD COLUMN     "manualDailyRationKg" DECIMAL(10,3),
ADD COLUMN     "manualFeedingsPerDay" INTEGER;

-- CreateTable
CREATE TABLE "feeding_recommendations" (
    "id" TEXT NOT NULL,
    "speciesId" TEXT NOT NULL,
    "minWeightG" DECIMAL(10,2) NOT NULL,
    "maxWeightG" DECIMAL(10,2) NOT NULL,
    "feedPercent" DECIMAL(5,2) NOT NULL,
    "feedingsPerDay" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "deviceId" TEXT NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "feeding_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feeding_recommendations_speciesId_idx" ON "feeding_recommendations"("speciesId");

-- CreateIndex
CREATE INDEX "feeding_recommendations_active_idx" ON "feeding_recommendations"("active");

-- CreateIndex
CREATE INDEX "feeding_recommendations_updatedAt_idx" ON "feeding_recommendations"("updatedAt");

-- AddForeignKey
ALTER TABLE "feeding_recommendations" ADD CONSTRAINT "feeding_recommendations_speciesId_fkey" FOREIGN KEY ("speciesId") REFERENCES "species"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

