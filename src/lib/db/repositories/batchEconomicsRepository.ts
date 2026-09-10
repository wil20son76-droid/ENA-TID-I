// Envoltorio de solo lectura sobre `getBatchEconomics` (§35 del encargo de
// Fase 5): trae los datos de Dexie y se los pasa a la función de dominio,
// que es la única fuente del cálculo — igual criterio que ledgerQueries.ts
// para el ledger de peces/producción.
import { getBatchTotalBalance } from "../../domain/batchLedger";
import { getBatchEconomics, type BatchEconomics } from "../../domain/batchEconomics";
import { db } from "../schema";

/**
 * Mapea cada FeedingRecord del lote al `id` de su FeedInventoryMovement
 * CONSUMPTION vinculado (Fase 3.5: `sourceType: "FEEDING"`, `sourceId:
 * <feedingRecordId>`) — `getBatchFeedCost` valora el consumo por el costo
 * calculado para ESE movimiento específico, nunca por el ID del registro
 * de alimentación en sí.
 */
export async function getBatchEconomicsSummary(batchId: string): Promise<BatchEconomics> {
  const [batch, feedings, allMovements, expenses, saleLines, harvests, stockings, transfers, mortalities] =
    await Promise.all([
      db.fishBatches.get(batchId),
      db.feedingRecords.where("batchId").equals(batchId).toArray(),
      db.feedInventoryMovements.toArray(),
      db.expenses.toArray(),
      db.saleLines.toArray(),
      db.harvests.toArray(),
      db.stockings.where("batchId").equals(batchId).toArray(),
      db.fishTransfers.where("batchId").equals(batchId).toArray(),
      db.mortalityRecords.where("batchId").equals(batchId).toArray(),
    ]);

  const batchHarvests = harvests.filter((h) => !h.deletedAt && h.batchId === batchId);
  const activeFeedings = feedings.filter((f) => !f.deletedAt);
  const movementBySourceId = new Map(
    allMovements
      .filter((m) => !m.deletedAt && m.sourceType === "FEEDING" && m.sourceId)
      .map((m) => [m.sourceId as string, m.id]),
  );

  const feedingsForEconomics = activeFeedings.map((f) => ({
    id: movementBySourceId.get(f.id) ?? f.id,
    batchId: f.batchId,
    feedId: f.feedId,
  }));

  const totalLivingFish = getBatchTotalBalance(stockings, transfers, mortalities, batchHarvests, batchId);

  return getBatchEconomics({
    batchId,
    fryCost: batch?.fryCost ?? null,
    feedings: feedingsForEconomics,
    feedMovements: allMovements
      .filter((m) => !m.deletedAt)
      .map((m) => ({
        id: m.id,
        feedId: m.feedId,
        movementType: m.movementType,
        quantityKg: m.quantityKg,
        unitCostPerKg: m.unitCostPerKg,
        createdAt: m.createdAt,
      })),
    directExpenses: expenses
      .filter((e) => !e.deletedAt)
      .map((e) => ({ batchId: e.batchId, totalAmount: e.totalAmount })),
    saleLines: saleLines
      .filter((l) => !l.deletedAt)
      .map((l) => ({ batchId: l.batchId, totalAmount: l.totalAmount })),
    harvests: batchHarvests.map((h) => ({
      batchId: h.batchId,
      pondId: h.pondId,
      quantityFish: h.quantityFish,
      totalWeightKg: h.totalWeightKg,
    })),
    isBatchStillActive: totalLivingFish > 0,
  });
}
