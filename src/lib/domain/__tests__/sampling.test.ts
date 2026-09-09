import { describe, expect, it } from "vitest";

import {
  calculateSampleAverageWeightG,
  getEstimatedWeightForBatch,
  getEstimatedWeightForPond,
} from "../sampling";

const BATCH = "batch-1";
const E01 = "pond-e01";
const E02 = "pond-e02";

describe("sampling", () => {
  it("calculateSampleAverageWeightG: 30 peces, 15.3kg -> 510 g", () => {
    expect(calculateSampleAverageWeightG(30, 15.3)).toBe(510);
  });

  it("calculateSampleAverageWeightG: rechaza cantidad de peces <= 0", () => {
    expect(() => calculateSampleAverageWeightG(0, 15.3)).toThrow();
    expect(() => calculateSampleAverageWeightG(-5, 15.3)).toThrow();
  });

  it("getEstimatedWeightForPond: usa el muestreo más reciente de ese batch+pond", () => {
    const samplings = [
      { batchId: BATCH, pondId: E01, date: "2026-08-01", averageWeightG: 350 },
      { batchId: BATCH, pondId: E01, date: "2026-09-01", averageWeightG: 510 },
      { batchId: BATCH, pondId: E02, date: "2026-09-01", averageWeightG: 999 }, // otro estanque, no debe afectar
    ];
    const estimate = getEstimatedWeightForPond(samplings, BATCH, E01, 15);
    expect(estimate).toEqual({ averageWeightG: 510, source: "SAMPLING", sampleDate: "2026-09-01" });
  });

  it("getEstimatedWeightForPond: sin muestreo, cae al peso inicial de siembra", () => {
    const estimate = getEstimatedWeightForPond([], BATCH, E01, 15);
    expect(estimate).toEqual({ averageWeightG: 15, source: "INITIAL_STOCKING", sampleDate: null });
  });

  it("getEstimatedWeightForPond: un muestreo de E01 no sustituye el de E02", () => {
    const samplings = [{ batchId: BATCH, pondId: E01, date: "2026-09-01", averageWeightG: 510 }];
    const estimateE02 = getEstimatedWeightForPond(samplings, BATCH, E02, 15);
    expect(estimateE02.source).toBe("INITIAL_STOCKING");
    expect(estimateE02.averageWeightG).toBe(15);
  });

  it("getEstimatedWeightForBatch: promedio ponderado por peces presentes", () => {
    const samplings = [
      { batchId: BATCH, pondId: E01, date: "2026-09-01", averageWeightG: 510 },
      { batchId: BATCH, pondId: E02, date: "2026-09-01", averageWeightG: 530 },
    ];
    const distribution = { [E01]: 580, [E02]: 390 };
    const result = getEstimatedWeightForBatch(samplings, distribution, BATCH, 15);
    expect(result).not.toBeNull();
    // (580*510 + 390*530) / 970
    expect(result?.averageWeightG).toBeCloseTo((580 * 510 + 390 * 530) / 970, 5);
    expect(result?.allFromSampling).toBe(true);
  });

  it("getEstimatedWeightForBatch: allFromSampling es false si algún estanque cae al peso inicial", () => {
    const samplings = [{ batchId: BATCH, pondId: E01, date: "2026-09-01", averageWeightG: 510 }];
    const distribution = { [E01]: 580, [E02]: 390 };
    const result = getEstimatedWeightForBatch(samplings, distribution, BATCH, 15);
    expect(result?.allFromSampling).toBe(false);
    expect(result?.perPond[E02].source).toBe("INITIAL_STOCKING");
  });

  it("getEstimatedWeightForBatch: null si el lote no tiene peces en ningún estanque", () => {
    expect(getEstimatedWeightForBatch([], {}, BATCH, 15)).toBeNull();
  });
});
