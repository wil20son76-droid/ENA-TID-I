// Prueba explícita de que el upgrade del esquema Dexie de v1 (Fase 1) a
// v2 (Fase 2) conserva los datos ya creados y deja las tablas nuevas
// listas para usarse (§26 del encargo de Fase 2: "no destruir IndexedDB
// existente durante la actualización").
//
// Simula un dispositivo que instaló la app en Fase 1 (solo conoce
// version(1).stores()) abriendo primero una base con ESE esquema nada
// más, y luego reabriendo la MISMA base de datos con el esquema real de
// la app (que ya incluye v1 y v2) — como pasaría de verdad cuando se
// actualiza el service worker y se recarga la app.
import Dexie, { type EntityTable } from "dexie";
import { beforeEach, describe, expect, it } from "vitest";

import { AppDatabase } from "../schema";

const DB_NAME = "piscicultura-db";

interface LegacySpeciesRecord {
  id: string;
  commonName: string;
  active: boolean;
  updatedAt: string;
}

class LegacyV1Database extends Dexie {
  species!: EntityTable<LegacySpeciesRecord, "id">;

  constructor() {
    super(DB_NAME);
    // Copia exacta de version(1).stores() tal como existía en Fase 1 —
    // ver src/lib/db/schema.ts. No se referencia esa definición
    // directamente a propósito: este test debe seguir funcionando aunque
    // el archivo real cambie, para detectar si algún día se rompe el
    // encadenamiento de versiones.
    this.version(1).stores({
      species: "id, active, updatedAt",
      ponds: "id, code, status, updatedAt",
      syncQueue: "id, status, entityType, [entityType+entityId], createdAt",
      syncMeta: "key",
    });
  }
}

describe("Dexie: upgrade de esquema v1 -> v2 sin perder datos", () => {
  beforeEach(async () => {
    await Dexie.delete(DB_NAME);
  });

  it("conserva un registro creado en v1 al reabrir con el esquema v2", async () => {
    const legacyDb = new LegacyV1Database();
    await legacyDb.open();
    await legacyDb.species.add({
      id: "species-legacy-1",
      commonName: "Pacú",
      active: true,
      updatedAt: new Date().toISOString(),
    });
    legacyDb.close();

    const upgradedDb = new AppDatabase();
    await upgradedDb.open();

    const preserved = await upgradedDb.species.get("species-legacy-1");
    expect(preserved?.commonName).toBe("Pacú");

    upgradedDb.close();
  });

  it("las tablas nuevas de Fase 2 quedan disponibles tras el upgrade", async () => {
    const legacyDb = new LegacyV1Database();
    await legacyDb.open();
    await legacyDb.species.add({
      id: "species-legacy-2",
      commonName: "Tilapia",
      active: true,
      updatedAt: new Date().toISOString(),
    });
    legacyDb.close();

    const upgradedDb = new AppDatabase();
    await upgradedDb.open();

    expect(await upgradedDb.fishBatches.count()).toBe(0);
    expect(await upgradedDb.stockings.count()).toBe(0);
    expect(await upgradedDb.fishTransfers.count()).toBe(0);

    await upgradedDb.fishBatches.add({
      id: "batch-1",
      code: "PAC-2026-001-0000",
      speciesId: "species-legacy-2",
      supplierId: null,
      purchaseDate: null,
      initialStockingDate: new Date().toISOString(),
      initialQuantity: 1000,
      initialAverageWeightG: 15,
      initialBiomassKg: 15,
      fryCost: null,
      targetWeightKg: null,
      expectedHarvestDate: null,
      status: "PLANNED",
      notes: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      version: 1,
      deviceId: "device-test",
      createdBy: null,
      updatedBy: null,
    });

    expect(await upgradedDb.fishBatches.count()).toBe(1);

    upgradedDb.close();
  });
});
