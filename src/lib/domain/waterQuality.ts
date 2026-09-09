// Calidad del agua (Fase 4, §1-§11 del encargo). Un WaterQualityRecord es
// un registro histórico append-only, igual principio de ledger que el
// resto del dominio (batchLedger.ts, feedLedger.ts): NUNCA se guarda
// `pond.currentPh`/`pond.currentTemperature` como fuente primaria. La
// última medición, la tendencia y la alerta actual se DERIVAN siempre del
// historial completo.
//
// Dos conceptos deliberadamente distintos, nunca mezclados (§35 del
// encargo):
// - Validación FÍSICA (§3, assertPhysicallyValidMeasurement): un pH de 20
//   o un oxígeno negativo son imposibles de verdad — un error de tipeo o
//   de sensor, no una condición real del agua. Se rechaza antes de
//   guardar, en cliente y en servidor (§42).
// - Alerta OPERATIVA (§6, evaluateWaterQuality): un pH de 5 es
//   físicamente válido, pero puede estar fuera del rango recomendado para
//   una especie concreta. Nunca es un diagnóstico médico (§47) — solo
//   señala qué parámetro está fuera de rango, para que la persona decida
//   qué hacer.

/**
 * Rangos físicos absolutos (§3) — nunca el rango recomendado para peces,
 * eso lo decide `evaluateWaterQuality` por especie. Un valor fuera de
 * este rango es casi siempre un error de tipeo o de sensor. El rango de
 * temperatura es "técnicamente razonable" para agua de estanque en
 * general (no ligado a ninguna especie), documentado aquí como única
 * fuente — se reutiliza también en la validación Zod del servidor
 * (src/lib/validation/sync.ts) para no duplicar los números.
 */
export const WATER_QUALITY_PHYSICAL_LIMITS = {
  ph: { min: 0, max: 14 },
  temperatureC: { min: -5, max: 45 },
} as const;

export interface WaterQualityMeasurementInput {
  temperatureC?: number | null;
  ph?: number | null;
  dissolvedOxygenMgL?: number | null;
  transparencyCm?: number | null;
  ammoniaMgL?: number | null;
  nitriteMgL?: number | null;
  alkalinityMgL?: number | null;
  waterLevelCm?: number | null;
}

const NON_NEGATIVE_FIELDS: {
  key: keyof WaterQualityMeasurementInput;
  label: string;
}[] = [
  { key: "dissolvedOxygenMgL", label: "El oxígeno disuelto" },
  { key: "transparencyCm", label: "La transparencia" },
  { key: "ammoniaMgL", label: "El amonio" },
  { key: "nitriteMgL", label: "El nitrito" },
  { key: "alkalinityMgL", label: "La alcalinidad" },
  { key: "waterLevelCm", label: "El nivel de agua" },
];

/**
 * Valida rangos físicos básicos (§3 del encargo) — nunca sobrevalida más
 * allá de lo físicamente imposible (§38: "no sobrevalidar sin
 * fundamento"). Lanza en la primera violación encontrada, con un mensaje
 * listo para mostrar en un formulario.
 */
export function assertPhysicallyValidMeasurement(input: WaterQualityMeasurementInput): void {
  if (
    input.ph != null &&
    (input.ph < WATER_QUALITY_PHYSICAL_LIMITS.ph.min || input.ph > WATER_QUALITY_PHYSICAL_LIMITS.ph.max)
  ) {
    throw new Error(
      `El pH debe estar entre ${WATER_QUALITY_PHYSICAL_LIMITS.ph.min} y ${WATER_QUALITY_PHYSICAL_LIMITS.ph.max}.`,
    );
  }
  if (
    input.temperatureC != null &&
    (input.temperatureC < WATER_QUALITY_PHYSICAL_LIMITS.temperatureC.min ||
      input.temperatureC > WATER_QUALITY_PHYSICAL_LIMITS.temperatureC.max)
  ) {
    throw new Error(
      `La temperatura debe estar entre ${WATER_QUALITY_PHYSICAL_LIMITS.temperatureC.min} y ${WATER_QUALITY_PHYSICAL_LIMITS.temperatureC.max} °C.`,
    );
  }
  for (const field of NON_NEGATIVE_FIELDS) {
    const value = input[field.key];
    if (value != null && value < 0) {
      throw new Error(`${field.label} no puede ser negativo.`);
    }
  }
}

/** Requisito mínimo de un registro (§2): estanque + fecha + al menos un parámetro medido. */
export function hasAtLeastOneMeasurement(input: WaterQualityMeasurementInput): boolean {
  return (
    input.temperatureC != null ||
    input.ph != null ||
    input.dissolvedOxygenMgL != null ||
    input.transparencyCm != null ||
    input.ammoniaMgL != null ||
    input.nitriteMgL != null ||
    input.alkalinityMgL != null ||
    input.waterLevelCm != null
  );
}

