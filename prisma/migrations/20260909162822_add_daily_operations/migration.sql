-- CreateEnum
CREATE TYPE "FeedMovementType" AS ENUM ('PURCHASE', 'INITIAL_STOCK', 'CONSUMPTION', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'LOSS', 'RETURN');

-- CreateEnum
CREATE TYPE "FeedingShift" AS ENUM ('MORNING', 'MIDDAY', 'AFTERNOON', 'NIGHT');

-- CreateEnum
CREATE TYPE "MortalityCause" AS ENUM ('UNKNOWN', 'LOW_OXYGEN', 'DISEASE', 'HANDLING', 'PREDATORS', 'TEMPERATURE', 'WATER_QUALITY', 'ACCIDENT', 'OTHER');

-- CreateTable
CREATE TABLE "feeds" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "proteinPercent" DECIMAL(5,2),
    "pelletSizeMm" DECIMAL(6,2),
    "bagWeightKg" DECIMAL(8,2),
    "defaultBagPrice" DECIMAL(12,2),
    "defaultCostPerKg" DECIMAL(12,4),
    "recommendedStage" TEXT,
    "notes" TEXT,
    "minimumStockKg" DECIMAL(10,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "deviceId" TEXT NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "feeds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_inventory_movements" (
    "id" TEXT NOT NULL,
    "feedId" TEXT NOT NULL,
    "movementType" "FeedMovementType" NOT NULL,
    "quantityKg" DECIMAL(10,3) NOT NULL,
    "unitCostPerKg" DECIMAL(12,4),
    "totalCost" DECIMAL(12,2),
    "date" TIMESTAMP(3) NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "notes" TEXT,
    "deviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "feed_inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feeding_records" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "pondId" TEXT NOT NULL,
    "feedId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "time" TEXT,
    "quantityKg" DECIMAL(10,3) NOT NULL,
    "shift" "FeedingShift",
    "responsibleName" TEXT,
    "notes" TEXT,
    "deviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "feeding_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mortality_records" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "pondId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "estimatedAverageWeightG" DECIMAL(10,2),
    "cause" "MortalityCause" NOT NULL DEFAULT 'UNKNOWN',
    "notes" TEXT,
    "responsibleName" TEXT,
    "deviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "mortality_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "samplings" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "pondId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "sampleFishCount" INTEGER NOT NULL,
    "totalSampleWeightKg" DECIMAL(10,3) NOT NULL,
    "averageWeightG" DECIMAL(10,2) NOT NULL,
    "averageLengthCm" DECIMAL(6,2),
    "notes" TEXT,
    "responsibleName" TEXT,
    "deviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "samplings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feeds_active_idx" ON "feeds"("active");

-- CreateIndex
CREATE INDEX "feed_inventory_movements_feedId_idx" ON "feed_inventory_movements"("feedId");

-- CreateIndex
CREATE INDEX "feed_inventory_movements_feedId_date_idx" ON "feed_inventory_movements"("feedId", "date");

-- CreateIndex
CREATE INDEX "feed_inventory_movements_movementType_idx" ON "feed_inventory_movements"("movementType");

-- CreateIndex
CREATE UNIQUE INDEX "feed_inventory_movements_sourceType_sourceId_key" ON "feed_inventory_movements"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "feeding_records_batchId_idx" ON "feeding_records"("batchId");

-- CreateIndex
CREATE INDEX "feeding_records_pondId_idx" ON "feeding_records"("pondId");

-- CreateIndex
CREATE INDEX "feeding_records_feedId_idx" ON "feeding_records"("feedId");

-- CreateIndex
CREATE INDEX "feeding_records_date_idx" ON "feeding_records"("date");

-- CreateIndex
CREATE INDEX "mortality_records_batchId_idx" ON "mortality_records"("batchId");

-- CreateIndex
CREATE INDEX "mortality_records_pondId_idx" ON "mortality_records"("pondId");

-- CreateIndex
CREATE INDEX "mortality_records_batchId_pondId_idx" ON "mortality_records"("batchId", "pondId");

-- CreateIndex
CREATE INDEX "mortality_records_date_idx" ON "mortality_records"("date");

-- CreateIndex
CREATE INDEX "samplings_batchId_idx" ON "samplings"("batchId");

-- CreateIndex
CREATE INDEX "samplings_pondId_idx" ON "samplings"("pondId");

-- CreateIndex
CREATE INDEX "samplings_batchId_pondId_idx" ON "samplings"("batchId", "pondId");

-- CreateIndex
CREATE INDEX "samplings_date_idx" ON "samplings"("date");

-- AddForeignKey
ALTER TABLE "feed_inventory_movements" ADD CONSTRAINT "feed_inventory_movements_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "feeds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feeding_records" ADD CONSTRAINT "feeding_records_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "fish_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feeding_records" ADD CONSTRAINT "feeding_records_pondId_fkey" FOREIGN KEY ("pondId") REFERENCES "ponds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feeding_records" ADD CONSTRAINT "feeding_records_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "feeds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mortality_records" ADD CONSTRAINT "mortality_records_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "fish_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mortality_records" ADD CONSTRAINT "mortality_records_pondId_fkey" FOREIGN KEY ("pondId") REFERENCES "ponds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "samplings" ADD CONSTRAINT "samplings_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "fish_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "samplings" ADD CONSTRAINT "samplings_pondId_fkey" FOREIGN KEY ("pondId") REFERENCES "ponds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
