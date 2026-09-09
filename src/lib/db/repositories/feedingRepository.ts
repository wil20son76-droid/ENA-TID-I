import { getFeedStock } from "../../domain/feedLedger";
import { getDeviceId } from "../deviceId";
import { db } from "../schema";
import type { FeedingRecordFields, FeedingRecordRecord } from "../types";
import { generateId } from "../uuid";
import { enqueueSyncOperation } from "./base";

const REGISTER_FEEDING_ENTITY_TYPE = "RegisterFeeding" as const;

/** Fuente de un movimiento de inventario generado por un registro de alimentación (§9 de Fase 3). */
const FEEDING_SOURCE_TYPE = "FEEDING";

export interface CreateFeedingInput {
  batchId: string;
  pondId: string;
  feedId: string;
  date: string;
  time?: string | null;
  quantityKg: number;
  shift?: FeedingRecordFields["shift"];
  responsibleName?: string | null;
  notes?: string | null;
}

/**
 * Registra una alimentación: FeedingRecord + FeedInventoryMovement
 * CONSUMPTION vinculado, en una única transacción local — y, desde la
 * Fase 3.5, encolados como UNA sola operación de sync
 * (`RegisterFeeding`), no dos independientes (§2/§5 del encargo de
 * Fase 3.5). "Registrar alimentación" es una sola acción de negocio: el
 * servidor debe terminar con las dos escrituras aplicadas o con
 * ninguna, nunca con una sin la otra — ver
 * `src/app/api/sync/_lib/applyOperation.ts` (applyRegisterFeedingOperation)
 * y `OFFLINE_SYNC.md` §10.
 *
 * Localmente se siguen escribiendo AMBAS tablas (`feedingRecords` y
 * `feedInventoryMovements`) para que la UI offline (stock, historial,
 * dashboard) siga leyendo de sus tablas normales sin cambios — el
 * payload de sync trae todo lo necesario para que el servidor recree
 * las dos escrituras de forma idempotente a partir de una sola entrada
 * de outbox.
 *
 * Valida el stock disponible ANTES de escribir (§10 de Fase 3); el
 * servidor vuelve a validarlo al sincronizar, igual que con los
 * traslados de peces (§59: nunca confiar solo en el cliente).
 */
export async function createFeedingWithConsumption(
  input: CreateFeedingInput,
): Promise<{ feeding: FeedingRecordRecord; movementId: string }> {
  if (input.quantityKg <= 0) {
    throw new Error("La cantidad de alimento debe ser mayor que cero.");
  }

  const movements = await db.feedInventoryMovements.where("feedId").equals(input.feedId).toArray();
  const available = getFeedStock(movements, input.feedId);
  if (input.quantityKg > available) {
    throw new Error(
      `No hay suficiente alimento disponible. Stock actual: ${available.toLocaleString("es")} kg.`,
    );
  }

  const deviceId = getDeviceId();
  const now = new Date().toISOString();
  const feedingId = generateId();
  const movementId = generateId();

  const feeding: FeedingRecordRecord = {
    id: feedingId,
    batchId: input.batchId,
    pondId: input.pondId,
    feedId: input.feedId,
    date: input.date,
    time: input.time ?? null,
    quantityKg: input.quantityKg,
    shift: input.shift ?? null,
    responsibleName: input.responsibleName ?? null,
    notes: input.notes ?? null,
    deviceId,
    createdAt: now,
    deletedAt: null,
  };

  const movement = {
    id: movementId,
    feedId: input.feedId,
    movementType: "CONSUMPTION" as const,
    quantityKg: input.quantityKg,
    unitCostPerKg: null,
    totalCost: null,
    date: input.date,
    sourceType: FEEDING_SOURCE_TYPE,
    sourceId: feeding.id,
    notes: null,
    deviceId,
    createdAt: now,
    deletedAt: null,
  };

  // Payload del comando de negocio: trae todos los campos que el
  // servidor necesita para recrear FeedingRecord + FeedInventoryMovement
  // dentro de su única transacción (ver applyRegisterFeedingOperation).
  const registerFeedingPayload = {
    id: feeding.id,
    movementId,
    batchId: feeding.batchId,
    pondId: feeding.pondId,
    feedId: feeding.feedId,
    date: feeding.date,
    time: feeding.time,
    quantityKg: feeding.quantityKg,
    shift: feeding.shift,
    responsibleName: feeding.responsibleName,
    notes: feeding.notes,
    deviceId: feeding.deviceId,
    createdAt: feeding.createdAt,
    deletedAt: feeding.deletedAt,
  };

  await db.transaction(
    "rw",
    db.feedingRecords,
    db.feedInventoryMovements,
    db.syncQueue,
    async () => {
      await db.feedingRecords.add(feeding);
      await db.feedInventoryMovements.add(movement);
      await enqueueSyncOperation(
        REGISTER_FEEDING_ENTITY_TYPE,
        feeding.id,
        "CREATE",
        registerFeedingPayload,
        deviceId,
      );
    },
  );

  return { feeding, movementId };
}

export async function listFeedingRecords(): Promise<FeedingRecordRecord[]> {
  const all = await db.feedingRecords.toArray();
  return all.filter((f) => !f.deletedAt).sort((a, b) => b.date.localeCompare(a.date));
}
