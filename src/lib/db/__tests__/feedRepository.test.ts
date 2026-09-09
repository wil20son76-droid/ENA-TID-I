import { beforeEach, describe, expect, it } from "vitest";

import { createFeed, getFeedStockKg } from "../repositories/feedRepository";
import { db } from "../schema";

describe("feedRepository.createFeed", () => {
  beforeEach(async () => {
    await db.feeds.clear();
    await db.feedInventoryMovements.clear();
    await db.syncQueue.clear();
  });

  it("crea el alimento sin stock inicial: stock queda en 0", async () => {
    const feed = await createFeed({ name: "Balanceado Inicial 38%" });
    expect(await getFeedStockKg(feed.id)).toBe(0);

    const queue = await db.syncQueue.toArray();
    expect(queue).toHaveLength(1);
    expect(queue[0].entityType).toBe("Feed");
  });

  it("crea el alimento y su stock inicial juntos, en una transacción, como un único comando de negocio (§7, Fase 3.5 §9)", async () => {
    const feed = await createFeed({ name: "Crecimiento 32%", initialStockKg: 500 });

    expect(await getFeedStockKg(feed.id)).toBe(500);

    const movements = await db.feedInventoryMovements.where("feedId").equals(feed.id).toArray();
    expect(movements).toHaveLength(1);
    expect(movements[0].movementType).toBe("INITIAL_STOCK");
    expect(movements[0].quantityKg).toBe(500);

    // Con stock inicial, se encola UN solo comando de negocio
    // (CreateFeedWithInitialStock), no dos operaciones independientes —
    // así el servidor nunca puede aplicar el Feed sin su stock inicial.
    const queue = await db.syncQueue.toArray();
    expect(queue).toHaveLength(1);
    expect(queue[0].entityType).toBe("CreateFeedWithInitialStock");
  });

  it("stock inicial de 0 o no indicado no crea ningún movimiento", async () => {
    const feed = await createFeed({ name: "Engorde 28%", initialStockKg: 0 });
    const movements = await db.feedInventoryMovements.where("feedId").equals(feed.id).toArray();
    expect(movements).toHaveLength(0);
  });
});
