// Crecimiento entre dos muestreos (§27 del encargo de Fase 3). Pura: no
// decide CUÁLES muestreos comparar (eso lo hace quien llama, típicamente
// los dos muestreos más recientes de un batch+pond) — solo calcula la
// ganancia y el crecimiento diario entre dos puntos ya elegidos.

export interface GrowthResult {
  available: true;
  gainG: number;
  days: number;
  dailyGrowthG: number;
}

export interface GrowthUnavailable {
  available: false;
}

/**
 * Ganancia absoluta y crecimiento diario entre dos pesos promedio con
 * fecha. Si el período es cero o negativo (fechas iguales o invertidas,
 * datos no comparables), devuelve `available: false` — nunca división
 * por cero ni un resultado engañoso.
 */
export function calculateGrowth(
  previousWeightG: number,
  previousDate: string,
  currentWeightG: number,
  currentDate: string,
): GrowthResult | GrowthUnavailable {
  const days =
    (new Date(currentDate).getTime() - new Date(previousDate).getTime()) / (1000 * 60 * 60 * 24);

  if (!(days > 0)) {
    return { available: false };
  }

  const gainG = currentWeightG - previousWeightG;
  return { available: true, gainG, days, dailyGrowthG: gainG / days };
}
