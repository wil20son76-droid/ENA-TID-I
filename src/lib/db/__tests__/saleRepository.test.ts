import { beforeEach, describe, expect, it } from "vitest";

import { createSpecies } from "../repositories/speciesRepository";
import { createPond } from "../repositories/pondRepository";
import { createFishBatchWithStocking } from "../repositories/fishBatchRepository";
import { createHarvest } from "../repositories/harvestRepository";
import {
  getAvailableKgForHarvest,
  registerSale,
  updateSalePaymentStatus,
} from "../repositories/saleRepository";
import { db } from "../schema";

describe("saleRepository", () => {
  let e01: string;
  let batchId: string;

  beforeEach(async () => {
    await db.species.clear();
    await db.ponds.clear();
    await db.fishBatches.clear();
    await db.stockings.clear();
    await db.harvests.clear();
    await db.sales.clear();
    await db.saleLines.clear();
    await db.syncQueue.clear();

    const speciesId = (await createSpecies({ commonName: "Pacú" })).id;
    e01 = (await createPond({ code: "E01", name: "Norte" })).id;
    const { batch } = await createFishBatchWithStocking({
      speciesId,
      pondId: e01,
      initialStockingDate: "2026-09-10T00:00:00.000Z",
      initialQuantity: 1000,
      initialAverageWeightG: 500,
    });
    batchId = batch.id;
  });

  it("§65: 200kg x 32 Bs/kg -> 6400 Bs", async () => {
    const { sale, lines } = await registerSale({
      date: "2026-11-20T00:00:00.000Z",
      lines: [{ batchId, description: "Venta", weightKg: 200, pricePerKg: 32 }],
    });

    expect(sale.totalAmount).toBe(6400);
    expect(lines[0].totalAmount).toBe(6400);
    expect(sale.paymentStatus).toBe("PENDING");
  });

  it("§29-§30: vender contra una cosecha reduce los kg disponibles de esa cosecha", async () => {
    const harvest = await createHarvest({
      batchId,
      pondId: e01,
      date: "2026-11-20T00:00:00.000Z",
      quantityFish: 200,
      totalWeightKg: 300,
      harvestType: "PARTIAL",
    });

    expect(await getAvailableKgForHarvest(harvest.id)).toBe(300);

    await registerSale({
      date: "2026-11-21T00:00:00.000Z",
      lines: [{ batchId, harvestId: harvest.id, description: "Venta", weightKg: 200, pricePerKg: 32 }],
    });

    expect(await getAvailableKgForHarvest(harvest.id)).toBe(100);
  });

  it("§31: rechaza vender más kg de los disponibles de una cosecha", async () => {
    const harvest = await createHarvest({
      batchId,
      pondId: e01,
      date: "2026-11-20T00:00:00.000Z",
      quantityFish: 200,
      totalWeightKg: 300,
      harvestType: "PARTIAL",
    });

    await registerSale({
      date: "2026-11-21T00:00:00.000Z",
      lines: [{ batchId, harvestId: harvest.id, description: "Venta 1", weightKg: 200, pricePerKg: 32 }],
    });

    await expect(
      registerSale({
        date: "2026-11-22T00:00:00.000Z",
        lines: [{ batchId, harvestId: harvest.id, description: "Venta 2", weightKg: 150, pricePerKg: 32 }],
      }),
    ).rejects.toThrow(/No hay suficiente peso disponible/);

    expect(await db.sales.count()).toBe(1);
    expect(await getAvailableKgForHarvest(harvest.id)).toBe(100);
  });

  it("una venta sin cosecha asociada es una venta externa: no valida ningún balance de cosecha", async () => {
    const { sale } = await registerSale({
      date: "2026-11-20T00:00:00.000Z",
      lines: [{ batchId, description: "Venta externa", weightKg: 50, pricePerKg: 30 }],
    });
    expect(sale.totalAmount).toBe(1500);
  });

  it("rechaza una venta sin líneas", async () => {
    await expect(registerSale({ date: "2026-11-20T00:00:00.000Z", lines: [] })).rejects.toThrow(
      /al menos una línea/,
    );
  });

  it("updateSalePaymentStatus: registra pago parcial (§59)", async () => {
    const { sale } = await registerSale({
      date: "2026-11-20T00:00:00.000Z",
      lines: [{ batchId, description: "Venta", weightKg: 100, pricePerKg: 30 }],
    });

    const updated = await updateSalePaymentStatus(sale.id, "PARTIAL", 600);
    expect(updated.paymentStatus).toBe("PARTIAL");
    expect(updated.amountPaid).toBe(600);
    expect(updated.totalAmount - updated.amountPaid).toBe(2400);
  });
});
