import { describe, expect, it } from "vitest";

import { formatG, formatKg, formatPercent, gramsToKg, kgToGrams, roundTo } from "../format";

describe("format", () => {
  it("roundTo: corrige el error visible de floating point", () => {
    expect(roundTo(295.799999999, 1)).toBe(295.8);
  });

  it("formatKg: 295.8 kg en locale es", () => {
    expect(formatKg(295.799999999)).toBe("295,8 kg");
  });

  it("formatG: sin decimales", () => {
    expect(formatG(510.4)).toBe("510 g");
  });

  it("formatPercent: 97,0 %", () => {
    expect(formatPercent(97)).toBe("97,0 %");
  });

  it("gramsToKg / kgToGrams: conversión centralizada", () => {
    expect(gramsToKg(15300)).toBe(15.3);
    expect(kgToGrams(15.3)).toBeCloseTo(15300, 5);
  });
});
