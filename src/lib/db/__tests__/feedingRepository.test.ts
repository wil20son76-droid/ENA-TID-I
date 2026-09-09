import { beforeEach, describe, expect, it } from "vitest";

import { createSpecies } from "../repositories/speciesRepository";
import { createPond } from "../repositories/pondRepository";
import { createFishBatchWithStocking } from "../repositories/fishBatchRepository";
import { createFeed, getFeedStockKg } from "../repositories/feedRepository";
import { createFeedingWithConsumption } from "../repositories/feedingRepository";
import { db } from "../schema";

describe("feedingRepository.createFeedingWithConsumption", () => {
  let batchId: string;
  let pondId: string;
  let feedId: string;

  beforeEach(async () => {
    await db.species.clear();
    await db.ponds.clear();
    await db.fishBatches.clear();
    await db.stockings.clear();
    await db.feeds.clear();
    await db.feedInventoryMovements.clear();
    await db.feedingRecords.clear();
    await db.syncQueue.clear();

    const species = await createSpecies({ commonName: "Pacú" });
    const pond = await createPond({ code: "E01", name: "Norte" });
    const { batch } = await createFishBatchWithStocking({
      speciesId: species.id,
      pondId: pond.id,
      initialStockingDate: "2026-09-10T00:00:00.000Z",
      initialQuantity: 1000,
      initialAverageWeightG: 15,
    });
    const feed = await createFeed({ name: "Crecimiento 32%", initialStockKg: 500 });

    batchId = batch.id;
    pondId = pond.id;
    feedId = feed.id;
    await db.syncQueue.clear();
  });

  it("inicial 500, feeding 18 -> 482, feeding 22 -> 460 (§47)", async () => {
    await createFeedingWithConsumption({
      batchId,
      pondId,
      feedId,
      date: "2026-09-11T08:00:00.000Z",
      quantityKg: 18,
    });
    expect(await getFeedStockKg(feedId)).toBe(482);

    await createFeedingWithConsumption({
      batchId,
      pondId,
      feedId,
      date: "2026-09-11T12:00:00.000Z",
      quantityKg: 22,
    });
    expect(await getFeedStockKg(feedId)).toBe(460);
  });

  it("crea FeedingRecord + FeedInventoryMovement CONSUMPTION vinculado en una transacción", async () => {
    const { feeding, movementId } = await createFeedingWithConsumption({
      batchId,
      pondId,
      feedId,
      date: "2026-09-11T08:00:00.000Z",
      quantityKg: 18,
    });

    const movement = await db.feedInventoryMovements.get(movementId);
    expect(movement?.movementType).toBe("CONSUMPTION");
    expect(movement?.quantityKg).toBe(18);
    expect(movement?.sourceType).toBe("FEEDING");
    expect(movement?.sourceId).toBe(feeding.id);

    const queue = await db.syncQueue.toArray();
    expect(queue).toHaveLength(2);
    expect(queue.map((q) => q.entityType).sort()).toEqual([
      "FeedInventoryMovement",
      "FeedingRecord",
    ]);
  });

  it("stock 20kg, intento 25kg -> falla y no crea nada (§48)", async () => {
    // Deja el stock en 20 (500 - 480).
    await createFeedingWithConsumption({
      batchId,
      pondId,
      feedId,
      date: "2026-09-11T08:00:00.000Z",
      quantityKg: 480,
    });
    expect(await getFeedStockKg(feedId)).toBe(20);

    await expect(
      createFeedingWithConsumption({
        batchId,
        pondId,
        feedId,
        date: "2026-09-12T08:00:00.000Z",
        quantityKg: 25,
      }),
    ).rejects.toThrow(/No hay suficiente alimento/);

    expect(await getFeedStockKg(feedId)).toBe(20); // no cambió
    expect(await db.feedingRecords.count()).toBe(1); // no se creó el segundo registro
  });

  it("rechaza cantidades <= 0", async () => {
    await expect(
      createFeedingWithConsumption({
        batchId,
        pondId,
        feedId,
        date: "2026-09-11T08:00:00.000Z",
        quantityKg: 0,
      }),
    ).rejects.toThrow(/mayor que cero/);
  });
});
