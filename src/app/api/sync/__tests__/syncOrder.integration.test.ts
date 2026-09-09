// Prueba de integración del orden de sincronización (Fase 3.5 §21-22 del
// encargo) contra PostgreSQL real: un dispositivo que trabajó totalmente
// offline — creando Species, Pond, FishBatch, Stocking, un alimento con
// stock inicial, una alimentación, una mortalidad, un muestreo y un
// traslado, en ese orden de negocio, pero SIN que el reloj local
// garantice que `createdAt` refleje ese orden (dos escrituras rápidas
// pueden empatar, o el usuario pudo crear el lote y el alimento con
// timestamps que no coinciden con las dependencias reales) — debe poder
// conectarse por primera vez y sincronizar todo sin depender de que los
// reintentos por error de FK "arreglen" el orden.
//
// La prueba usa `selectReadyOperations` (src/lib/sync/priority.ts, el
// mismo código que usa el motor de sincronización real) para decidir el
// orden de envío, y demuestra dos cosas con Postgres real (no un mock de
// "debería funcionar"): (1) en el orden que produce esa función, el primer
// sync se aplica completo, sin un solo error de llave foránea; (2) el
// orden ingenuo por `createdAt` (el comportamiento anterior a la Fase 3.5)
// SÍ produce errores de llave foránea con el mismo dataset — confirmando
// que el cambio no es cosmético.
import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/server/prisma";
import { selectReadyOperations } from "@/lib/sync/priority";
import type { SyncEntityType, SyncQueueRecord } from "@/lib/db/types";
import { POST as pushHandler } from "../push/route";

