-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MANAGER', 'WORKER', 'READ_ONLY');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "tokenVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_active_idx" ON "users"("active");

-- CreateIndex
CREATE INDEX "customers_updatedAt_idx" ON "customers"("updatedAt");

-- CreateIndex
CREATE INDEX "expenses_createdAt_idx" ON "expenses"("createdAt");

-- CreateIndex
CREATE INDEX "feed_inventory_movements_createdAt_idx" ON "feed_inventory_movements"("createdAt");

-- CreateIndex
CREATE INDEX "feeding_records_createdAt_idx" ON "feeding_records"("createdAt");

-- CreateIndex
CREATE INDEX "feeds_updatedAt_idx" ON "feeds"("updatedAt");

-- CreateIndex
CREATE INDEX "fish_batches_updatedAt_idx" ON "fish_batches"("updatedAt");

-- CreateIndex
CREATE INDEX "fish_transfers_createdAt_idx" ON "fish_transfers"("createdAt");

-- CreateIndex
CREATE INDEX "harvests_createdAt_idx" ON "harvests"("createdAt");

-- CreateIndex
CREATE INDEX "mortality_records_createdAt_idx" ON "mortality_records"("createdAt");

-- CreateIndex
CREATE INDEX "ponds_updatedAt_idx" ON "ponds"("updatedAt");

-- CreateIndex
CREATE INDEX "purchase_lines_createdAt_idx" ON "purchase_lines"("createdAt");

-- CreateIndex
CREATE INDEX "purchases_updatedAt_idx" ON "purchases"("updatedAt");

-- CreateIndex
CREATE INDEX "sale_lines_createdAt_idx" ON "sale_lines"("createdAt");

-- CreateIndex
CREATE INDEX "sales_updatedAt_idx" ON "sales"("updatedAt");

-- CreateIndex
CREATE INDEX "samplings_createdAt_idx" ON "samplings"("createdAt");

-- CreateIndex
CREATE INDEX "species_updatedAt_idx" ON "species"("updatedAt");

-- CreateIndex
CREATE INDEX "stockings_updatedAt_idx" ON "stockings"("updatedAt");

-- CreateIndex
CREATE INDEX "suppliers_updatedAt_idx" ON "suppliers"("updatedAt");

-- CreateIndex
CREATE INDEX "tasks_updatedAt_idx" ON "tasks"("updatedAt");

-- CreateIndex
CREATE INDEX "water_quality_records_createdAt_idx" ON "water_quality_records"("createdAt");
