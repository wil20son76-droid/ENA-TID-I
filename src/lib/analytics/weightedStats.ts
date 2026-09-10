// Estadísticas ponderadas (Fase 6, regla crítica del encargo: "No usar
// promedios simples cuando deben ser ponderados"). Toda agregación de la
// capa de analítica que combine varios lotes/estanques/períodos pasa por
// estas funciones — nunca se promedia un porcentaje o un precio ya
// calculado por lote, siempre se suman los componentes y se divide una
// sola vez al final.
//
// Ejemplo obligatorio del encargo — supervivencia agregada:
//   Lote A: 1000 sembrados / 900 vivos
//   Lote B: 100 sembrados / 50 vivos
//   Correcto:  (900+50) / (1000+100) × 100 = 86,36 %
//   Incorrecto: promedio de 90% y 50% = 70%
//
// Ejemplo obligatorio — precio medio ponderado:
//   100 kg × 20 Bs + 900 kg × 30 Bs
//   Correcto:  (100×20 + 900×30) / (100+900) = 29 Bs/kg
//   Incorrecto: promedio de 20 y 30 = 25 Bs/kg

/** Suma de `selector(item)` sobre una lista — la única forma de sumar de este módulo. */
export function sumBy<T>(items: readonly T[], selector: (item: T) => number): number {
  let total = 0;
  for (const item of items) total += selector(item);
  return total;
}

/**
 * Razón de sumas: `Σ numerador / Σ denominador`. Es la base de toda
 * métrica "ponderada" de este módulo (supervivencia, costo/kg, margen,
 * precio medio) — nunca el promedio de razones ya calculadas por
 * elemento. `null` si el denominador total es cero o negativo (nunca
 * división por cero ni un resultado inventado).
 */
export function ratioOfSums<T>(
  items: readonly T[],
  numerator: (item: T) => number,
  denominator: (item: T) => number,
): number | null {
  const totalDenominator = sumBy(items, denominator);
  if (!(totalDenominator > 0)) return null;
  return sumBy(items, numerator) / totalDenominator;
}

/** Igual que `ratioOfSums`, expresado como porcentaje (`× 100`). */
export function percentOfSums<T>(
  items: readonly T[],
  numerator: (item: T) => number,
  denominator: (item: T) => number,
): number | null {
  const ratio = ratioOfSums(items, numerator, denominator);
  return ratio === null ? null : ratio * 100;
}

/**
 * Supervivencia agregada de un conjunto de lotes: `Σ vivos / Σ sembrados
 * × 100`. Envoltorio de `percentOfSums` con nombres explícitos para que
 * la fórmula del ejemplo del encargo sea trazable en el código, no solo
 * en un comentario.
 */
export function aggregateSurvivalPercent<T>(
  items: readonly T[],
  living: (item: T) => number,
  stocked: (item: T) => number,
): number | null {
  return percentOfSums(items, living, stocked);
}

/**
 * Precio medio ponderado por cantidad: `Σ(cantidad×precio) / Σ cantidad`.
 * Nunca el promedio simple de los precios unitarios — ver el ejemplo del
 * encargo en el encabezado de este archivo.
 */
export function weightedAveragePrice<T>(
  items: readonly T[],
  quantity: (item: T) => number,
  unitPrice: (item: T) => number,
): number | null {
  return ratioOfSums(
    items,
    (item) => quantity(item) * unitPrice(item),
    (item) => quantity(item),
  );
}

/**
 * Promedio ponderado genérico: `Σ(valor×peso) / Σ peso`. Usado para
 * peso/biomasa agregados, costo/kg agregado y cualquier otra métrica que
 * no encaje en el patrón "razón de sumas" directo (p. ej. cuando el valor
 * ya es una tasa y el peso es la base sobre la que se calculó esa tasa).
 */
export function weightedAverage<T>(
  items: readonly T[],
  value: (item: T) => number,
  weight: (item: T) => number,
): number | null {
  return ratioOfSums(
    items,
    (item) => value(item) * weight(item),
    (item) => weight(item),
  );
}
