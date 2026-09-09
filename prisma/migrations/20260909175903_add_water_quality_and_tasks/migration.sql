-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateTable
CREATE TABLE "water_quality_records" (
    "id" TEXT NOT NULL,
    "pondId" TEXT NOT NULL,
    "batchId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "time" TEXT,
    "temperatureC" DECIMAL(4,1),
    "ph" DECIMAL(4,2),
    "dissolvedOxygenMgL" DECIMAL(5,2),
    "transparencyCm" DECIMAL(6,1),
    "ammoniaMgL" DECIMAL(6,3),
    "nitriteMgL" DECIMAL(6,3),
    "alkalinityMgL" DECIMAL(7,2),
    "waterLevelCm" DECIMAL(7,1),
    "notes" TEXT,
    "responsibleName" TEXT,
    "deviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "water_quality_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "dueTime" TEXT,
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "pondId" TEXT,
    "batchId" TEXT,
    "assignedToName" TEXT,
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "deviceId" TEXT NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "water_quality_records_pondId_idx" ON "water_quality_records"("pondId");

-- CreateIndex
CREATE INDEX "water_quality_records_batchId_idx" ON "water_quality_records"("batchId");

-- CreateIndex
CREATE INDEX "water_quality_records_pondId_date_idx" ON "water_quality_records"("pondId", "date");

-- CreateIndex
CREATE INDEX "water_quality_records_date_idx" ON "water_quality_records"("date");

-- CreateIndex
CREATE INDEX "tasks_dueDate_idx" ON "tasks"("dueDate");

-- CreateIndex
CREATE INDEX "tasks_status_idx" ON "tasks"("status");

-- CreateIndex
CREATE INDEX "tasks_pondId_idx" ON "tasks"("pondId");

-- CreateIndex
CREATE INDEX "tasks_batchId_idx" ON "tasks"("batchId");

-- AddForeignKey
ALTER TABLE "water_quality_records" ADD CONSTRAINT "water_quality_records_pondId_fkey" FOREIGN KEY ("pondId") REFERENCES "ponds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "water_quality_records" ADD CONSTRAINT "water_quality_records_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "fish_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_pondId_fkey" FOREIGN KEY ("pondId") REFERENCES "ponds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "fish_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
