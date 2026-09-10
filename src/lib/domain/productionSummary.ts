// Combina ledger de peces (batchLedger.ts) + peso estimado (sampling.ts)
// + biomasa (biomass.ts) en un resumen de producción por lote (§18-§19,
// §23-§26 del encargo de Fase 3). Sigue siendo puro: opera solo sobre los
// eventos ya cargados que le pasa quien llama (cliente vía Dexie, futuro
// código de servidor vía Prisma) — para una consulta "a fecha X" basta con
// pre-filtrar esos arreglos antes de llamar, sin cambiar esta función.
import {
  getBatchDistribution,
  getBatchHarvestedFishTotal,
  getBatchHarvestedWeightKgTotal,
  getBatchMortalityTotal,
  getBatchStockedTotal,
  getMortalityPercent,
  getSurvivalPercent,
  type HarvestLedgerEntry,
  type MortalityLedgerEntry,
  type StockingLedgerEntry,
  type TransferLedgerEntry,
} from "./batchLedger";
import { calculateBiomassKg } from "./biomass";
import {
  getEstimatedWeightForBatch,
  getEstimatedWeightForPond,
  type SamplingLedgerEntry,
  type WeightEstimateSource,
} from "./sampling";

export interface PondProductionSummary {
  pondId: string;
  quantity: number;
  averageWeightG: number;
  weightSource: WeightEstimateSource;
  sampleDate: string | null;
  biomassKg: number;
}

export interface BatchProductionSummary {
  batchId: string;
  /** Peces vivos ahora mismo, sumando todos los estanques. */
  totalQuantity: number;
  /** Total histórico sembrado (nunca baja por traslados/mortalidad). */
  stockedTotal: number;
  mortalityTotal: number;
  /** Total histórico cosechado (§34 de Fase 5) — no reduce la supervivencia. */
  harvestedFishTotal: number;
  harvestedWeightKgTotal: number;
  survivalPercent: number | null;
  mortalityPercent: number | null;
  /**
   * Suma de la biomasa de CADA estanque calculada con su propio peso
   * estimado (§26) — nunca `totalQuantity × un único peso`, porque un
   * muestreo en un estanque no debe aplicarse a otro que no lo tuvo.
   */
  totalBiomassKg: number;
  /** Peso promedio ponderado por peces presentes; `null` si el lote no tiene peces en ningún estanque. */
  averageWeightG: number | null;
  /** `true` solo si todos los componentes del promedio vienen de un muestreo real. */
  allFromSampling: boolean;
  perPond: PondProductionSummary[];
}

export type ProductionSummaryHarvestEntry = HarvestLedgerEntry & { totalWeightKg: number };

export function getBatchProductionSummary(
  stockings: readonly StockingLedgerEntry[],
  transfers: readonly TransferLedgerEntry[],
  mortalities: readonly MortalityLedgerEntry[],
  harvests: readonly ProductionSummaryHarvestEntry[],
  samplings: readonly SamplingLedgerEntry[],
  batchId: string,
  initialAverageWeightG: number,
): BatchProductionSummary {
  const distribution = getBatchDistribution(stockings, transfers, mortalities, harvests, batchId);
  const stockedTotal = getBatchStockedTotal(stockings, batchId);
  const mortalityTotal = getBatchMortalityTotal(mortalities, batchId);
  const harvestedFishTotal = getBatchHarvestedFishTotal(harvests, batchId);
  const harvestedWeightKgTotal = getBatchHarvestedWeightKgTotal(harvests, batchId);
  const totalQuantity = Object.values(distribution).reduce((sum, qty) => sum + qty, 0);

  const perPond: PondProductionSummary[] = Object.entries(distribution).map(([pondId, quantity]) => {
    const estimate = getEstimatedWeightForPond(samplings, batchId, pondId, initialAverageWeightG);
    return {
      pondId,
      quantity,
      averageWeightG: estimate.averageWeightG,
      weightSource: estimate.source,
      sampleDate: estimate.sampleDate,
      biomassKg: calculateBiomassKg(quantity, estimate.averageWeightG),
    };
  });

  const totalBiomassKg = perPond.reduce((sum, p) => sum + p.biomassKg, 0);
  const weightEstimate = getEstimatedWeightForBatch(
    samplings,
    distribution,
    batchId,
    initialAverageWeightG,
  );

  return {
    batchId,
    totalQuantity,
    stockedTotal,
    mortalityTotal,
    harvestedFishTotal,
    harvestedWeightKgTotal,
    // §19/§34 de Fase 5: la supervivencia NUNCA se calcula a partir de
    // `totalQuantity` (que ya está reducido por cosechas) — una cosecha es
    // una decisión de negocio, no una pérdida. Se usa explícitamente
    // `stockedTotal - mortalityTotal`, matemáticamente idéntico al
    // `totalQuantity` de antes de la Fase 5 cuando no hay cosechas.
    survivalPercent: getSurvivalPercent(stockedTotal - mortalityTotal, stockedTotal),
    mortalityPercent: getMortalityPercent(mortalityTotal, stockedTotal),
    totalBiomassKg,
    averageWeightG: weightEstimate?.averageWeightG ?? null,
    allFromSampling: weightEstimate?.allFromSampling ?? false,
    perPond,
  };
}
