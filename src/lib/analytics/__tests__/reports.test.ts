import { describe, expect, it } from "vitest";

import {
  buildEconomicsReport,
  buildHarvestReport,
  buildMortalityReport,
  buildProductionReport,
  buildSalesReport,
  type EconomicsReportRow,
} from "../reports";

const SPECIES_A = "species-pacu";
const SPECIES_B = "species-tilapia";

describe("reports: producción", () => {
  it("§ejemplo obligatorio: supervivencia agregada de dos lotes = 86,36%, nunca el promedio de los % (70%)", () => {
    const batches = [
      { id: "batch-a", code: "LOTE-A", speciesId: SPECIES_A, initialAverageWeightG: 15 },
      { id: "batch-b", code: "LOTE-B", speciesId: SPECIES_A, initialAverageWeightG: 15 },
    ];
    const stockings = [
      { batchId: "batch-a", pondId: "pond-1", quantity: 1000 },
      { batchId: "batch-b", pondId: "pond-1", quantity: 100 },
    ];
    const mortalities = [
      { batchId: "batch-a", pondId: "pond-1", quantity: 100, date: "2026-01-05T00:00:00.000Z" },
      { batchId: "batch-b", pondId: "pond-1", quantity: 50, date: "2026-01-05T00:00:00.000Z" },
    ];

    const report = buildProductionReport({
      batches,
      species: [{ id: SPECIES_A, commonName: "Pacú" }],
      stockings,
      transfers: [],
      mortalities,
      harvests: [],
      samplings: [],
      filters: {},
    });

    expect(report.totals.survivalPercent).toBeCloseTo(86.36, 2);
    expect(report.totals.survivalPercent).not.toBeCloseTo(70, 0);
    expect(report.rows.find((r) => r.batchId === "batch-a")?.survivalPercent).toBeCloseTo(90, 5);
    expect(report.rows.find((r) => r.batchId === "batch-b")?.survivalPercent).toBeCloseTo(50, 5);
  });

  it("la cosecha nunca reduce la supervivencia (§19/§34 de Fase 5, verificado también en analítica)", () => {
    const batches = [{ id: "batch-a", code: "LOTE-A", speciesId: SPECIES_A, initialAverageWeightG: 500 }];
    const report = buildProductionReport({
      batches,
      species: [{ id: SPECIES_A, commonName: "Pacú" }],
      stockings: [{ batchId: "batch-a", pondId: "pond-1", quantity: 1000 }],
      transfers: [],
      mortalities: [],
      harvests: [
        {
          batchId: "batch-a",
          pondId: "pond-1",
          quantityFish: 400,
          totalWeightKg: 600,
          date: "2026-02-01T00:00:00.000Z",
        },
      ],
      samplings: [],
      filters: {},
    });

    expect(report.rows[0].currentLiving).toBe(600); // 1000 - 400 cosechados
    expect(report.rows[0].survivalPercent).toBe(100); // nadie murió
  });

  it("filtros: por especie excluye lotes de otra especie", () => {
    const batches = [
      { id: "batch-a", code: "LOTE-A", speciesId: SPECIES_A, initialAverageWeightG: 15 },
      { id: "batch-b", code: "LOTE-B", speciesId: SPECIES_B, initialAverageWeightG: 15 },
    ];
    const report = buildProductionReport({
      batches,
      species: [
        { id: SPECIES_A, commonName: "Pacú" },
        { id: SPECIES_B, commonName: "Tilapia" },
      ],
      stockings: [
        { batchId: "batch-a", pondId: "pond-1", quantity: 500 },
        { batchId: "batch-b", pondId: "pond-1", quantity: 500 },
      ],
      transfers: [],
      mortalities: [],
      harvests: [],
      samplings: [],
      filters: { speciesId: SPECIES_A },
    });

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].batchId).toBe("batch-a");
  });

  it("filtros: por rango de fecha limita la mortalidad/cosecha DEL PERÍODO, no el estado acumulado", () => {
    const batches = [{ id: "batch-a", code: "LOTE-A", speciesId: SPECIES_A, initialAverageWeightG: 15 }];
    const report = buildProductionReport({
      batches,
      species: [{ id: SPECIES_A, commonName: "Pacú" }],
      stockings: [{ batchId: "batch-a", pondId: "pond-1", quantity: 1000 }],
      transfers: [],
      mortalities: [
        { batchId: "batch-a", pondId: "pond-1", quantity: 30, date: "2026-01-05T00:00:00.000Z" },
        { batchId: "batch-a", pondId: "pond-1", quantity: 20, date: "2026-03-05T00:00:00.000Z" },
      ],
      harvests: [],
      samplings: [],
      filters: { dateFrom: "2026-03-01", dateTo: "2026-03-31" },
    });

    expect(report.rows[0].mortalityInPeriod).toBe(20); // solo la de marzo
    expect(report.rows[0].mortalityTotal).toBe(50); // acumulado histórico, sin cortar
    expect(report.rows[0].currentLiving).toBe(950); // estado actual, no depende del filtro de fecha
  });
});

