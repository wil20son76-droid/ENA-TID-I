// Ledger de peces por lote/estanque (IMPLEMENTATION_PLAN.md §4.1, principio
// P4: "ledger, no sobrescritura"). La cantidad de peces de un lote en un
// estanque NUNCA se guarda como campo mutable — se deriva siempre de los
// eventos de siembra y traslado. Estas funciones son la ÚNICA fuente de
// ese cálculo: ni la UI ni el servidor lo recalculan a su manera.
//
// Funciones puras y testeables, sin dependencia de Dexie ni de Prisma: se
// usan igual en el cliente (con registros de Dexie) y en el servidor (con
// filas de Prisma) porque ambos lados comparten los mismos nombres de
// campo (batchId, pondId, quantity, fromPondId, toPondId).
//
// Hasta la Fase 2 el balance solo consideraba siembras ± traslados. La
// Fase 3 (§17 del encargo) suma la mortalidad como una salida más, con el
// mismo tratamiento que un traslado saliente: reduce el balance del
// estanque donde ocurrió, nunca el de otro. Cuando se añadan cosechas se
// integrarán de la misma forma, sin cambiar la firma de estas funciones.

export interface StockingLedgerEntry {
  batchId: string;
  pondId: string;
  quantity: number;
}

export interface TransferLedgerEntry {
  batchId: string;
  fromPondId: string;
  toPondId: string;
  quantity: number;
}

export interface MortalityLedgerEntry {
  batchId: string;
  pondId: string;
  quantity: number;
}

/** Peces de `batchId` presentes actualmente en `pondId`. */
export function getBatchPondBalance(
  stockings: readonly StockingLedgerEntry[],
  transfers: readonly TransferLedgerEntry[],
  mortalities: readonly MortalityLedgerEntry[],
  batchId: string,
  pondId: string,
): number {
  let balance = 0;
  for (const s of stockings) {
    if (s.batchId === batchId && s.pondId === pondId) balance += s.quantity;
  }
  for (const t of transfers) {
    if (t.batchId !== batchId) continue;
    if (t.toPondId === pondId) balance += t.quantity;
    if (t.fromPondId === pondId) balance -= t.quantity;
  }
  for (const m of mortalities) {
    if (m.batchId === batchId && m.pondId === pondId) balance -= m.quantity;
  }
  return balance;
}

/**
 * Distribución actual de un lote entre estanques: `{ pondId: cantidad }`,
 * solo estanques con cantidad mayor que cero (§11/§12: un lote puede estar
 * repartido entre varios estanques a la vez).
 */
export function getBatchDistribution(
  stockings: readonly StockingLedgerEntry[],
  transfers: readonly TransferLedgerEntry[],
  mortalities: readonly MortalityLedgerEntry[],
  batchId: string,
): Record<string, number> {
  const balances = new Map<string, number>();

  for (const s of stockings) {
    if (s.batchId !== batchId) continue;
    balances.set(s.pondId, (balances.get(s.pondId) ?? 0) + s.quantity);
  }
  for (const t of transfers) {
    if (t.batchId !== batchId) continue;
    balances.set(t.toPondId, (balances.get(t.toPondId) ?? 0) + t.quantity);
    balances.set(t.fromPondId, (balances.get(t.fromPondId) ?? 0) - t.quantity);
  }
  for (const m of mortalities) {
    if (m.batchId !== batchId) continue;
    balances.set(m.pondId, (balances.get(m.pondId) ?? 0) - m.quantity);
  }

  const distribution: Record<string, number> = {};
  for (const [pondId, quantity] of balances) {
    if (quantity > 0) distribution[pondId] = quantity;
  }
  return distribution;
}

/** Total de peces vivos del lote, sumando todos los estanques donde está. */
export function getBatchTotalBalance(
  stockings: readonly StockingLedgerEntry[],
  transfers: readonly TransferLedgerEntry[],
  mortalities: readonly MortalityLedgerEntry[],
  batchId: string,
): number {
  const distribution = getBatchDistribution(stockings, transfers, mortalities, batchId);
  return Object.values(distribution).reduce((sum, qty) => sum + qty, 0);
}

/**
 * Ocupación actual de un estanque: `{ batchId: cantidad }` de todos los
 * lotes presentes en él (§12: un estanque puede alojar más de un lote).
 */
export function getPondOccupancy(
  stockings: readonly StockingLedgerEntry[],
  transfers: readonly TransferLedgerEntry[],
  mortalities: readonly MortalityLedgerEntry[],
  pondId: string,
): Record<string, number> {
  const batchIds = new Set<string>();
  for (const s of stockings) if (s.pondId === pondId) batchIds.add(s.batchId);
  for (const t of transfers) {
    if (t.toPondId === pondId) batchIds.add(t.batchId);
    if (t.fromPondId === pondId) batchIds.add(t.batchId);
  }
  for (const m of mortalities) if (m.pondId === pondId) batchIds.add(m.batchId);

  const occupancy: Record<string, number> = {};
  for (const batchId of batchIds) {
    const qty = getBatchPondBalance(stockings, transfers, mortalities, batchId, pondId);
    if (qty > 0) occupancy[batchId] = qty;
  }
  return occupancy;
}

/** Total histórico sembrado de un lote (§19): nunca cambia por traslados, mortalidad o cosechas. */
export function getBatchStockedTotal(
  stockings: readonly StockingLedgerEntry[],
  batchId: string,
): number {
  return stockings.reduce((sum, s) => (s.batchId === batchId ? sum + s.quantity : sum), 0);
}

/** Mortalidad acumulada histórica de un lote (independiente de en qué estanque ocurrió). */
export function getBatchMortalityTotal(
  mortalities: readonly MortalityLedgerEntry[],
  batchId: string,
): number {
  return mortalities.reduce((sum, m) => (m.batchId === batchId ? sum + m.quantity : sum), 0);
}

/**
 * Supervivencia % = peces actuales / peces sembrados × 100 (§19). Evita
 * división por cero: sin siembra registrada, no hay supervivencia que
 * calcular.
 */
export function getSurvivalPercent(currentTotal: number, stockedTotal: number): number | null {
  if (stockedTotal <= 0) return null;
  return (currentTotal / stockedTotal) * 100;
}

/** Mortalidad % = mortalidad acumulada / peces sembrados × 100. */
export function getMortalityPercent(mortalityTotal: number, stockedTotal: number): number | null {
  if (stockedTotal <= 0) return null;
  return (mortalityTotal / stockedTotal) * 100;
}
