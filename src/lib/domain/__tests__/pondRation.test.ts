import { describe, expect, it } from "vitest";

import type { FeedingRecommendationEntry } from "../ration";
import { calculatePondRationSummary, resolvePondRationDisplay } from "../pondRation";

const pacuId = "species-pacu";
const recommendations: FeedingRecommendationEntry[] = [
  { speciesId: pacuId, minWeightG: 200, maxWeightG: 1000, feedPercent: 3, feedingsPerDay: 3, active: true },
];

describe("calculatePondRationSummary", () => {
  it("1. 1.000 peces x 500g -> 500 kg de biomasa", () => {
    const summary = calculatePondRationSummary(
      [{ batchId: "b1", speciesId: pacuId, quantity: 1000, averageWeightG: 500 }],
      recommendations,
    );
    expect(summary.totalFish).toBe(1000);
    expect(summary.totalBiomassKg).toBe(500);
  });

  it("3. con 500kg de biomasa y 3% -> 15 kg/día, la ración calculada del estanque", () => {
    const summary = calculatePondRationSummary(
      [{ batchId: "b1", speciesId: pacuId, quantity: 1000, averageWeightG: 500 }],
      recommendations,
    );
    expect(summary.calculatedDailyRationKg).toBe(15);
    expect(summary.fullyConfigured).toBe(true);
    expect(summary.suggestedFeedingsPerDay).toBe(3);
  });

  it("4. la mortalidad reduce automáticamente la recomendación (menos peces -> menos biomasa -> menos kg/día)", () => {
    // Antes de la mortalidad: 1000 peces (idéntico a getBatchPondBalance
    // antes de aplicar el evento). Después: 970 (30 murieron) — el mismo
    // número que produciría el ledger real, pasado aquí ya calculado.
    const before = calculatePondRationSummary(
      [{ batchId: "b1", speciesId: pacuId, quantity: 1000, averageWeightG: 500 }],
      recommendations,
    );
    const after = calculatePondRationSummary(
      [{ batchId: "b1", speciesId: pacuId, quantity: 970, averageWeightG: 500 }],
      recommendations,
    );
    expect(after.totalBiomassKg).toBeLessThan(before.totalBiomassKg);
    expect(after.calculatedDailyRationKg).toBeLessThan(before.calculatedDailyRationKg);
    expect(after.calculatedDailyRationKg).toBeCloseTo(14.55, 5);
  });

  it("5. un nuevo muestreo (peso distinto) cambia la recomendación", () => {
    // Mismo lote, mismo estanque — antes del muestreo se usaba el peso
    // inicial de siembra; después, el peso del muestreo más reciente (el
    // mismo dato que ya produce getEstimatedWeightForPond, pasado aquí ya
    // resuelto).
    const beforeSampling = calculatePondRationSummary(
      [{ batchId: "b1", speciesId: pacuId, quantity: 970, averageWeightG: 300 }],
      recommendations,
    );
    const afterSampling = calculatePondRationSummary(
      [{ batchId: "b1", speciesId: pacuId, quantity: 970, averageWeightG: 510 }],
      recommendations,
    );
    expect(afterSampling.calculatedDailyRationKg).not.toBe(beforeSampling.calculatedDailyRationKg);
    expect(afterSampling.calculatedDailyRationKg).toBeCloseTo(14.841, 3);
  });

  it("suma la biomasa/ración de varios lotes presentes en el mismo estanque", () => {
    const summary = calculatePondRationSummary(
      [
        { batchId: "b1", speciesId: pacuId, quantity: 500, averageWeightG: 300 },
        { batchId: "b2", speciesId: pacuId, quantity: 300, averageWeightG: 250 },
      ],
      recommendations,
    );
    expect(summary.totalFish).toBe(800);
    expect(summary.totalBiomassKg).toBeCloseTo(150 + 75, 5);
    expect(summary.calculatedDailyRationKg).toBeCloseTo((150 + 75) * 0.03, 5);
  });

  it("fullyConfigured es false si algún lote no tiene recomendación configurada para su especie/peso", () => {
    const summary = calculatePondRationSummary(
      [{ batchId: "b1", speciesId: pacuId, quantity: 100, averageWeightG: 5 }],
      recommendations,
    );
    expect(summary.fullyConfigured).toBe(false);
    expect(summary.calculatedDailyRationKg).toBe(0);
  });
});

describe("resolvePondRationDisplay", () => {
  it("sin ajuste manual, usa la ración calculada y el reparto en raciones", () => {
    const summary = calculatePondRationSummary(
      [{ batchId: "b1", speciesId: pacuId, quantity: 1000, averageWeightG: 500 }],
      recommendations,
    );
    const display = resolvePondRationDisplay(summary, null, null, 3);
    expect(display.hasManualOverride).toBe(false);
    expect(display.recommendedDailyRationKg).toBe(15);
    expect(display.effectiveDailyRationKg).toBe(15);
    expect(display.effectiveFeedingsPerDay).toBe(3);
    expect(display.perFeedingKg).toBe(5);
  });

  it("6. el ajuste manual reemplaza la ración efectiva sin tocar la recomendada", () => {
    const summary = calculatePondRationSummary(
      [{ batchId: "b1", speciesId: pacuId, quantity: 1000, averageWeightG: 500 }],
      recommendations,
    );
    const display = resolvePondRationDisplay(summary, 13.5, null, 3);
    expect(display.hasManualOverride).toBe(true);
    // La recomendación calculada sigue visible, sin alterarse por el ajuste.
    expect(display.recommendedDailyRationKg).toBe(15);
    expect(display.effectiveDailyRationKg).toBe(13.5);
    expect(display.perFeedingKg).toBe(4.5);
  });

  it("el ajuste manual también puede fijar su propio número de raciones", () => {
    const summary = calculatePondRationSummary(
      [{ batchId: "b1", speciesId: pacuId, quantity: 1000, averageWeightG: 500 }],
      recommendations,
    );
    const display = resolvePondRationDisplay(summary, 13.5, 2, 3);
    expect(display.effectiveFeedingsPerDay).toBe(2);
    expect(display.perFeedingKg).toBe(6.75);
  });
});
