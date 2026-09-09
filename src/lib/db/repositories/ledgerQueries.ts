// Consultas derivadas de solo lectura sobre el ledger de peces
// (Stocking + FishTransfer). Usadas por las páginas de ficha de lote y
// ficha de estanque. Toda la lógica de cálculo vive en
// src/lib/domain/batchLedger.ts — este archivo solo trae los datos de
// Dexie y se los pasa.
import {
  getBatchDistribution as calculateBatchDistribution,
  getBatchTotalBalance as calculateBatchTotalBalance,
  getPondOccupancy as calculatePondOccupancy,
} from "../../domain/batchLedger";
import { db } from "../schema";
import type { FishTransferRecord, StockingRecord } from "../types";

async function loadBatchEvents(batchId: string) {
  const [stockings, transfers] = await Promise.all([
    db.stockings.where("batchId").equals(batchId).toArray(),
    db.fishTransfers.where("batchId").equals(batchId).toArray(),
  ]);
  return { stockings, transfers };
}

/** `{ pondId: cantidad }` — dónde está repartido un lote ahora mismo. */
export async function getBatchDistribution(batchId: string): Promise<Record<string, number>> {
  const { stockings, transfers } = await loadBatchEvents(batchId);
  return calculateBatchDistribution(stockings, transfers, batchId);
}

/** Total de peces vivos de un lote, sumando todos los estanques. */
export async function getBatchTotalQuantity(batchId: string): Promise<number> {
  const { stockings, transfers } = await loadBatchEvents(batchId);
  return calculateBatchTotalBalance(stockings, transfers, batchId);
}

export type BatchHistoryEvent =
  | { kind: "stocking"; date: string; record: StockingRecord }
  | { kind: "transfer"; date: string; record: FishTransferRecord };

/** Historial de un lote (siembra + traslados), del más reciente al más antiguo. */
export async function getBatchHistory(batchId: string): Promise<BatchHistoryEvent[]> {
  const { stockings, transfers } = await loadBatchEvents(batchId);
  const events: BatchHistoryEvent[] = [
    ...stockings.map((record) => ({ kind: "stocking" as const, date: record.date, record })),
    ...transfers.map((record) => ({ kind: "transfer" as const, date: record.date, record })),
  ];
  return events.sort((a, b) => b.date.localeCompare(a.date));
}

/** `{ batchId: cantidad }` — qué lotes hay ahora mismo en un estanque. */
export async function getPondOccupancy(pondId: string): Promise<Record<string, number>> {
  const [allStockings, allTransfers] = await Promise.all([
    db.stockings.where("pondId").equals(pondId).toArray(),
    db.fishTransfers.toArray(),
  ]);
  // getPondOccupancy necesita ver TODOS los movimientos de los lotes que
  // pasaron por este estanque, no solo los que tienen pondId = este
  // estanque en Stocking — por eso se cargan todos los traslados y se
  // deja que la función de dominio filtre por pondId internamente.
  const batchIds = new Set(allStockings.map((s) => s.batchId));
  for (const t of allTransfers) {
    if (t.fromPondId === pondId || t.toPondId === pondId) batchIds.add(t.batchId);
  }

  const relevantStockings = await db.stockings
    .where("batchId")
    .anyOf([...batchIds])
    .toArray();
  const relevantTransfers = allTransfers.filter((t) => batchIds.has(t.batchId));

  return calculatePondOccupancy(relevantStockings, relevantTransfers, pondId);
}

export type PondHistoryEvent =
  | { kind: "stocking"; date: string; record: StockingRecord }
  | { kind: "transfer-in" | "transfer-out"; date: string; record: FishTransferRecord };

/** Historial de un estanque (siembras + traslados de entrada/salida). */
export async function getPondHistory(pondId: string): Promise<PondHistoryEvent[]> {
  const [stockings, transfersIn, transfersOut] = await Promise.all([
    db.stockings.where("pondId").equals(pondId).toArray(),
    db.fishTransfers.where("toPondId").equals(pondId).toArray(),
    db.fishTransfers.where("fromPondId").equals(pondId).toArray(),
  ]);

  const events: PondHistoryEvent[] = [
    ...stockings.map((record) => ({ kind: "stocking" as const, date: record.date, record })),
    ...transfersIn.map((record) => ({ kind: "transfer-in" as const, date: record.date, record })),
    ...transfersOut.map((record) => ({ kind: "transfer-out" as const, date: record.date, record })),
  ];
  return events.sort((a, b) => b.date.localeCompare(a.date));
}
