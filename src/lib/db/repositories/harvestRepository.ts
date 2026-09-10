// Cosechas (§20-§26 del encargo de Fase 5): evento append-only, salida
// del ledger de peces con el MISMO criterio que mortalidad/traslado —
// nunca se puede cosechar más peces de los disponibles en ese lote+
// estanque (§22), validado localmente antes de escribir y de nuevo en el
// servidor al sincronizar (§59, §23 — mismo lock de concurrencia por
// batchId que ya protege traslados y mortalidad, porque las tres compiten
// por el mismo balance).
import { getBatchPondBalance } from "../../domain/batchLedger";
import { db } from "../schema";
import type { HarvestFields, HarvestRecord } from "../types";
import { createEventRecord } from "./base";

const ENTITY_TYPE = "Harvest" as const;

export async function getAvailableForHarvest(batchId: string, pondId: string): Promise<number> {
  const [stockings, transfers, mortalities, harvests] = await Promise.all([
    db.stockings.where("batchId").equals(batchId).toArray(),
    db.fishTransfers.where("batchId").equals(batchId).toArray(),
    db.mortalityRecords.where("batchId").equals(batchId).toArray(),
    db.harvests.where("batchId").equals(batchId).toArray(),
  ]);
  return getBatchPondBalance(stockings, transfers, mortalities, harvests, batchId, pondId);
}

export interface CreateHarvestInput {
  batchId: string;
  pondId: string;
  date: string;
  quantityFish: number;
  totalWeightKg: number;
  harvestType: HarvestFields["harvestType"];
  responsibleName?: string | null;
  notes?: string | null;
}

/**
 * Registra una cosecha, validando ANTES contra el balance local (§22: no
 * se puede cosechar más peces de los disponibles). `averageWeightG` se
 * calcula aquí (`totalWeightKg × 1000 / quantityFish`), nunca se le pide
 * a la persona que lo calcule — mismo criterio que Sampling.
 */
export async function createHarvest(input: CreateHarvestInput): Promise<HarvestRecord> {
  if (input.quantityFish <= 0) {
    throw new Error("La cantidad de peces cosechados debe ser mayor que cero.");
  }
  if (input.totalWeightKg <= 0) {
    throw new Error("El peso total cosechado debe ser mayor que cero.");
  }

  const available = await getAvailableForHarvest(input.batchId, input.pondId);
  if (input.quantityFish > available) {
    throw new Error(
      `No se puede cosechar más peces que los disponibles en este estanque. Disponibles: ${available}.`,
    );
  }

  const fields: HarvestFields = {
    batchId: input.batchId,
    pondId: input.pondId,
    date: input.date,
    quantityFish: input.quantityFish,
    totalWeightKg: input.totalWeightKg,
    averageWeightG: (input.totalWeightKg * 1000) / input.quantityFish,
    harvestType: input.harvestType,
    responsibleName: input.responsibleName ?? null,
    notes: input.notes ?? null,
  };

  return createEventRecord<HarvestRecord>(db.harvests, ENTITY_TYPE, fields);
}

export async function listHarvests(): Promise<HarvestRecord[]> {
  const all = await db.harvests.toArray();
  return all.filter((h) => !h.deletedAt).sort((a, b) => b.date.localeCompare(a.date));
}

export async function listHarvestsForBatch(batchId: string): Promise<HarvestRecord[]> {
  const all = await db.harvests.where("batchId").equals(batchId).toArray();
  return all.filter((h) => !h.deletedAt).sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * §25: si al cosechar no queda ningún pez vivo del lote en NINGÚN
 * estanque, el lote está efectivamente cosechado del todo — pero esto se
 * deriva siempre del ledger, nunca se escribe como mutación de
 * `FishBatch.status` (evitaría el riesgo de inconsistencia que el propio
 * encargo señala: "nunca permitir status=HARVESTED con 300 peces
 * todavía activos"). La UI usa esta función para MOSTRAR un indicador,
 * no para decidir si debe escribir un nuevo estado.
 */
export function isBatchFullyHarvested(totalLivingFish: number, stockedTotal: number): boolean {
  return stockedTotal > 0 && totalLivingFish <= 0;
}
