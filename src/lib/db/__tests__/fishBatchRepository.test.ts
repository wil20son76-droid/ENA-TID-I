import { beforeEach, describe, expect, it } from "vitest";

import { createSpecies } from "../repositories/speciesRepository";
import { createPond } from "../repositories/pondRepository";
import { createFishBatchWithStocking } from "../repositories/fishBatchRepository";
import { db } from "../schema";

describe("fishBatchRepository.createFishBatchWithStocking", () => {
  beforeEach(async () => {
    await db.species.clear();
    await db.ponds.clear();
    await db.fishBatches.clear();
    await db.stockings.clear();
    await db.syncQueue.clear();
  });

  it("crea el lote y la siembra juntos, con biomasa y código calculados", async () => {
    const species = await createSpecies({ commonName: "Pacú" });
    const pond = await createPond({ code: "E01", name: "Estanque Norte" });
    await db.syncQueue.clear(); // aísla el aserto de outbox de las creaciones previas

    const { batch, stocking } = await createFishBatchWithStocking({
      speciesId: species.id,
      pondId: pond.id,
      initialStockingDate: "2026-09-10T00:00:00.000Z",
      initialQuantity: 1000,
      initialAverageWeightG: 15,
    });

    expect(batch.initialBiomassKg).toBe(15);
    expect(batch.status).toBe("STOCKED");
    expect(batch.code).toMatch(/^PAC-2026-001-/);

    expect(stocking.batchId).toBe(batch.id);
    expect(stocking.pondId).toBe(pond.id);
    expect(stocking.quantity).toBe(1000);
    expect(stocking.biomassKg).toBe(15);

    const storedBatch = await db.fishBatches.get(batch.id);
    const storedStocking = await db.stockings.get(stocking.id);
    expect(storedBatch).toBeDefined();
    expect(storedStocking).toBeDefined();

    const queue = await db.syncQueue.toArray();
    expect(queue).toHaveLength(2);
    expect(queue.map((q) => q.entityType).sort()).toEqual(["FishBatch", "Stocking"]);
  });

  it("la secuencia local del código de lote avanza por especie y año", async () => {
    const species = await createSpecies({ commonName: "Pacú" });
    const pond = await createPond({ code: "E01", name: "Estanque Norte" });

    const first = await createFishBatchWithStocking({
      speciesId: species.id,
      pondId: pond.id,
      initialStockingDate: "2026-01-10T00:00:00.000Z",
      initialQuantity: 500,
      initialAverageWeightG: 10,
    });
    const second = await createFishBatchWithStocking({
      speciesId: species.id,
      pondId: pond.id,
      initialStockingDate: "2026-02-10T00:00:00.000Z",
      initialQuantity: 600,
      initialAverageWeightG: 10,
    });

    expect(first.batch.code).toMatch(/^PAC-2026-001-/);
    expect(second.batch.code).toMatch(/^PAC-2026-002-/);
  });

  it("rechaza cantidades o pesos iniciales inválidos", async () => {
    const species = await createSpecies({ commonName: "Pacú" });
    const pond = await createPond({ code: "E01", name: "Estanque Norte" });

    await expect(
      createFishBatchWithStocking({
        speciesId: species.id,
        pondId: pond.id,
        initialStockingDate: "2026-09-10T00:00:00.000Z",
        initialQuantity: 0,
        initialAverageWeightG: 15,
      }),
    ).rejects.toThrow(/mayor que cero/);

    await expect(
      createFishBatchWithStocking({
        speciesId: species.id,
        pondId: pond.id,
        initialStockingDate: "2026-09-10T00:00:00.000Z",
        initialQuantity: 1000,
        initialAverageWeightG: 0,
      }),
    ).rejects.toThrow(/mayor que cero/);
  });
});
