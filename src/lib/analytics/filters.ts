// Filtros compartidos de la capa de analítica (Fase 6, §"Filtros por
// fecha, especie, lote y estanque"). Funciones puras y pequeñas: cada
// informe decide QUÉ filtrar (algunos eventos no tienen `pondId`, p. ej.
// una venta), pero todos usan estas mismas comprobaciones — nunca una
// reimplementación de "¿está dentro del rango?" por informe.

export interface AnalyticsFilters {
  /** ISO "YYYY-MM-DD", inclusivo. `null`/`undefined` = sin límite inferior. */
  dateFrom?: string | null;
  /** ISO "YYYY-MM-DD", inclusivo. `null`/`undefined` = sin límite superior. */
  dateTo?: string | null;
  speciesId?: string | null;
  batchId?: string | null;
  pondId?: string | null;
}

export const EMPTY_FILTERS: AnalyticsFilters = {};

/** `true` si no hay ningún filtro activo (para mostrar "mostrando todo" en la UI). */
export function hasActiveFilters(filters: AnalyticsFilters): boolean {
  return Boolean(filters.dateFrom || filters.dateTo || filters.speciesId || filters.batchId || filters.pondId);
}

/** Compara solo la parte de fecha (los eventos guardan datetime ISO completo). */
export function isWithinDateRange(
  dateIso: string,
  filters: Pick<AnalyticsFilters, "dateFrom" | "dateTo">,
): boolean {
  const day = dateIso.slice(0, 10);
  if (filters.dateFrom && day < filters.dateFrom) return false;
  if (filters.dateTo && day > filters.dateTo) return false;
  return true;
}

export function matchesBatch(
  batchId: string | null | undefined,
  filters: Pick<AnalyticsFilters, "batchId">,
): boolean {
  if (!filters.batchId) return true;
  return batchId === filters.batchId;
}

export function matchesPond(
  pondId: string | null | undefined,
  filters: Pick<AnalyticsFilters, "pondId">,
): boolean {
  if (!filters.pondId) return true;
  return pondId === filters.pondId;
}

/** `{ batchId: speciesId }` — necesario porque la mayoría de eventos referencian un lote, no una especie directamente. */
export function buildBatchSpeciesIndex(
  batches: readonly { id: string; speciesId: string }[],
): ReadonlyMap<string, string> {
  return new Map(batches.map((b) => [b.id, b.speciesId]));
}

export function matchesSpecies(
  batchId: string | null | undefined,
  batchSpeciesIndex: ReadonlyMap<string, string>,
  filters: Pick<AnalyticsFilters, "speciesId">,
): boolean {
  if (!filters.speciesId) return true;
  if (!batchId) return false;
  return batchSpeciesIndex.get(batchId) === filters.speciesId;
}

/**
 * Comprobación combinada para un evento con `date` + `batchId` opcional
 * + `pondId` opcional (el caso más común: mortalidad, alimentación,
 * muestreos, cosechas, calidad del agua...). Un evento sin `batchId`
 * nunca pasa un filtro de especie o de lote activo (§ "no inventar
 * datos"); un evento sin `pondId` nunca pasa un filtro de estanque
 * activo.
 */
export function matchesEventFilters(
  event: { date: string; batchId?: string | null; pondId?: string | null },
  batchSpeciesIndex: ReadonlyMap<string, string>,
  filters: AnalyticsFilters,
): boolean {
  return (
    isWithinDateRange(event.date, filters) &&
    matchesBatch(event.batchId, filters) &&
    matchesPond(event.pondId, filters) &&
    matchesSpecies(event.batchId, batchSpeciesIndex, filters)
  );
}