function pushRequest(body: unknown) {
  return new Request("http://localhost/api/sync/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function auditFields(deviceId: string) {
  const now = new Date().toISOString();
  return {
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1,
    deviceId,
    createdBy: null,
    updatedBy: null,
  };
}

/** Un item de outbox falso, con el mismo shape que produce Dexie, pero con
 * `createdAt` deliberadamente en el orden INVERSO al de las dependencias
 * reales — para probar que el orden de envío no depende de coincidir con
 * el reloj local. */
function queueItem(opts: {
  entityType: SyncEntityType;
  entityId: string;
  payload: unknown;
  createdAt: string;
  deviceId: string;
}): SyncQueueRecord {
  return {
    id: randomUUID(),
    entityType: opts.entityType,
    entityId: opts.entityId,
    operation: "CREATE",
    payload: opts.payload,
    createdAt: opts.createdAt,
    updatedAt: opts.createdAt,
    retryCount: 0,
    status: "pending",
    lastError: null,
    deviceId: opts.deviceId,
  };
}

function reversedTimestamp(index: number, total: number): string {
  // index 0 (primera dependencia real, p. ej. Species) recibe el
  // timestamp MÁS TARDÍO; index total-1 (última, p. ej. FishTransfer)
  // recibe el MÁS TEMPRANO — el opuesto exacto de lo que produciría un
  // dispositivo real, para no depender por accidente de que Date.now()
  // avance en el mismo orden que las dependencias.
  const base = Date.parse("2026-09-11T00:00:00.000Z");
  return new Date(base + (total - index) * 60_000).toISOString();
}

/** Construye el dataset completo de un dispositivo que trabajó offline de
 * principio a fin: Species -> Pond(x2) -> FishBatch -> Stocking ->
 * CreateFeedWithInitialStock -> RegisterFeeding -> MortalityRecord ->
 * Sampling -> FishTransfer. Cada llamada usa ids nuevos para no chocar
 * entre los dos escenarios (orden correcto vs. orden ingenuo) de la misma
 * prueba. */
function buildOfflineDataset(deviceId: string) {
  const speciesId = randomUUID();
  const fromPondId = randomUUID();
  const toPondId = randomUUID();
  const batchId = randomUUID();
  const stockingId = randomUUID();
  const feedId = randomUUID();
  const feedingId = randomUUID();
  const mortalityId = randomUUID();
  const samplingId = randomUUID();
  const transferId = randomUUID();
  const now = new Date().toISOString();

  const logical: Array<{ entityType: SyncEntityType; entityId: string; payload: unknown }> = [
    {
      entityType: "Species",
      entityId: speciesId,
      payload: {
        id: speciesId,
        commonName: "Pacú",
        scientificName: null,
        description: null,
        targetWeightKg: null,
        estimatedCycleDays: null,
        minTemperatureC: null,
        maxTemperatureC: null,
        minPh: null,
        maxPh: null,
        minDissolvedOxygenMgL: null,
        expectedFcr: null,
        expectedMortalityPercent: null,
        active: true,
        ...auditFields(deviceId),
      },
    },
    {
      entityType: "Pond",
      entityId: fromPondId,
      payload: {
        id: fromPondId,
        code: `E01-${fromPondId.slice(0, 4)}`,
        name: "Origen",
        type: null,
        lengthM: null,
        widthM: null,
        averageDepthM: null,
        areaM2: null,
        areaSource: "CALCULATED",
        estimatedVolumeM3: null,
        volumeSource: "CALCULATED",
        capacityNotes: null,
        locationNotes: null,
        notes: null,
        status: "ACTIVE",
        active: true,
        ...auditFields(deviceId),
      },
    },
    {
      entityType: "Pond",
      entityId: toPondId,
      payload: {
        id: toPondId,
        code: `E02-${toPondId.slice(0, 4)}`,
        name: "Destino",
        type: null,
        lengthM: null,
        widthM: null,
        averageDepthM: null,
        areaM2: null,
        areaSource: "CALCULATED",
        estimatedVolumeM3: null,
        volumeSource: "CALCULATED",
        capacityNotes: null,
        locationNotes: null,
        notes: null,
        status: "ACTIVE",
        active: true,
        ...auditFields(deviceId),
      },
    },
    {
      entityType: "FishBatch",
      entityId: batchId,
      payload: {
        id: batchId,
        code: `PAC-2026-${batchId.slice(0, 6)}`,
        speciesId,
        supplierId: null,
        purchaseDate: null,
        initialStockingDate: now,
        initialQuantity: 1000,
        initialAverageWeightG: 15,
        initialBiomassKg: 15,
        fryCost: null,
        targetWeightKg: null,
        expectedHarvestDate: null,
        status: "STOCKED",
        notes: null,
        ...auditFields(deviceId),
      },
    },
    {
      entityType: "Stocking",
      entityId: stockingId,
      payload: {
        id: stockingId,
        batchId,
        pondId: fromPondId,
        date: now,
        quantity: 1000,
        averageWeightG: 15,
        biomassKg: 15,
        responsibleName: null,
        notes: null,
        deviceId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    },
    {
      entityType: "CreateFeedWithInitialStock",
      entityId: feedId,
      payload: {
        id: feedId,
        name: "Crecimiento 32%",
        brand: null,
        proteinPercent: null,
        pelletSizeMm: null,
        bagWeightKg: null,
        defaultBagPrice: null,
        defaultCostPerKg: null,
        recommendedStage: null,
        notes: null,
        minimumStockKg: null,
        active: true,
        ...auditFields(deviceId),
        initialStockMovementId: randomUUID(),
        initialStockKg: 500,
        initialStockDate: now,
      },
    },
    {
      entityType: "RegisterFeeding",
      entityId: feedingId,
      payload: {
        id: feedingId,
        movementId: randomUUID(),
        batchId,
        pondId: fromPondId,
        feedId,
        date: now,
        time: null,
        quantityKg: 18,
        shift: "MORNING",
        responsibleName: null,
        notes: null,
        deviceId,
        createdAt: now,
        deletedAt: null,
      },
    },
    {
      entityType: "MortalityRecord",
      entityId: mortalityId,
      payload: {
        id: mortalityId,
        batchId,
        pondId: fromPondId,
        date: now,
        quantity: 3,
        estimatedAverageWeightG: null,
        cause: "UNKNOWN",
        notes: null,
        responsibleName: null,
        deviceId,
        createdAt: now,
        deletedAt: null,
      },
    },
    {
      entityType: "Sampling",
      entityId: samplingId,
      payload: {
        id: samplingId,
        batchId,
        pondId: fromPondId,
        date: now,
        sampleFishCount: 30,
        totalSampleWeightKg: 15.3,
        averageWeightG: 510,
        averageLengthCm: null,
        notes: null,
        responsibleName: null,
        deviceId,
        createdAt: now,
        deletedAt: null,
      },
    },
    {
      entityType: "FishTransfer",
      entityId: transferId,
      payload: {
        id: transferId,
        batchId,
        fromPondId,
        toPondId,
        date: now,
        quantity: 100,
        averageWeightG: null,
        biomassKg: null,
        reason: null,
        responsibleName: null,
        notes: null,
        deviceId,
        createdAt: now,
        deletedAt: null,
      },
    },
  ];

  return { logical, ids: { speciesId, fromPondId, toPondId, batchId, feedId } };
}

async function pushSequentially(
  items: SyncQueueRecord[],
): Promise<Array<{ id: string; status: string; error?: string }>> {
  const results: Array<{ id: string; status: string; error?: string }> = [];
  for (const item of items) {
    const response = await pushHandler(
      pushRequest({
        deviceId: item.deviceId,
        operations: [
          {
            id: item.id,
            entityType: item.entityType,
            entityId: item.entityId,
            operation: item.operation,
            deviceId: item.deviceId,
            payload: item.payload,
          },
        ],
      }),
    );
    const body = await response.json();
    results.push(body.results[0]);
  }
  return results;
}

beforeEach(async () => {
  await prisma.syncOperation.deleteMany();
  await prisma.feedingRecord.deleteMany();
  await prisma.mortalityRecord.deleteMany();
  await prisma.sampling.deleteMany();
  await prisma.feedInventoryMovement.deleteMany();
  await prisma.feed.deleteMany();
  await prisma.fishTransfer.deleteMany();
  await prisma.stocking.deleteMany();
  await prisma.fishBatch.deleteMany();
  await prisma.pond.deleteMany();
  await prisma.species.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Orden de sincronización del primer sync tras trabajar offline (Fase 3.5 §21-22)", () => {
  it("§21 con el orden de selectReadyOperations, el primer sync se aplica completo, sin errores de llave foránea", async () => {
    const deviceId = "device-a";
    const { logical } = buildOfflineDataset(deviceId);

    // `createdAt` en orden INVERSO a las dependencias reales: si el motor
    // dependiera de ese timestamp (comportamiento previo a la Fase 3.5),
    // este dataset fallaría.
    const items = logical.map((entry, index) =>
      queueItem({
        ...entry,
        createdAt: reversedTimestamp(index, logical.length - 1),
        deviceId,
      }),
    );

    const sorted = selectReadyOperations(items, items);
    expect(sorted).toHaveLength(items.length);

    // Verifica que el orden calculado sí respeta las dependencias reales
    // (Species/Pond antes que FishBatch, antes que Stocking, antes que los
    // eventos de nivel 4) — no es una casualidad del test.
    const indexOf = (entityType: SyncEntityType) =>
      sorted.findIndex((item) => item.entityType === entityType);
    expect(indexOf("Species")).toBeLessThan(indexOf("FishBatch"));
    expect(indexOf("FishBatch")).toBeLessThan(indexOf("Stocking"));
    expect(indexOf("Stocking")).toBeLessThan(indexOf("RegisterFeeding"));
    expect(indexOf("CreateFeedWithInitialStock")).toBeLessThan(indexOf("RegisterFeeding"));
    expect(indexOf("Stocking")).toBeLessThan(indexOf("FishTransfer"));
    expect(indexOf("Stocking")).toBeLessThan(indexOf("MortalityRecord"));
    expect(indexOf("Stocking")).toBeLessThan(indexOf("Sampling"));

    const results = await pushSequentially(sorted);

    const failed = results.filter((r) => r.status === "error");
    expect(failed).toEqual([]); // ni un solo error de llave foránea
    expect(results.every((r) => r.status === "applied")).toBe(true);
  });

  it("contraste: el mismo dataset, enviado en el orden ingenuo por createdAt, SÍ produce errores de llave foránea", async () => {
    const deviceId = "device-b";
    const { logical } = buildOfflineDataset(deviceId);

    const items = logical.map((entry, index) =>
      queueItem({
        ...entry,
        createdAt: reversedTimestamp(index, logical.length - 1),
        deviceId,
      }),
    );

    // El comportamiento anterior a la Fase 3.5: ordenar solo por
    // `createdAt`, sin nivel de prioridad ni dependencias explícitas.
    const naiveOrder = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const results = await pushSequentially(naiveOrder);

    const failed = results.filter((r) => r.status === "error");
    // Con este dataset (creado a propósito con timestamps invertidos), el
    // orden ingenuo intenta crear FishBatch antes que Species, Stocking
    // antes que FishBatch, etc. — confirma que el problema que resuelve
    // `selectReadyOperations` es real, no cosmético.
    expect(failed.length).toBeGreaterThan(0);
  });

  it("§22 tras un fallo transitorio en una operación intermedia, un siguiente intento continúa sin perder ni duplicar nada", async () => {
    const deviceId = "device-c";
    const { logical, ids } = buildOfflineDataset(deviceId);

    const items = logical.map((entry, index) =>
      queueItem({
        ...entry,
        createdAt: reversedTimestamp(index, logical.length - 1),
        deviceId,
      }),
    );
    const sorted = selectReadyOperations(items, items);

    // Simula un fallo transitorio de servidor en una operación intermedia
    // (Stocking): en vez de enviarla en el primer intento, se omite del
    // primer lote — como si esa solicitud HTTP concreta se hubiera
    // perdido — y se reintenta sola después, exactamente como haría
    // `runSync` en una siguiente llamada.
    const stockingIndex = sorted.findIndex((item) => item.entityType === "Stocking");
    const stockingItem = sorted[stockingIndex];
    const firstAttempt = [...sorted.slice(0, stockingIndex), ...sorted.slice(stockingIndex + 1)];

    const firstResults = await pushSequentially(firstAttempt);
    // MortalityRecord y FishTransfer validan el balance del estanque
    // (getCurrentPondBalance, que lee Stocking): sin Stocking, el balance
    // disponible es 0, así que deben quedar en "conflict", nunca
    // "applied" con datos inventados. (RegisterFeeding y Sampling NO
    // dependen del balance de peces del estanque — RegisterFeeding solo
    // valida stock de alimento, Sampling no valida nada — así que sí
    // pueden aplicarse igual sin Stocking; eso es correcto y no es lo que
    // esta prueba verifica.)
    const balanceDependentTypes = ["MortalityRecord", "FishTransfer"];
    const balanceDependentResults = firstAttempt
      .map((item, i) => ({ item, result: firstResults[i] }))
      .filter(({ item }) => balanceDependentTypes.includes(item.entityType));
    expect(balanceDependentResults).toHaveLength(2);
    expect(balanceDependentResults.every(({ result }) => result.status === "conflict")).toBe(true);

    // Segundo intento: se reenvía SOLO lo que falló (mismo operationId,
    // idempotente) más la operación que se había "perdido" — igual que
    // haría el motor de sync en la siguiente llamada a runSync.
    const pendingRetry = firstAttempt.filter((_, i) => firstResults[i].status !== "applied");
    const secondAttempt = [stockingItem, ...pendingRetry];
    const secondResults = await pushSequentially(secondAttempt);

    expect(secondResults.every((r) => r.status === "applied")).toBe(true);

    // Nada se perdió ni se duplicó: exactamente un FishBatch, un Stocking,
    // un FeedingRecord, una mortalidad, un muestreo, un traslado.
    expect(await prisma.fishBatch.count({ where: { id: ids.batchId } })).toBe(1);
    expect(await prisma.stocking.count({ where: { batchId: ids.batchId } })).toBe(1);
    expect(await prisma.feedingRecord.count({ where: { batchId: ids.batchId } })).toBe(1);
    expect(await prisma.mortalityRecord.count({ where: { batchId: ids.batchId } })).toBe(1);
    expect(await prisma.sampling.count({ where: { batchId: ids.batchId } })).toBe(1);
    expect(await prisma.fishTransfer.count({ where: { batchId: ids.batchId } })).toBe(1);
  });
});
