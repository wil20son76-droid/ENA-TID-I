// Capa de informes (Fase 6). Funciones puras: reciben arreglos YA
// CARGADOS de Dexie (o de Prisma, si algún día hiciera falta en
// servidor) y devuelven filas/series listas para tabla, gráfico o CSV —
// nunca tocan IndexedDB ni la red, nunca se ejecutan dentro de un
// componente de React (regla crítica del encargo: "mantener cálculos en
// una capa analytics, no dentro de componentes").
//
// Ninguna función de este archivo inventa una fuente de verdad nueva:
// todo se deriva de los ledgers y funciones de dominio ya existentes
// (batchLedger.ts, feedLedger.ts, feedCost.ts, batchEconomics.ts,
// sampling.ts, growth.ts, fcr.ts, waterQuality.ts) — este archivo solo
// agrega/filtra/serializa para la vista de informes.
//
// Convención de tiempo (importante, documentada aquí una sola vez):
// las métricas de ACTIVIDAD de un período (mortalidad, alimentación,
// cosecha, ventas, gastos ocurridos EN el rango de fechas) se filtran
// por fecha; las métricas de ESTADO (peces vivos ahora, supervivencia
// acumulada, biomasa actual) son siempre acumuladas desde el origen del
// lote — un rango de fechas no puede "cortar" cuántos peces hay vivos
// hoy sin dejar el balance sin sentido. Los filtros de especie/lote/
// estanque sí aplican a ambos tipos de métrica (deciden qué filas
// entran, no qué eventos se suman dentro de cada fila).
import {
  getBatchDistribution,
  getBatchHarvestedFishTotal,
  getBatchHarvestedWeightKgTotal,
  getBatchMortalityTotal,
  getBatchStockedTotal,
  getBatchTotalBalance,
  getSurvivalPercent,
  type HarvestLedgerEntry,
  type MortalityLedgerEntry,
  type StockingLedgerEntry,
  type TransferLedgerEntry,
} from "../domain/batchLedger";
import { calculateBiomassKg } from "../domain/biomass";
import { calculateFcr } from "../domain/fcr";
import { calculateGrowth } from "../domain/growth";
import { calculateFeedInventoryValuation, type FeedCostMovementEntry } from "../domain/feedCost";
import { getAllFeedStocks, getDaysOfStockRemaining, type FeedMovementLedgerEntry } from "../domain/feedLedger";
import { getEstimatedWeightForBatch, type SamplingLedgerEntry } from "../domain/sampling";
import type { BatchEconomics } from "../domain/batchEconomics";
import {
  isWithinDateRange,
  matchesBatch,
  matchesPond,
  matchesSpecies,
  type AnalyticsFilters,
} from "./filters";
import { percentOfSums, ratioOfSums, sumBy, weightedAverage, weightedAveragePrice } from "./weightedStats";

// --- Utilidades comunes ---

export interface MonthlyPoint {
  /** "YYYY-MM". */
  month: string;
  value: number;
}

/** Serie mensual (suma de `valueOf` por mes), ordenada cronológicamente — base de todos los gráficos de tendencia de este módulo. */
export function buildMonthlySeries<T>(
  items: readonly T[],
  dateOf: (item: T) => string,
  valueOf: (item: T) => number,
): MonthlyPoint[] {
  const totals = new Map<string, number>();
  for (const item of items) {
    const month = dateOf(item).slice(0, 7);
    totals.set(month, (totals.get(month) ?? 0) + valueOf(item));
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, value]) => ({ month, value }));
}

export interface BatchLike {
  id: string;
  code: string;
  speciesId: string;
  initialAverageWeightG: number;
}

export interface SpeciesLike {
  id: string;
  commonName: string;
}

function speciesNameOf(speciesId: string, species: readonly SpeciesLike[]): string {
  return species.find((s) => s.id === speciesId)?.commonName ?? "Especie desconocida";
}

// --- 1. Producción ---

export interface ProductionBatchRow {
  batchId: string;
  batchCode: string;
  speciesId: string;
  speciesName: string;
  /** Histórico total sembrado — nunca cambia por traslados/mortalidad/cosecha (§19 de Fase 3). */
  stockedTotal: number;
  mortalityTotal: number;
  /** = stockedTotal - mortalityTotal, la base correcta para supervivencia (§19/§34 de Fase 5: la cosecha no es una pérdida). */
  survivorsExcludingHarvest: number;
  harvestedFishTotal: number;
  harvestedWeightKgTotal: number;
  /** Peces vivos ahora mismo (ya descuenta cosecha) — estado actual, no supervivencia. */
  currentLiving: number;
  survivalPercent: number | null;
  currentBiomassKg: number;
  currentAverageWeightG: number | null;
  mortalityInPeriod: number;
  harvestedFishInPeriod: number;
  harvestedWeightKgInPeriod: number;
}

