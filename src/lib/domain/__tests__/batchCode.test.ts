import { describe, expect, it } from "vitest";

import { generateBatchCode } from "../batchCode";

describe("generateBatchCode", () => {
  it("genera el prefijo esperado por especie", () => {
    expect(
      generateBatchCode({
        speciesCommonName: "Pacú",
        year: 2026,
        localSequence: 1,
        deviceId: "550e8400-e29b-41d4-a716-446655440000",
      }),
    ).toBe("PAC-2026-001-0000");

    expect(
      generateBatchCode({
        speciesCommonName: "Tambaquí",
        year: 2026,
        localSequence: 1,
        deviceId: "550e8400-e29b-41d4-a716-446655440000",
      }).startsWith("TAM-2026-001-"),
    ).toBe(true);

    expect(
      generateBatchCode({
        speciesCommonName: "Tilapia",
        year: 2026,
        localSequence: 1,
        deviceId: "550e8400-e29b-41d4-a716-446655440000",
      }).startsWith("TIL-2026-001-"),
    ).toBe(true);
  });

  it("la secuencia local queda visible y con 3 dígitos", () => {
    const code = generateBatchCode({
      speciesCommonName: "Pacú",
      year: 2026,
      localSequence: 2,
      deviceId: "abc",
    });
    expect(code).toMatch(/^PAC-2026-002-/);
  });

  it("dos dispositivos distintos con la misma especie/año/secuencia NO colisionan", () => {
    const codeA = generateBatchCode({
      speciesCommonName: "Pacú",
      year: 2026,
      localSequence: 1,
      deviceId: "11111111-1111-1111-1111-111111111111",
    });
    const codeB = generateBatchCode({
      speciesCommonName: "Pacú",
      year: 2026,
      localSequence: 1,
      deviceId: "22222222-2222-2222-2222-222222222222",
    });

    expect(codeA).not.toBe(codeB);
  });

  it("el mismo dispositivo genera el mismo código para los mismos parámetros (determinista)", () => {
    const input = {
      speciesCommonName: "Pacú",
      year: 2026,
      localSequence: 3,
      deviceId: "device-xyz",
    };
    expect(generateBatchCode(input)).toBe(generateBatchCode(input));
  });
});