describe("reports: mortalidad", () => {
  it("agrupa por causa y por mes", () => {
    const report = buildMortalityReport({
      mortalities: [
        { batchId: "b-1", pondId: "p-1", date: "2026-01-10T00:00:00.000Z", quantity: 10, cause: "LOW_OXYGEN" },
        { batchId: "b-1", pondId: "p-1", date: "2026-01-20T00:00:00.000Z", quantity: 5, cause: "LOW_OXYGEN" },
        { batchId: "b-1", pondId: "p-1", date: "2026-02-01T00:00:00.000Z", quantity: 3, cause: "DISEASE" },
      ],
      batches: [{ id: "b-1", code: "LOTE-A", speciesId: SPECIES_A, initialAverageWeightG: 15 }],
      filters: {},
    });

    expect(report.totalInPeriod).toBe(18);
    expect(report.byCause[0]).toEqual({ cause: "LOW_OXYGEN", quantity: 15 });
    expect(report.byMonth).toEqual([
      { month: "2026-01", value: 15 },
      { month: "2026-02", value: 3 },
    ]);
  });
});

describe("reports: cosechas", () => {
  it("peso promedio ponderado por peces cosechados, nunca el promedio simple de los averageWeightG", () => {
    const report = buildHarvestReport({
      harvests: [
        { batchId: "b-1", pondId: "p-1", date: "2026-01-01T00:00:00.000Z", quantityFish: 100, totalWeightKg: 100, averageWeightG: 1000 },
        { batchId: "b-1", pondId: "p-1", date: "2026-01-02T00:00:00.000Z", quantityFish: 900, totalWeightKg: 1800, averageWeightG: 2000 },
      ],
      batches: [{ id: "b-1", code: "LOTE-A", speciesId: SPECIES_A, initialAverageWeightG: 15 }],
      species: [{ id: SPECIES_A, commonName: "Pacú" }],
      filters: {},
    });

    // (100*1000 + 900*2000) / 1000 = 1900, no (1000+2000)/2=1500
    expect(report.averageWeightG).toBeCloseTo(1900, 5);
    expect(report.totalFishInPeriod).toBe(1000);
    expect(report.totalWeightKgInPeriod).toBe(1900);
  });
});

describe("reports: ventas", () => {
  it("ejemplo obligatorio: precio medio ponderado 29 Bs/kg (100kg×20 + 900kg×30), nunca 25", () => {
    const report = buildSalesReport({
      sales: [
        { id: "sale-1", customerId: null, date: "2026-01-10T00:00:00.000Z", totalAmount: 2000, amountPaid: 0, paymentStatus: "PENDING" },
        { id: "sale-2", customerId: null, date: "2026-01-11T00:00:00.000Z", totalAmount: 27000, amountPaid: 27000, paymentStatus: "PAID" },
      ],
      saleLines: [
        { saleId: "sale-1", batchId: "b-1", weightKg: 100, pricePerKg: 20, totalAmount: 2000 },
        { saleId: "sale-2", batchId: "b-1", weightKg: 900, pricePerKg: 30, totalAmount: 27000 },
      ],
      customers: [],
      batches: [{ id: "b-1", code: "LOTE-A", speciesId: SPECIES_A, initialAverageWeightG: 15 }],
      filters: {},
    });

    expect(report.averagePricePerKg).toBe(29);
    expect(report.totalKgInPeriod).toBe(1000);
    expect(report.totalRevenueInPeriod).toBe(29000);
    expect(report.pendingPaymentsTotal).toBe(2000);
  });
});

describe("reports: economía agregada", () => {
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

  it("ingresos/ganancia/margen/costo-por-kg agregados como razón de sumas, nunca promedio de los márgenes por lote", () => {
    const rows = [
      economicsRow({
        batchId: "b-1",
        directCostTotal: 24500,
        harvestedWeightKgTotal: 1200,
        incomeTotal: 38400,
        profit: 13900,
        marginPercent: 36.2,
      }),
      economicsRow({
        batchId: "b-2",
        directCostTotal: 5000,
        harvestedWeightKgTotal: 100,
        incomeTotal: 4000,
        profit: -1000,
        marginPercent: -25,
      }),
    ];

    const report = buildEconomicsReport(rows);

    expect(report.totals.incomeTotal).toBe(42400);
    expect(report.totals.directCostTotal).toBe(29500);
    expect(report.totals.profit).toBe(12900);
    // Margen agregado correcto: 12900/42400*100, NUNCA el promedio de 36.2 y -25.
    expect(report.totals.marginPercent).toBeCloseTo((12900 / 42400) * 100, 5);
    expect(report.totals.marginPercent).not.toBeCloseTo((36.2 + -25) / 2, 1);
    // Costo/kg agregado correcto: 29500/1300, no el promedio de los costo/kg individuales.
    expect(report.totals.costPerKg).toBeCloseTo(29500 / 1300, 5);
  });

  it("§40 del encargo de Fase 5 verificado también en el agregado de un solo lote", () => {
    const rows = [
      economicsRow({
        directCostTotal: 24500,
        harvestedWeightKgTotal: 1200,
        incomeTotal: 38400,
        profit: 13900,
      }),
    ];
    const report = buildEconomicsReport(rows);
    expect(report.totals.costPerKg).toBeCloseTo(20.42, 2);
    expect(report.totals.marginPercent).toBeCloseTo(36.2, 1);
  });

  it("sin ingresos, el margen agregado es null (nunca división por cero)", () => {
    const report = buildEconomicsReport([economicsRow({ incomeTotal: 0, profit: -500 })]);
    expect(report.totals.marginPercent).toBeNull();
  });
});
