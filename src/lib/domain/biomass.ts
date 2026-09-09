// Cálculos de biomasa (§7 del encargo de Fase 2). El usuario nunca calcula
// esto a mano: la UI siempre deriva la biomasa de cantidad × peso.

/** biomasaKg = cantidad × pesoPromedioGramos / 1000 */
export function calculateBiomassKg(quantity: number, averageWeightG: number): number {
  return (quantity * averageWeightG) / 1000;
}
