// Dinero: formato y redondeo centralizados (§2-§3 del encargo de Fase 5).
//
// Regla: la moneda de la finca es configurable (FarmSettings — ver
// src/lib/db/repositories/settingsRepository.ts), nunca "Bs" hardcodeado
// en cada pantalla. Internamente los montos se guardan como `number` sin
// formato (igual que el resto del dominio: kg, peces, etc.); Prisma los
// persiste como `Decimal` (§3) para evitar el error acumulado de punto
// flotante en sumas repetidas de facturación — el redondeo a 2 decimales
// solo ocurre en el borde de presentación (esta función) o justo antes de
// guardar un monto derivado de una multiplicación (`roundMoney`), nunca
// disperso por los componentes de React.
export const DEFAULT_CURRENCY_CODE = "BOB";
export const DEFAULT_CURRENCY_SYMBOL = "Bs";

/** Redondea a 2 decimales — el único punto donde una multiplicación de dinero se fija a un valor final. */
export function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/**
 * Formatea un monto con separador de miles y símbolo de moneda, p. ej.
 * "1.250,00 Bs". Nunca se llama a `toLocaleString` suelto en un componente
 * — esta es la única función de formato de dinero de toda la app.
 */
export function formatMoney(amount: number, currencySymbol: string = DEFAULT_CURRENCY_SYMBOL): string {
  const formatted = new Intl.NumberFormat("es-BO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(roundMoney(amount));
  return `${formatted} ${currencySymbol}`;
}
