"use client";

import { useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { db } from "@/lib/db/schema";
import { getSyncStatus, subscribeSyncStatus } from "@/lib/sync/status";

export interface SyncStatus {
  connectivity: "online" | "offline";
  state: "idle" | "syncing";
  lastSyncedAt: string | null;
  lastError: string | null;
  /** Cambios pendientes de sincronizar (pending + error), en vivo desde Dexie. */
  pendingCount: number;
  hasErrors: boolean;
}

/**
 * Estado combinado de sincronización para la UI (badge, botón "Sincronizar
 * ahora", etc.). El recuento de pendientes se lee en vivo directamente de
 * IndexedDB — es exacto incluso si el motor de sync todavía no corrió.
 */
export function useSyncStatus(): SyncStatus {
  const engineStatus = useSyncExternalStore(
    subscribeSyncStatus,
    getSyncStatus,
    getSyncStatus,
  );

  const pendingCount =
    useLiveQuery(
      () => db.syncQueue.where("status").anyOf("pending", "error").count(),
      [],
    ) ?? 0;

  const hasErrors =
    useLiveQuery(
      () => db.syncQueue.where("status").equals("error").count(),
      [],
    ) ?? 0;

  return {
    ...engineStatus,
    pendingCount,
    hasErrors: hasErrors > 0,
  };
}
