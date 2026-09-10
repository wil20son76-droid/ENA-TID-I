import { describe, expect, it } from "vitest";

import {
  aggregateSurvivalPercent,
  percentOfSums,
  ratioOfSums,
  sumBy,
  weightedAverage,
  weightedAveragePrice,
} from "../weightedStats";

describe("weightedStats", () => {
  it("ejemplo obligatorio del encargo — supervivencia agregada: 950/1100 = 86,36%, nunca 70%", () => {
    const batches = [
      { stocked: 1000, living: 900 },
      { stocked: 100, living: 50 },
    ];
    const result = aggregateSurvivalPercent(batches, (b) => b.living, (b) => b.stocked);
    expect(result).toBeCloseTo(86.36, 2);

    const wrongSimpleAverage = ((900 / 1000) * 100 + (50 / 100) * 100) / 2;
    expect(wrongSimpleAverage).toBe(70);
    expect(result).not.toBeCloseTo(70, 0);
  });

  it("ejemplo obligatorio del encargo — precio medio ponderado: 29 Bs/kg, nunca 25 Bs/kg", () => {
    const lines = [
      { quantity: 100, price: 20 },
      { quantity: 900, price: 30 },
    ];
    const result = weightedAveragePrice(lines, (l) => l.quantity, (l) => l.price);
    expect(result).toBe(29);

    const wrongSimpleAverage = (20 + 30) / 2;
    expect(wrongSimpleAverage).toBe(25);
    expect(result).not.toBe(25);
  });

  it("ratioOfSums: null cuando el denominador total es cero (nunca división por cero)", () => {
    const empty: { a: number; b: number }[] = [];
    expect(ratioOfSums(empty, (x) => x.a, (x) => x.b)).toBeNull();
    expect(ratioOfSums([{ a: 5, b: 0 }], (x) => x.a, (x) => x.b)).toBeNull();
  });

  it("percentOfSums: expresa ratioOfSums como porcentaje", () => {
    const items = [{ num: 3, den: 4 }];
    expect(percentOfSums(items, (i) => i.num, (i) => i.den)).toBe(75);
  });

  it("sumBy: suma simple de un selector", () => {
    expect(sumBy([{ v: 1 }, { v: 2 }, { v: 3 }], (i) => i.v)).toBe(6);
  });

  it("weightedAverage: promedio ponderado genérico (peso estimado por lote repartido)", () => {
    // 600 peces a 500g + 400 peces a 600g -> promedio ponderado 540g, no 550g.
    const ponds = [
      { weightG: 500, quantity: 600 },
      { weightG: 600, quantity: 400 },
    ];
    const result = weightedAverage(ponds, (p) => p.weightG, (p) => p.quantity);
    expect(result).toBeCloseTo(540, 5);
    expect(result).not.toBeCloseTo(550, 5);
  });

  it("weightedAveragePrice: null sin cantidad total (nunca Infinity/NaN)", () => {
    const empty: { quantity: number; price: number }[] = [];
    expect(weightedAveragePrice(empty, (l) => l.quantity, (l) => l.price)).toBeNull();
  });
});