// --- Alertas operativas (§4-§11) ---

export type WaterQualitySeverity = "info" | "warning" | "critical";

export type WaterQualityParameterKind = "temperature" | "ph" | "dissolvedOxygen";

export interface WaterQualityAlert {
  parameter: WaterQualityParameterKind;
  severity: WaterQualitySeverity;
  measuredValue: number;
  threshold: number;
  thresholdKind: "min" | "max";
  speciesId: string;
  speciesName: string;
  message: string;
}

/** Solo los campos de Species que esta fase usa para evaluar (§4: reutilizados, nunca duplicados). */
export interface SpeciesWaterRanges {
  id: string;
  commonName: string;
  minTemperatureC: number | null;
  maxTemperatureC: number | null;
  minPh: number | null;
  maxPh: number | null;
  minDissolvedOxygenMgL: number | null;
}

/** Margen de desviación (más allá del límite) a partir del cual una salida de rango escala de "warning" a "critical". */
const CRITICAL_DEVIATION = {
  temperatureC: 4,
  ph: 1,
  // Oxígeno usa un margen relativo (no absoluto) porque su escala es muy
  // distinta entre especies con mínimos de 3 mg/L o de 6 mg/L.
  dissolvedOxygenRelative: 0.2,
} as const;

/**
 * Alertas operativas de UNA medición contra el rango recomendado de CADA
 * especie presente en el estanque (§5: un estanque puede tener varias
 * especies con rangos distintos — nunca se reduce a un único rango
 * arbitrario, cada violación se reporta con el nombre de la especie que
 * la generó). Una especie sin ningún parámetro configurado no genera
 * ninguna alerta para esos parámetros (§10: nunca se inventa un rango).
 *
 * Política de severidad (única fuente, documentada aquí — §6 y §36 del
 * encargo): el oxígeno disuelto bajo es la condición más urgente para la
 * supervivencia de los peces, así que escala a "critical" antes que las
 * demás — por debajo de un 20% adicional del mínimo recomendado, no solo
 * por debajo del mínimo. pH y temperatura fuera de rango son "warning";
 * escalan a "critical" solo ante una desviación grande (más de 1 unidad
 * de pH, o más de 4 °C) — una salida moderada pide atención, una
 * desviación grande pide atención inmediata. Esto NUNCA es un
 * diagnóstico médico (§47): solo indica qué parámetro está fuera de
 * rango y por cuánto.
 */
export function evaluateWaterQuality(
  measurement: Pick<WaterQualityMeasurementInput, "temperatureC" | "ph" | "dissolvedOxygenMgL">,
  speciesList: readonly SpeciesWaterRanges[],
): WaterQualityAlert[] {
  const alerts: WaterQualityAlert[] = [];

  for (const species of speciesList) {
    if (measurement.temperatureC != null) {
      if (species.minTemperatureC != null && measurement.temperatureC < species.minTemperatureC) {
        const deviation = species.minTemperatureC - measurement.temperatureC;
        alerts.push({
          parameter: "temperature",
          severity: deviation > CRITICAL_DEVIATION.temperatureC ? "critical" : "warning",
          measuredValue: measurement.temperatureC,
          threshold: species.minTemperatureC,
          thresholdKind: "min",
          speciesId: species.id,
          speciesName: species.commonName,
          message: `Temperatura por debajo del rango recomendado para ${species.commonName}.`,
        });
      }
      if (species.maxTemperatureC != null && measurement.temperatureC > species.maxTemperatureC) {
        const deviation = measurement.temperatureC - species.maxTemperatureC;
        alerts.push({
          parameter: "temperature",
          severity: deviation > CRITICAL_DEVIATION.temperatureC ? "critical" : "warning",
          measuredValue: measurement.temperatureC,
          threshold: species.maxTemperatureC,
          thresholdKind: "max",
          speciesId: species.id,
          speciesName: species.commonName,
          message: `Temperatura por encima del rango recomendado para ${species.commonName}.`,
        });
      }
    }

    if (measurement.ph != null) {
      if (species.minPh != null && measurement.ph < species.minPh) {
        const deviation = species.minPh - measurement.ph;
        alerts.push({
          parameter: "ph",
          severity: deviation > CRITICAL_DEVIATION.ph ? "critical" : "warning",
          measuredValue: measurement.ph,
          threshold: species.minPh,
          thresholdKind: "min",
          speciesId: species.id,
          speciesName: species.commonName,
          message: `pH por debajo del rango recomendado para ${species.commonName}.`,
        });
      }
      if (species.maxPh != null && measurement.ph > species.maxPh) {
        const deviation = measurement.ph - species.maxPh;
        alerts.push({
          parameter: "ph",
          severity: deviation > CRITICAL_DEVIATION.ph ? "critical" : "warning",
          measuredValue: measurement.ph,
          threshold: species.maxPh,
          thresholdKind: "max",
          speciesId: species.id,
          speciesName: species.commonName,
          message: `pH por encima del rango recomendado para ${species.commonName}.`,
        });
      }
    }

    if (
      measurement.dissolvedOxygenMgL != null &&
      species.minDissolvedOxygenMgL != null &&
      measurement.dissolvedOxygenMgL < species.minDissolvedOxygenMgL
    ) {
      const criticalThreshold =
        species.minDissolvedOxygenMgL * (1 - CRITICAL_DEVIATION.dissolvedOxygenRelative);
      alerts.push({
        parameter: "dissolvedOxygen",
        severity: measurement.dissolvedOxygenMgL < criticalThreshold ? "critical" : "warning",
        measuredValue: measurement.dissolvedOxygenMgL,
        threshold: species.minDissolvedOxygenMgL,
        thresholdKind: "min",
        speciesId: species.id,
        speciesName: species.commonName,
        message: `Oxígeno disuelto bajo para ${species.commonName}.`,
      });
    }
  }

  return alerts;
}

