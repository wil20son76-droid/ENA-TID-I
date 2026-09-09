import { calculateSampleAverageWeightG } from "../../domain/sampling";
import { db } from "../schema";
import type { SamplingFields, SamplingRecord } from "../types";
import { createEventRecord } from "./base";

const ENTITY_TYPE = "Sampling" as const;

export interface CreateSamplingInput {
  batchId: string;
  pondId: string;
  date: string;
  sampleFishCount: number;
  totalSampleWeightKg: number;
  averageLengthCm?: number | null;
  notes?: string | null;
  responsibleName?: string | null;
}

/**
 * Registra un muestreo, calculando `averageWeightG` automáticamente
 * (§21: la persona nunca calcula el peso promedio a mano). Valida que el
 * lote exista en el estanque seleccionado (§22) antes de guardar.
 */
export async function createSampling(input: CreateSamplingInput): Promise<SamplingRecord> {
  if (input.sampleFishCount <= 0) {
    throw new Error("El número de peces muestreados debe ser mayor que cero.");
  }
  if (input.totalSampleWeightKg <= 0) {
    throw new Error("El peso total de la muestra debe ser mayor que cero.");
  }

  const [stockings, transfers] = await Promise.all([
    db.stockings.where("batchId").equals(input.batchId).toArray(),
    db.fishTransfers.where("batchId").equals(input.batchId).toArray(),
  ]);
  const hasBatchInPond =
    stockings.some((s) => s.pondId === input.pondId) ||
    transfers.some((t) => t.toPondId === input.pondId);
  if (!hasBatchInPond) {
    throw new Error("Este lote no tiene registro de haber estado en el estanque seleccionado.");
  }

  const averageWeightG = calculateSampleAverageWeightG(
    input.sampleFishCount,
    input.totalSampleWeightKg,
  );

  const fields: SamplingFields = {
    batchId: input.batchId,
    pondId: input.pondId,
    date: input.date,
    sampleFishCount: input.sampleFishCount,
    totalSampleWeightKg: input.totalSampleWeightKg,
    averageWeightG,
    averageLengthCm: input.averageLengthCm ?? null,
    notes: input.notes ?? null,
    responsibleName: input.responsibleName ?? null,
  };

  return createEventRecord<SamplingRecord>(db.samplings, ENTITY_TYPE, fields);
}

export async function listSamplings(): Promise<SamplingRecord[]> {
  const all = await db.samplings.toArray();
  return all.filter((s) => !s.deletedAt).sort((a, b) => b.date.localeCompare(a.date));
}
