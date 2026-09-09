"use client";

import { useEffect } from "react";

import { startSyncEngine } from "@/lib/sync/engine";

/**
 * Arranca el motor de sincronización (apertura de la app, evento "online",
 * intervalo periódico) una sola vez para toda la aplicación. Se monta en
 * el layout raíz; no renderiza nada visible.
 */
export function SyncProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const stop = startSyncEngine();
    return stop;
  }, []);

  return children;
}
