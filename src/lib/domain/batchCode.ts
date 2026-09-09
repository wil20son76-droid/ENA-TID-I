// Generación de código de lote, legible y sin colisiones offline (§6 del
// encargo de Fase 2).
//
// El identificador REAL de un lote sigue siendo su UUID (§6: "el ID real
// sigue siendo UUID. El código es identificador visual"). Pero dos
// dispositivos pueden crear offline, el mismo día, el primer lote de Pacú
// del año — si el código dependiera solo de "especie + año + secuencia",
// ambos generarían "PAC-2026-001" sin saberlo, y ese código tiene una
// restricción UNIQUE en el servidor: al sincronizar, uno de los dos
// fallaría por colisión.
//
// Estrategia híbrida elegida (documentada también en
// IMPLEMENTATION_PLAN.md): prefijo de especie + año + secuencia LOCAL
// visible (cuántos lotes de esta especie creó ESTE dispositivo este año —
// no requiere coordinación con el servidor) + un sufijo corto derivado
// del deviceId. El sufijo es lo que garantiza unicidad real sin depender
// de la red; la secuencia sigue siendo clara y mayormente consecutiva
// desde el punto de vista de quien trabaja en un mismo teléfono.
//
// Ejemplo: "PAC-2026-001-9B1C". No son números perfectamente consecutivos
// a nivel global (ver §6: "no sacrifiques la posibilidad offline solo por
// conseguir números perfectamente consecutivos"), pero sí lo son por
// dispositivo, y nunca chocan entre dispositivos sin necesidad de red.

export interface BatchCodeInput {
  speciesCommonName: string;
  year: number;
  /** Cuántos lotes de esta especie ya creó este dispositivo este año, + 1. */
  localSequence: number;
  deviceId: string;
}

function speciesPrefix(commonName: string): string {
  const lettersOnly = commonName
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // quita acentos (á, í, ú...)
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase();
  return lettersOnly.slice(0, 3).padEnd(3, "X");
}

function deviceSuffix(deviceId: string): string {
  const alphanumeric = deviceId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const suffix = alphanumeric.slice(-4);
  return suffix.padStart(4, "0");
}

export function generateBatchCode({
  speciesCommonName,
  year,
  localSequence,
  deviceId,
}: BatchCodeInput): string {
  const prefix = speciesPrefix(speciesCommonName);
  const sequence = String(Math.max(1, localSequence)).padStart(3, "0");
  const suffix = deviceSuffix(deviceId);
  return `${prefix}-${year}-${sequence}-${suffix}`;
}
