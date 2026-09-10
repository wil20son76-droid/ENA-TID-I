import { beforeEach, describe, expect, it } from "vitest";

import { createSpecies } from "../repositories/speciesRepository";
import { createPond } from "../repositories/pondRepository";
import { createFishBatchWithStocking } from "../repositories/fishBatchRepository";
import { createHarvest, getAvailableForHarvest } from "../repositories/harvestRepository";
import { db } from "../schema";

describe("harvestRepository", () => {
  let e01: string;
  let batchId: string;

  beforeEach(async () => {
    await db.species.clear();
    await db.ponds.clear();
    await db.fishBatches.clear();
    await db.stockings.clear();
    await db.harvests.clear();
    await db.syncQueue.clear();

    const speciesId = (await createSpecies({ commonName: "Pacú" })).id;
    e01 = (await createPond({ code: "E01", name: "Norte" })).id;

    const { batch } = await createFishBatchWithStocking({
      speciesId,
      pondId: e01,
      initialStockingDate: "2026-09-10T00:00:00.000Z",
      initialQuantity: 600,
      initialAverageWeightG: 500,
    });
    batchId = batch.id;
  });

  it("§24 cosecha parcial: PAC-001 E01 600 -> cosecha 200 -> E01: 400", async () => {
    await createHarvest({
      batchId,
      pondId: e01,
      date: "2026-11-20T00:00:00.000Z",
      quantityFish: 200,
      totalWeightKg: 300,
      harvestType: "PARTIAL",
    });

    expect(await getAvailableForHarvest(batchId, e01)).toBe(400);
  });

  it("calcula averageWeightG automáticamente (totalWeightKg x 1000 / quantityFish)", async () => {
    const harvest = await createHarvest({
      batchId,
      pondId: e01,
      date: "2026-11-20T00:00:00.000Z",
      quantityFish: 200,
      totalWeightKg: 300,
      harvestType: "PARTIAL",
    });

    expect(harvest.averageWeightG).toBeCloseTo(1500, 5);
  });

  it("§22 rechaza cosechar más peces de los disponibles, sin escribir nada", async () => {
    await expect(
      createHarvest({
        batchId,
        pondId: e01,
        date: "2026-11-20T00:00:00.000Z",
        quantityFish: 700,
        totalWeightKg: 900,
        harvestType: "PARTIAL",
      }),
    ).rejects.toThrow(/No se puede cosechar más peces/);

    expect(await db.harvests.count()).toBe(0);
    expect(await getAvailableForHarvest(batchId, e01)).toBe(600);
  });

  it("cosecha total: deja el balance del estanque en cero", async () => {
    await createHarvest({
      batchId,
      pondId: e01,
      date: "2026-11-20T00:00:00.000Z",
      quantityFish: 600,
      totalWeightKg: 900,
      harvestType: "TOTAL",
    });

    expect(await getAvailableForHarvest(batchId, e01)).toBe(0);
  });

  it("no permite cantidades cero o negativas", async () => {
    await expect(
      createHarvest({
        batchId,
        pondId: e01,
        date: "2026-11-20T00:00:00.000Z",
        quantityFish: 0,
        totalWeightKg: 10,
        harvestType: "PARTIAL",
      }),
    ).rejects.toThrow(/mayor que cero/);
  });
});
