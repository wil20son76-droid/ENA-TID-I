import { describe, expect, it } from "vitest";

import { calculateFeedInventoryValuation, calculateFeedMovementCosts } from "../feedCost";

const FEED = "feed-1";

function movement(
  id: string,
  movementType: "PURCHASE" | "CONSUMPTION" | "INITIAL_STOCK",
  quantityKg: number,
  unitCostPerKg: number | null,
  createdAt: string,
) {
  return { id, feedId: FEED, movementType, quantityKg, unitCostPerKg, createdAt };
}

describe("feedCost", () => {
  it("§16 del encargo de Fase 5: 100kg x 6 + 100kg x 8 -> stock 200, promedio 7; consumo de 20kg cuesta 140", () => {
    const movements = [
      movement("m1", "PURCHASE", 100, 6, "2026-01-01T00:00:00.000Z"),
      movement("m2", "PURCHASE", 100, 8, "2026-01-02T00:00:00.000Z"),
      movement("m3", "CONSUMPTION", 20, null, "2026-01-03T00:00:00.000Z"),
    ];

    const costs = calculateFeedMovementCosts(movements, FEED);
    const consumptionCost = costs.find((c) => c.id === "m3");
    expect(consumptionCost?.cost).toBe(140);

    const valuation = calculateFeedInventoryValuation(movements, FEED);
    expect(valuation.stockKg).toBe(180);
    // El promedio DESPUÉS del consumo sigue siendo 7: el consumo nunca
    // mueve el promedio, solo lo hacen las compras nuevas.
    expect(valuation.averageCostPerKg).toBeCloseTo(7, 6);
  });

  it("el promedio ponderado antes de cualquier consumo es exactamente (600+800)/200 = 7", () => {
    const movements = [
      movement("m1", "PURCHASE", 100, 6, "2026-01-01T00:00:00.000Z"),
      movement("m2", "PURCHASE", 100, 8, "2026-01-02T00:00:00.000Z"),
    ];
    const valuation = calculateFeedInventoryValuation(movements, FEED);
    expect(valuation.stockKg).toBe(200);
    expect(valuation.totalValue).toBe(1400);
    expect(valuation.averageCostPerKg).toBeCloseTo(7, 6);
  });

  it("un cambio de precio futuro (nueva compra) nunca recalcula retroactivamente el costo de un consumo ya registrado", () => {
    const movements = [
      movement("m1", "PURCHASE", 100, 6, "2026-01-01T00:00:00.000Z"),
      movement("m2", "CONSUMPTION", 10, null, "2026-01-02T00:00:00.000Z"),
      // Compra posterior a precio muy distinto: el costo de m2 (ya
      // calculado arriba con el promedio de ESE momento) nunca cambia.
      movement("m3", "PURCHASE", 100, 20, "2026-01-03T00:00:00.000Z"),
    ];
    const costs = calculateFeedMovementCosts(movements, FEED);
    const m2Cost = costs.find((c) => c.id === "m2")?.cost;
    expect(m2Cost).toBe(60); // 10kg x 6 Bs/kg (el único precio conocido hasta ese momento)
  });

  it("stock sin movimientos: valoración en cero, promedio null (nunca Infinity/NaN)", () => {
    const valuation = calculateFeedInventoryValuation([], FEED);
    expect(valuation.stockKg).toBe(0);
    expect(valuation.averageCostPerKg).toBeNull();
  });

  it("una entrada sin costo conocido (dato legado) suma cantidad pero no valor", () => {
    const movements = [movement("m1", "INITIAL_STOCK", 50, null, "2026-01-01T00:00:00.000Z")];
    const valuation = calculateFeedInventoryValuation(movements, FEED);
    expect(valuation.stockKg).toBe(50);
    expect(valuation.totalValue).toBe(0);
    expect(valuation.averageCostPerKg).toBe(0);
  });

  it("nunca deja el valor total en negativo por errores de redondeo acumulados", () => {
    const movements = [
      movement("m1", "PURCHASE", 33.333, 6, "2026-01-01T00:00:00.000Z"),
      movement("m2", "CONSUMPTION", 33.333, null, "2026-01-02T00:00:00.000Z"),
    ];
    const valuation = calculateFeedInventoryValuation(movements, FEED);
    expect(valuation.totalValue).toBeGreaterThanOrEqual(0);
    expect(valuation.stockKg).toBeCloseTo(0, 6);
  });
});
