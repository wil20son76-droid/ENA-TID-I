// Motor de sincronización (IMPLEMENTATION_PLAN.md §6.3, §6.5, §9).
//
// Un ciclo de sincronización (runSync) hace, en orden:
//   1. PUSH: envía las operaciones locales pendientes/en error listas
//      para reintentar (respetando backoff, salvo que sea forzado).
//   2. PULL: pide a /api/sync/pull los cambios posteriores al último
//      cursor guardado y los aplica a Dexie SIN pasar por el outbox (si
//      volvieran a encolarse, el dispositivo reenviaría al servidor datos
//      que el propio servidor le acaba de mandar).
//
// Cada operación del outbox se intenta como máximo una vez por llamada a
// runSync: nunca hay un bucle interno que reintente hasta tener éxito.
// Los reintentos vienen de que algo vuelve a invocar runSync más tarde
// (intervalo periódico, evento "online", botón "Sincronizar ahora"), lo
// que evita que un fallo persistente de red cause un bucle infinito.
import { getDeviceId } from "../db/deviceId";
import { db } from "../db/schema";
import {
  countPending,
  getLastSyncedAt,
  listByStatus,
  markError,
  markSynced,
  markSyncing,
  purgeSynced,
  setLastSyncedAt,
} from "../db/repositories/syncQueueRepository";
import type { SyncQueueRecord } from "../db/types";
import { pullChanges, pushOperations } from "./client";
import { getConflictMessage } from "./conflictMessages";
import { selectReadyOperations } from "./priority";
import { setSyncStatus } from "./status";

const BATCH_SIZE = 50;
const BASE_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

function backoffDelayMs(retryCount: number): number {
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** retryCount, MAX_RETRY_DELAY_MS);
}

function isReadyForRetry(item: SyncQueueRecord, now: number, force: boolean): boolean {
  if (item.status === "pending") return true;
  if (item.status !== "error") return false;
  if (force) return true;
  const lastAttemptMs = new Date(item.updatedAt).getTime();
  return now - lastAttemptMs >= backoffDelayMs(item.retryCount);
}

