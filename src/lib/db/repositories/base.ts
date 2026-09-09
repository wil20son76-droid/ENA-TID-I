// Capa de acceso a datos común para toda entidad sincronizable.
//
// Regla de oro (IMPLEMENTATION_PLAN.md §5.1 y §6.2): guardar el registro de
// dominio y encolar su operación de sincronización ocurre en UNA sola
// transacción local. Si el navegador se cierra a mitad de camino, Dexie
// garantiza que la transacción se aplicó entera o no se aplicó, así que
// nunca queda un registro "guardado" sin su entrada de outbox (lo que
// dejaría ese cambio sin sincronizar para siempre) ni una entrada de
// outbox "huérfana" sin el dato real.
import type { EntityTable, IDType } from "dexie";

import { db } from "../schema";
import type { AuditFields, SyncEntityType, SyncOperationType } from "../types";
import { getDeviceId } from "../deviceId";
import { generateId } from "../uuid";

type Creatable<T extends AuditFields & { id: string }> = Omit<
  T,
  keyof AuditFields | "id"
>;

type Updatable<T extends AuditFields & { id: string }> = Partial<
  Omit<T, keyof AuditFields | "id">
>;

async function enqueueSyncOperation(
  entityType: SyncEntityType,
  entityId: string,
  operation: SyncOperationType,
  payload: unknown,
  deviceId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db.syncQueue.add({
    id: generateId(),
    entityType,
    entityId,
    operation,
    payload,
    createdAt: now,
    updatedAt: now,
    retryCount: 0,
    status: "pending",
    lastError: null,
    deviceId,
  });
}

/** Crea una entidad nueva y encola su operación CREATE, en una transacción. */
export async function createRecord<T extends AuditFields & { id: string }>(
  table: EntityTable<T, "id">,
  entityType: SyncEntityType,
  input: Creatable<T>,
): Promise<T> {
  const deviceId = getDeviceId();
  const now = new Date().toISOString();
  const record = {
    ...input,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1,
    deviceId,
    createdBy: null,
    updatedBy: null,
  } as T;

  await db.transaction("rw", table, db.syncQueue, async () => {
    await table.add(record);
    await enqueueSyncOperation(entityType, record.id, "CREATE", record, deviceId);
  });

  return record;
}

/** Actualiza una entidad existente y encola su operación UPDATE. */
export async function updateRecord<T extends AuditFields & { id: string }>(
  table: EntityTable<T, "id">,
  entityType: SyncEntityType,
  id: string,
  patch: Updatable<T>,
): Promise<T> {
  const deviceId = getDeviceId();
  let updated: T | undefined;

  await db.transaction("rw", table, db.syncQueue, async () => {
    const current = await table.get(id as IDType<T, "id">);
    if (!current) {
      throw new Error(`No existe ${entityType} con id ${id}`);
    }

    updated = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
      version: current.version + 1,
      deviceId,
    };

    await table.put(updated);
    await enqueueSyncOperation(entityType, id, "UPDATE", updated, deviceId);
  });

  // El bloque de la transacción anterior siempre asigna `updated` o lanza;
  // TypeScript no puede verlo, así que se afirma de forma explícita.
  return updated as T;
}

/** Marca una entidad como eliminada (soft-delete) y encola su operación DELETE. */
export async function softDeleteRecord<T extends AuditFields & { id: string }>(
  table: EntityTable<T, "id">,
  entityType: SyncEntityType,
  id: string,
): Promise<void> {
  const deviceId = getDeviceId();

  await db.transaction("rw", table, db.syncQueue, async () => {
    const current = await table.get(id as IDType<T, "id">);
    if (!current) {
      throw new Error(`No existe ${entityType} con id ${id}`);
    }

    const now = new Date().toISOString();
    const updated: T = {
      ...current,
      deletedAt: now,
      updatedAt: now,
      version: current.version + 1,
      deviceId,
    };

    await table.put(updated);
    await enqueueSyncOperation(entityType, id, "DELETE", updated, deviceId);
  });
}