export interface ProductionReportInput {
  batches: readonly BatchLike[];
  species: readonly SpeciesLike[];
  stockings: readonly StockingLedgerEntry[];
  transfers: readonly TransferLedgerEntry[];
  mortalities: readonly (MortalityLedgerEntry & { date: string })[];
  harvests: readonly (HarvestLedgerEntry & { date: string; totalWeightKg: number })[];
  samplings: readonly SamplingLedgerEntry[];
  filters: AnalyticsFilters;
}

export interface ProductionReport {
  rows: ProductionBatchRow[];
  totals: {
    stockedTotal: number;
    mortalityTotal: number;
    harvestedWeightKgTotal: number;
    currentLiving: number;
    /** Supervivencia agregada correcta: Σ(sembrado-muerto) / Σsembrado × 100 — nunca el promedio de los % por lote. */
    survivalPercent: number | null;
    currentBiomassKg: number;
  };
  weightTrend: MonthlyPoint[];
}

export function buildProductionReport(input: ProductionReportInput): ProductionReport {
  const { filters } = input;
  const rows: ProductionBatchRow[] = [];

  for (const batch of input.batches) {
    if (!matchesBatch(batch.id, filters)) continue;
    if (filters.speciesId && batch.speciesId !== filters.speciesId) continue;

    const batchStockings = input.stockings.filter((s) => s.batchId === batch.id);
    const batchTransfers = input.transfers.filter((t) => t.batchId === batch.id);
    const batchMortalities = input.mortalities.filter((m) => m.batchId === batch.id);
    const batchHarvests = input.harvests.filter((h) => h.batchId === batch.id);
    const batchSamplings = input.samplings.filter((s) => s.batchId === batch.id);

    // Filtro de estanque: solo incluye el lote si tuvo algún evento en ese
    // estanque — el resto de las métricas del lote se sigue calculando
    // sobre TODO su historial (un lote repartido entre estanques no puede
    // "cortarse a la mitad" sin romper el balance).
    if (filters.pondId) {
      const touchesPond =
        batchStockings.some((s) => s.pondId === filters.pondId) ||
        batchTransfers.some((t) => t.fromPondId === filters.pondId || t.toPondId === filters.pondId) ||
        batchMortalities.some((m) => m.pondId === filters.pondId) ||
        batchHarvests.some((h) => h.pondId === filters.pondId);
      if (!touchesPond) continue;
    }

    const stockedTotal = getBatchStockedTotal(batchStockings, batch.id);
    const mortalityTotal = getBatchMortalityTotal(batchMortalities, batch.id);
    const harvestedFishTotal = getBatchHarvestedFishTotal(batchHarvests, batch.id);
    const harvestedWeightKgTotal = getBatchHarvestedWeightKgTotal(batchHarvests, batch.id);
    const currentLiving = getBatchTotalBalance(batchStockings, batchTransfers, batchMortalities, batchHarvests, batch.id);
    const survivorsExcludingHarvest = stockedTotal - mortalityTotal;

    const distribution = getBatchDistribution(batchStockings, batchTransfers, batchMortalities, batchHarvests, batch.id);
    const weightEstimate = getEstimatedWeightForBatch(batchSamplings, distribution, batch.id, batch.initialAverageWeightG);
    const currentBiomassKg = weightEstimate ? calculateBiomassKg(currentLiving, weightEstimate.averageWeightG) : 0;

    const mortalityInPeriod = sumBy(
      batchMortalities.filter((m) => isWithinDateRange(m.date, filters)),
      (m) => m.quantity,
    );
    const periodHarvests = batchHarvests.filter((h) => isWithinDateRange(h.date, filters));
    const harvestedFishInPeriod = sumBy(periodHarvests, (h) => h.quantityFish);
    const harvestedWeightKgInPeriod = sumBy(periodHarvests, (h) => h.totalWeightKg);

    rows.push({
      batchId: batch.id,
      batchCode: batch.code,
      speciesId: batch.speciesId,
      speciesName: speciesNameOf(batch.speciesId, input.species),
      stockedTotal,
      mortalityTotal,
      survivorsExcludingHarvest,
      harvestedFishTotal,
      harvestedWeightKgTotal,
      currentLiving,
      survivalPercent: getSurvivalPercent(survivorsExcludingHarvest, stockedTotal),
      currentBiomassKg,
      currentAverageWeightG: weightEstimate?.averageWeightG ?? null,
      mortalityInPeriod,
      harvestedFishInPeriod,
      harvestedWeightKgInPeriod,
    });
  }

  const weightTrend = buildMonthlySeries(
    input.samplings.filter((s) => {
      const batch = input.batches.find((b) => b.id === s.batchId);
      if (!batch) return false;
      if (filters.speciesId && batch.speciesId !== filters.speciesId) return false;
      if (!matchesBatch(s.batchId, filters)) return false;
      if (!matchesPond(s.pondId, filters)) return false;
      return isWithinDateRange(s.date, filters);
    }),
    (s) => s.date,
    (s) => s.averageWeightG,
  );

  return {
    rows,
    totals: {
      stockedTotal: sumBy(rows, (r) => r.stockedTotal),
      mortalityTotal: sumBy(rows, (r) => r.mortalityTotal),
      harvestedWeightKgTotal: sumBy(rows, (r) => r.harvestedWeightKgTotal),
      currentLiving: sumBy(rows, (r) => r.currentLiving),
      survivalPercent: percentOfSums(rows, (r) => r.survivorsExcludingHarvest, (r) => r.stockedTotal),
      currentBiomassKg: sumBy(rows, (r) => r.currentBiomassKg),
    },
    weightTrend,
  };
}

