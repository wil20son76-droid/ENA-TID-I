import { getFeedStock } from "../../domain/feedLedger";
import { getDeviceId } from "../deviceId";
import { db } from "../schema";
import type { FeedFields, FeedRecord } from "../types";
import { generateId } from "../uuid";
import { enqueueSyncOperation, softDeleteRecord, updateRecord } from "./base";

const ENTITY_TYPE = "Feed" as const;
const CREATE_WITH_STOCK_ENTITY_TYPE = "CreateFeedWithInitialStock" as const;

/** Alimentos activos (no eliminados), ordenados por nombre. */
export async function listActiveFeeds(): Promise<FeedRecord[]> {
  const all = await db.feeds.toArray();
  return all
    .filter((f) => f.active && !f.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export async function getFeedById(id: string): Promise<FeedRecord | undefined> {
  return db.feeds.get(id);
}

export interface CreateFeedInput {
  name: string;
  brand?: string | null;
  proteinPercent?: number | null;
  pelletSizeMm?: number | null;
  bagWeightKg?: number | null;
  defaultBagPrice?: number | null;
  defaultCostPerKg?: number | null;
  recommendedStage?: string | null;
  notes?: string | null;
  minimumStockKg?: number | null;
  /** Stock inicial opcional (§7): crea Feed + FeedInventoryMovement INITIAL_STOCK juntos. */
  initialStockKg?: number | null;
}

/**
 * Crea un alimento y, si se indica, su movimiento de stock inicial, en
 * una única transacción local. Desde la Fase 3.5 (§9 del encargo), con
 * stock inicial se encola UNA sola operación de negocio
 * (`CreateFeedWithInitialStock`) en vez de dos independientes — mismo
 * criterio que `createFeedingWithConsumption`: el servidor no debe poder
 * terminar con el Feed creado pero el stock inicial perdido. Sin stock
 * inicial (0 o no informado), sigue siendo un `Feed` CREATE simple — no
 * hay nada compuesto que proteger.
 */
export async function createFeed(input: CreateFeedInput): Promise<FeedRecord> {
  const deviceId = getDeviceId();
  const now = new Date().toISOString();

  const feed: FeedRecord = {
    id: generateId(),
    name: input.name,
    brand: input.brand ?? null,
    proteinPercent: input.proteinPercent ?? null,
    pelletSizeMm: input.pelletSizeMm ?? null,
    bagWeightKg: input.bagWeightKg ?? null,
    defaultBagPrice: input.defaultBagPrice ?? null,
    defaultCostPerKg: input.defaultCostPerKg ?? null,
    recommendedStage: input.recommendedStage ?? null,
    notes: input.notes ?? null,
    minimumStockKg: input.minimumStockKg ?? null,
    active: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1,
    deviceId,
    createdBy: null,
    updatedBy: null,
  };

  const hasInitialStock = input.initialStockKg != null && input.initialStockKg > 0;

  if (!hasInitialStock) {
    await db.transaction("rw", db.feeds, db.syncQueue, async () => {
      await db.feeds.add(feed);
      await enqueueSyncOperation(ENTITY_TYPE, feed.id, "CREATE", feed, deviceId);
    });
    return feed;
  }

  const movementId = generateId();
  const movement = {
    id: movementId,
    feedId: feed.id,
    movementType: "INITIAL_STOCK" as const,
    quantityKg: input.initialStockKg as number,
    unitCostPerKg: null,
    totalCost: null,
    date: now,
    sourceType: null,
    sourceId: null,
    notes: null,
    deviceId,
    createdAt: now,
    deletedAt: null,
  };

  const createWithStockPayload = {
    id: feed.id,
    name: feed.name,
    brand: feed.brand,
    proteinPercent: feed.proteinPercent,
    pelletSizeMm: feed.pelletSizeMm,
    bagWeightKg: feed.bagWeightKg,
    defaultBagPrice: feed.defaultBagPrice,
    defaultCostPerKg: feed.defaultCostPerKg,
    recommendedStage: feed.recommendedStage,
    notes: feed.notes,
    minimumStockKg: feed.minimumStockKg,
    active: feed.active,
    createdAt: feed.createdAt,
    updatedAt: feed.updatedAt,
    deletedAt: feed.deletedAt,
    version: feed.version,
    deviceId: feed.deviceId,
    createdBy: feed.createdBy,
    updatedBy: feed.updatedBy,
    initialStockMovementId: movementId,
    initialStockKg: input.initialStockKg as number,
    initialStockDate: now,
  };

  await db.transaction(
    "rw",
    db.feeds,
    db.feedInventoryMovements,
    db.syncQueue,
    async () => {
      await db.feeds.add(feed);
      await db.feedInventoryMovements.add(movement);
      await enqueueSyncOperation(
        CREATE_WITH_STOCK_ENTITY_TYPE,
        feed.id,
        "CREATE",
        createWithStockPayload,
        deviceId,
      );
    },
  );

  return feed;
}

export async function updateFeed(id: string, patch: Partial<FeedFields>): Promise<FeedRecord> {
  return updateRecord<FeedRecord>(db.feeds, ENTITY_TYPE, id, patch);
}

export async function deactivateFeed(id: string): Promise<FeedRecord> {
  return updateRecord<FeedRecord>(db.feeds, ENTITY_TYPE, id, { active: false });
}

export async function deleteFeed(id: string): Promise<void> {
  return softDeleteRecord<FeedRecord>(db.feeds, ENTITY_TYPE, id);
}

/** Stock actual de un alimento, calculado localmente desde el ledger (§6). */
export async function getFeedStockKg(feedId: string): Promise<number> {
  const movements = await db.feedInventoryMovements.where("feedId").equals(feedId).toArray();
  return getFeedStock(movements, feedId);
}
