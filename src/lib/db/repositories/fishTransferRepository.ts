import { getBatchPondBalance } from "../../domain/batchLedger";
import { calculateBiomassKg } from "../../domain/biomass";
import { db } from "../schema";
import type { FishTransferFields, FishTransferRecord } from "../types";
import { createEventRecord } from "./base";

const ENTITY_TYPE = "FishTransfer" as const;

export interface CreateFishTransferInput {
  batchId: string;
  fromPondId: string;
  toPondId: string;
  date: string;
  quantity: number;
  averageWeightG?: number | null;
  reason?: string | null;
  responsibleName?: string | null;
  notes?: string | null;
}

/**
 * Cuántos peces de este lote hay disponibles ahora mismo en este estanque,
 * calculado localmente (§13/§14: nunca se guarda como campo mutable). La
 * mortalidad cuenta como salida (§17 de la Fase 3), igual que un traslado.
 */
export async function getAvailableInPond(batchId: string, pondId: string): Promise<number> {
  const [stockings, transfers, mortalities] = await Promise.all([
    db.stockings.where("batchId").equals(batchId).toArray(),
    db.fishTransfers.where("batchId").equals(batchId).toArray(),
    db.mortalityRecords.where("batchId").equals(batchId).toArray(),
  ]);
  return getBatchPondBalance(stockings, transfers, mortalities, batchId, pondId);
}

/**
 * Crea un traslado, validando ANTES contra el balance local (§15: un
 * traslado nunca puede sacar más peces de los que hay disponibles). Esta
 * es la validación de cliente; el servidor vuelve a validarlo contra el
 * estado real de Postgres al sincronizar (§59: nunca confiar solo en el
 * cliente) — ver src/app/api/sync/_lib/applyOperation.ts.
 */
export async function createFishTransfer(
  input: CreateFishTransferInput,
): Promise<FishTransferRecord> {
  if (input.fromPondId === input.toPondId) {
    throw new Error("El estanque de origen y destino no pueden ser el mismo.");
  }
  if (input.quantity <= 0) {
    throw new Error("La cantidad a trasladar debe ser mayor que cero.");
  }

  const available = await getAvailableInPond(input.batchId, input.fromPondId);
  if (input.quantity > available) {
    throw new Error(
      `No hay suficientes peces disponibles en este estanque. Disponibles: ${available}.`,
    );
  }

  const biomassKg =
    input.averageWeightG != null && input.averageWeightG > 0
      ? calculateBiomassKg(input.quantity, input.averageWeightG)
      : null;

  const fields: FishTransferFields = {
    batchId: input.batchId,
    fromPondId: input.fromPondId,
    toPondId: input.toPondId,
    date: input.date,
    quantity: input.quantity,
    averageWeightG: input.averageWeightG ?? null,
    biomassKg,
    reason: input.reason ?? null,
    responsibleName: input.responsibleName ?? null,
    notes: input.notes ?? null,
  };

  return createEventRecord<FishTransferRecord>(db.fishTransfers, ENTITY_TYPE, fields);
}
