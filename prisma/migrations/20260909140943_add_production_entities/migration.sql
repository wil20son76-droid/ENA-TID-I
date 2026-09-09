/*
  Renombres (mismo tipo/significado, se preserva el dato con RENAME COLUMN
  en vez de DROP+ADD — editado a mano tras generar con
  `prisma migrate dev --create-only`, ver IMPLEMENTATION_PLAN.md):
    ponds.location              -> ponds.locationNotes
    ponds.surfaceM2             -> ponds.areaM2
    ponds.volumeM3              -> ponds.estimatedVolumeM3
    species.cultureDurationDays -> species.estimatedCycleDays
    species.expectedMortalityPct -> species.expectedMortalityPercent
    species.minDissolvedOxygen  -> species.minDissolvedOxygenMgL

  Cambios reales (no son solo un rename, se pierde el dato anterior):
    - species.notes se elimina (sin reemplazo; "description" ya cubre
      texto libre en el campo final acordado para Fase 2).
    - species.targetWeightGrams se reemplaza por species.targetWeightKg:
      cambia de unidad (gramos -> kilogramos), así que un RENAME dejaría
      el valor numérico equivocado (1000x). No hay filas con datos reales
      en este punto del proyecto (Fase 2 arrancó con la tabla vacía), así
      que no aplica ninguna conversión de datos.
*/
-- CreateEnum
CREATE TYPE "GeometrySource" AS ENUM ('CALCULATED', 'MANUAL');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('PLANNED', 'STOCKED', 'GROWING', 'PRE_HARVEST', 'PARTIAL_HARVEST', 'HARVESTED', 'CLOSED');

-- RenameColumn (preserva datos)
ALTER TABLE "ponds" RENAME COLUMN "location" TO "locationNotes";
ALTER TABLE "ponds" RENAME COLUMN "surfaceM2" TO "areaM2";
ALTER TABLE "ponds" RENAME COLUMN "volumeM3" TO "estimatedVolumeM3";

-- AlterTable
ALTER TABLE "ponds"
ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "areaSource" "GeometrySource" NOT NULL DEFAULT 'CALCULATED',
ADD COLUMN     "capacityNotes" TEXT,
ADD COLUMN     "volumeSource" "GeometrySource" NOT NULL DEFAULT 'CALCULATED';

-- RenameColumn (preserva datos)
ALTER TABLE "species" RENAME COLUMN "cultureDurationDays" TO "estimatedCycleDays";
ALTER TABLE "species" RENAME COLUMN "expectedMortalityPct" TO "expectedMortalityPercent";
ALTER TABLE "species" RENAME COLUMN "minDissolvedOxygen" TO "minDissolvedOxygenMgL";

-- AlterTable (cambios reales, no renames — ver comentario arriba)
ALTER TABLE "species"
DROP COLUMN "notes",
DROP COLUMN "targetWeightGrams",
ADD COLUMN     "targetWeightKg" DECIMAL(10,3);

-- CreateTable
CREATE TABLE "fish_batches" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "speciesId" TEXT NOT NULL,
    "supplierId" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "initialStockingDate" TIMESTAMP(3) NOT NULL,
    "initialQuantity" INTEGER NOT NULL,
    "initialAverageWeightG" DECIMAL(10,2) NOT NULL,
    "initialBiomassKg" DECIMAL(12,3) NOT NULL,
    "fryCost" DECIMAL(12,2),
    "targetWeightKg" DECIMAL(10,3),
    "expectedHarvestDate" TIMESTAMP(3),
    "status" "BatchStatus" NOT NULL DEFAULT 'PLANNED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "deviceId" TEXT NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "fish_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stockings" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "pondId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "averageWeightG" DECIMAL(10,2) NOT NULL,
    "biomassKg" DECIMAL(12,3) NOT NULL,
    "responsibleName" TEXT,
    "notes" TEXT,
    "deviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "stockings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fish_transfers" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "fromPondId" TEXT NOT NULL,
    "toPondId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "averageWeightG" DECIMAL(10,2),
    "biomassKg" DECIMAL(12,3),
    "reason" TEXT,
    "responsibleName" TEXT,
    "notes" TEXT,
    "deviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fish_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fish_batches_code_key" ON "fish_batches"("code");

-- CreateIndex
CREATE INDEX "fish_batches_speciesId_idx" ON "fish_batches"("speciesId");

-- CreateIndex
CREATE INDEX "fish_batches_status_idx" ON "fish_batches"("status");

-- CreateIndex
CREATE INDEX "stockings_batchId_idx" ON "stockings"("batchId");

-- CreateIndex
CREATE INDEX "stockings_pondId_idx" ON "stockings"("pondId");

-- CreateIndex
CREATE INDEX "stockings_batchId_pondId_idx" ON "stockings"("batchId", "pondId");

-- CreateIndex
CREATE INDEX "fish_transfers_batchId_idx" ON "fish_transfers"("batchId");

-- CreateIndex
CREATE INDEX "fish_transfers_fromPondId_idx" ON "fish_transfers"("fromPondId");

-- CreateIndex
CREATE INDEX "fish_transfers_toPondId_idx" ON "fish_transfers"("toPondId");

-- CreateIndex
CREATE INDEX "ponds_active_idx" ON "ponds"("active");

-- AddForeignKey
ALTER TABLE "fish_batches" ADD CONSTRAINT "fish_batches_speciesId_fkey" FOREIGN KEY ("speciesId") REFERENCES "species"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stockings" ADD CONSTRAINT "stockings_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "fish_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stockings" ADD CONSTRAINT "stockings_pondId_fkey" FOREIGN KEY ("pondId") REFERENCES "ponds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fish_transfers" ADD CONSTRAINT "fish_transfers_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "fish_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fish_transfers" ADD CONSTRAINT "fish_transfers_fromPondId_fkey" FOREIGN KEY ("fromPondId") REFERENCES "ponds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fish_transfers" ADD CONSTRAINT "fish_transfers_toPondId_fkey" FOREIGN KEY ("toPondId") REFERENCES "ponds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
