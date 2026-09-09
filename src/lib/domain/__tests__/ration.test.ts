import { describe, expect, it } from "vitest";

import { calculateDailyRationKg, splitRationPerFeeding } from "../ration";

describe("ration", () => {
  it("calculateDailyRationKg: 500kg biomasa x 3% -> 15 kg/día", () => {
    expect(calculateDailyRationKg(500, 3)).toBe(15);
  });

  it("splitRationPerFeeding: 15kg / 3 raciones -> 5 kg", () => {
    expect(splitRationPerFeeding(15, 3)).toBe(5);
  });

  it("splitRationPerFeeding: rechaza 0 o negativo", () => {
    expect(() => splitRationPerFeeding(15, 0)).toThrow();
    expect(() => splitRationPerFeeding(15, -1)).toThrow();
  });
});
