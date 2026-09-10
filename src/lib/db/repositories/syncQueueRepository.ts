// Acceso a la cola de sincronización local (outbox) y a los metadatos de
// sincronización (última sincronización, cursor incremental). Lo usa el
// motor de sincronización (src/lib/sync/*), nunca la UI directamente.
import { db } from "../schema";
import type { SyncQueueRecord, SyncQueueStatus } from "../types";

const LAST_SYNCED_AT_KEY = "lastSyncedAt";

export async function listByStatus(
  status: SyncQueueStatus,
): Promise<SyncQueueRecord[]> {
  const items = await db.syncQueue.where("status").equals(status).toArray();
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function countPending(): Promise<number> {
  // "syncing" cuenta como pendiente (Fase 7, §"Hardening de
  // sincronización"): ver la nota junto a `isReadyForRetry` en engine.ts
  // sobre por qué un elemento en "syncing" al INICIO de un ciclo siempre
  // es un abandono de un intento anterior, nunca uno realmente en curso.
  const pending = await db.syncQueue.where("status").equals("pending").count();
  const errored = await db.syncQueue.where("status").equals("error").count();
  const syncing = await db.syncQueue.where("status").equals("syncing").count();
  return pending + errored + syncing;
}

export async function markSyncing(ids: string[]): Promise<void> {
  await db.syncQueue.bulkUpdate(
    ids.map((id) => ({
      key: id,
      changes: { status: "syncing" as const, updatedAt: new Date().toISOString() },
    })),
  );
}

export async function markSynced(ids: string[]): Promise<void> {
  await db.syncQueue.bulkUpdate(
    ids.map((id) => ({
      key: id,
      changes: { status: "synced" as const, updatedAt: new Date().toISOString() },
    })),
  );
}

export async function markError(id: string, message: string): Promise<void> {
  const current = await db.syncQueue.get(id);
  await db.syncQueue.update(id, {
    status: "error",
    lastError: message,
    retryCount: (current?.retryCount ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  });
}

/** Vuelve a poner en "pending" las operaciones en error, para reintentarlas. */
export async function resetErroredToPending(): Promise<number> {
  const errored = await listByStatus("error");
  await db.syncQueue.bulkUpdate(
    errored.map((item) => ({
      key: item.id,
      changes: { status: "pending" as const },
    })),
  );
  return errored.length;
}

/** Elimina de la cola local las operaciones ya confirmadas por el servidor. */
export async function purgeSynced(): Promise<void> {
  await db.syncQueue.where("status").equals("synced").delete();
}

export async function getLastSyncedAt(): Promise<string | null> {
  const meta = await db.syncMeta.get(LAST_SYNCED_AT_KEY);
  return meta?.value ?? null;
}

export async function setLastSyncedAt(isoDate: string): Promise<void> {
  await db.syncMeta.put({ key: LAST_SYNCED_AT_KEY, value: isoDate });
}
