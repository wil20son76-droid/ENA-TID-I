// Recomendación de ración diaria (§31 del encargo de Fase 3). Es
// deliberadamente solo una CALCULADORA: nunca crea movimientos de
// inventario ni FeedingRecords por sí sola (§32 — "planificado" y "real"
// son cosas distintas). Solo se descuenta stock cuando alguien registra
// alimentación de verdad suministrada.

/** ración diaria = biomasa × porcentaje / 100 */
export function calculateDailyRationKg(biomassKg: number, rationPercent: number): number {
  return (biomassKg * rationPercent) / 100;
}

/** Reparte la ración diaria entre N tomas iguales. */
export function splitRationPerFeeding(dailyRationKg: number, feedingsPerDay: number): number {
  if (feedingsPerDay <= 0) {
    throw new Error("El número de raciones por día debe ser mayor que cero.");
  }
  return dailyRationKg / feedingsPerDay;
}

/**
 * Fila configurable de la tabla especie+peso → porcentaje/raciones
 * (§"Recomendaciones configurables" de la función "Ración recomendada").
 * NUNCA hardcodeada: se edita desde Configuración (ver
 * FeedingRecommendation en prisma/schema.prisma) porque el criterio
 * correcto cambia con el alimento, la temperatura o el manejo — este
 * módulo solo sabe buscar en lo que exista configurado, nunca asume un
 * valor por defecto propio.
 */
export interface FeedingRecommendationEntry {
  speciesId: string;
  minWeightG: number;
  maxWeightG: number;
  feedPercent: number;
  feedingsPerDay: number;
  active: boolean;
}

/**
 * Bracket aplicable a una especie+peso: el rango activo de esa especie
 * que contiene `averageWeightG`. Si dos rangos se solapan (la UI no lo
 * impide — es una decisión de criterio técnico, no un error de datos),
 * gana el de `minWeightG` más alto — el más específico para ese peso
 * exacto. Sin ningún rango aplicable, devuelve `null`: nunca se inventa
 * un porcentaje por defecto.
 */
export function findFeedingRecommendation(
  entries: readonly FeedingRecommendationEntry[],
  speciesId: string,
  averageWeightG: number,
): FeedingRecommendationEntry | null {
  let best: FeedingRecommendationEntry | null = null;
  for (const entry of entries) {
    if (!entry.active || entry.speciesId !== speciesId) continue;
    if (averageWeightG < entry.minWeightG || averageWeightG > entry.maxWeightG) continue;
    if (!best || entry.minWeightG > best.minWeightG) best = entry;
  }
  return best;
}