// --- 2. Mortalidad ---

export interface MortalityEventLike {
  batchId: string;
  pondId: string;
  date: string;
  quantity: number;
  cause: string;
}

export interface MortalityReport {
  totalInPeriod: number;
  byCause: { cause: string; quantity: number }[];
  byMonth: MonthlyPoint[];
  byBatch: { batchId: string; batchCode: string; quantity: number }[];
  rows: MortalityEventLike[];
}

export function buildMortalityReport(input: {
  mortalities: readonly MortalityEventLike[];
  batches: readonly BatchLike[];
  filters: AnalyticsFilters;
}): MortalityReport {
  const batchSpecies = new Map(input.batches.map((b) => [b.id, b.speciesId]));
  const filtered = input.mortalities.filter(
    (m) =>
      isWithinDateRange(m.date, input.filters) &&
      matchesBatch(m.batchId, input.filters) &&
      matchesPond(m.pondId, input.filters) &&
      matchesSpecies(m.batchId, batchSpecies, input.filters),
  );

  const byCauseMap = new Map<string, number>();
  for (const m of filtered) byCauseMap.set(m.cause, (byCauseMap.get(m.cause) ?? 0) + m.quantity);

  const byBatchMap = new Map<string, number>();
  for (const m of filtered) byBatchMap.set(m.batchId, (byBatchMap.get(m.batchId) ?? 0) + m.quantity);

  return {
    totalInPeriod: sumBy(filtered, (m) => m.quantity),
    byCause: [...byCauseMap.entries()]
      .map(([cause, quantity]) => ({ cause, quantity }))
      .sort((a, b) => b.quantity - a.quantity),
    byMonth: buildMonthlySeries(filtered, (m) => m.date, (m) => m.quantity),
    byBatch: [...byBatchMap.entries()]
      .map(([batchId, quantity]) => ({
        batchId,
        batchCode: input.batches.find((b) => b.id === batchId)?.code ?? batchId,
        quantity,
      }))
      .sort((a, b) => b.quantity - a.quantity),
    rows: [...filtered].sort((a, b) => b.date.localeCompare(a.date)),
  };
}

// --- 3. Alimentación (+ FCR estimado) ---

export interface FeedingEventLike {
  batchId: string;
  pondId: string;
  feedId: string;
  date: string;
  quantityKg: number;
}

export interface FeedLike {
  id: string;
  name: string;
}

