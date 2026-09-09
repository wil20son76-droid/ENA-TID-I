// Muestreos y peso estimado (§21-§24 del encargo de Fase 3). Funciones
// puras: el peso promedio actual de un lote/estanque nunca se guarda como
// campo mutable, se deriva siempre del último muestreo aplicable — igual
// principio de ledger que el resto del dominio.

/** peso promedio (g) = peso total muestra (kg) × 1000 / cantidad de peces muestreados. */
export function calculateSampleAverageWeightG(
  sampleFishCount: number,
  totalSampleWeightKg: number,
): number {
  if (sampleFishCount <= 0) {
    throw new Error("El número de peces muestreados debe ser mayor que cero.");
  }
  return (totalSampleWeightKg * 1000) / sampleFishCount;
}

export interface SamplingLedgerEntry {
  batchId: string;
  pondId: string;
  date: string;
  averageWeightG: number;
}

export type WeightEstimateSource = "SAMPLING" | "INITIAL_STOCKING";

export interface WeightEstimate {
  averageWeightG: number;
  source: WeightEstimateSource;
  /** Fecha del muestreo usado, o `null` si se recurrió al peso inicial de siembra. */
  sampleDate: string | null;
}

/**
 * Peso estimado de un lote EN UN ESTANQUE concreto (§24: un lote puede
 * estar repartido, y un muestreo de un estanque no sustituye
 * automáticamente el peso estimado de otro). Usa el muestreo más
 * reciente de esa combinación exacta batchId+pondId; si no existe
 * ninguno todavía, cae al peso inicial de la siembra del lote (§23) —
 * nunca deja el peso sin definir mientras el lote exista.
 */
export function getEstimatedWeightForPond(
  samplings: readonly SamplingLedgerEntry[],
  batchId: string,
  pondId: string,
  initialAverageWeightG: number,
): WeightEstimate {
  let latest: SamplingLedgerEntry | null = null;
  for (const s of samplings) {
    if (s.batchId !== batchId || s.pondId !== pondId) continue;
    if (!latest || s.date > latest.date) latest = s;
  }

  if (latest) {
    return { averageWeightG: latest.averageWeightG, source: "SAMPLING", sampleDate: latest.date };
  }
  return { averageWeightG: initialAverageWeightG, source: "INITIAL_STOCKING", sampleDate: null };
}

export interface BatchWeightEstimate {
  /** Promedio ponderado por peces presentes en cada estanque. */
  averageWeightG: number;
  /** `true` solo si TODOS los componentes vienen de un muestreo real (ninguno cayó al peso inicial). */
  allFromSampling: boolean;
  perPond: Record<string, WeightEstimate>;
}

/**
 * Peso estimado agregado de un lote repartido entre varios estanques
 * (§24): promedio ponderado por la cantidad de peces presentes en cada
 * estanque, no un peso único aplicado a todo el lote. Si el lote no tiene
 * peces en ningún estanque, devuelve `null` — no hay nada que estimar.
 */
export function getEstimatedWeightForBatch(
  samplings: readonly SamplingLedgerEntry[],
  distribution: Readonly<Record<string, number>>,
  batchId: string,
  initialAverageWeightG: number,
): BatchWeightEstimate | null {
  const pondIds = Object.keys(distribution).filter((pondId) => distribution[pondId] > 0);
  if (pondIds.length === 0) return null;

  const perPond: Record<string, WeightEstimate> = {};
  let weightedSum = 0;
  let totalQuantity = 0;
  let allFromSampling = true;

  for (const pondId of pondIds) {
    const estimate = getEstimatedWeightForPond(samplings, batchId, pondId, initialAverageWeightG);
    perPond[pondId] = estimate;
    if (estimate.source !== "SAMPLING") allFromSampling = false;

    const quantity = distribution[pondId];
    weightedSum += estimate.averageWeightG * quantity;
    totalQuantity += quantity;
  }

  return {
    averageWeightG: weightedSum / totalQuantity,
    allFromSampling,
    perPond,
  };
}
