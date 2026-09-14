// Pruebas de integración de la función "Ración recomendada" contra
// PostgreSQL real (piscicultura_test): sincronización de
// FeedingRecommendation (LWW mutable, igual criterio que Species/Pond) y
// del ajuste manual de ración en Pond (manualDailyRationKg/
// manualFeedingsPerDay) — comprobando en particular que NINGUNA de las dos
// operaciones toca nunca el inventario de alimento (§"Ajuste manual" del
// encargo: "Modificar la recomendación NO debe registrar automáticamente
// una alimentación ni descontar inventario").
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/server/prisma";
import { authHeader, createTestUser } from "@/test/authTestHelpers";
import { POST as pushHandler } from "../push/route";
import { GET as pullHandler } from "../pull/route";

let testToken: string;

beforeAll(async () => {
  ({ token: testToken } = await createTestUser());
});

function pushRequest(body: unknown) {
  return new Request("http://localhost/api/sync/push", {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeader(testToken) },
    body: JSON.stringify(body),
  });
}

function pullRequest(since?: string) {
  const url = new URL("http://localhost/api/sync/pull");
  if (since) url.searchParams.set("since", since);
  return new Request(url, { headers: authHeader(testToken) });
}

function speciesPayload(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
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
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1,
    deviceId: "device-a",
    createdBy: null,
    updatedBy: null,
    ...overrides,
  };
}

function pondPayload(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    code: "E01",
    name: "Estanque Norte",
    type: null,
    lengthM: null,
    widthM: null,
    averageDepthM: null,
    areaM2: null,
    areaSource: "CALCULATED",
    estimatedVolumeM3: null,
    volumeSource: "CALCULATED",
    manualDailyRationKg: null,
    manualFeedingsPerDay: null,
    capacityNotes: null,
    locationNotes: null,
    notes: null,
    status: "ACTIVE",
    active: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1,
    deviceId: "device-a",
    createdBy: null,
    updatedBy: null,
    ...overrides,
  };
}

function feedingRecommendationPayload(
  speciesId: string,
  overrides: Record<string, unknown> = {},
) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    speciesId,
    minWeightG: 200,
    maxWeightG: 500,
    feedPercent: 3,
    feedingsPerDay: 3,
    active: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1,
    deviceId: "device-a",
    createdBy: null,
    updatedBy: null,
    ...overrides,
  };
}

beforeEach(async () => {
  await prisma.syncOperation.deleteMany();
  await prisma.feedingRecommendation.deleteMany();
  await prisma.feedInventoryMovement.deleteMany();
  await prisma.feedingRecord.deleteMany();
  await prisma.mortalityRecord.deleteMany();
  await prisma.sampling.deleteMany();
  await prisma.fishTransfer.deleteMany();
  await prisma.stocking.deleteMany();
  await prisma.feed.deleteMany();
  await prisma.fishBatch.deleteMany();
  await prisma.species.deleteMany();
  await prisma.pond.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Sincronización de FeedingRecommendation", () => {
  it("aplica un CREATE y lo entrega en el siguiente pull", async () => {
    const species = speciesPayload();
    await pushHandler(
      pushRequest({
        deviceId: "device-a",
        operations: [
          {
            id: randomUUID(),
            entityType: "Species",
            entityId: species.id,
            operation: "CREATE",
            deviceId: "device-a",
            payload: species,
          },
        ],
      }),
    );

    const recommendation = feedingRecommendationPayload(species.id);
    const pushResult = await (
      await pushHandler(
        pushRequest({
          deviceId: "device-a",
          operations: [
            {
              id: randomUUID(),
              entityType: "FeedingRecommendation",
              entityId: recommendation.id,
              operation: "CREATE",
              deviceId: "device-a",
              payload: recommendation,
            },
          ],
        }),
      )
    ).json();
    expect(pushResult.results[0].status).toBe("applied");

    const pullResult = await (await pullHandler(pullRequest())).json();
    const pulled = pullResult.feedingRecommendations.find(
      (r: { id: string }) => r.id === recommendation.id,
    );
    expect(pulled).toBeDefined();
    expect(pulled.speciesId).toBe(species.id);
    expect(pulled.minWeightG).toBe(200);
    expect(pulled.maxWeightG).toBe(500);
    expect(pulled.feedPercent).toBe(3);
    expect(pulled.feedingsPerDay).toBe(3);
  });

  it("resuelve conflictos por versión (last-write-wins), igual que Species/Pond/Feed", async () => {
    const species = speciesPayload();
    await pushHandler(
      pushRequest({
        deviceId: "device-a",
        operations: [
          {
            id: randomUUID(),
            entityType: "Species",
            entityId: species.id,
            operation: "CREATE",
            deviceId: "device-a",
            payload: species,
          },
        ],
      }),
    );

    const recommendation = feedingRecommendationPayload(species.id);
    await pushHandler(
      pushRequest({
        deviceId: "device-a",
        operations: [
          {
            id: randomUUID(),
            entityType: "FeedingRecommendation",
            entityId: recommendation.id,
            operation: "CREATE",
            deviceId: "device-a",
            payload: recommendation,
          },
        ],
      }),
    );

    // Un UPDATE con la MISMA versión (1) que ya está aplicada nunca
    // sobrescribe: se reporta como conflicto, visible para revisión.
    const staleUpdate = feedingRecommendationPayload(species.id, {
      id: recommendation.id,
      feedPercent: 6,
      version: 1,
    });
    const staleResult = await (
      await pushHandler(
        pushRequest({
          deviceId: "device-b",
          operations: [
            {
              id: randomUUID(),
              entityType: "FeedingRecommendation",
              entityId: recommendation.id,
              operation: "UPDATE",
              deviceId: "device-b",
              payload: staleUpdate,
            },
          ],
        }),
      )
    ).json();
    expect(staleResult.results[0].status).toBe("conflict");

    const newerUpdate = feedingRecommendationPayload(species.id, {
      id: recommendation.id,
      feedPercent: 4,
      version: 2,
    });
    const newerResult = await (
      await pushHandler(
        pushRequest({
          deviceId: "device-b",
          operations: [
            {
              id: randomUUID(),
              entityType: "FeedingRecommendation",
              entityId: recommendation.id,
              operation: "UPDATE",
              deviceId: "device-b",
              payload: newerUpdate,
            },
          ],
        }),
      )
    ).json();
    expect(newerResult.results[0].status).toBe("applied");

    const stored = await prisma.feedingRecommendation.findUnique({
      where: { id: recommendation.id },
    });
    expect(Number(stored?.feedPercent)).toBe(4);
  });
});

