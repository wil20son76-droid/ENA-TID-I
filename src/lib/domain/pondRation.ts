// Agregación por estanque de la "Ración recomendada" (nueva función,
// mismo criterio de composición que src/app/estanques/[id]/page.tsx: un
// estanque puede alojar más de un lote a la vez, así que la recomendación
// del estanque es la SUMA de la de cada lote presente — nunca un solo
// peso/porcentaje aplicado a todo el estanque. No es otra fuente de
// verdad de peces/biomasa: recibe ya calculados los peces (getBatchPondBalance)
// y el peso estimado (getEstimatedWeightForPond) de cada lote, los mismos
// que usa el resto de la app.
import { calculateBiomassKg } from "./biomass";
import {
  calculateDailyRationKg,
  findFeedingRecommendation,
  splitRationPerFeeding,
  type FeedingRecommendationEntry,
} from "./ration";

export interface PondRationBatchInput {
  batchId: string;
  speciesId: string;
  quantity: number;
  averageWeightG: number;
}

export interface PondRationBatchResult extends PondRationBatchInput {
  biomassKg: number;
  /** `null` si no hay ninguna fila configurada para esta especie+peso todavía. */
  matchedRecommendation: FeedingRecommendationEntry | null;
  /** 0 cuando `matchedRecommendation` es `null` — nunca se inventa un porcentaje. */
  dailyRationKg: number;
}

export interface PondRationSummary {
  totalFish: number;
  totalBiomassKg: number;
  batches: PondRationBatchResult[];
  /** Suma de `dailyRationKg` de todos los lotes — la ración CALCULADA del estanque. */
  calculatedDailyRationKg: number;
  /** `false` si algún lote presente no tiene fila configurada para su especie+peso (recomendación parcial). */
  fullyConfigured: boolean;
  /** `feedingsPerDay` configurado del lote con mayor biomasa — sugerencia para repartir el total del estanque, nunca un promedio inventado. `null` sin ningún lote con recomendación. */
  suggestedFeedingsPerDay: number | null;
}

/** Suma la ración de cada lote presente en el estanque — ver cabecera del módulo. */
export function calculatePondRationSummary(
  batches: readonly PondRationBatchInput[],
  recommendations: readonly FeedingRecommendationEntry[],
): PondRationSummary {
  const results: PondRationBatchResult[] = batches.map((batch) => {
    const biomassKg = calculateBiomassKg(batch.quantity, batch.averageWeightG);
    const matchedRecommendation = findFeedingRecommendation(
      recommendations,
      batch.speciesId,
      batch.averageWeightG,
    );
    const dailyRationKg = matchedRecommendation
      ? calculateDailyRationKg(biomassKg, matchedRecommendation.feedPercent)
      : 0;

    return { ...batch, biomassKg, matchedRecommendation, dailyRationKg };
  });

  // Bucle plano (no dentro del .map de arriba) para que TypeScript pueda
  // seguir el estrechamiento de `dominant` sin cruzar el límite de una
  // función anidada — dentro de un callback de .map() el análisis de flujo
  // de control no lo conserva al leer la variable después de la llamada.
  let totalFish = 0;
  let totalBiomassKg = 0;
  let calculatedDailyRationKg = 0;
  let fullyConfigured = true;
  let dominant: { biomassKg: number; feedingsPerDay: number } | null = null;

  for (const result of results) {
    totalFish += result.quantity;
    totalBiomassKg += result.biomassKg;
    calculatedDailyRationKg += result.dailyRationKg;
    if (!result.matchedRecommendation) {
      fullyConfigured = false;
    } else if (!dominant || result.biomassKg > dominant.biomassKg) {
      dominant = {
        biomassKg: result.biomassKg,
        feedingsPerDay: result.matchedRecommendation.feedingsPerDay,
      };
    }
  }

  return {
    totalFish,
    totalBiomassKg,
    batches: results,
    calculatedDailyRationKg,
    fullyConfigured: batches.length > 0 && fullyConfigured,
    suggestedFeedingsPerDay: dominant ? dominant.feedingsPerDay : null,
  };
}

export interface PondRationDisplay {
  /** Siempre la calculada — nunca el ajuste manual, para poder mostrar ambas a la vez. */
  recommendedDailyRationKg: number;
  /** La que realmente se reparte en tarjetas: el ajuste manual si existe, si no la calculada. */
  effectiveDailyRationKg: number;
  effectiveFeedingsPerDay: number;
  hasManualOverride: boolean;
  perFeedingKg: number;
}

/**
 * Resuelve qué mostrar/repartir combinando la recomendación calculada con
 * un posible ajuste manual del estanque (§"Ajuste manual" — Pond.manualDailyRationKg/
 * manualFeedingsPerDay, nunca otra tabla: modificar la ración es un campo
 * más del estanque, igual criterio que su geometría). Nunca toca
 * inventario ni crea FeedingRecord — es una función pura de lectura.
 */
export function resolvePondRationDisplay(
  summary: PondRationSummary,
  manualDailyRationKg: number | null,
  manualFeedingsPerDay: number | null,
  defaultFeedingsPerDay: number,
): PondRationDisplay {
  const hasManualOverride = manualDailyRationKg !== null;
  const effectiveDailyRationKg = hasManualOverride
    ? manualDailyRationKg
    : summary.calculatedDailyRationKg;
  const effectiveFeedingsPerDay =
    manualFeedingsPerDay ?? summary.suggestedFeedingsPerDay ?? defaultFeedingsPerDay;
  const perFeedingKg =
    effectiveFeedingsPerDay > 0
      ? splitRationPerFeeding(effectiveDailyRationKg, effectiveFeedingsPerDay)
      : 0;

  return {
    recommendedDailyRationKg: summary.calculatedDailyRationKg,
    effectiveDailyRationKg,
    effectiveFeedingsPerDay,
    hasManualOverride,
    perFeedingKg,
  };
}
