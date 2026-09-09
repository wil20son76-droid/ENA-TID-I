-- CreateEnum
CREATE TYPE "PondStatus" AS ENUM ('EMPTY', 'PREPARATION', 'ACTIVE', 'HARVEST', 'CLEANING', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "SyncOperationType" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateEnum
CREATE TYPE "SyncOperationStatus" AS ENUM ('applied', 'duplicate', 'conflict', 'error');

-- CreateTable
CREATE TABLE "species" (
    "id" TEXT NOT NULL,
    "commonName" TEXT NOT NULL,
    "scientificName" TEXT,
    "description" TEXT,
    "targetWeightGrams" DECIMAL(10,2),
    "cultureDurationDays" INTEGER,
    "minTemperatureC" DECIMAL(4,1),
    "maxTemperatureC" DECIMAL(4,1),
    "minPh" DECIMAL(4,2),
    "maxPh" DECIMAL(4,2),
    "minDissolvedOxygen" DECIMAL(5,2),
    "expectedFcr" DECIMAL(5,2),
    "expectedMortalityPct" DECIMAL(5,2),
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "deviceId" TEXT NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "species_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ponds" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "lengthM" DECIMAL(8,2),
    "widthM" DECIMAL(8,2),
    "averageDepthM" DECIMAL(8,2),
    "surfaceM2" DECIMAL(10,2),
    "volumeM3" DECIMAL(10,2),
    "location" TEXT,
    "notes" TEXT,
    "status" "PondStatus" NOT NULL DEFAULT 'EMPTY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "deviceId" TEXT NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "ponds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_operations" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "operation" "SyncOperationType" NOT NULL,
    "deviceId" TEXT NOT NULL,
    "status" "SyncOperationStatus" NOT NULL,
    "errorMessage" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "species_active_idx" ON "species"("active");

-- CreateIndex
CREATE UNIQUE INDEX "ponds_code_key" ON "ponds"("code");

-- CreateIndex
CREATE INDEX "ponds_status_idx" ON "ponds"("status");

-- CreateIndex
CREATE UNIQUE INDEX "sync_operations_operationId_key" ON "sync_operations"("operationId");

-- CreateIndex
CREATE INDEX "sync_operations_entityType_entityId_idx" ON "sync_operations"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "sync_operations_processedAt_idx" ON "sync_operations"("processedAt");
