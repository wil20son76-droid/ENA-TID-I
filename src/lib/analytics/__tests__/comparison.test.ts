import { describe, expect, it } from "vitest";

import { buildBatchComparison, buildSpeciesComparison } from "../comparison";
import { buildProductionReport, type EconomicsReportRow } from "../reports";

const SPECIES_A = "species-pacu";

function economicsRow(overrides: Partial<EconomicsReportRow>): EconomicsReportRow {
  return {
    batchId: "b-1",
    batchCode: "LOTE-A",
    speciesId: SPECIES_A,
    speciesName: "Pacú",
    fryCost: 0,
    feedCost: 0,
    directExpensesTotal: 0,
    directCostTotal: 0,
    harvestedFishTotal: 0,
    harvestedWeightKgTotal: 0,
    incomeTotal: 0,
    costPerKg: null,
    costPerFish: null,
    profit: 0,
    marginPercent: null,
    isProvisional: false,
    ...overrides,
  };
}

describe("comparison", () => {
  it("buildBatchComparison une producción + economía por batchId, sin omitir lotes sin economía", () => {
    const production = buildProductionReport({
      batches: [
        { id: "b-1", code: "LOTE-A", speciesId: SPECIES_A, initialAverageWeightG: 15 },
        { id: "b-2", code: "LOTE-B", speciesId: SPECIES_A, initialAverageWeightG: 15 },
      ],
      species: [{ id: SPECIES_A, commonName: "Pacú" }],
      stockings: [
        { batchId: "b-1", pondId: "p-1", quantity: 1000 },
        { batchId: "b-2", pondId: "p-1", quantity: 500 },
      ],
      transfers: [],
      mortalities: [],
      harvests: [],
      samplings: [],
      filters: {},
    });

    const economics = [economicsRow({ batchId: "b-1", incomeTotal: 1000, profit: 200, marginPercent: 20 })];
    const rows = buildBatchComparison(production.rows, economics);

    expect(rows).toHaveLength(2);
    const b2 = rows.find((r) => r.batchId === "b-2");
    expect(b2?.incomeTotal).toBe(0);
    expect(b2?.marginPercent).toBeNull();
  });

  it("buildSpeciesComparison agrega supervivencia/costo-kg/margen por razón de sumas, no promedio", () => {
    const production = buildProductionReport({
      batches: [
        { id: "b-1", code: "LOTE-A", speciesId: SPECIES_A, initialAverageWeightG: 15 },
        { id: "b-2", code: "LOTE-B", speciesId: SPECIES_A, initialAverageWeightG: 15 },
      ],
      species: [{ id: SPECIES_A, commonName: "Pacú" }],
      stockings: [
        { batchId: "b-1", pondId: "p-1", quantity: 1000 },
        { batchId: "b-2", pondId: "p-1", quantity: 100 },
      ],
      transfers: [],
      mortalities: [
        { batchId: "b-1", pondId: "p-1", quantity: 100, date: "2026-01-01T00:00:00.000Z" },
        { batchId: "b-2", pondId: "p-1", quantity: 50, date: "2026-01-01T00:00:00.000Z" },
      ],
      harvests: [],
      samplings: [],
      filters: {},
    });

    const economics = [
      economicsRow({ batchId: "b-1", directCostTotal: 24500, harvestedWeightKgTotal: 1200, incomeTotal: 38400, profit: 13900 }),
      economicsRow({ batchId: "b-2", directCostTotal: 5000, harvestedWeightKgTotal: 100, incomeTotal: 4000, profit: -1000 }),
    ];

    const rows = buildSpeciesComparison(production.rows, economics);
    expect(rows).toHaveLength(1);
    expect(rows[0].batchCount).toBe(2);
    expect(rows[0].survivalPercent).toBeCloseTo(86.36, 2); // mismo ejemplo obligatorio del encargo
    expect(rows[0].costPerKg).toBeCloseTo(29500 / 1300, 5);
    expect(rows[0].marginPercent).toBeCloseTo((12900 / 42400) * 100, 5);
  });
});
