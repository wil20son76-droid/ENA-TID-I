// Consultas derivadas de solo lectura sobre el ledger de peces
// (Stocking + FishTransfer + MortalityRecord) y, desde la Fase 3, el
// resumen de producción (peso estimado, biomasa, supervivencia). Usadas
// por las páginas de ficha de lote y ficha de estanque. Toda la lógica de
// cálculo vive en src/lib/domain/ — este archivo solo trae los datos de
// Dexie y se los pasa.
import {
  getBatchDistribution as calculateBatchDistribution,
  getBatchTotalBalance as calculateBatchTotalBalance,
  getPondOccupancy as calculatePondOccupancy,
} from "../../domain/batchLedger";
import {
  getBatchProductionSummary as calculateBatchProductionSummary,
  type BatchProductionSummary,
} from "../../domain/productionSummary";
import { db } from "../schema";
import type {
  FeedingRecordRecord,
  FishTransferRecord,
  HarvestRecord,
  MortalityRecordRecord,
  SamplingRecord,
  StockingRecord,
} from "../types";

async function loadBatchEvents(batchId: string) {
  const [stockings, transfers, mortalities, harvests] = await Promise.all([
    db.stockings.where("batchId").equals(batchId).toArray(),
    db.fishTransfers.where("batchId").equals(batchId).toArray(),
    db.mortalityRecords.where("batchId").equals(batchId).toArray(),
    db.harvests.where("batchId").equals(batchId).toArray(),
  ]);
  return { stockings, transfers, mortalities, harvests };
}

/** `{ pondId: cantidad }` — dónde está repartido un lote ahora mismo. */
export async function getBatchDistribution(batchId: string): Promise<Record<string, number>> {
  const { stockings, transfers, mortalities, harvests } = await loadBatchEvents(batchId);
  return calculateBatchDistribution(stockings, transfers, mortalities, harvests, batchId);
}

/** Total de peces vivos de un lote, sumando todos los estanques. */
export async function getBatchTotalQuantity(batchId: string): Promise<number> {
  const { stockings, transfers, mortalities, harvests } = await loadBatchEvents(batchId);
  return calculateBatchTotalBalance(stockings, transfers, mortalities, harvests, batchId);
}

/**
 * Resumen de producción del lote (§18-§19, §23-§26 de la Fase 3): peces
 * actuales, supervivencia/mortalidad %, peso y biomasa estimados por
 * estanque y agregados. `initialAverageWeightG` es el peso de la siembra
 * del lote, usado como respaldo mientras no haya muestreos.
 */
export async function getBatchProductionSummary(
  batchId: string,
  initialAverageWeightG: number,
): Promise<BatchProductionSummary> {
  const { stockings, transfers, mortalities, harvests } = await loadBatchEvents(batchId);
  const samplings = await db.samplings.where("batchId").equals(batchId).toArray();
  return calculateBatchProductionSummary(
    stockings,
    transfers,
    mortalities,
    harvests.map((h) => ({ batchId: h.batchId, pondId: h.pondId, quantityFish: h.quantityFish, totalWeightKg: h.totalWeightKg })),
    samplings,
    batchId,
    initialAverageWeightG,
  );
}

export type BatchHistoryEvent =
  | { kind: "stocking"; date: string; record: StockingRecord }
  | { kind: "transfer"; date: string; record: FishTransferRecord }
  | { kind: "mortality"; date: string; record: MortalityRecordRecord }
  | { kind: "feeding"; date: string; record: FeedingRecordRecord }
  | { kind: "sampling"; date: string; record: SamplingRecord }
  | { kind: "harvest"; date: string; record: HarvestRecord };

/** Historial completo de un lote, del más reciente al más antiguo. */
export async function getBatchHistory(batchId: string): Promise<BatchHistoryEvent[]> {
  const { stockings, transfers, mortalities, harvests } = await loadBatchEvents(batchId);
  const [feedings, samplings] = await Promise.all([
    db.feedingRecords.where("batchId").equals(batchId).toArray(),
    db.samplings.where("batchId").equals(batchId).toArray(),
  ]);
  const events: BatchHistoryEvent[] = [
    ...stockings.map((record) => ({ kind: "stocking" as const, date: record.date, record })),
    ...transfers.map((record) => ({ kind: "transfer" as const, date: record.date, record })),
    ...mortalities.map((record) => ({ kind: "mortality" as const, date: record.date, record })),
    ...feedings.map((record) => ({ kind: "feeding" as const, date: record.date, record })),
    ...samplings.map((record) => ({ kind: "sampling" as const, date: record.date, record })),
    ...harvests.map((record) => ({ kind: "harvest" as const, date: record.date, record })),
  ];
  return events.sort((a, b) => b.date.localeCompare(a.date));
}

