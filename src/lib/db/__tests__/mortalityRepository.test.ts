import { beforeEach, describe, expect, it } from "vitest";

import { createSpecies } from "../repositories/speciesRepository";
import { createPond } from "../repositories/pondRepository";
import { createFishBatchWithStocking } from "../repositories/fishBatchRepository";
import { createFishTransfer } from "../repositories/fishTransferRepository";
import { createMortality, getAvailableForMortality } from "../repositories/mortalityRepository";
import { db } from "../schema";

describe("mortalityRepository.createMortality", () => {
  let batchId: string;
  let e01: string;
  let e02: string;

  beforeEach(async () => {
    await db.species.clear();
    await db.ponds.clear();
    await db.fishBatches.clear();
    await db.stockings.clear();
    await db.fishTransfers.clear();
    await db.mortalityRecords.clear();
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

  it("1000 iniciales, mortalidad 30 -> 970, mortalidad 20 -> 950 (§50)", async () => {
    await createMortality({
      batchId,
      pondId: e01,
      date: "2026-09-11T00:00:00.000Z",
      quantity: 30,
      cause: "UNKNOWN",
    });
    expect(await getAvailableForMortality(batchId, e01)).toBe(970);

    await createMortality({
      batchId,
      pondId: e01,
      date: "2026-09-12T00:00:00.000Z",
      quantity: 20,
      cause: "DISEASE",
    });
    expect(await getAvailableForMortality(batchId, e01)).toBe(950);
  });

  it("no permite registrar más mortalidad que peces disponibles (§16)", async () => {
    await expect(
      createMortality({
        batchId,
        pondId: e01,
        date: "2026-09-11T00:00:00.000Z",
        quantity: 1001,
        cause: "UNKNOWN",
      }),
    ).rejects.toThrow(/no se puede registrar más mortalidad/i);

    expect(await db.mortalityRecords.count()).toBe(0);
  });

  it("mortalidad distribuida: E01=600/E02=400 tras traslado, mortalidad 20/10 -> 580/390 (§51)", async () => {
    await createFishTransfer({
      batchId,
      fromPondId: e01,
      toPondId: e02,
      date: "2026-09-11T00:00:00.000Z",
      quantity: 400,
    });

    await createMortality({
      batchId,
      pondId: e01,
      date: "2026-09-12T00:00:00.000Z",
      quantity: 20,
      cause: "LOW_OXYGEN",
    });
    await createMortality({
      batchId,
      pondId: e02,
      date: "2026-09-12T00:00:00.000Z",
      quantity: 10,
      cause: "LOW_OXYGEN",
    });

    expect(await getAvailableForMortality(batchId, e01)).toBe(580);
    expect(await getAvailableForMortality(batchId, e02)).toBe(390);
  });

  it("rechaza cantidades <= 0", async () => {
    await expect(
      createMortality({
        batchId,
        pondId: e01,
        date: "2026-09-11T00:00:00.000Z",
        quantity: 0,
        cause: "UNKNOWN",
      }),
    ).rejects.toThrow(/mayor que cero/);
  });
});
