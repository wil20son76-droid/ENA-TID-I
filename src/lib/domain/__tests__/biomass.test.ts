import { describe, expect, it } from "vitest";

import { calculateBiomassKg } from "../biomass";

describe("calculateBiomassKg", () => {
  it("1.000 peces × 15 g = 15 kg", () => {
    expect(calculateBiomassKg(1000, 15)).toBe(15);
  });

  it("962 peces × 510 g = 490.62 kg", () => {
    expect(calculateBiomassKg(962, 510)).toBeCloseTo(490.62, 2);
  });

  it("0 peces = 0 kg", () => {
    expect(calculateBiomassKg(0, 15)).toBe(0);
  });
});
