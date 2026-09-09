import { getBatchPondBalance } from "../../domain/batchLedger";
import { db } from "../schema";
import type { MortalityRecordFields, MortalityRecordRecord } from "../types";
import { createEventRecord } from "./base";

const ENTITY_TYPE = "MortalityRecord" as const;

/**
 * Peces disponibles de este lote en este estanque, considerando también
 * la mortalidad ya registrada (§16-§17: la mortalidad es una salida más
 * del ledger, igual que un traslado saliente).
 */
export async function getAvailableForMortality(batchId: string, pondId: string): Promise<number> {
  const [stockings, transfers, mortalities] = await Promise.all([
    db.stockings.where("batchId").equals(batchId).toArray(),
    db.fishTransfers.where("batchId").equals(batchId).toArray(),
    db.mortalityRecords.where("batchId").equals(batchId).toArray(),
  ]);
  return getBatchPondBalance(stockings, transfers, mortalities, batchId, pondId);
}

export interface CreateMortalityInput {
  batchId: string;
  pondId: string;
  date: string;
  quantity: number;
  estimatedAverageWeightG?: number | null;
  cause: MortalityRecordFields["cause"];
  notes?: string | null;
  responsibleName?: string | null;
}

/**
 * Registra mortalidad, validando ANTES contra el balance local (§16: no
 * se puede registrar más mortalidad que peces disponibles en ese
 * estanque). El servidor vuelve a validarlo al sincronizar, con el mismo
 * criterio de bloqueo de concurrencia que los traslados (§16 —
 * applyOperation.ts).
 */
export async function createMortality(
  input: CreateMortalityInput,
): Promise<MortalityRecordRecord> {
  if (input.quantity <= 0) {
    throw new Error("La cantidad de mortalidad debe ser mayor que cero.");
  }

  const available = await getAvailableForMortality(input.batchId, input.pondId);
  if (input.quantity > available) {
    throw new Error(
      `No se puede registrar más mortalidad que peces disponibles en este estanque. Disponibles: ${available}.`,
    );
  }

  const fields: MortalityRecordFields = {
    batchId: input.batchId,
    pondId: input.pondId,
    date: input.date,
    quantity: input.quantity,
    estimatedAverageWeightG: input.estimatedAverageWeightG ?? null,
    cause: input.cause,
    notes: input.notes ?? null,
    responsibleName: input.responsibleName ?? null,
  };

  return createEventRecord<MortalityRecordRecord>(db.mortalityRecords, ENTITY_TYPE, fields);
}

export async function listMortalityRecords(): Promise<MortalityRecordRecord[]> {
  const all = await db.mortalityRecords.toArray();
  return all.filter((m) => !m.deletedAt).sort((a, b) => b.date.localeCompare(a.date));
}
