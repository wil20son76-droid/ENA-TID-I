import { describe, expect, it } from "vitest";

import {
  getBatchDistribution,
  getBatchHarvestedFishTotal,
  getBatchHarvestedWeightKgTotal,
  getBatchMortalityTotal,
  getBatchPondBalance,
  getBatchStockedTotal,
  getBatchTotalBalance,
  getMortalityPercent,
  getPondOccupancy,
  getSurvivalPercent,
} from "../batchLedger";

const BATCH = "batch-1";
const E01 = "pond-e01";
const E02 = "pond-e02";
const E03 = "pond-e03";

describe("batchLedger", () => {
  it("traslado total: todo el lote se mueve de un estanque a otro", () => {
    const stockings = [{ batchId: BATCH, pondId: E01, quantity: 1000 }];
    const transfers = [{ batchId: BATCH, fromPondId: E01, toPondId: E02, quantity: 1000 }];

    expect(getBatchPondBalance(stockings, transfers, [], [], BATCH, E01)).toBe(0);
    expect(getBatchPondBalance(stockings, transfers, [], [], BATCH, E02)).toBe(1000);
    expect(getBatchTotalBalance(stockings, transfers, [], [], BATCH)).toBe(1000);
  });

  it("traslado parcial: el lote queda repartido entre dos estanques", () => {
    const stockings = [{ batchId: BATCH, pondId: E01, quantity: 1000 }];
    const transfers = [{ batchId: BATCH, fromPondId: E01, toPondId: E02, quantity: 400 }];

    expect(getBatchPondBalance(stockings, transfers, [], [], BATCH, E01)).toBe(600);
    expect(getBatchPondBalance(stockings, transfers, [], [], BATCH, E02)).toBe(400);
    expect(getBatchDistribution(stockings, transfers, [], [], BATCH)).toEqual({
      [E01]: 600,
      [E02]: 400,
    });
    expect(getBatchTotalBalance(stockings, transfers, [], [], BATCH)).toBe(1000);
  });

  it("segundo traslado: el lote queda repartido entre tres estanques", () => {
    const stockings = [{ batchId: BATCH, pondId: E01, quantity: 1000 }];
    const transfers = [
      { batchId: BATCH, fromPondId: E01, toPondId: E02, quantity: 400 },
      { batchId: BATCH, fromPondId: E01, toPondId: E03, quantity: 200 },
    ];

    expect(getBatchDistribution(stockings, transfers, [], [], BATCH)).toEqual({
      [E01]: 400,
      [E02]: 400,
      [E03]: 200,
    });
    expect(getBatchTotalBalance(stockings, transfers, [], [], BATCH)).toBe(1000);
  });

  it("el total del lote nunca cambia por traslados, solo por siembras/mortalidad/cosecha", () => {
    const stockings = [
      { batchId: BATCH, pondId: E01, quantity: 600 },
      { batchId: BATCH, pondId: E02, quantity: 400 },
    ];
    const transfers = [{ batchId: BATCH, fromPondId: E01, toPondId: E03, quantity: 100 }];

    expect(getBatchTotalBalance(stockings, transfers, [], [], BATCH)).toBe(1000);
  });

  it("getPondOccupancy: un estanque puede alojar varios lotes", () => {
    const stockings = [
      { batchId: "batch-pacu", pondId: E01, quantity: 600 },
      { batchId: "batch-tilapia", pondId: E01, quantity: 500 },
    ];

    expect(getPondOccupancy(stockings, [], [], [], E01)).toEqual({
      "batch-pacu": 600,
      "batch-tilapia": 500,
    });
  });

  it("un estanque que quedó en 0 no aparece en la distribución ni en la ocupación", () => {
    const stockings = [{ batchId: BATCH, pondId: E01, quantity: 1000 }];
    const transfers = [{ batchId: BATCH, fromPondId: E01, toPondId: E02, quantity: 1000 }];

    expect(getBatchDistribution(stockings, transfers, [], [], BATCH)).toEqual({ [E02]: 1000 });
    expect(getPondOccupancy(stockings, transfers, [], [], E01)).toEqual({});
  });

  // --- Fase 3: mortalidad integrada en el ledger (§17-§19, §50-§51) ---

  it("mortalidad: reduce el balance del estanque exacto donde ocurrió", () => {
    const stockings = [{ batchId: BATCH, pondId: E01, quantity: 1000 }];
    const mortalities = [{ batchId: BATCH, pondId: E01, quantity: 30 }];

    expect(getBatchPondBalance(stockings, [], mortalities, [], BATCH, E01)).toBe(970);
    expect(getBatchTotalBalance(stockings, [], mortalities, [], BATCH)).toBe(970);
  });

  it("mortalidad repetida no se acumula dos veces por el mismo evento (idempotencia la garantiza el repositorio, aquí solo se suma lo que llega)", () => {
    const stockings = [{ batchId: BATCH, pondId: E01, quantity: 1000 }];
    const mortalities = [
      { batchId: BATCH, pondId: E01, quantity: 30 },
      { batchId: BATCH, pondId: E01, quantity: 20 },
    ];

    expect(getBatchTotalBalance(stockings, [], mortalities, [], BATCH)).toBe(950);
  });

  it("mortalidad distribuida: cada estanque descuenta solo su propia mortalidad", () => {
    const stockings = [{ batchId: BATCH, pondId: E01, quantity: 1000 }];
    const transfers = [{ batchId: BATCH, fromPondId: E01, toPondId: E02, quantity: 400 }];
    const mortalities = [
      { batchId: BATCH, pondId: E01, quantity: 20 },
      { batchId: BATCH, pondId: E02, quantity: 10 },
    ];

    expect(getBatchDistribution(stockings, transfers, mortalities, [], BATCH)).toEqual({
      [E01]: 580,
      [E02]: 390,
    });
    expect(getBatchTotalBalance(stockings, transfers, mortalities, [], BATCH)).toBe(970);
  });

  it("getBatchStockedTotal/getBatchMortalityTotal: totales históricos independientes de traslados", () => {
    const stockings = [{ batchId: BATCH, pondId: E01, quantity: 1000 }];
    const mortalities = [
      { batchId: BATCH, pondId: E01, quantity: 20 },
      { batchId: BATCH, pondId: E02, quantity: 10 },
    ];

    expect(getBatchStockedTotal(stockings, BATCH)).toBe(1000);
    expect(getBatchMortalityTotal(mortalities, BATCH)).toBe(30);
  });

  it("supervivencia y mortalidad %: 970/1000 -> 97% supervivencia", () => {
    expect(getSurvivalPercent(970, 1000)).toBe(97);
    expect(getMortalityPercent(30, 1000)).toBe(3);
  });

  it("supervivencia/mortalidad %: nunca divide por cero", () => {
    expect(getSurvivalPercent(0, 0)).toBeNull();
    expect(getMortalityPercent(0, 0)).toBeNull();
  });

  // --- Fase 5: cosecha integrada en el ledger (§20-§26, §34 del encargo) ---

  it("cosecha parcial: PAC-001 E01 600 -> cosecha 200 -> E01: 400 (§24)", () => {
    const stockings = [{ batchId: BATCH, pondId: E01, quantity: 600 }];
    const harvests = [{ batchId: BATCH, pondId: E01, quantityFish: 200 }];

    expect(getBatchPondBalance(stockings, [], [], harvests, BATCH, E01)).toBe(400);
    expect(getBatchTotalBalance(stockings, [], [], harvests, BATCH)).toBe(400);
  });

  it("cosecha: reduce el balance del estanque exacto donde ocurrió, nunca el de otro", () => {
    const stockings = [
      { batchId: BATCH, pondId: E01, quantity: 500 },
      { batchId: BATCH, pondId: E02, quantity: 500 },
    ];
    const harvests = [{ batchId: BATCH, pondId: E01, quantityFish: 200 }];

    expect(getBatchDistribution(stockings, [], [], harvests, BATCH)).toEqual({
      [E01]: 300,
      [E02]: 500,
    });
  });

  it("cosecha total: deja el balance del lote en cero", () => {
    const stockings = [{ batchId: BATCH, pondId: E01, quantity: 1000 }];
    const harvests = [{ batchId: BATCH, pondId: E01, quantityFish: 1000 }];

    expect(getBatchTotalBalance(stockings, [], [], harvests, BATCH)).toBe(0);
    expect(getBatchDistribution(stockings, [], [], harvests, BATCH)).toEqual({});
  });

  it("un lote cosechado del todo desaparece de la ocupación del estanque", () => {
    const stockings = [{ batchId: BATCH, pondId: E01, quantity: 500 }];
    const harvests = [{ batchId: BATCH, pondId: E01, quantityFish: 500 }];

    expect(getPondOccupancy(stockings, [], [], harvests, E01)).toEqual({});
  });

  it("supervivencia NUNCA se calcula sobre el balance reducido por cosecha (§19/§34/§41): una cosecha no es una pérdida", () => {
    // 1000 sembrados, 0 muertos, 400 cosechados -> quedan 600 vivos, pero
    // la supervivencia debe seguir siendo 100%, nunca 60%.
    const stockedTotal = 1000;
    const mortalityTotal = 0;
    expect(getSurvivalPercent(stockedTotal - mortalityTotal, stockedTotal)).toBe(100);
  });

  it("getBatchHarvestedFishTotal/getBatchHarvestedWeightKgTotal: totales históricos acumulados de todas las cosechas", () => {
    const harvests = [
      { batchId: BATCH, quantityFish: 200, totalWeightKg: 300 },
      { batchId: BATCH, quantityFish: 150, totalWeightKg: 240 },
      { batchId: "otro-lote", quantityFish: 999, totalWeightKg: 999 },
    ];

    expect(getBatchHarvestedFishTotal(harvests, BATCH)).toBe(350);
    expect(getBatchHarvestedWeightKgTotal(harvests, BATCH)).toBe(540);
  });
});
