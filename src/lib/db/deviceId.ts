// Identificador persistente de instalación/dispositivo (§6D del encargo de
// Fase 1, IMPLEMENTATION_PLAN.md §5.3). Se usa para auditoría, para saber
// qué dispositivo originó cada cambio, y como base para una futura
// resolución de conflictos multi-dispositivo.
//
// Se guarda en localStorage (no en Dexie) a propósito: necesitamos poder
// leerlo de forma síncrona en el momento de crear cualquier registro, y es
// un simple identificador — si por algún motivo se perdiera (limpieza de
// datos del navegador), el peor caso es que el dispositivo estrena un
// deviceId nuevo, sin ninguna pérdida de datos productivos.

const DEVICE_ID_STORAGE_KEY = "piscicultura:deviceId";

let cachedDeviceId: string | null = null;

function generateDeviceId(): string {
  // No es un UUID "colisionable": crypto.randomUUID() usa un generador
  // aleatorio criptográfico (RFC 4122 v4), suficiente para identificar
  // instalaciones sin coordinación central.
  return crypto.randomUUID();
}

/** Devuelve el deviceId de esta instalación, generándolo la primera vez. */
export function getDeviceId(): string {
  if (typeof window === "undefined") {
    throw new Error(
      "getDeviceId() solo puede usarse en el navegador (cliente), no en el servidor.",
    );
  }

  if (cachedDeviceId) {
    return cachedDeviceId;
  }

  const stored = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (stored) {
    cachedDeviceId = stored;
    return stored;
  }

  const created = generateDeviceId();
  window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, created);
  cachedDeviceId = created;
  return created;
}
