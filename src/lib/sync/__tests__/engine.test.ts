import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSpecies } from "../../db/repositories/speciesRepository";
import { db } from "../../db/schema";
import { runSync } from "../engine";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function emptyPullResponse() {
  return { species: [], ponds: [], serverTime: new Date().toISOString() };
}

describe("runSync", () => {
  beforeEach(async () => {
    await db.species.clear();
    await db.ponds.clear();
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
            targetWeightGrams: null,
            cultureDurationDays: null,
            minTemperatureC: null,
            maxTemperatureC: null,
            minPh: null,
            maxPh: null,
            minDissolvedOxygen: null,
            expectedFcr: null,
            expectedMortalityPct: null,
            notes: null,
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
});
