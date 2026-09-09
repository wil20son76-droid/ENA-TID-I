import { getFeedStock } from "../../domain/feedLedger";
import { getDeviceId } from "../deviceId";
import { db } from "../schema";
import type { FeedingRecordFields, FeedingRecordRecord } from "../types";
import { generateId } from "../uuid";
import { enqueueSyncOperation } from "./base";

const FEEDING_ENTITY_TYPE = "FeedingRecord" as const;
const MOVEMENT_ENTITY_TYPE = "FeedInventoryMovement" as const;

/** Fuente de un movimiento de inventario generado por un registro de alimentación (§9). */
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
 * CONSUMPTION vinculado, en una única transacción local (§9 del encargo
 * de Fase 3 — mismo patrón que createFishBatchWithStocking). Valida el
 * stock disponible ANTES de escribir (§10); el servidor vuelve a
 * validarlo al sincronizar, igual que con los traslados de peces
 * (§59: nunca confiar solo en el cliente).
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

  const feeding: FeedingRecordRecord = {
    id: generateId(),
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

  const movementId = generateId();
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

  await db.transaction(
    "rw",
    db.feedingRecords,
    db.feedInventoryMovements,
    db.syncQueue,
    async () => {
      await db.feedingRecords.add(feeding);
      await db.feedInventoryMovements.add(movement);
      await enqueueSyncOperation(FEEDING_ENTITY_TYPE, feeding.id, "CREATE", feeding, deviceId);
      await enqueueSyncOperation(
        MOVEMENT_ENTITY_TYPE,
        movement.id,
        "CREATE",
        movement,
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
