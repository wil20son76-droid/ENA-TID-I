import { describe, expect, it } from "vitest";

import {
  calculateDailyRationKg,
  findFeedingRecommendation,
  splitRationPerFeeding,
  type FeedingRecommendationEntry,
} from "../ration";

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

  describe("findFeedingRecommendation", () => {
    const pacuId = "species-pacu";
    const tilapiaId = "species-tilapia";
    const entries: FeedingRecommendationEntry[] = [
      { speciesId: pacuId, minWeightG: 10, maxWeightG: 50, feedPercent: 6, feedingsPerDay: 4, active: true },
      { speciesId: pacuId, minWeightG: 50, maxWeightG: 200, feedPercent: 4, feedingsPerDay: 3, active: true },
      { speciesId: pacuId, minWeightG: 200, maxWeightG: 500, feedPercent: 3, feedingsPerDay: 3, active: true },
      { speciesId: pacuId, minWeightG: 500, maxWeightG: 1000, feedPercent: 2, feedingsPerDay: 2, active: true },
      { speciesId: tilapiaId, minWeightG: 0, maxWeightG: 1000, feedPercent: 5, feedingsPerDay: 3, active: true },
    ];

    it("encuentra el bracket que contiene el peso exacto", () => {
      const match = findFeedingRecommendation(entries, pacuId, 510);
      expect(match).not.toBeNull();
      expect(match?.feedPercent).toBe(2);
      expect(match?.feedingsPerDay).toBe(2);
    });

    it("nunca mezcla especies distintas", () => {
      const match = findFeedingRecommendation(entries, tilapiaId, 510);
      expect(match?.feedPercent).toBe(5);
    });

    it("devuelve null sin ningún bracket aplicable (nunca inventa un porcentaje)", () => {
      expect(findFeedingRecommendation(entries, pacuId, 5000)).toBeNull();
      expect(findFeedingRecommendation(entries, "species-desconocida", 100)).toBeNull();
    });

    it("ignora filas desactivadas", () => {
      const withInactive: FeedingRecommendationEntry[] = [
        { speciesId: pacuId, minWeightG: 0, maxWeightG: 100, feedPercent: 99, feedingsPerDay: 1, active: false },
      ];
      expect(findFeedingRecommendation(withInactive, pacuId, 50)).toBeNull();
    });

    it("con rangos solapados, gana el de minWeightG más alto (más específico)", () => {
      const overlapping: FeedingRecommendationEntry[] = [
        { speciesId: pacuId, minWeightG: 0, maxWeightG: 1000, feedPercent: 10, feedingsPerDay: 1, active: true },
        { speciesId: pacuId, minWeightG: 400, maxWeightG: 600, feedPercent: 2, feedingsPerDay: 2, active: true },
      ];
      const match = findFeedingRecommendation(overlapping, pacuId, 500);
      expect(match?.feedPercent).toBe(2);
    });
  });
});
