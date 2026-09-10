"use client";

import { useSyncExternalStore } from "react";

import { useSyncStatus } from "@/hooks/useSyncStatus";
import { runSync } from "@/lib/sync/engine";

// Patrón estándar para detectar "ya estamos en el cliente, después de
// hidratar" sin caer en un setState dentro de un efecto (que dispararía un
// render en cascada evitable): la suscripción nunca emite cambios, solo se
// usa la diferencia entre el snapshot de servidor (false) y el de cliente
// (true), que React resuelve de forma correcta durante la hidratación.
const subscribeNever = () => () => undefined;
function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

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

  // El estado real (conexión, pendientes...) solo existe en el navegador.
  // Si se renderizara desde el primer instante, el HTML que el usuario ve
  // al abrir la app offline desde el caché del service worker (generado en
  // una visita anterior, con otro estado) no coincidiría con lo que React
  // calcula al hidratar ahora mismo, y React lo marca como error de
  // hidratación. Se evita mostrando un valor neutro y estable hasta que el
  // componente termina de montarse; el valor real llega en el primer
  // re-render posterior al montaje.
  const mounted = useMounted();

  const pendingLabel =
    status.pendingCount === 1 ? "1 cambio pendiente" : `${status.pendingCount} cambios pendientes`;

  let icon = "🟢";
  let label = "Sincronizado";
  let lastSyncedAt = status.lastSyncedAt;
  let buttonDisabled = true;

  if (mounted) {
    buttonDisabled = status.state === "syncing" || status.connectivity === "offline";

    if (status.connectivity === "offline") {
      icon = "⚫";
      label = status.pendingCount > 0 ? `Sin conexión — ${pendingLabel}` : "Sin conexión";
    } else if (status.state === "syncing") {
      icon = "🟠";
      label = "Sincronizando…";
    } else if (status.hasErrors || status.lastError) {
      icon = "🔴";
      label = "Error de sincronización";
    } else if (status.pendingCount > 0) {
      icon = "🟠";
      label = pendingLabel;
    }
  } else {
    lastSyncedAt = null;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="font-medium" aria-live="polite">
        <span aria-hidden="true">{icon}</span> {label}
      </span>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">
        Última sincronización: {formatLastSyncedAt(lastSyncedAt)}
      </span>
      {mounted && status.lastError && (
        <span className="w-full text-xs text-red-600 dark:text-red-400" role="alert">
          {status.lastError}
        </span>
      )}
      <button
        type="button"
        onClick={() => void runSync({ force: true })}
        disabled={buttonDisabled}
        className="inline-flex min-h-11 items-center justify-center rounded-full border border-emerald-600 px-3 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-emerald-950"
      >
        Sincronizar ahora
      </button>
    </div>
  );
}
