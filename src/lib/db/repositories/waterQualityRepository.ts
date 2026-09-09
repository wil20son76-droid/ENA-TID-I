import {
  assertPhysicallyValidMeasurement,
  hasAtLeastOneMeasurement,
  type WaterQualityMeasurementInput,
} from "../../domain/waterQuality";
import { db } from "../schema";
import type { WaterQualityRecordFields, WaterQualityRecordRecord } from "../types";
import { createEventRecord } from "./base";

const ENTITY_TYPE = "WaterQualityRecord" as const;

export interface CreateWaterQualityInput extends WaterQualityMeasurementInput {
  pondId: string;
  batchId?: string | null;
  date: string;
  time?: string | null;
  notes?: string | null;
  responsibleName?: string | null;
}

/**
 * Registra una medición de calidad del agua. Requisito mínimo (§2 del
 * encargo de Fase 4): estanque + fecha + al menos un parámetro medido —
 * no se exige informar todos. Valida rangos físicos básicos ANTES de
 * escribir (§3, §42: el servidor los vuelve a validar al sincronizar,
 * nunca se confía solo en el cliente).
 */
export async function createWaterQualityRecord(
  input: CreateWaterQualityInput,
): Promise<WaterQualityRecordRecord> {
  if (!hasAtLeastOneMeasurement(input)) {
    throw new Error("Registra al menos un parámetro medido.");
  }
  assertPhysicallyValidMeasurement(input);

  const fields: WaterQualityRecordFields = {
    pondId: input.pondId,
    batchId: input.batchId ?? null,
    date: input.date,
    time: input.time ?? null,
    temperatureC: input.temperatureC ?? null,
    ph: input.ph ?? null,
    dissolvedOxygenMgL: input.dissolvedOxygenMgL ?? null,
    transparencyCm: input.transparencyCm ?? null,
    ammoniaMgL: input.ammoniaMgL ?? null,
    nitriteMgL: input.nitriteMgL ?? null,
    alkalinityMgL: input.alkalinityMgL ?? null,
    waterLevelCm: input.waterLevelCm ?? null,
    notes: input.notes ?? null,
    responsibleName: input.responsibleName ?? null,
  };

  return createEventRecord<WaterQualityRecordRecord>(db.waterQualityRecords, ENTITY_TYPE, fields);
}

export async function listWaterQualityRecords(): Promise<WaterQualityRecordRecord[]> {
  const all = await db.waterQualityRecords.toArray();
  return all.filter((r) => !r.deletedAt).sort((a, b) => b.date.localeCompare(a.date));
}

export async function listWaterQualityRecordsByPond(
  pondId: string,
): Promise<WaterQualityRecordRecord[]> {
  const all = await db.waterQualityRecords.where("pondId").equals(pondId).toArray();
  return all.filter((r) => !r.deletedAt).sort((a, b) => b.date.localeCompare(a.date));
}

/** Última medición de un estanque, o `undefined` si nunca se registró ninguna. */
export async function getLatestWaterQualityRecord(
  pondId: string,
): Promise<WaterQualityRecordRecord | undefined> {
  const records = await listWaterQualityRecordsByPond(pondId);
  return records[0];
}
