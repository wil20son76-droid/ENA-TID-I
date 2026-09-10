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
// Fase 3 (§17 del encargo) sumó la mortalidad como una salida más, con el
// mismo tratamiento que un traslado saliente: reduce el balance del
// estanque donde ocurrió, nunca el de otro. La Fase 5 (§21 del encargo)
// suma la cosecha como una salida más, con el MISMO criterio: nunca se
// guarda un `currentQuantity` mutable — el balance sigue siendo
// `siembra ± traslado - mortalidad - cosecha`, derivado siempre de estos
// eventos. La nota original de este archivo decía que la firma de estas
// funciones no cambiaría al añadir cosechas; en la práctica sí hace falta
// un parámetro `harvests` explícito (exactamente el mismo patrón que se
// usó al añadir `mortalities` en la Fase 3) para que esta siga siendo la
// única fuente de verdad del cálculo.
//
// IMPORTANTE (§19/§34 del encargo de Fase 5): la cosecha reduce el balance
// de peces VIVOS en el estanque, pero NO debe tratarse como una pérdida
// para efectos de supervivencia — ver `getSurvivalPercent` más abajo, que
// deliberadamente sigue calculándose a partir de `stockedTotal -
// mortalityTotal`, nunca del balance ya reducido por cosecha.

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

/** Cosecha (§20-§26 del encargo de Fase 5): salida del ledger de peces, igual criterio que la mortalidad. */
export interface HarvestLedgerEntry {
  batchId: string;
  pondId: string;
  quantityFish: number;
}

/** Peces de `batchId` presentes actualmente en `pondId`. */
export function getBatchPondBalance(
  stockings: readonly StockingLedgerEntry[],
  transfers: readonly TransferLedgerEntry[],
  mortalities: readonly MortalityLedgerEntry[],
  harvests: readonly HarvestLedgerEntry[],
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
  for (const h of harvests) {
    if (h.batchId === batchId && h.pondId === pondId) balance -= h.quantityFish;
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
  harvests: readonly HarvestLedgerEntry[],
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
  for (const h of harvests) {
    if (h.batchId !== batchId) continue;
    balances.set(h.pondId, (balances.get(h.pondId) ?? 0) - h.quantityFish);
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
  harvests: readonly HarvestLedgerEntry[],
  batchId: string,
): number {
  const distribution = getBatchDistribution(stockings, transfers, mortalities, harvests, batchId);
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
  harvests: readonly HarvestLedgerEntry[],
  pondId: string,
): Record<string, number> {
  const batchIds = new Set<string>();
  for (const s of stockings) if (s.pondId === pondId) batchIds.add(s.batchId);
  for (const t of transfers) {
    if (t.toPondId === pondId) batchIds.add(t.batchId);
    if (t.fromPondId === pondId) batchIds.add(t.batchId);
  }
  for (const m of mortalities) if (m.pondId === pondId) batchIds.add(m.batchId);
  for (const h of harvests) if (h.pondId === pondId) batchIds.add(h.batchId);

  const occupancy: Record<string, number> = {};
  for (const batchId of batchIds) {
    const qty = getBatchPondBalance(stockings, transfers, mortalities, harvests, batchId, pondId);
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

/**
 * Total histórico de peces cosechados de un lote (§34 del encargo de
 * Fase 5: "producción cosechada"), sumando todas las cosechas (parciales y
 * totales) en todos los estanques — independiente de dónde ocurrió cada
 * una y nunca afectado por mortalidad/traslados posteriores.
 */
export function getBatchHarvestedFishTotal(
  harvests: readonly { batchId: string; quantityFish: number }[],
  batchId: string,
): number {
  return harvests.reduce((sum, h) => (h.batchId === batchId ? sum + h.quantityFish : sum), 0);
}

/** Total histórico de kilos cosechados de un lote (§34). */
export function getBatchHarvestedWeightKgTotal(
  harvests: readonly { batchId: string; totalWeightKg: number }[],
  batchId: string,
): number {
  return harvests.reduce((sum, h) => (h.batchId === batchId ? sum + h.totalWeightKg : sum), 0);
}
