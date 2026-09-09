import { calculateBiomassKg } from "../../domain/biomass";
import { generateBatchCode } from "../../domain/batchCode";
import { getDeviceId } from "../deviceId";
import { db } from "../schema";
import type { FishBatchFields, FishBatchRecord, StockingRecord } from "../types";
import { generateId } from "../uuid";
import { enqueueSyncOperation, softDeleteRecord, updateRecord } from "./base";

const ENTITY_TYPE = "FishBatch" as const;
const STOCKING_ENTITY_TYPE = "Stocking" as const;

/** Lotes activos (no eliminados), ordenados por código. */
export async function listActiveFishBatches(): Promise<FishBatchRecord[]> {
  const all = await db.fishBatches.toArray();
  return all
    .filter((b) => !b.deletedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getFishBatchById(id: string): Promise<FishBatchRecord | undefined> {
  return db.fishBatches.get(id);
}

async function nextLocalBatchSequence(
  speciesId: string,
  year: number,
  deviceId: string,
): Promise<number> {
  const existing = await db.fishBatches.where("speciesId").equals(speciesId).toArray();
  const count = existing.filter(
    (batch) => batch.deviceId === deviceId && new Date(batch.createdAt).getFullYear() === year,
  ).length;
  return count + 1;
}

export interface CreateFishBatchInput {
  speciesId: string;
  /** Estanque donde se realiza la siembra inicial. */
  pondId: string;
  initialStockingDate: string;
  initialQuantity: number;
  initialAverageWeightG: number;
  purchaseDate?: string | null;
  supplierId?: string | null;
  fryCost?: number | null;
  targetWeightKg?: number | null;
  expectedHarvestDate?: string | null;
  notes?: string | null;
  responsibleName?: string | null;
}

/**
 * Crea un lote y su siembra inicial juntos, en una única transacción
 * local (§21 del encargo de Fase 2): si algo falla, no debe quedar un
 * lote sin su siembra ni una siembra sin su lote.
 */
export async function createFishBatchWithStocking(
  input: CreateFishBatchInput,
): Promise<{ batch: FishBatchRecord; stocking: StockingRecord }> {
  const species = await db.species.get(input.speciesId);
  if (!species) {
    throw new Error("La especie seleccionada no existe.");
  }
  if (input.initialQuantity <= 0) {
    throw new Error("La cantidad inicial debe ser mayor que cero.");
  }
  if (input.initialAverageWeightG <= 0) {
    throw new Error("El peso promedio inicial debe ser mayor que cero.");
  }

  const deviceId = getDeviceId();
  const year = new Date(input.initialStockingDate).getFullYear();
  const localSequence = await nextLocalBatchSequence(input.speciesId, year, deviceId);
  const code = generateBatchCode({
    speciesCommonName: species.commonName,
    year,
    localSequence,
    deviceId,
  });

  const initialBiomassKg = calculateBiomassKg(input.initialQuantity, input.initialAverageWeightG);
  const now = new Date().toISOString();

  const batch: FishBatchRecord = {
    id: generateId(),
    code,
    speciesId: input.speciesId,
    supplierId: input.supplierId ?? null,
    purchaseDate: input.purchaseDate ?? null,
    initialStockingDate: input.initialStockingDate,
    initialQuantity: input.initialQuantity,
    initialAverageWeightG: input.initialAverageWeightG,
    initialBiomassKg,
    fryCost: input.fryCost ?? null,
    targetWeightKg: input.targetWeightKg ?? null,
    expectedHarvestDate: input.expectedHarvestDate ?? null,
    status: "STOCKED",
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1,
    deviceId,
    createdBy: null,
    updatedBy: null,
  };

  const stocking: StockingRecord = {
    id: generateId(),
    batchId: batch.id,
    pondId: input.pondId,
    date: input.initialStockingDate,
    quantity: input.initialQuantity,
    averageWeightG: input.initialAverageWeightG,
    biomassKg: initialBiomassKg,
    responsibleName: input.responsibleName ?? null,
    notes: null,
    deviceId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  await db.transaction("rw", db.fishBatches, db.stockings, db.syncQueue, async () => {
    await db.fishBatches.add(batch);
    await db.stockings.add(stocking);
    await enqueueSyncOperation(ENTITY_TYPE, batch.id, "CREATE", batch, deviceId);
    await enqueueSyncOperation(STOCKING_ENTITY_TYPE, stocking.id, "CREATE", stocking, deviceId);
  });

  return { batch, stocking };
}

export async function updateFishBatch(
  id: string,
  patch: Partial<FishBatchFields>,
): Promise<FishBatchRecord> {
  return updateRecord<FishBatchRecord>(db.fishBatches, ENTITY_TYPE, id, patch);
}

export async function deleteFishBatch(id: string): Promise<void> {
  return softDeleteRecord<FishBatchRecord>(db.fishBatches, ENTITY_TYPE, id);
}
