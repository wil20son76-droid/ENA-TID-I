import { describe, expect, it } from "vitest";

import {
  getAllFeedStocks,
  getDaysOfStockRemaining,
  getFeedMovementSignedQuantity,
  getFeedStock,
} from "../feedLedger";

const FEED = "feed-1";

describe("feedLedger", () => {
  it("getFeedMovementSignedQuantity: entradas positivas, salidas negativas", () => {
    expect(getFeedMovementSignedQuantity("INITIAL_STOCK", 500)).toBe(500);
    expect(getFeedMovementSignedQuantity("PURCHASE", 250)).toBe(250);
    expect(getFeedMovementSignedQuantity("RETURN", 10)).toBe(10);
    expect(getFeedMovementSignedQuantity("ADJUSTMENT_IN", 5)).toBe(5);
    expect(getFeedMovementSignedQuantity("CONSUMPTION", 18)).toBe(-18);
    expect(getFeedMovementSignedQuantity("LOSS", 5)).toBe(-5);
    expect(getFeedMovementSignedQuantity("ADJUSTMENT_OUT", 3)).toBe(-3);
  });

  it("getFeedStock: inicial 500, dos consumos -> 460", () => {
    const movements = [
      { feedId: FEED, movementType: "INITIAL_STOCK" as const, quantityKg: 500 },
      { feedId: FEED, movementType: "CONSUMPTION" as const, quantityKg: 18 },
      { feedId: FEED, movementType: "CONSUMPTION" as const, quantityKg: 22 },
    ];
    expect(getFeedStock(movements, FEED)).toBe(460);
  });

  it("getFeedStock: ignora movimientos de otros alimentos", () => {
    const movements = [
      { feedId: FEED, movementType: "INITIAL_STOCK" as const, quantityKg: 500 },
      { feedId: "otro-feed", movementType: "INITIAL_STOCK" as const, quantityKg: 999 },
    ];
    expect(getFeedStock(movements, FEED)).toBe(500);
  });

  it("getAllFeedStocks: un mapa de stock por alimento", () => {
    const movements = [
      { feedId: "a", movementType: "INITIAL_STOCK" as const, quantityKg: 500 },
      { feedId: "a", movementType: "CONSUMPTION" as const, quantityKg: 40 },
      { feedId: "b", movementType: "PURCHASE" as const, quantityKg: 200 },
    ];
    expect(getAllFeedStocks(movements)).toEqual({ a: 460, b: 200 });
  });

  it("getDaysOfStockRemaining: 300kg stock / 30kg día promedio -> 10 días", () => {
    const recent = [
      { date: "2026-09-01", quantityKg: 30 },
      { date: "2026-09-02", quantityKg: 30 },
      { date: "2026-09-03", quantityKg: 30 },
    ];
    expect(getDaysOfStockRemaining(300, recent)).toBe(10);
  });

  it("getDaysOfStockRemaining: sin historial -> null (nunca Infinity/NaN)", () => {
    expect(getDaysOfStockRemaining(300, [])).toBeNull();
  });
});
