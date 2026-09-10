import { describe, expect, it } from "vitest";

import { getBatchProductionSummary } from "../productionSummary";

const BATCH = "batch-1";
const E01 = "pond-e01";
const E02 = "pond-e02";

describe("productionSummary", () => {
  it("biomasa por estanque: 580 peces x 510g -> 295.8 kg", () => {
    const stockings = [{ batchId: BATCH, pondId: E01, quantity: 1000 }];
    const transfers = [{ batchId: BATCH, fromPondId: E01, toPondId: E02, quantity: 400 }];
    const mortalities = [
      { batchId: BATCH, pondId: E01, quantity: 20 },
      { batchId: BATCH, pondId: E02, quantity: 10 },
    ];
    const samplings = [
      { batchId: BATCH, pondId: E01, date: "2026-09-01", averageWeightG: 510 },
      { batchId: BATCH, pondId: E02, date: "2026-09-01", averageWeightG: 530 },
    ];

    const summary = getBatchProductionSummary(
      stockings,
      transfers,
      mortalities,
      [],
      samplings,
      BATCH,
      15,
    );

    expect(summary.totalQuantity).toBe(970);
    expect(summary.stockedTotal).toBe(1000);
    expect(summary.mortalityTotal).toBe(30);
    expect(summary.harvestedFishTotal).toBe(0);
    expect(summary.harvestedWeightKgTotal).toBe(0);
    expect(summary.survivalPercent).toBe(97);
    expect(summary.mortalityPercent).toBe(3);

    const e01 = summary.perPond.find((p) => p.pondId === E01);
    expect(e01?.quantity).toBe(580);
    expect(e01?.biomassKg).toBeCloseTo(295.8, 5);

    const e02 = summary.perPond.find((p) => p.pondId === E02);
    expect(e02?.quantity).toBe(390);
    expect(e02?.biomassKg).toBeCloseTo(390 * 530 / 1000, 5);

    // Biomasa total = suma de componentes por estanque, no cantidad total x un único peso.
    expect(summary.totalBiomassKg).toBeCloseTo((e01?.biomassKg ?? 0) + (e02?.biomassKg ?? 0), 5);
  });

  it("sin peces en ningún estanque: averageWeightG null, biomasa 0", () => {
    const stockings = [{ batchId: BATCH, pondId: E01, quantity: 1000 }];
    const transfers: never[] = [];
    const mortalities = [{ batchId: BATCH, pondId: E01, quantity: 1000 }];
    const summary = getBatchProductionSummary(stockings, transfers, mortalities, [], [], BATCH, 15);

    expect(summary.totalQuantity).toBe(0);
    expect(summary.totalBiomassKg).toBe(0);
    expect(summary.averageWeightG).toBeNull();
    expect(summary.perPond).toHaveLength(0);
  });

  it("cosecha reduce totalQuantity/biomasa pero NUNCA la supervivencia (§19/§34/§41 de Fase 5)", () => {
    const stockings = [{ batchId: BATCH, pondId: E01, quantity: 1000 }];
    const harvests = [{ batchId: BATCH, pondId: E01, quantityFish: 400, totalWeightKg: 600 }];
    const summary = getBatchProductionSummary(stockings, [], [], harvests, [], BATCH, 15);

    expect(summary.totalQuantity).toBe(600);
    expect(summary.harvestedFishTotal).toBe(400);
    expect(summary.harvestedWeightKgTotal).toBe(600);
    // Nada murió: la supervivencia debe seguir siendo 100%, nunca 60%.
    expect(summary.survivalPercent).toBe(100);
  });
});
