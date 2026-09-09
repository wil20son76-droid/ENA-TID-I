import { describe, expect, it } from "vitest";

import {
  assertPhysicallyValidMeasurement,
  evaluateWaterQuality,
  getLatestMeasurement,
  getParameterTrend,
  hasAtLeastOneMeasurement,
  isMeasurementStale,
  type SpeciesWaterRanges,
} from "../waterQuality";

const tilapia: SpeciesWaterRanges = {
  id: "sp-tilapia",
  commonName: "Tilapia",
  minTemperatureC: 24,
  maxTemperatureC: 30,
  minPh: 6.5,
  maxPh: 8.5,
  minDissolvedOxygenMgL: 5,
};

describe("assertPhysicallyValidMeasurement (§3, §38)", () => {
  it("rechaza pH 20 (físicamente imposible)", () => {
    expect(() => assertPhysicallyValidMeasurement({ ph: 20 })).toThrow(/pH/);
  });

  it("rechaza oxígeno negativo", () => {
    expect(() => assertPhysicallyValidMeasurement({ dissolvedOxygenMgL: -2 })).toThrow(
      /no puede ser negativo/,
    );
  });

  it("rechaza temperatura fuera del rango físico razonable", () => {
    expect(() => assertPhysicallyValidMeasurement({ temperatureC: 90 })).toThrow(/temperatura/i);
  });

  it("acepta pH 5 (físicamente válido, aunque genere alerta operativa después)", () => {
    expect(() => assertPhysicallyValidMeasurement({ ph: 5 })).not.toThrow();
  });

  it("acepta valores nulos/no informados sin fallar", () => {
    expect(() => assertPhysicallyValidMeasurement({})).not.toThrow();
  });

  it("rechaza transparencia/amonio/nitrito negativos", () => {
    expect(() => assertPhysicallyValidMeasurement({ transparencyCm: -1 })).toThrow();
    expect(() => assertPhysicallyValidMeasurement({ ammoniaMgL: -0.1 })).toThrow();
    expect(() => assertPhysicallyValidMeasurement({ nitriteMgL: -0.1 })).toThrow();
  });
});

describe("hasAtLeastOneMeasurement (§2)", () => {
  it("false si no hay ningún parámetro", () => {
    expect(hasAtLeastOneMeasurement({})).toBe(false);
  });

  it("true con un solo parámetro informado", () => {
    expect(hasAtLeastOneMeasurement({ ph: 7.2 })).toBe(true);
  });
});

describe("evaluateWaterQuality (§4-§11, §36)", () => {
  it("oxígeno bajo (3,8 vs mínimo 5) genera alerta 'critical' según la política documentada", () => {
    const alerts = evaluateWaterQuality({ dissolvedOxygenMgL: 3.8, ph: null, temperatureC: null }, [
      tilapia,
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].parameter).toBe("dissolvedOxygen");
    expect(alerts[0].severity).toBe("critical"); // 3.8 < 5 * 0.8 = 4.0
    expect(alerts[0].speciesName).toBe("Tilapia");
  });

  it("oxígeno normal (5,5) no genera alerta", () => {
    const alerts = evaluateWaterQuality({ dissolvedOxygenMgL: 5.5, ph: null, temperatureC: null }, [
      tilapia,
    ]);
    expect(alerts).toHaveLength(0);
  });

  it("oxígeno levemente bajo (4,5 vs mínimo 5) genera 'warning', no 'critical'", () => {
    const alerts = evaluateWaterQuality({ dissolvedOxygenMgL: 4.5, ph: null, temperatureC: null }, [
      tilapia,
    ]);
    expect(alerts[0].severity).toBe("warning");
  });

  it("pH alto (9 vs rango 6,5-8,5) genera alerta", () => {
    const alerts = evaluateWaterQuality({ ph: 9, dissolvedOxygenMgL: null, temperatureC: null }, [
      tilapia,
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].parameter).toBe("ph");
    expect(alerts[0].thresholdKind).toBe("max");
    expect(alerts[0].message).toMatch(/por encima del rango recomendado/);
  });

  it("temperatura baja (22 vs rango 24-30) genera alerta", () => {
    const alerts = evaluateWaterQuality({ temperatureC: 22, ph: null, dissolvedOxygenMgL: null }, [
      tilapia,
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].parameter).toBe("temperature");
    expect(alerts[0].thresholdKind).toBe("min");
    expect(alerts[0].message).toMatch(/por debajo del rango recomendado/);
  });

  it("especie sin rangos configurados no genera ninguna alerta inventada (§10)", () => {
    const noRanges: SpeciesWaterRanges = {
      id: "sp-x",
      commonName: "Especie sin datos",
      minTemperatureC: null,
      maxTemperatureC: null,
      minPh: null,
      maxPh: null,
      minDissolvedOxygenMgL: null,
    };
    const alerts = evaluateWaterQuality({ temperatureC: 5, ph: 13, dissolvedOxygenMgL: 0.1 }, [
      noRanges,
    ]);
    expect(alerts).toHaveLength(0);
  });

  it("varias especies en el mismo estanque: una medición solo viola el rango de una (§5, §37)", () => {
    const pacu: SpeciesWaterRanges = {
      id: "sp-pacu",
      commonName: "Pacú",
      minTemperatureC: 20,
      maxTemperatureC: 32,
      minPh: 6,
      maxPh: 9,
      minDissolvedOxygenMgL: 4,
    };
    // 4.5 mg/L: insuficiente para Tilapia (mínimo 5), suficiente para Pacú (mínimo 4).
    const alerts = evaluateWaterQuality(
      { dissolvedOxygenMgL: 4.5, ph: null, temperatureC: null },
      [tilapia, pacu],
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].speciesId).toBe("sp-tilapia");
    expect(alerts[0].message).toMatch(/Tilapia/);
  });

  it("sin mediciones (todo null) no genera alertas", () => {
    const alerts = evaluateWaterQuality({ temperatureC: null, ph: null, dissolvedOxygenMgL: null }, [
      tilapia,
    ]);
    expect(alerts).toHaveLength(0);
  });
});

