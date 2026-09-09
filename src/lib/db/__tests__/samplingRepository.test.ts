import { beforeEach, describe, expect, it } from "vitest";

import { createSpecies } from "../repositories/speciesRepository";
import { createPond } from "../repositories/pondRepository";
import { createFishBatchWithStocking } from "../repositories/fishBatchRepository";
import { createSampling } from "../repositories/samplingRepository";
import { db } from "../schema";

describe("samplingRepository.createSampling", () => {
  let batchId: string;
  let e01: string;
  let e02: string;

  beforeEach(async () => {
    await db.species.clear();
    await db.ponds.clear();
    await db.fishBatches.clear();
    await db.stockings.clear();
    await db.fishTransfers.clear();
    await db.samplings.clear();
    await db.syncQueue.clear();

    const species = await createSpecies({ commonName: "Pacú" });
    e01 = (await createPond({ code: "E01", name: "Norte" })).id;
    e02 = (await createPond({ code: "E02", name: "Sur" })).id;
    const { batch } = await createFishBatchWithStocking({
      speciesId: species.id,
      pondId: e01,
      initialStockingDate: "2026-09-10T00:00:00.000Z",
      initialQuantity: 1000,
      initialAverageWeightG: 15,
    });
    batchId = batch.id;
    await db.syncQueue.clear();
  });

  it("30 peces, 15.3kg -> 510 g/pez calculado automáticamente (§21/§52)", async () => {
    const sampling = await createSampling({
      batchId,
      pondId: e01,
      date: "2026-09-11T00:00:00.000Z",
      sampleFishCount: 30,
      totalSampleWeightKg: 15.3,
    });
    expect(sampling.averageWeightG).toBe(510);
  });

  it("rechaza sampleFishCount <= 0", async () => {
    await expect(
      createSampling({
        batchId,
        pondId: e01,
        date: "2026-09-11T00:00:00.000Z",
        sampleFishCount: 0,
        totalSampleWeightKg: 15.3,
      }),
    ).rejects.toThrow(/mayor que cero/);
  });

  it("rechaza totalSampleWeightKg <= 0", async () => {
    await expect(
      createSampling({
        batchId,
        pondId: e01,
        date: "2026-09-11T00:00:00.000Z",
        sampleFishCount: 30,
        totalSampleWeightKg: 0,
      }),
    ).rejects.toThrow(/mayor que cero/);
  });

  it("rechaza un estanque donde el lote nunca estuvo registrado (§22)", async () => {
    await expect(
      createSampling({
        batchId,
        pondId: e02,
        date: "2026-09-11T00:00:00.000Z",
        sampleFishCount: 30,
        totalSampleWeightKg: 15.3,
      }),
    ).rejects.toThrow(/no tiene registro/);
  });
});
