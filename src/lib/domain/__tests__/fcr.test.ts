import { describe, expect, it } from "vitest";

import { calculateFcr } from "../fcr";

describe("fcr", () => {
  it("720kg alimento / 500kg incremento de biomasa -> FCR 1.44", () => {
    const result = calculateFcr(720, 500);
    expect(result).not.toBeNull();
    expect(result?.fcr).toBeCloseTo(1.44, 5);
    expect(result?.estimated).toBe(true);
  });

  it("incremento de biomasa cero o negativo: no calculable", () => {
    expect(calculateFcr(720, 0)).toBeNull();
    expect(calculateFcr(720, -50)).toBeNull();
  });

  it("nunca devuelve Infinity ni NaN", () => {
    const result = calculateFcr(0, 500);
    expect(result?.fcr).toBe(0);
    expect(Number.isFinite(result?.fcr)).toBe(true);
  });
});
