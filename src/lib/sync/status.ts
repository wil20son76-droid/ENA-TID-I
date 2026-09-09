// Estado observable del motor de sincronización, expuesto vía
// useSyncExternalStore (src/hooks/useSyncStatus.ts). El número de cambios
// pendientes NO vive aquí: se consulta en vivo directamente contra Dexie
// (siempre exacto, incluso si el motor de sync nunca llegó a ejecutarse
// todavía) — este store solo guarda el resultado del último ciclo.
export type SyncConnectivity = "online" | "offline";
export type SyncRunState = "idle" | "syncing";

export interface SyncStatusSnapshot {
  connectivity: SyncConnectivity;
  state: SyncRunState;
  lastSyncedAt: string | null;
  lastError: string | null;
}

function initialConnectivity(): SyncConnectivity {
  if (typeof navigator === "undefined" || !("onLine" in navigator)) {
    return "online";
  }
  return navigator.onLine ? "online" : "offline";
}

let snapshot: SyncStatusSnapshot = {
  connectivity: initialConnectivity(),
  state: "idle",
  lastSyncedAt: null,
  lastError: null,
};

const listeners = new Set<() => void>();

export function getSyncStatus(): SyncStatusSnapshot {
  return snapshot;
}

export function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSyncStatus(patch: Partial<SyncStatusSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) {
    listener();
  }
}