// Fase 3.5 (§10-§14): el orden de envío ya no depende solo de `createdAt`.
// `selectReadyOperations` ordena por nivel de prioridad explícito
// (catálogos antes que sus dependientes) y excluye las operaciones cuya
// dependencia está actualmente en error, para no inundar al servidor con
// hijos que sabemos que van a fallar mientras su padre siga fallando. Esto
// no sustituye el backoff/reintento de `isReadyForRetry` — se aplica
// después, solo sobre lo que ya está listo para intentarse.
async function collectEligibleOperations(force: boolean): Promise<SyncQueueRecord[]> {
  const [pending, errored] = await Promise.all([
    listByStatus("pending"),
    listByStatus("error"),
  ]);
  const all = [...pending, ...errored];
  const now = Date.now();
  const readyForRetry = all.filter((item) => isReadyForRetry(item, now, force));
  return selectReadyOperations(readyForRetry, all);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// `fetch()` solo rechaza su promesa por fallos de red reales (sin conexión,
// DNS, CORS, conexión rechazada); una respuesta HTTP de error (4xx/5xx) la
// resuelve igual con `response.ok === false`. Por eso un TypeError aquí es
// la señal fiable de "no hay conexión real", más robusta que depender solo
// de `navigator.onLine` (que en algunos entornos/navegadores puede seguir
// reportando `true` sin conectividad real, como se observó verificando
// esta misma función con la red cortada).
function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

async function pushBatch(deviceId: string, batch: SyncQueueRecord[]): Promise<void> {
  if (batch.length === 0) return;

  await markSyncing(batch.map((item) => item.id));

  try {
    const response = await pushOperations(deviceId, batch);
    const byId = new Map(response.results.map((result) => [result.id, result]));
    const syncedIds: string[] = [];

    for (const item of batch) {
      const result = byId.get(item.id);
      if (!result) {
        await markError(item.id, "El servidor no devolvió resultado para esta operación.");
        continue;
      }

      switch (result.status) {
        case "applied":
        case "duplicate":
          syncedIds.push(item.id);
          break;
        case "conflict":
          // Mensaje específico por tipo de operación (§23 de Fase 3.5): un
          // comando de negocio compuesto (RegisterFeeding, etc.) se
          // presenta como UN incidente comprensible, nunca desglosado en
          // sus escrituras internas.
          await markError(item.id, getConflictMessage(item.entityType, item.payload));
          break;
        case "error":
          await markError(item.id, result.error ?? "Error al sincronizar en el servidor.");
          break;
      }
    }

    if (syncedIds.length > 0) {
      await markSynced(syncedIds);
    }
  } catch (error) {
    // Fallo de red (sin conexión real, servidor caído, timeout, etc.): el
    // dato ya está seguro en IndexedDB, así que esto nunca es una pérdida
    // de información — solo queda pendiente de un próximo intento.
    const message = error instanceof Error ? error.message : "Error de red al sincronizar.";
    await Promise.all(batch.map((item) => markError(item.id, message)));
    if (isNetworkError(error)) {
      setSyncStatus({ connectivity: "offline" });
    }
  }
}

async function pullAndMerge(): Promise<void> {
  const since = await getLastSyncedAt();
  const response = await pullChanges(since);

  await db.transaction(
    "rw",
    [
      db.species,
      db.ponds,
      db.fishBatches,
      db.stockings,
      db.fishTransfers,
      db.feeds,
      db.feedInventoryMovements,
      db.feedingRecords,
      db.mortalityRecords,
      db.samplings,
      db.waterQualityRecords,
      db.tasks,
    ],
    async () => {
      for (const species of response.species) {
        await db.species.put(species);
      }
      for (const pond of response.ponds) {
        await db.ponds.put(pond);
      }
      for (const batch of response.fishBatches) {
        await db.fishBatches.put(batch);
      }
      for (const stocking of response.stockings) {
        await db.stockings.put(stocking);
      }
      for (const transfer of response.fishTransfers) {
        await db.fishTransfers.put(transfer);
      }
      for (const feed of response.feeds) {
        await db.feeds.put(feed);
      }
      for (const movement of response.feedInventoryMovements) {
        await db.feedInventoryMovements.put(movement);
      }
      for (const feeding of response.feedingRecords) {
        await db.feedingRecords.put(feeding);
      }
      for (const mortality of response.mortalityRecords) {
        await db.mortalityRecords.put(mortality);
      }
      for (const sampling of response.samplings) {
        await db.samplings.put(sampling);
      }
      for (const record of response.waterQualityRecords) {
        await db.waterQualityRecords.put(record);
      }
      for (const task of response.tasks) {
        await db.tasks.put(task);
      }
    },
  );

  await setLastSyncedAt(response.serverTime);
}

let isRunning = false;

export interface RunSyncOptions {
  /** Ignora el backoff de los elementos en error y los reintenta ya. */
  force?: boolean;
}

/**
 * Ejecuta un ciclo completo de sincronización. Es seguro llamarla desde
 * varios disparadores (apertura de la app, evento "online", intervalo,
 * botón manual): si ya hay un ciclo en curso, la llamada no hace nada.
 */
export async function runSync(options: RunSyncOptions = {}): Promise<void> {
  if (typeof window === "undefined") return;
  if (isRunning) return;

  if (!navigator.onLine) {
    setSyncStatus({ connectivity: "offline", state: "idle" });
    return;
  }

  isRunning = true;
  setSyncStatus({ connectivity: "online", state: "syncing" });

  try {
    const deviceId = getDeviceId();
    const eligible = await collectEligibleOperations(options.force ?? false);

    for (const batch of chunk(eligible, BATCH_SIZE)) {
      await pushBatch(deviceId, batch);
    }

    await purgeSynced();
    await pullAndMerge();

    setSyncStatus({
      connectivity: "online",
      state: "idle",
      lastSyncedAt: await getLastSyncedAt(),
      lastError: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error de sincronización.";
    setSyncStatus({
      state: "idle",
      lastError: message,
      connectivity: isNetworkError(error) ? "offline" : "online",
    });
  } finally {
    isRunning = false;
  }
}

export { countPending };

const PERIODIC_SYNC_INTERVAL_MS = 60_000;

/**
 * Conecta los disparadores automáticos de sincronización (§7/§8 del plan):
 * al abrir la app, al recuperar conexión, y periódicamente mientras haya
 * conexión y la pestaña esté activa. El botón "Sincronizar ahora" llama a
 * runSync({ force: true }) directamente, sin pasar por aquí.
 *
 * Devuelve una función de limpieza para quitar los listeners/intervalo
 * (uso típico: dentro de un useEffect de un componente cliente raíz).
 */
export function startSyncEngine(): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleOnline = () => {
    setSyncStatus({ connectivity: "online" });
    void runSync();
  };
  const handleOffline = () => {
    setSyncStatus({ connectivity: "offline" });
  };

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  // Sincronización inicial al abrir la app (si hay conexión; si no,
  // runSync se limita a actualizar el indicador y no hace nada más).
  void runSync();

  const intervalId = window.setInterval(() => {
    void runSync();
  }, PERIODIC_SYNC_INTERVAL_MS);

  return () => {
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
    window.clearInterval(intervalId);
  };
}