export interface FeedingReport {
  totalKgInPeriod: number;
  byMonth: MonthlyPoint[];
  byFeed: { feedId: string; feedName: string; quantityKg: number }[];
  byBatch: { batchId: string; batchCode: string; quantityKg: number }[];
  rows: FeedingEventLike[];
  /**
   * FCR agregado del conjunto filtrado (§28-§29 de Fase 3, siempre
   * "estimado"): pondera por ganancia de biomasa de cada lote, nunca
   * promedia los FCR individuales — un lote que casi no ganó biomasa no
   * puede pesar igual que uno que ganó mucha. `null` con lotes sin datos
   * suficientes (menos de dos muestreos en el período).
   */
  fcrEstimate: { fcr: number; estimated: true } | null;
}

export function buildFeedingReport(input: {
  feedings: readonly FeedingEventLike[];
  feeds: readonly FeedLike[];
  batches: readonly BatchLike[];
  samplings: readonly SamplingLedgerEntry[];
  filters: AnalyticsFilters;
  /**
   * Peces vivos ACTUALES por lote (`batchId -> cantidad`), ya calculados
   * por `buildProductionReport` — se reutilizan aquí en vez de
   * recalcular el ledger de peces por segunda vez (nunca una fuente de
   * verdad nueva). Necesarios para convertir la ganancia de peso
   * PROMEDIO POR PEZ (`calculateGrowth`) en ganancia de BIOMASA TOTAL del
   * lote antes de sumarla entre lotes — sumar directamente los gramos
   * por pez de lotes con poblaciones distintas sería otro promedio
   * simple donde hace falta uno ponderado.
   */
  livingQuantityByBatch: ReadonlyMap<string, number>;
}): FeedingReport {
  const batchSpecies = new Map(input.batches.map((b) => [b.id, b.speciesId]));
  const filtered = input.feedings.filter(
    (f) =>
      isWithinDateRange(f.date, input.filters) &&
      matchesBatch(f.batchId, input.filters) &&
      matchesPond(f.pondId, input.filters) &&
      matchesSpecies(f.batchId, batchSpecies, input.filters),
  );

  const byFeedMap = new Map<string, number>();
  for (const f of filtered) byFeedMap.set(f.feedId, (byFeedMap.get(f.feedId) ?? 0) + f.quantityKg);
  const byBatchMap = new Map<string, number>();
  for (const f of filtered) byBatchMap.set(f.batchId, (byBatchMap.get(f.batchId) ?? 0) + f.quantityKg);

  // FCR agregado: para cada lote en alcance, toma el primer y último
  // muestreo DENTRO del período filtrado (mismo criterio de selección
  // que la ficha de lote, Fase 3) y suma alimento consumido + ganancia de
  // biomasa de los lotes con datos suficientes, antes de dividir una sola
  // vez — nunca promedia FCRs ya calculados por lote.
  let totalFeedForFcr = 0;
  let totalBiomassGainForFcr = 0;
  const batchIdsInScope = new Set(filtered.map((f) => f.batchId));
  for (const batchId of batchIdsInScope) {
    const batch = input.batches.find((b) => b.id === batchId);
    if (!batch) continue;
    const batchSamplings = input.samplings
      .filter((s) => s.batchId === batchId && isWithinDateRange(s.date, input.filters))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (batchSamplings.length < 2) continue;

    const first = batchSamplings[0];
    const last = batchSamplings[batchSamplings.length - 1];
    const growth = calculateGrowth(first.averageWeightG, first.date, last.averageWeightG, last.date);
    if (!growth.available) continue;

    const livingQuantity = input.livingQuantityByBatch.get(batchId);
    if (!livingQuantity || livingQuantity <= 0) continue;

    const feedInWindow = sumBy(
      filtered.filter((f) => f.batchId === batchId && f.date >= first.date && f.date <= last.date),
      (f) => f.quantityKg,
    );
    const biomassGainKg = calculateBiomassKg(livingQuantity, growth.gainG);

    totalFeedForFcr += feedInWindow;
    totalBiomassGainForFcr += biomassGainKg;
  }

  const fcrEstimate =
    totalBiomassGainForFcr > 0 && totalFeedForFcr > 0
      ? calculateFcr(totalFeedForFcr, totalBiomassGainForFcr)
      : null;

  return {
    totalKgInPeriod: sumBy(filtered, (f) => f.quantityKg),
    byMonth: buildMonthlySeries(filtered, (f) => f.date, (f) => f.quantityKg),
    byFeed: [...byFeedMap.entries()]
      .map(([feedId, quantityKg]) => ({
        feedId,
        feedName: input.feeds.find((f) => f.id === feedId)?.name ?? feedId,
        quantityKg,
      }))
      .sort((a, b) => b.quantityKg - a.quantityKg),
    byBatch: [...byBatchMap.entries()]
      .map(([batchId, quantityKg]) => ({
        batchId,
        batchCode: input.batches.find((b) => b.id === batchId)?.code ?? batchId,
        quantityKg,
      }))
      .sort((a, b) => b.quantityKg - a.quantityKg),
    rows: [...filtered].sort((a, b) => b.date.localeCompare(a.date)),
    fcrEstimate,
  };
}

