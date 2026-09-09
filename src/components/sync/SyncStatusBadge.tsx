"use client";

import { useSyncStatus } from "@/hooks/useSyncStatus";
import { runSync } from "@/lib/sync/engine";

function formatLastSyncedAt(iso: string | null): string {
  if (!iso) return "nunca";
  return new Intl.DateTimeFormat("es", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

/**
 * Indicador permanente y discreto de conexión/sincronización (§7, §10, §46
 * del encargo): nunca un mensaje técnico, solo un semáforo + contador.
 */
export function SyncStatusBadge() {
  const status = useSyncStatus();

  const pendingLabel =
    status.pendingCount === 1 ? "1 cambio pendiente" : `${status.pendingCount} cambios pendientes`;

  let icon = "🟢";
  let label = "Sincronizado";

  if (status.connectivity === "offline") {
    icon = "⚫";
    label = status.pendingCount > 0 ? `Sin conexión — ${pendingLabel}` : "Sin conexión";
  } else if (status.state === "syncing") {
    icon = "🟠";
    label = "Sincronizando…";
  } else if (status.hasErrors) {
    icon = "🔴";
    label = "Error de sincronización";
  } else if (status.pendingCount > 0) {
    icon = "🟠";
    label = pendingLabel;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="font-medium" aria-live="polite">
        <span aria-hidden="true">{icon}</span> {label}
      </span>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">
        Última sincronización: {formatLastSyncedAt(status.lastSyncedAt)}
      </span>
      <button
        type="button"
        onClick={() => void runSync({ force: true })}
        disabled={status.state === "syncing" || status.connectivity === "offline"}
        className="rounded-full border border-emerald-600 px-3 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-emerald-950"
      >
        Sincronizar ahora
      </button>
    </div>
  );
}
