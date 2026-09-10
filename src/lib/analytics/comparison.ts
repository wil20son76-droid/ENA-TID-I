// Comparación por lote y por especie (Fase 6, §"Comparación por lote y
// especie"). Combina las filas ya calculadas por `reports.ts`
// (producción + economía) — nunca vuelve a tocar Dexie ni recalcula el
// ledger. La agregación por especie usa siempre razón-de-sumas
// (`weightedStats.ts`), nunca el promedio de los porcentajes/costos ya
// calculados por lote — mismo criterio que el resto de esta capa.
import type { EconomicsReportRow, ProductionBatchRow } from "./reports";
import { percentOfSums, ratioOfSums, sumBy } from "./weightedStats";

export interface BatchComparisonRow {
  batchId: string;
  batchCode: string;
  speciesId: string;
  speciesName: string;
  stockedTotal: number;
  survivalPercent: number | null;
  harvestedWeightKgTotal: number;
  costPerKg: number | null;
  incomeTotal: number;
  profit: number;
  marginPercent: number | null;
  isProvisional: boolean;
}

/** Une producción + economía por `batchId`. Un lote sin fila de economía (nunca cosechó/vendió) aparece con los campos económicos en 0/null, nunca se omite. */
export function buildBatchComparison(
  production: readonly ProductionBatchRow[],
  economics: readonly EconomicsReportRow[],
): BatchComparisonRow[] {
  const economicsByBatch = new Map(economics.map((e) => [e.batchId, e]));

  return production.map((row) => {
    const econ = economicsByBatch.get(row.batchId);
    return {
      batchId: row.batchId,
      batchCode: row.batchCode,
      speciesId: row.speciesId,
      speciesName: row.speciesName,
      stockedTotal: row.stockedTotal,
      survivalPercent: row.survivalPercent,
      harvestedWeightKgTotal: row.harvestedWeightKgTotal,
      costPerKg: econ?.costPerKg ?? null,
      incomeTotal: econ?.incomeTotal ?? 0,
      profit: econ?.profit ?? 0,
      marginPercent: econ?.marginPercent ?? null,
      isProvisional: econ?.isProvisional ?? true,
    };
  });
}

export interface SpeciesComparisonRow {
  speciesId: string;
  speciesName: string;
  batchCount: number;
  stockedTotal: number;
  /** Agregado correcto: Σ(sembrado-muerto)/Σsembrado × 100 — ver `ProductionReport.totals.survivalPercent`. */
  survivalPercent: number | null;
  harvestedWeightKgTotal: number;
  costPerKg: number | null;
  incomeTotal: number;
  profit: number;
  marginPercent: number | null;
}

/**
 * Agrega por especie a partir de las MISMAS filas por lote que
 * `buildBatchComparison`, más los campos de supervivencia de
 * `ProductionBatchRow` (que `BatchComparisonRow` no expone porque no los
 * necesita para su propia tabla) — se pasan ambos arreglos ya
 * emparejados por índice/`batchId` para no recalcular nada.
 */
export function buildSpeciesComparison(
  production: readonly ProductionBatchRow[],
  economics: readonly EconomicsReportRow[],
): SpeciesComparisonRow[] {
  const economicsByBatch = new Map(economics.map((e) => [e.batchId, e]));
  const speciesIds = [...new Set(production.map((r) => r.speciesId))];

  return speciesIds.map((speciesId) => {
    const batchRows = production.filter((r) => r.speciesId === speciesId);
    const econRows = batchRows
      .map((r) => economicsByBatch.get(r.batchId))
      .filter((e): e is EconomicsReportRow => e != null);

    return {
      speciesId,
      speciesName: batchRows[0]?.speciesName ?? "Especie desconocida",
      batchCount: batchRows.length,
      stockedTotal: sumBy(batchRows, (r) => r.stockedTotal),
      survivalPercent: percentOfSums(batchRows, (r) => r.survivorsExcludingHarvest, (r) => r.stockedTotal),
      harvestedWeightKgTotal: sumBy(batchRows, (r) => r.harvestedWeightKgTotal),
      costPerKg: ratioOfSums(econRows, (e) => e.directCostTotal, (e) => e.harvestedWeightKgTotal),
      incomeTotal: sumBy(econRows, (e) => e.incomeTotal),
      profit: sumBy(econRows, (e) => e.profit),
      marginPercent:
        sumBy(econRows, (e) => e.incomeTotal) > 0
          ? (sumBy(econRows, (e) => e.profit) / sumBy(econRows, (e) => e.incomeTotal)) * 100
          : null,
    };
  });
}