// --- 4. Inventario de alimento ---

export interface InventoryFeedRow {
  feedId: string;
  feedName: string;
  stockKg: number;
  averageCostPerKg: number | null;
  totalValue: number;
  daysOfStockRemaining: number | null;
}

export function buildInventoryReport(input: {
  feeds: readonly FeedLike[];
  movements: readonly (FeedMovementLedgerEntry & FeedCostMovementEntry)[];
  recentConsumptionWindowDays?: number;
}): { rows: InventoryFeedRow[]; totals: { stockKg: number; totalValue: number } } {
  const stocks = getAllFeedStocks(input.movements);
  const rows: InventoryFeedRow[] = input.feeds.map((feed) => {
    const valuation = calculateFeedInventoryValuation(input.movements, feed.id);
    const recentConsumptions = input.movements
      .filter((m) => m.feedId === feed.id && m.movementType === "CONSUMPTION")
      .map((m) => ({ date: m.createdAt, quantityKg: m.quantityKg }));
    return {
      feedId: feed.id,
      feedName: feed.name,
      stockKg: stocks[feed.id] ?? 0,
      averageCostPerKg: valuation.averageCostPerKg,
      totalValue: valuation.totalValue,
      daysOfStockRemaining: getDaysOfStockRemaining(stocks[feed.id] ?? 0, recentConsumptions),
    };
  });

  return {
    rows,
    totals: {
      stockKg: sumBy(rows, (r) => r.stockKg),
      totalValue: sumBy(rows, (r) => r.totalValue),
    },
  };
}

// --- 5. Calidad del agua ---

export interface WaterQualityEventLike {
  pondId: string;
  batchId: string | null;
  date: string;
  temperatureC: number | null;
  ph: number | null;
  dissolvedOxygenMgL: number | null;
}

export interface WaterQualityReport {
  countInPeriod: number;
  byMonth: { averageTemperatureC: MonthlyPoint[]; averagePh: MonthlyPoint[]; averageDissolvedOxygenMgL: MonthlyPoint[] };
  rows: WaterQualityEventLike[];
}

function monthlyAverage(
  items: readonly { date: string; value: number | null }[],
): MonthlyPoint[] {
  const sums = new Map<string, { total: number; count: number }>();
  for (const item of items) {
    if (item.value == null) continue;
    const month = item.date.slice(0, 7);
    const bucket = sums.get(month) ?? { total: 0, count: 0 };
    bucket.total += item.value;
    bucket.count += 1;
    sums.set(month, bucket);
  }
  return [...sums.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { total, count }]) => ({ month, value: total / count }));
}

export function buildWaterQualityReport(input: {
  records: readonly WaterQualityEventLike[];
  filters: AnalyticsFilters;
  batchSpeciesIndex: ReadonlyMap<string, string>;
}): WaterQualityReport {
  const filtered = input.records.filter(
    (r) =>
      isWithinDateRange(r.date, input.filters) &&
      matchesPond(r.pondId, input.filters) &&
      matchesBatch(r.batchId, input.filters) &&
      matchesSpecies(r.batchId, input.batchSpeciesIndex, input.filters),
  );

  return {
    countInPeriod: filtered.length,
    byMonth: {
      averageTemperatureC: monthlyAverage(filtered.map((r) => ({ date: r.date, value: r.temperatureC }))),
      averagePh: monthlyAverage(filtered.map((r) => ({ date: r.date, value: r.ph }))),
      averageDissolvedOxygenMgL: monthlyAverage(
        filtered.map((r) => ({ date: r.date, value: r.dissolvedOxygenMgL })),
      ),
    },
    rows: [...filtered].sort((a, b) => b.date.localeCompare(a.date)),
  };
}

// --- 6. Cosechas ---

export interface HarvestEventLike {
  batchId: string;
  pondId: string;
  date: string;
  quantityFish: number;
  totalWeightKg: number;
  averageWeightG: number;
}

