"use client";

// Barra de filtros compartida por todos los informes (Fase 6, §"Filtros
// por fecha, especie, lote y estanque"). Puramente controlada: el estado
// de los filtros vive en la página (no aquí, no en la URL) — este
// componente solo renderiza los controles y notifica cambios. `print:hidden`
// para que la vista imprimible/PDF nunca muestre los controles de filtro.
import type { AnalyticsFilters } from "@/lib/analytics/filters";

export interface ReportFilterBarProps {
  filters: AnalyticsFilters;
  onChange: (filters: AnalyticsFilters) => void;
  species: readonly { id: string; commonName: string }[];
  batches: readonly { id: string; code: string }[];
  ponds: readonly { id: string; code: string }[];
  /** Oculta el selector de estanque en informes donde no aplica (p. ej. ventas). */
  showPond?: boolean;
}

const inputClass =
  "rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900";

export function ReportFilterBar({
  filters,
  onChange,
  species,
  batches,
  ponds,
  showPond = true,
}: ReportFilterBarProps) {
  const active = Boolean(
    filters.dateFrom || filters.dateTo || filters.speciesId || filters.batchId || filters.pondId,
  );

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 bg-white p-3 print:hidden dark:border-zinc-800 dark:bg-zinc-900">
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-zinc-500 dark:text-zinc-400">Desde</span>
        <input
          type="date"
          value={filters.dateFrom ?? ""}
          onChange={(event) => onChange({ ...filters, dateFrom: event.target.value || null })}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-zinc-500 dark:text-zinc-400">Hasta</span>
        <input
          type="date"
          value={filters.dateTo ?? ""}
          onChange={(event) => onChange({ ...filters, dateTo: event.target.value || null })}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-zinc-500 dark:text-zinc-400">Especie</span>
        <select
          value={filters.speciesId ?? ""}
          onChange={(event) => onChange({ ...filters, speciesId: event.target.value || null })}
          className={inputClass}
        >
          <option value="">Todas</option>
          {species.map((s) => (
            <option key={s.id} value={s.id}>
              {s.commonName}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-zinc-500 dark:text-zinc-400">Lote</span>
        <select
          value={filters.batchId ?? ""}
          onChange={(event) => onChange({ ...filters, batchId: event.target.value || null })}
          className={inputClass}
        >
          <option value="">Todos</option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code}
            </option>
          ))}
        </select>
      </label>
      {showPond && (
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-zinc-500 dark:text-zinc-400">Estanque</span>
          <select
            value={filters.pondId ?? ""}
            onChange={(event) => onChange({ ...filters, pondId: event.target.value || null })}
            className={inputClass}
          >
            <option value="">Todos</option>
            {ponds.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code}
              </option>
            ))}
          </select>
        </label>
      )}
      {active && (
        <button
          type="button"
          onClick={() => onChange({})}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
        >
          Limpiar filtros
        </button>
      )}
    </div>
  );
}