// --- "Última medición" (§1: siempre derivada, nunca un campo mutable) ---

export interface WaterQualityRecordLike {
  date: string;
  time: string | null;
  createdAt: string;
}

/**
 * Compara la recencia de dos mediciones: primero por fecha, luego por hora
 * si ambas la informaron, y por último por `createdAt` (el momento real en
 * que se registró, con precisión de milisegundos) como desempate final.
 * Necesario porque dos mediciones del mismo día sin hora informada tienen
 * el mismo `date` — comparar solo esa cadena dejaría el resultado
 * indefinido (y, con IndexedDB, dependiente de un orden de array que Dexie
 * nunca garantiza que sea el de inserción).
 */
export function compareMeasurementRecency<T extends WaterQualityRecordLike>(a: T, b: T): number {
  const dateDiff = a.date.localeCompare(b.date);
  if (dateDiff !== 0) return dateDiff;
  const timeDiff = (a.time ?? "").localeCompare(b.time ?? "");
  if (timeDiff !== 0) return timeDiff;
  return a.createdAt.localeCompare(b.createdAt);
}

/** La medición más reciente de una lista, o `undefined` si está vacía. */
export function getLatestMeasurement<T extends WaterQualityRecordLike>(
  records: readonly T[],
): T | undefined {
  let latest: T | undefined;
  for (const record of records) {
    if (!latest || compareMeasurementRecency(record, latest) > 0) latest = record;
  }
  return latest;
}

// --- Frescura de la medición (§17) — advertencia operativa distinta de una alerta de parámetro (§35) ---

/** Umbral inicial (§17): configurable en el futuro, no ligado a ninguna especie. */
export const STALE_MEASUREMENT_THRESHOLD_HOURS = 24;

/** `true` si no hay medición o la última es más antigua que el umbral. */
export function isMeasurementStale(
  lastMeasurementDate: string | null,
  now: Date = new Date(),
): boolean {
  if (!lastMeasurementDate) return true;
  const ageMs = now.getTime() - new Date(lastMeasurementDate).getTime();
  return ageMs > STALE_MEASUREMENT_THRESHOLD_HOURS * 60 * 60 * 1000;
}

// --- Tendencia simple (§16) — sin librería de gráficos ---

export interface WaterQualityTrendPoint {
  date: string;
  value: number;
  /** Diferencia contra el punto anterior de la serie, `null` en el primero. */
  deltaFromPrevious: number | null;
}

/**
 * Últimos `limit` valores de UN parámetro, en orden cronológico, con la
 * diferencia respecto al anterior — suficiente para "tendencia simple"
 * (§16) sin construir ni cargar una librería de gráficos.
 */
export function getParameterTrend(
  values: readonly { date: string; value: number | null }[],
  limit = 5,
): WaterQualityTrendPoint[] {
  const withValue = values
    .filter((v): v is { date: string; value: number } => v.value != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  const recent = withValue.slice(-limit);

  return recent.map((point, index) => ({
    date: point.date,
    value: point.value,
    deltaFromPrevious: index === 0 ? null : point.value - recent[index - 1].value,
  }));
}