export interface HarvestReport {
  totalFishInPeriod: number;
  totalWeightKgInPeriod: number;
  /** Peso promedio ponderado por peces cosechados — nunca el promedio simple de los `averageWeightG` de cada cosecha. */
  averageWeightG: number | null;
  byMonth: MonthlyPoint[];
  byBatch: { batchId: string; batchCode: string; quantityFish: number; totalWeightKg: number }[];
  bySpecies: { speciesId: string; speciesName: string; quantityFish: number; totalWeightKg: number }[];
  rows: HarvestEventLike[];
}

export function buildHarvestReport(input: {
  harvests: readonly HarvestEventLike[];
  batches: readonly BatchLike[];
  species: readonly SpeciesLike[];
  filters: AnalyticsFilters;
}): HarvestReport {
  const batchSpecies = new Map(input.batches.map((b) => [b.id, b.speciesId]));
  const filtered = input.harvests.filter(
    (h) =>
      isWithinDateRange(h.date, input.filters) &&
      matchesBatch(h.batchId, input.filters) &&
      matchesPond(h.pondId, input.filters) &&
      matchesSpecies(h.batchId, batchSpecies, input.filters),
  );

  const byBatchMap = new Map<string, { quantityFish: number; totalWeightKg: number }>();
  for (const h of filtered) {
    const bucket = byBatchMap.get(h.batchId) ?? { quantityFish: 0, totalWeightKg: 0 };
    bucket.quantityFish += h.quantityFish;
    bucket.totalWeightKg += h.totalWeightKg;
    byBatchMap.set(h.batchId, bucket);
  }

  const bySpeciesMap = new Map<string, { quantityFish: number; totalWeightKg: number }>();
  for (const h of filtered) {
    const speciesId = batchSpecies.get(h.batchId) ?? "desconocida";
    const bucket = bySpeciesMap.get(speciesId) ?? { quantityFish: 0, totalWeightKg: 0 };
    bucket.quantityFish += h.quantityFish;
    bucket.totalWeightKg += h.totalWeightKg;
    bySpeciesMap.set(speciesId, bucket);
  }

  return {
    totalFishInPeriod: sumBy(filtered, (h) => h.quantityFish),
    totalWeightKgInPeriod: sumBy(filtered, (h) => h.totalWeightKg),
    averageWeightG: weightedAverage(filtered, (h) => h.averageWeightG, (h) => h.quantityFish),
    byMonth: buildMonthlySeries(filtered, (h) => h.date, (h) => h.totalWeightKg),
    byBatch: [...byBatchMap.entries()]
      .map(([batchId, totals]) => ({
        batchId,
        batchCode: input.batches.find((b) => b.id === batchId)?.code ?? batchId,
        ...totals,
      }))
      .sort((a, b) => b.totalWeightKg - a.totalWeightKg),
    bySpecies: [...bySpeciesMap.entries()]
      .map(([speciesId, totals]) => ({
        speciesId,
        speciesName: speciesNameOf(speciesId, input.species),
        ...totals,
      }))
      .sort((a, b) => b.totalWeightKg - a.totalWeightKg),
    rows: [...filtered].sort((a, b) => b.date.localeCompare(a.date)),
  };
}

// --- 7. Ventas ---

export interface SaleLineLike {
  saleId: string;
  batchId: string;
  weightKg: number;
  pricePerKg: number;
  totalAmount: number;
}

export interface SaleLike {
  id: string;
  customerId: string | null;
  date: string;
  totalAmount: number;
  amountPaid: number;
  paymentStatus: string;
}

export interface CustomerLike {
  id: string;
  name: string;
}

export interface SalesReport {
  totalRevenueInPeriod: number;
  totalKgInPeriod: number;
  /** Precio medio ponderado por kg vendido — ver ejemplo obligatorio del encargo. */
  averagePricePerKg: number | null;
  pendingPaymentsTotal: number;
  byMonth: MonthlyPoint[];
  byCustomer: { customerId: string | null; customerName: string; totalAmount: number }[];
  rows: (SaleLike & { batchCodes: string })[];
}

