// FCR operacional básico (§28-§29 del encargo de Fase 3).
//
// FCR = alimento consumido / incremento de biomasa, en un período acotado
// por dos muestreos comparables. Quien llama es responsable de sumar el
// alimento consumido EXCLUSIVAMENTE dentro de ese mismo período (§28: "no
// mezclar alimento de fechas fuera del intervalo") y de calcular el
// incremento de biomasa entre esos dos puntos — esta función solo hace la
// división, sin decidir qué eventos entran en cada bolsa.
//
// Siempre se marca `estimated: true`: esta primera versión no descuenta
// la biomasa de los peces que murieron a mitad del período (no se
// registra su peso exacto al morir), así que el incremento de biomasa
// usado es una aproximación razonable, no un balance contable exacto
// (§29 — mostrar "FCR estimado", nunca con falsa precisión).
export interface FcrResult {
  fcr: number;
  estimated: true;
}

/**
 * `null` cuando no hay datos suficientes para un cálculo significativo
 * (incremento de biomasa cero o negativo: el lote no creció en el
 * período, o no hay dos puntos de biomasa comparables) — nunca
 * Infinity/NaN.
 */
export function calculateFcr(feedConsumedKg: number, biomassGainKg: number): FcrResult | null {
  if (!(biomassGainKg > 0)) return null;
  return { fcr: feedConsumedKg / biomassGainKg, estimated: true };
}