describe("isMeasurementStale (§17)", () => {
  it("sin ninguna medición: siempre 'sin medición reciente'", () => {
    expect(isMeasurementStale(null)).toBe(true);
  });

  it("medición de hace 1 hora: no es antigua", () => {
    const now = new Date("2026-09-11T12:00:00.000Z");
    expect(isMeasurementStale("2026-09-11T11:00:00.000Z", now)).toBe(false);
  });

  it("medición de hace 25 horas (> umbral de 24h): es antigua", () => {
    const now = new Date("2026-09-11T12:00:00.000Z");
    expect(isMeasurementStale("2026-09-10T11:00:00.000Z", now)).toBe(true);
  });
});

describe("getLatestMeasurement", () => {
  it("dos mediciones del mismo día sin hora: gana la de createdAt más reciente, no un orden de array arbitrario", () => {
    const older = { date: "2026-09-09", time: null, createdAt: "2026-09-09T10:00:00.000Z", id: "a" };
    const newer = { date: "2026-09-09", time: null, createdAt: "2026-09-09T14:00:00.000Z", id: "b" };
    // Probado en ambos órdenes de array — el resultado no debe depender de
    // en qué orden Dexie devuelva las filas.
    expect(getLatestMeasurement([older, newer])?.id).toBe("b");
    expect(getLatestMeasurement([newer, older])?.id).toBe("b");
  });

  it("fecha distinta manda sobre createdAt", () => {
    const yesterday = { date: "2026-09-08", time: null, createdAt: "2026-09-09T23:00:00.000Z" };
    const today = { date: "2026-09-09", time: null, createdAt: "2026-09-09T00:01:00.000Z" };
    expect(getLatestMeasurement([yesterday, today])).toBe(today);
  });

  it("mismo día, hora informada en ambas: gana la hora más tardía", () => {
    const morning = { date: "2026-09-09", time: "08:00", createdAt: "2026-09-09T08:05:00.000Z" };
    const afternoon = { date: "2026-09-09", time: "16:00", createdAt: "2026-09-09T08:06:00.000Z" };
    expect(getLatestMeasurement([afternoon, morning])).toBe(afternoon);
  });

  it("lista vacía: undefined", () => {
    expect(getLatestMeasurement([])).toBeUndefined();
  });
});

describe("getParameterTrend (§16)", () => {
  it("devuelve como máximo los últimos `limit` valores, en orden cronológico, con diferencia", () => {
    const values = [
      { date: "2026-09-01", value: 7.0 },
      { date: "2026-09-02", value: 7.2 },
      { date: "2026-09-03", value: 7.1 },
      { date: "2026-09-04", value: 6.9 },
      { date: "2026-09-05", value: 7.3 },
      { date: "2026-09-06", value: 7.4 },
    ];
    const trend = getParameterTrend(values, 5);
    expect(trend).toHaveLength(5);
    expect(trend[0].date).toBe("2026-09-02"); // el más antiguo de los 6 queda fuera
    expect(trend[0].deltaFromPrevious).toBeNull();
    expect(trend[1].deltaFromPrevious).toBeCloseTo(-0.1, 5);
  });

  it("ignora valores null y no revienta con menos de `limit` puntos", () => {
    const values = [
      { date: "2026-09-01", value: null },
      { date: "2026-09-02", value: 7.2 },
    ];
    const trend = getParameterTrend(values, 5);
    expect(trend).toHaveLength(1);
    expect(trend[0].value).toBe(7.2);
  });
});