export function buildSalesReport(input: {
  sales: readonly SaleLike[];
  saleLines: readonly SaleLineLike[];
  customers: readonly CustomerLike[];
  batches: readonly BatchLike[];
  filters: AnalyticsFilters;
}): SalesReport {
  const batchSpecies = new Map(input.batches.map((b) => [b.id, b.speciesId]));
  const salesInDateRange = input.sales.filter((s) => isWithinDateRange(s.date, input.filters));
  const saleDateById = new Map(salesInDateRange.map((s) => [s.id, s.date]));

  const linesInScope = input.saleLines.filter((line) => {
    if (!saleDateById.has(line.saleId)) return false;
    if (!matchesBatch(line.batchId, input.filters)) return false;
    if (!matchesSpecies(line.batchId, batchSpecies, input.filters)) return false;
    return true;
  });

  const saleIdsInScope = new Set(linesInScope.map((l) => l.saleId));
  // Si hay filtro de lote/especie, solo entran las ventas que tengan
  // alguna línea en ese lote/especie; sin filtro, entran todas las
  // ventas del rango de fechas (aunque `input.filters.pondId` no aplica
  // a ventas — una venta no ocurre "en" un estanque).
  const hasBatchOrSpeciesFilter = Boolean(input.filters.batchId || input.filters.speciesId);
  const salesInScope = hasBatchOrSpeciesFilter
    ? salesInDateRange.filter((s) => saleIdsInScope.has(s.id))
    : salesInDateRange;

  const linesForSalesInScope = input.saleLines.filter((l) => {
    if (hasBatchOrSpeciesFilter) return saleIdsInScope.has(l.saleId) && linesInScope.includes(l);
    return salesInScope.some((s) => s.id === l.saleId);
  });

  const byCustomerMap = new Map<string | null, number>();
  for (const s of salesInScope) {
    byCustomerMap.set(s.customerId, (byCustomerMap.get(s.customerId) ?? 0) + s.totalAmount);
  }

  const batchCodesBySale = new Map<string, string>();
  for (const line of linesForSalesInScope) {
    const code = input.batches.find((b) => b.id === line.batchId)?.code ?? line.batchId;
    const current = batchCodesBySale.get(line.saleId);
    batchCodesBySale.set(line.saleId, current ? `${current}, ${code}` : code);
  }

  return {
    totalRevenueInPeriod: sumBy(linesForSalesInScope, (l) => l.totalAmount),
    totalKgInPeriod: sumBy(linesForSalesInScope, (l) => l.weightKg),
    averagePricePerKg: weightedAveragePrice(linesForSalesInScope, (l) => l.weightKg, (l) => l.pricePerKg),
    pendingPaymentsTotal: sumBy(salesInScope, (s) => Math.max(0, s.totalAmount - s.amountPaid)),
    byMonth: buildMonthlySeries(salesInScope, (s) => s.date, (s) => s.totalAmount),
    byCustomer: [...byCustomerMap.entries()]
      .map(([customerId, totalAmount]) => ({
        customerId,
        customerName: customerId
          ? input.customers.find((c) => c.id === customerId)?.name ?? "Cliente desconocido"
          : "Venta externa",
        totalAmount,
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount),
    rows: salesInScope
      .map((s) => ({ ...s, batchCodes: batchCodesBySale.get(s.id) ?? "" }))
      .sort((a, b) => b.date.localeCompare(a.date)),
  };
}

// --- 8. Economía (agregado) ---

export interface EconomicsReportRow extends BatchEconomics {
  batchCode: string;
  speciesId: string;
  speciesName: string;
}

export interface EconomicsReport {
  rows: EconomicsReportRow[];
  totals: {
    incomeTotal: number;
    directCostTotal: number;
    profit: number;
    /** Margen agregado: Σganancia / Σingresos × 100 — nunca el promedio de los márgenes por lote. */
    marginPercent: number | null;
    /** Costo/kg agregado: Σcosto directo / Σkg cosechados. */
    costPerKg: number | null;
    harvestedWeightKgTotal: number;
  };
}

export function buildEconomicsReport(rows: readonly EconomicsReportRow[]): EconomicsReport {
  const incomeTotal = sumBy(rows, (r) => r.incomeTotal);
  const directCostTotal = sumBy(rows, (r) => r.directCostTotal);
  const profit = incomeTotal - directCostTotal;
  return {
    rows: [...rows],
    totals: {
      incomeTotal,
      directCostTotal,
      profit,
      marginPercent: incomeTotal > 0 ? (profit / incomeTotal) * 100 : null,
      costPerKg: ratioOfSums(rows, (r) => r.directCostTotal, (r) => r.harvestedWeightKgTotal),
      harvestedWeightKgTotal: sumBy(rows, (r) => r.harvestedWeightKgTotal),
    },
  };
}
