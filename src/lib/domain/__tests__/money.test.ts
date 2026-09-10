import { describe, expect, it } from "vitest";

import { formatMoney, roundMoney } from "../money";

describe("money", () => {
  it("formatMoney: 1250 -> '1.250,00 Bs'", () => {
    expect(formatMoney(1250)).toBe("1.250,00 Bs");
  });

  it("formatMoney respeta un símbolo de moneda configurable, nunca hardcodeado", () => {
    expect(formatMoney(10, "USD")).toBe("10,00 USD");
  });

  it("roundMoney: nunca deja errores de punto flotante tipo 99.999999", () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(19.999999)).toBe(20);
  });
});
