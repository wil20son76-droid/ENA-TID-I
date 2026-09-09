import { describe, expect, it } from "vitest";

import { calculateGrowth } from "../growth";

describe("growth", () => {
  it("350g -> 510g en 20 días: ganancia 160g, 8 g/día", () => {
    const result = calculateGrowth(350, "2026-08-01", 510, "2026-08-21");
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.gainG).toBe(160);
      expect(result.days).toBe(20);
      expect(result.dailyGrowthG).toBe(8);
    }
  });

  it("fechas iguales: datos insuficientes", () => {
    const result = calculateGrowth(350, "2026-08-01", 510, "2026-08-01");
    expect(result.available).toBe(false);
  });

  it("fecha actual anterior a la previa: datos insuficientes", () => {
    const result = calculateGrowth(510, "2026-08-21", 350, "2026-08-01");
    expect(result.available).toBe(false);
  });
});
