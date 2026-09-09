// Redondeo y formato numérico centralizados (§30/§61 del encargo de
// Fase 3): un único lugar decide cómo se redondea y cómo se presenta un
// número, para no repetir la regla en cada pantalla ni arriesgar que
// 295.799999999 (error visible de floating point) se muestre tal cual.
//
// Los valores INTERNOS (los que usan los cálculos de dominio) nunca pasan
// por aquí — se mantienen numéricos sin formatear. El formato es
// exclusivamente para lo que ve la persona en pantalla.

/** Redondea a `decimals` posiciones sin arrastrar el error de floating point. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** Kilogramos: "295,8 kg". Una posición decimal — suficiente precisión operativa. */
export function formatKg(value: number): string {
  return `${roundTo(value, 1).toLocaleString("es", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`;
}

/** Gramos: "510 g". Sin decimales — el peso de un pez no se pesa al miligramo. */
export function formatG(value: number): string {
  return `${Math.round(value).toLocaleString("es")} g`;
}

/** Conteo de peces/unidades: "1.000 peces" (el sufijo lo agrega el llamador). */
export function formatCount(value: number): string {
  return Math.round(value).toLocaleString("es");
}

/** Porcentaje: "97,0 %". */
export function formatPercent(value: number): string {
  return `${roundTo(value, 1).toLocaleString("es", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

/** g/kg ↔ kg/g. Nunca reimplementar esta división en una pantalla. */
export function gramsToKg(grams: number): number {
  return grams / 1000;
}

export function kgToGrams(kg: number): number {
  return kg * 1000;
}