/** `{ batchId: cantidad }` — qué lotes hay ahora mismo en un estanque. */
export async function getPondOccupancy(pondId: string): Promise<Record<string, number>> {
  const [allStockings, allTransfers, allMortalities, allHarvests] = await Promise.all([
    db.stockings.where("pondId").equals(pondId).toArray(),
    db.fishTransfers.toArray(),
    db.mortalityRecords.toArray(),
    db.harvests.toArray(),
  ]);
  // getPondOccupancy necesita ver TODOS los movimientos de los lotes que
  // pasaron por este estanque, no solo los que tienen pondId = este
  // estanque en Stocking — por eso se cargan todos los traslados/
  // mortalidad/cosecha y se deja que la función de dominio filtre por pondId.
  const batchIds = new Set(allStockings.map((s) => s.batchId));
  for (const t of allTransfers) {
    if (t.fromPondId === pondId || t.toPondId === pondId) batchIds.add(t.batchId);
  }
  for (const m of allMortalities) {
    if (m.pondId === pondId) batchIds.add(m.batchId);
  }
  for (const h of allHarvests) {
    if (h.pondId === pondId) batchIds.add(h.batchId);
  }

  const relevantStockings = await db.stockings
    .where("batchId")
    .anyOf([...batchIds])
    .toArray();
  const relevantTransfers = allTransfers.filter((t) => batchIds.has(t.batchId));
  const relevantMortalities = allMortalities.filter((m) => batchIds.has(m.batchId));
  const relevantHarvests = allHarvests.filter((h) => batchIds.has(h.batchId));

  return calculatePondOccupancy(
    relevantStockings,
    relevantTransfers,
    relevantMortalities,
    relevantHarvests,
    pondId,
  );
}

export type PondHistoryEvent =
  | { kind: "stocking"; date: string; record: StockingRecord }
  | { kind: "transfer-in" | "transfer-out"; date: string; record: FishTransferRecord }
  | { kind: "mortality"; date: string; record: MortalityRecordRecord }
  | { kind: "feeding"; date: string; record: FeedingRecordRecord }
  | { kind: "sampling"; date: string; record: SamplingRecord }
  | { kind: "harvest"; date: string; record: HarvestRecord };

/** Historial de un estanque (siembras + traslados + mortalidad + alimentación + muestreos + cosechas). */
export async function getPondHistory(pondId: string): Promise<PondHistoryEvent[]> {
  const [stockings, transfersIn, transfersOut, mortalities, feedings, samplings, harvests] =
    await Promise.all([
      db.stockings.where("pondId").equals(pondId).toArray(),
      db.fishTransfers.where("toPondId").equals(pondId).toArray(),
      db.fishTransfers.where("fromPondId").equals(pondId).toArray(),
      db.mortalityRecords.where("pondId").equals(pondId).toArray(),
      db.feedingRecords.where("pondId").equals(pondId).toArray(),
      db.samplings.where("pondId").equals(pondId).toArray(),
      db.harvests.where("pondId").equals(pondId).toArray(),
    ]);

  const events: PondHistoryEvent[] = [
    ...stockings.map((record) => ({ kind: "stocking" as const, date: record.date, record })),
    ...transfersIn.map((record) => ({ kind: "transfer-in" as const, date: record.date, record })),
    ...transfersOut.map((record) => ({ kind: "transfer-out" as const, date: record.date, record })),
    ...mortalities.map((record) => ({ kind: "mortality" as const, date: record.date, record })),
    ...feedings.map((record) => ({ kind: "feeding" as const, date: record.date, record })),
    ...samplings.map((record) => ({ kind: "sampling" as const, date: record.date, record })),
    ...harvests.map((record) => ({ kind: "harvest" as const, date: record.date, record })),
  ];
  return events.sort((a, b) => b.date.localeCompare(a.date));
}
