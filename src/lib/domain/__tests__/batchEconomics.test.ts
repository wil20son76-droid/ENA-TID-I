import { describe, expect, it } from "vitest";

import { getBatchEconomics } from "../batchEconomics";

const BATCH = "batch-pac-001";
const FEED = "feed-crecimiento";

describe("batchEconomics", () => {
  it("§40 del encargo de Fase 5 (ejemplo completo): costo directo 24500, costo/kg 20.42, ingresos 38400, ganancia 13900, margen 36.2%", () => {
    const feedMovements = [
      {
        id: "mov-purchase",
        feedId: FEED,
        movementType: "PURCHASE" as const,
        quantityKg: 3000,
        unitCostPerKg: 6,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "mov-consumption",
        feedId: FEED,
        movementType: "CONSUMPTION" as const,
        quantityKg: 3000,
        unitCostPerKg: null,
        createdAt: "2026-02-01T00:00:00.000Z",
      },
    ];

    const economics = getBatchEconomics({
      batchId: BATCH,
      fryCost: 2500,
      feedings: [{ id: "mov-consumption", batchId: BATCH, feedId: FEED }],
      feedMovements,
      directExpenses: [{ batchId: BATCH, totalAmount: 4000 }],
      saleLines: [{ batchId: BATCH, totalAmount: 38400 }],
      harvests: [{ batchId: BATCH, pondId: "pond-1", quantityFish: 400, totalWeightKg: 1200 }],
      isBatchStillActive: false,
    });

    expect(economics.fryCost).toBe(2500);
    expect(economics.feedCost).toBe(18000);
    expect(economics.directExpensesTotal).toBe(4000);
    expect(economics.directCostTotal).toBe(24500);
    expect(economics.harvestedWeightKgTotal).toBe(1200);
    expect(economics.costPerKg).toBeCloseTo(24500 / 1200, 6);
    expect(economics.costPerKg).toBeCloseTo(20.42, 2);
    expect(economics.incomeTotal).toBe(38400);
    expect(economics.profit).toBe(13900);
    expect(economics.marginPercent).toBeCloseTo(36.2, 1);
    expect(economics.isProvisional).toBe(false);
  });

  it("§36: sin producción cosechada, costo/kg es null (nunca Infinity)", () => {
    const economics = getBatchEconomics({
      batchId: BATCH,
      fryCost: 1000,
      feedings: [],
      feedMovements: [],
      directExpenses: [],
      saleLines: [],
      harvests: [],
      isBatchStillActive: true,
    });
    expect(economics.costPerKg).toBeNull();
    expect(economics.costPerFish).toBeNull();
  });

  it("§39: sin ingresos, el margen es null (nunca división por cero)", () => {
    const economics = getBatchEconomics({
      batchId: BATCH,
      fryCost: 500,
      feedings: [],
      feedMovements: [],
      directExpenses: [],
      saleLines: [],
      harvests: [{ batchId: BATCH, pondId: "p1", quantityFish: 100, totalWeightKg: 150 }],
      isBatchStillActive: false,
    });
    expect(economics.incomeTotal).toBe(0);
    expect(economics.marginPercent).toBeNull();
    expect(economics.profit).toBe(-500);
  });

  it("§1/§35: nunca cuenta un gasto general (batchId null) como costo directo del lote", () => {
    const economics = getBatchEconomics({
      batchId: BATCH,
      fryCost: 0,
      feedings: [],
      feedMovements: [],
      directExpenses: [
        { batchId: null, totalAmount: 9999 }, // gasto general de la finca, nunca se distribuye
        { batchId: BATCH, totalAmount: 100 },
        { batchId: "otro-lote", totalAmount: 500 },
      ],
      saleLines: [],
      harvests: [],
      isBatchStillActive: true,
    });
    expect(economics.directExpensesTotal).toBe(100);
    expect(economics.directCostTotal).toBe(100);
  });

  it("§41: un lote todavía activo (con peces vivos) siempre se marca como provisional", () => {
    const economics = getBatchEconomics({
      batchId: BATCH,
      fryCost: 0,
      feedings: [],
      feedMovements: [],
      directExpenses: [],
      saleLines: [],
      harvests: [],
      isBatchStillActive: true,
    });
    expect(economics.isProvisional).toBe(true);
  });
});
