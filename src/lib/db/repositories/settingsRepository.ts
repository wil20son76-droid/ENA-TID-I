// Configuración de moneda de la finca (§2 del encargo de Fase 5):
// singleton local (`id = "default"`), sincronizado como cualquier otra
// entidad mutable LWW. Se crea con valores por defecto ("BOB"/"Bs") la
// primera vez que se pide y todavía no existe localmente — nunca se
// asume una moneda fija en ningún otro módulo, ver src/lib/domain/money.ts.
import { getDeviceId } from "../deviceId";
import { db } from "../schema";
import { DEFAULT_CURRENCY_CODE, DEFAULT_CURRENCY_SYMBOL } from "../../domain/money";
import { FARM_SETTINGS_ID, type FarmSettingsRecord } from "../types";
import { enqueueSyncOperation } from "./base";

const ENTITY_TYPE = "FarmSettings" as const;

export async function getFarmSettings(): Promise<FarmSettingsRecord> {
  const existing = await db.farmSettings.get(FARM_SETTINGS_ID);
  if (existing) return existing;

  // Nunca se crea silenciosamente sin encolar su sync: si dos
  // dispositivos offline crean el valor por defecto a la vez, el
  // servidor los resuelve por last-write-wins como cualquier otra
  // entidad mutable — el resultado sigue siendo una moneda consistente,
  // nunca dos filas.
  const deviceId = getDeviceId();
  const now = new Date().toISOString();
  const record: FarmSettingsRecord = {
    id: FARM_SETTINGS_ID,
    currencyCode: DEFAULT_CURRENCY_CODE,
    currencySymbol: DEFAULT_CURRENCY_SYMBOL,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1,
    deviceId,
    createdBy: null,
    updatedBy: null,
  };

  await db.transaction("rw", db.farmSettings, db.syncQueue, async () => {
    await db.farmSettings.add(record);
    await enqueueSyncOperation(ENTITY_TYPE, record.id, "CREATE", record, deviceId);
  });

  return record;
}

export async function updateFarmSettings(patch: {
  currencyCode?: string;
  currencySymbol?: string;
}): Promise<FarmSettingsRecord> {
  const current = await getFarmSettings();
  const deviceId = getDeviceId();
  const updated: FarmSettingsRecord = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
    version: current.version + 1,
    deviceId,
  };

  await db.transaction("rw", db.farmSettings, db.syncQueue, async () => {
    await db.farmSettings.put(updated);
    await enqueueSyncOperation(ENTITY_TYPE, updated.id, "UPDATE", updated, deviceId);
  });

  return updated;
}
