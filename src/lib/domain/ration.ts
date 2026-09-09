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
