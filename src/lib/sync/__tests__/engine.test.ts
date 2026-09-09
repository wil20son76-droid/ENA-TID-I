import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFishBatchWithStocking } from "../../db/repositories/fishBatchRepository";
import { createFeedingWithConsumption } from "../../db/repositories/feedingRepository";
import { createFeed } from "../../db/repositories/feedRepository";
import { createPond } from "../../db/repositories/pondRepository";
import { createSpecies } from "../../db/repositories/speciesRepository";
import { db } from "../../db/schema";
import { runSync } from "../engine";
import { getSyncStatus } from "../status";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function emptyPullResponse() {
  return {
    species: [],
    ponds: [],
    fishBatches: [],
    stockings: [],
    fishTransfers: [],
    feeds: [],
    feedInventoryMovements: [],
    feedingRecords: [],
    mortalityRecords: [],
    samplings: [],
    serverTime: new Date().toISOString(),
  };
}

describe("runSync", () => {
  beforeEach(async () => {
    await db.species.clear();
    await db.ponds.clear();
    await db.fishBatches.clear();
    await db.stockings.clear();
    await db.fishTransfers.clear();
    await db.feeds.clear();
    await db.feedInventoryMovements.clear();
    await db.feedingRecords.clear();
    await db.mortalityRecords.clear();
    await db.samplings.clear();
    await db.syncQueue.clear();
    await db.syncMeta.clear();
    vi.restoreAllMocks();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });

  it("push aplicado: el elemento se marca synced y se purga del outbox", async () => {
    await createSpecies({ commonName: "Pacú" });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/sync/push")) {
        const before = await db.syncQueue.toArray();
        return jsonResponse({
          results: before.map((op) => ({ id: op.id, status: "applied" })),
          serverTime: new Date().toISOString(),
        });
      }
      return jsonResponse(emptyPullResponse());
    });
    vi.stubGlobal("fetch", fetchMock);

    await runSync();

    const queue = await db.syncQueue.toArray();
    expect(queue).toHaveLength(0); // synced -> purgado
    const meta = await db.syncMeta.get("lastSyncedAt");
    expect(meta?.value).toBeTruthy();
  });

  it("fallo de red: la operación queda en error, sin perder el dato local, y no se reintenta antes del backoff", async () => {
    const species = await createSpecies({ commonName: "Pacú" });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/sync/push")) {
        throw new Error("network down");
      }
      return jsonResponse(emptyPullResponse());
    });
    vi.stubGlobal("fetch", fetchMock);

    await runSync();

    // El dato sigue intacto en IndexedDB pese al fallo de red.
    const stored = await db.species.get(species.id);
    expect(stored?.commonName).toBe("Pacú");

    let queue = await db.syncQueue.toArray();
    expect(queue).toHaveLength(1);
    expect(queue[0].status).toBe("error");
    expect(queue[0].retryCount).toBe(1);

    const pushCallsAfterFirstRun = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/api/sync/push"),
    ).length;

    // Segundo intento inmediato SIN forzar: el backoff (5s base) todavía no
    // se cumplió, así que no debe reintentar la operación en error.
    await runSync();
    queue = await db.syncQueue.toArray();
    expect(queue[0].retryCount).toBe(1); // sin cambios

    const pushCallsAfterSecondRun = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/api/sync/push"),
    ).length;
    expect(pushCallsAfterSecondRun).toBe(pushCallsAfterFirstRun); // no se reintentó

    // Con force:true se ignora el backoff y se reintenta ya.
    await runSync({ force: true });
    queue = await db.syncQueue.toArray();
    expect(queue[0].retryCount).toBe(2);
  });

  it("conflicto de versión: se marca error con un mensaje explicativo, no se pierde el intento", async () => {
    await createSpecies({ commonName: "Pacú" });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/sync/push")) {
        const before = await db.syncQueue.toArray();
        return jsonResponse({
          results: before.map((op) => ({ id: op.id, status: "conflict" })),
          serverTime: new Date().toISOString(),
        });
      }
      return jsonResponse(emptyPullResponse());
    });
    vi.stubGlobal("fetch", fetchMock);

    await runSync();

    const queue = await db.syncQueue.toArray();
    expect(queue).toHaveLength(1);
    expect(queue[0].status).toBe("error");
    expect(queue[0].lastError).toMatch(/conflicto/i);
  });

  it("conflicto de una operación compuesta (RegisterFeeding): mensaje específico, no el genérico de versión (Fase 3.5 §23)", async () => {
    const species = await createSpecies({ commonName: "Pacú" });
    const pond = await createPond({ code: "E01", name: "Norte" });
    const { batch } = await createFishBatchWithStocking({
      speciesId: species.id,
      pondId: pond.id,
      initialStockingDate: "2026-09-10T00:00:00.000Z",
      initialQuantity: 1000,
      initialAverageWeightG: 15,
    });
    const feed = await createFeed({ name: "Crecimiento 32%", initialStockKg: 500 });
    await db.syncQueue.clear(); // solo interesa la operación de alimentación

    await createFeedingWithConsumption({
      batchId: batch.id,
      pondId: pond.id,
      feedId: feed.id,
      date: "2026-09-11T08:00:00.000Z",
      quantityKg: 18,
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/sync/push")) {
        const before = await db.syncQueue.toArray();
        return jsonResponse({
          results: before.map((op) => ({ id: op.id, status: "conflict" })),
          serverTime: new Date().toISOString(),
        });
      }
      return jsonResponse(emptyPullResponse());
    });
    vi.stubGlobal("fetch", fetchMock);

    await runSync();

    const queue = await db.syncQueue.toArray();
    expect(queue).toHaveLength(1);
    expect(queue[0].status).toBe("error");
    // Nunca el mensaje genérico de LWW, y nunca desglosado en dos errores
    // (Feeding / Inventory): un único incidente comprensible.
    expect(queue[0].lastError).toBe(
      "No se pudo sincronizar la alimentación de 18 kg porque el stock disponible cambió desde otro dispositivo.",
    );
    expect(queue[0].lastError).not.toMatch(/versión más reciente/);
  });

  it("sin conexión: no intenta red y no cambia el estado de la cola", async () => {
    await createSpecies({ commonName: "Pacú" });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await runSync();

    expect(fetchMock).not.toHaveBeenCalled();
    const queue = await db.syncQueue.toArray();
    expect(queue[0].status).toBe("pending");
  });

  it("un fallo real de red marca 'offline' aunque navigator.onLine siga en true", async () => {
    // navigator.onLine puede seguir reportando true sin conectividad real
    // (comprobado manualmente contra el navegador real con la red cortada:
    // ver IMPLEMENTATION_PLAN.md §7). fetch() sí distingue esto: rechaza
    // con un TypeError cuando la red falla de verdad, a diferencia de un
    // error HTTP normal (4xx/5xx), que resuelve la promesa igual.
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);

    await runSync();

    expect(getSyncStatus().connectivity).toBe("offline");
    expect(getSyncStatus().lastError).toBeTruthy();
  });

  it("pull aplica cambios remotos a Dexie sin volver a encolarlos en el outbox", async () => {
    const remoteId = crypto.randomUUID();
    const now = new Date().toISOString();

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/sync/push")) {
        return jsonResponse({ results: [], serverTime: now });
      }
      return jsonResponse({
        species: [
          {
            id: remoteId,
            commonName: "Tilapia",
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
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            version: 1,
            deviceId: "otro-dispositivo",
            createdBy: null,
            updatedBy: null,
          },
        ],
        ponds: [],
        fishBatches: [],
        stockings: [],
        fishTransfers: [],
        feeds: [],
        feedInventoryMovements: [],
        feedingRecords: [],
        mortalityRecords: [],
        samplings: [],
        serverTime: now,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await runSync();

    const stored = await db.species.get(remoteId);
    expect(stored?.commonName).toBe("Tilapia");

    const queue = await db.syncQueue.toArray();
    expect(queue).toHaveLength(0); // el registro remoto no generó una entrada de outbox
  });

  it("pull también aplica FishBatch/Stocking/FishTransfer remotos (Fase 2)", async () => {
    const now = new Date().toISOString();
    const batchId = crypto.randomUUID();
    const stockingId = crypto.randomUUID();
    const transferId = crypto.randomUUID();

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/sync/push")) {
        return jsonResponse({ results: [], serverTime: now });
      }
      return jsonResponse({
        species: [],
        ponds: [],
        fishBatches: [
          {
            id: batchId,
            code: "PAC-2026-001-0000",
            speciesId: "species-x",
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
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            version: 1,
            deviceId: "otro-dispositivo",
            createdBy: null,
            updatedBy: null,
          },
        ],
        stockings: [
          {
            id: stockingId,
            batchId,
            pondId: "pond-x",
            date: now,
            quantity: 1000,
            averageWeightG: 15,
            biomassKg: 15,
            responsibleName: null,
            notes: null,
            deviceId: "otro-dispositivo",
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          },
        ],
        fishTransfers: [
          {
            id: transferId,
            batchId,
            fromPondId: "pond-x",
            toPondId: "pond-y",
            date: now,
            quantity: 400,
            averageWeightG: null,
            biomassKg: null,
            reason: null,
            responsibleName: null,
            notes: null,
            deviceId: "otro-dispositivo",
            createdAt: now,
            deletedAt: null,
          },
        ],
        feeds: [],
        feedInventoryMovements: [],
        feedingRecords: [],
        mortalityRecords: [],
        samplings: [],
        serverTime: now,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await runSync();

    expect((await db.fishBatches.get(batchId))?.code).toBe("PAC-2026-001-0000");
    expect((await db.stockings.get(stockingId))?.quantity).toBe(1000);
    expect((await db.fishTransfers.get(transferId))?.quantity).toBe(400);

    const queue = await db.syncQueue.toArray();
    expect(queue).toHaveLength(0);
  });

  it("pull también aplica Feed/FeedInventoryMovement/FeedingRecord/MortalityRecord/Sampling remotos (Fase 3)", async () => {
    const now = new Date().toISOString();
    const feedId = crypto.randomUUID();
    const movementId = crypto.randomUUID();
    const feedingId = crypto.randomUUID();
    const mortalityId = crypto.randomUUID();
    const samplingId = crypto.randomUUID();

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/sync/push")) {
        return jsonResponse({ results: [], serverTime: now });
      }
      return jsonResponse({
        species: [],
        ponds: [],
        fishBatches: [],
        stockings: [],
        fishTransfers: [],
        feeds: [
          {
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
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            version: 1,
            deviceId: "otro-dispositivo",
            createdBy: null,
            updatedBy: null,
          },
        ],
        feedInventoryMovements: [
          {
            id: movementId,
            feedId,
            movementType: "INITIAL_STOCK",
            quantityKg: 500,
            unitCostPerKg: null,
            totalCost: null,
            date: now,
            sourceType: null,
            sourceId: null,
            notes: null,
            deviceId: "otro-dispositivo",
            createdAt: now,
            deletedAt: null,
          },
        ],
        feedingRecords: [
          {
            id: feedingId,
            batchId: "batch-x",
            pondId: "pond-x",
            feedId,
            date: now,
            time: null,
            quantityKg: 18,
            shift: "MORNING",
            responsibleName: null,
            notes: null,
            deviceId: "otro-dispositivo",
            createdAt: now,
            deletedAt: null,
          },
        ],
        mortalityRecords: [
          {
            id: mortalityId,
            batchId: "batch-x",
            pondId: "pond-x",
            date: now,
            quantity: 3,
            estimatedAverageWeightG: null,
            cause: "UNKNOWN",
            notes: null,
            responsibleName: null,
            deviceId: "otro-dispositivo",
            createdAt: now,
            deletedAt: null,
          },
        ],
        samplings: [
          {
            id: samplingId,
            batchId: "batch-x",
            pondId: "pond-x",
            date: now,
            sampleFishCount: 30,
            totalSampleWeightKg: 15.3,
            averageWeightG: 510,
            averageLengthCm: null,
            notes: null,
            responsibleName: null,
            deviceId: "otro-dispositivo",
            createdAt: now,
            deletedAt: null,
          },
        ],
        serverTime: now,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await runSync();

    expect((await db.feeds.get(feedId))?.name).toBe("Crecimiento 32%");
    expect((await db.feedInventoryMovements.get(movementId))?.quantityKg).toBe(500);
    expect((await db.feedingRecords.get(feedingId))?.quantityKg).toBe(18);
    expect((await db.mortalityRecords.get(mortalityId))?.quantity).toBe(3);
    expect((await db.samplings.get(samplingId))?.averageWeightG).toBe(510);

    const queue = await db.syncQueue.toArray();
    expect(queue).toHaveLength(0);
  });
});
