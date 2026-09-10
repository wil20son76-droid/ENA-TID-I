// Economía de un lote (§33-§41 del encargo de Fase 5): ingresos, costos
// directos, costo/kg, ganancia y margen. Función central única —
// `getBatchEconomics` — para que ningún reporte reinvente qué sumar y
// evitar el doble conteo (§1, §35): los gastos generales no asignados a
// ningún lote NUNCA entran aquí (se muestran aparte, ver §18), y una
// compra de alimento nunca se suma dos veces como "Purchase" + "Expense"
// porque el alimento consumido se costea contra el ledger de inventario
// (feedCost.ts), no contra `Purchase.totalAmount`.
//
// Pura y testeable: opera sobre eventos ya cargados por quien llama
// (cliente vía Dexie, servidor vía Prisma si algún día hiciera falta),
// igual criterio que batchLedger.ts/productionSummary.ts.
import {
  getBatchHarvestedFishTotal,
  getBatchHarvestedWeightKgTotal,
  type HarvestLedgerEntry,
} from "./batchLedger";
import { calculateFeedMovementCosts, type FeedCostMovementEntry } from "./feedCost";

export interface BatchEconomicsFeedingEntry {
  id: string;
  batchId: string;
  feedId: string;
}

export interface BatchEconomicsExpenseEntry {
  batchId: string | null;
  totalAmount: number;
}

export interface BatchEconomicsSaleLineEntry {
  batchId: string;
  totalAmount: number;
}

export interface BatchEconomicsHarvestEntry extends HarvestLedgerEntry {
  totalWeightKg: number;
}

export interface BatchEconomicsInput {
  batchId: string;
  /** `null`/`undefined` si el lote no tiene costo de alevines registrado. */
  fryCost: number | null | undefined;
  /** Registros de alimentación de ESTE lote (cualquier alimento). */
  feedings: readonly BatchEconomicsFeedingEntry[];
  /**
   * TODOS los movimientos de inventario de los alimentos usados por este
   * lote (no solo los de este lote): el costo promedio ponderado es
   * histórico y depende de las compras de ese alimento en cualquier lote.
   */
  feedMovements: readonly FeedCostMovementEntry[];
  /** Gastos con `batchId` = este lote (§18: nunca gastos generales sin asignar). */
  directExpenses: readonly BatchEconomicsExpenseEntry[];
  /** Líneas de venta con `batchId` = este lote. */
  saleLines: readonly BatchEconomicsSaleLineEntry[];
  /** Cosechas de este lote (cualquier estanque). */
  harvests: readonly BatchEconomicsHarvestEntry[];
  /** `true` si el lote todavía tiene peces vivos / el ciclo no terminó (§41). */
  isBatchStillActive: boolean;
}

export interface BatchEconomics {
  batchId: string;
  fryCost: number;
  feedCost: number;
  directExpensesTotal: number;
  directCostTotal: number;
  harvestedFishTotal: number;
  harvestedWeightKgTotal: number;
  incomeTotal: number;
  /** `null` = "Datos insuficientes" (§36): nunca Infinity/NaN. */
  costPerKg: number | null;
  costPerFish: number | null;
  profit: number;
  /** `null` si no hay ingresos que dividir (§39). */
  marginPercent: number | null;
  /** §41: mientras el lote siga activo, el resultado es provisional, nunca definitivo. */
  isProvisional: boolean;
}

/** Costo de alimento consumido por un lote, valorado contra el ledger histórico de cada alimento (§14-§16). */
export function getBatchFeedCost(
  feedings: readonly BatchEconomicsFeedingEntry[],
  feedMovements: readonly FeedCostMovementEntry[],
  batchId: string,
): number {
  const batchFeedings = feedings.filter((f) => f.batchId === batchId);
  if (batchFeedings.length === 0) return 0;

  const feedIds = new Set(batchFeedings.map((f) => f.feedId));
  let total = 0;

  for (const feedId of feedIds) {
    const costs = calculateFeedMovementCosts(feedMovements, feedId);
    const costById = new Map(costs.map((c) => [c.id, c.cost]));
    for (const feeding of batchFeedings) {
      if (feeding.feedId !== feedId) continue;
      // El movimiento CONSUMPTION vinculado a este registro de
      // alimentación se identifica por sourceType="FEEDING"/sourceId=id
      // (Fase 3.5) — pero para esta función basta con que quien llama ya
      // haya resuelto ese vínculo y pase el `id` del MOVIMIENTO como
      // `feeding.id` (ver batchEconomicsRepository para el mapeo real).
      total += costById.get(feeding.id) ?? 0;
    }
  }

  return total;
}

export function getBatchEconomics(input: BatchEconomicsInput): BatchEconomics {
  const fryCost = input.fryCost ?? 0;
  const feedCost = getBatchFeedCost(input.feedings, input.feedMovements, input.batchId);
  const directExpensesTotal = input.directExpenses
    .filter((e) => e.batchId === input.batchId)
    .reduce((sum, e) => sum + e.totalAmount, 0);
  const directCostTotal = fryCost + feedCost + directExpensesTotal;

  const harvestedFishTotal = getBatchHarvestedFishTotal(input.harvests, input.batchId);
  const harvestedWeightKgTotal = getBatchHarvestedWeightKgTotal(input.harvests, input.batchId);

  const incomeTotal = input.saleLines
    .filter((s) => s.batchId === input.batchId)
    .reduce((sum, s) => sum + s.totalAmount, 0);

  const costPerKg = harvestedWeightKgTotal > 0 ? directCostTotal / harvestedWeightKgTotal : null;
  const costPerFish = harvestedFishTotal > 0 ? directCostTotal / harvestedFishTotal : null;
  const profit = incomeTotal - directCostTotal;
  const marginPercent = incomeTotal > 0 ? (profit / incomeTotal) * 100 : null;

  return {
    batchId: input.batchId,
    fryCost,
    feedCost,
    directExpensesTotal,
    directCostTotal,
    harvestedFishTotal,
    harvestedWeightKgTotal,
    incomeTotal,
    costPerKg,
    costPerFish,
    profit,
    marginPercent,
    isProvisional: input.isBatchStillActive,
  };
}