describe("Ajuste manual de ración del estanque (manualDailyRationKg/manualFeedingsPerDay)", () => {
  it("un UPDATE de Pond con el ajuste manual nunca crea movimientos de inventario de alimento", async () => {
    const pond = pondPayload();
    await pushHandler(
      pushRequest({
        deviceId: "device-a",
        operations: [
          {
            id: randomUUID(),
            entityType: "Pond",
            entityId: pond.id,
            operation: "CREATE",
            deviceId: "device-a",
            payload: pond,
          },
        ],
      }),
    );

    const movementsBefore = await prisma.feedInventoryMovement.count();
    const feedingRecordsBefore = await prisma.feedingRecord.count();

    const updated = {
      ...pond,
      manualDailyRationKg: 13.5,
      manualFeedingsPerDay: 3,
      version: 2,
      updatedAt: new Date().toISOString(),
    };
    const result = await (
      await pushHandler(
        pushRequest({
          deviceId: "device-a",
          operations: [
            {
              id: randomUUID(),
              entityType: "Pond",
              entityId: pond.id,
              operation: "UPDATE",
              deviceId: "device-a",
              payload: updated,
            },
          ],
        }),
      )
    ).json();
    expect(result.results[0].status).toBe("applied");

    // El ajuste manual queda guardado en el propio Pond...
    const stored = await prisma.pond.findUnique({ where: { id: pond.id } });
    expect(Number(stored?.manualDailyRationKg)).toBe(13.5);
    expect(stored?.manualFeedingsPerDay).toBe(3);

    // ...pero NUNCA descuenta inventario ni crea un registro de
    // alimentación: solo un FeedingRecord/RegisterFeeding real hace eso
    // (ver applyRegisterFeedingOperation en applyOperation.ts).
    expect(await prisma.feedInventoryMovement.count()).toBe(movementsBefore);
    expect(await prisma.feedingRecord.count()).toBe(feedingRecordsBefore);
  });

  it("el pull entrega el ajuste manual del estanque junto con el resto de sus campos", async () => {
    const pond = pondPayload({ manualDailyRationKg: 13.5, manualFeedingsPerDay: 2 });
    await pushHandler(
      pushRequest({
        deviceId: "device-a",
        operations: [
          {
            id: randomUUID(),
            entityType: "Pond",
            entityId: pond.id,
            operation: "CREATE",
            deviceId: "device-a",
            payload: pond,
          },
        ],
      }),
    );

    const pullResult = await (await pullHandler(pullRequest())).json();
    const pulled = pullResult.ponds.find((p: { id: string }) => p.id === pond.id);
    expect(pulled).toBeDefined();
    expect(pulled.manualDailyRationKg).toBe(13.5);
    expect(pulled.manualFeedingsPerDay).toBe(2);
  });
});
