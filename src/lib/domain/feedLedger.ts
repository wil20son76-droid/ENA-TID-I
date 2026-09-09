// Ledger de inventario de alimento (§4-§7 del encargo de Fase 3). Mismo
// principio que src/lib/domain/batchLedger.ts para los peces: el stock de
// un alimento NUNCA se guarda como campo mutable (nada de
// `Feed.stockKg`) — siempre se deriva de sus movimientos, que son
// append-only (FeedInventoryMovement). Funciones puras, sin dependencia
// de Dexie ni de Prisma, usadas igual en cliente y servidor.

export type FeedMovementType =
  | "PURCHASE"
  | "INITIAL_STOCK"
  | "CONSUMPTION"
  | "ADJUSTMENT_IN"
  | "ADJUSTMENT_OUT"
  | "LOSS"
  | "RETURN";

const ENTRY_TYPES = new Set<FeedMovementType>(["PURCHASE", "INITIAL_STOCK", "ADJUSTMENT_IN", "RETURN"]);
const EXIT_TYPES = new Set<FeedMovementType>(["CONSUMPTION", "ADJUSTMENT_OUT", "LOSS"]);

/**
 * `true` si el tipo resta del stock. Única fuente de esta clasificación —
 * el servidor la usa para decidir cuándo validar que un movimiento no
 * deje el stock en negativo (§11 del encargo de Fase 3).
 */
export function isFeedExitMovement(movementType: FeedMovementType): boolean {
  return EXIT_TYPES.has(movementType);
}

/**
 * Signo único de cada tipo de movimiento (§5 del encargo): entradas suman,
 * salidas restan. `quantityKg` siempre llega positivo desde el registro;
 * esta es la ÚNICA función que decide el signo — ninguna pantalla debe
 * reimplementar esta regla.
 */
export function getFeedMovementSignedQuantity(
  movementType: FeedMovementType,
  quantityKg: number,
): number {
  const magnitude = Math.abs(quantityKg);
  if (ENTRY_TYPES.has(movementType)) return magnitude;
  if (EXIT_TYPES.has(movementType)) return -magnitude;
  // Nunca debería llegar aquí si el tipo está validado (Zod/Prisma enum),
  // pero se prefiere fallar de forma explícita a adivinar un signo.
  throw new Error(`Tipo de movimiento de alimento desconocido: ${movementType}`);
}

export interface FeedMovementLedgerEntry {
  feedId: string;
  movementType: FeedMovementType;
  quantityKg: number;
}

/** Stock actual de un alimento: SUM(entradas) - SUM(salidas). */
export function getFeedStock(
  movements: readonly FeedMovementLedgerEntry[],
  feedId: string,
): number {
  let stock = 0;
  for (const m of movements) {
    if (m.feedId !== feedId) continue;
    stock += getFeedMovementSignedQuantity(m.movementType, m.quantityKg);
  }
  return stock;
}

/** Stock actual de todos los alimentos con movimientos: `{ feedId: stockKg }`. */
export function getAllFeedStocks(
  movements: readonly FeedMovementLedgerEntry[],
): Record<string, number> {
  const stocks: Record<string, number> = {};
  for (const m of movements) {
    const current = stocks[m.feedId] ?? 0;
    stocks[m.feedId] = current + getFeedMovementSignedQuantity(m.movementType, m.quantityKg);
  }
  return stocks;
}

export interface DatedFeedConsumption {
  date: string;
  quantityKg: number;
}

/**
 * Días de stock disponible (§33): stock actual / consumo promedio diario
 * de una ventana reciente documentada (por defecto, últimos 7 días con
 * consumo — no 7 días de calendario: si no hubo alimentación un día, ese
 * día no cuenta como "0 kg" que abarate artificialmente el promedio).
 * Sin historial suficiente, devuelve `null` — nunca Infinity/NaN.
 */
export function getDaysOfStockRemaining(
  currentStockKg: number,
  recentConsumptions: readonly DatedFeedConsumption[],
  windowSize = 7,
): number | null {
  if (recentConsumptions.length === 0) return null;

  const sorted = [...recentConsumptions].sort((a, b) => b.date.localeCompare(a.date));
  const window = sorted.slice(0, windowSize);
  const totalConsumed = window.reduce((sum, c) => sum + Math.abs(c.quantityKg), 0);
  if (totalConsumed <= 0) return null;

  const averageDailyConsumption = totalConsumed / window.length;
  if (averageDailyConsumption <= 0) return null;

  return currentStockKg / averageDailyConsumption;
}
