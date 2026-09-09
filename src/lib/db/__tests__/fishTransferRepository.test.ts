import { beforeEach, describe, expect, it } from "vitest";

import { createSpecies } from "../repositories/speciesRepository";
import { createPond } from "../repositories/pondRepository";
import { createFishBatchWithStocking } from "../repositories/fishBatchRepository";
import {
  createFishTransfer,
  getAvailableInPond,
} from "../repositories/fishTransferRepository";
import { getBatchDistribution } from "../repositories/ledgerQueries";
import { db } from "../schema";

describe("fishTransferRepository", () => {
  let speciesId: string;
  let e01: string;
  let e02: string;
  let e03: string;
  let batchId: string;

  beforeEach(async () => {
    await db.species.clear();
    await db.ponds.clear();
    await db.fishBatches.clear();
    await db.stockings.clear();
    await db.fishTransfers.clear();
    await db.syncQueue.clear();

    const species = await createSpecies({ commonName: "Pacú" });
    speciesId = species.id;
    e01 = (await createPond({ code: "E01", name: "Norte" })).id;
    e02 = (await createPond({ code: "E02", name: "Sur" })).id;
    e03 = (await createPond({ code: "E03", name: "Este" })).id;

    const { batch } = await createFishBatchWithStocking({
      speciesId,
      pondId: e01,
      initialStockingDate: "2026-09-10T00:00:00.000Z",
      initialQuantity: 1000,
      initialAverageWeightG: 15,
    });
    batchId = batch.id;
  });

  it("traslado total: E01 queda en 0 y E02 recibe todo", async () => {
    await createFishTransfer({
      batchId,
      fromPondId: e01,
      toPondId: e02,
      date: "2026-11-20T00:00:00.000Z",
      quantity: 1000,
    });

    expect(await getAvailableInPond(batchId, e01)).toBe(0);
    expect(await getAvailableInPond(batchId, e02)).toBe(1000);
  });

  it("traslado parcial: 400 de 1000 se van a E02, quedan 600 en E01", async () => {
    await createFishTransfer({
      batchId,
      fromPondId: e01,
      toPondId: e02,
      date: "2026-11-20T00:00:00.000Z",
      quantity: 400,
    });

    expect(await getAvailableInPond(batchId, e01)).toBe(600);
    expect(await getAvailableInPond(batchId, e02)).toBe(400);
  });

  it("segundo traslado: el lote queda repartido entre E01, E02 y E03", async () => {
    await createFishTransfer({
      batchId,
      fromPondId: e01,
      toPondId: e02,
      date: "2026-11-20T00:00:00.000Z",
      quantity: 400,
    });
    await createFishTransfer({
      batchId,
      fromPondId: e01,
      toPondId: e03,
      date: "2026-11-21T00:00:00.000Z",
      quantity: 200,
    });

    const distribution = await getBatchDistribution(batchId);
    expect(distribution).toEqual({ [e01]: 400, [e02]: 400, [e03]: 200 });
  });

  it("traslado inválido: no se puede sacar más de lo disponible", async () => {
    await createFishTransfer({
      batchId,
      fromPondId: e01,
      toPondId: e02,
      date: "2026-11-20T00:00:00.000Z",
      quantity: 400,
    }); // quedan 600 en E01

    await expect(
      createFishTransfer({
        batchId,
        fromPondId: e01,
        toPondId: e03,
        date: "2026-11-21T00:00:00.000Z",
        quantity: 700,
      }),
    ).rejects.toThrow(/No hay suficientes peces/);

    // El intento fallido no debe haber alterado nada.
    expect(await getAvailableInPond(batchId, e01)).toBe(600);
    const transfers = await db.fishTransfers.toArray();
    expect(transfers).toHaveLength(1);
  });

  it("no permite trasladar al mismo estanque de origen", async () => {
    await expect(
      createFishTransfer({
        batchId,
        fromPondId: e01,
        toPondId: e01,
        date: "2026-11-20T00:00:00.000Z",
        quantity: 100,
      }),
    ).rejects.toThrow(/no pueden ser el mismo/);
  });

  it("no permite cantidades negativas o cero", async () => {
    await expect(
      createFishTransfer({
        batchId,
        fromPondId: e01,
        toPondId: e02,
        date: "2026-11-20T00:00:00.000Z",
        quantity: 0,
      }),
    ).rejects.toThrow(/mayor que cero/);
  });
});
