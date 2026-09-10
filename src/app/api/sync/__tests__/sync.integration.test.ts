// Pruebas de integración de /api/sync/push y /api/sync/pull contra una
// base de datos PostgreSQL real (piscicultura_test, ver src/test/setup.ts).
// No se mockea Prisma: el requisito crítico de esta fase es que la
// idempotencia y la resolución de conflictos funcionen de verdad, no solo
// en teoría.
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

beforeEach(async () => {
  // Orden respetando las llaves foráneas: los tests de otros archivos
  // (fishTransfer.integration.test.ts, dailyOperations.integration.test.ts,
  // economics.integration.test.ts) comparten esta misma base de datos de
  // pruebas y pueden dejar filas colgando de Species/Pond/FishBatch/Feed
  // si no se limpia todo en cada beforeEach — incluidas las entidades de
  // Fase 5 (Harvest/Sale/... referencian FishBatch/Pond, así que deben
  // limpiarse ANTES para no violar su FK al borrar el lote/estanque).
  await prisma.syncOperation.deleteMany();
  await prisma.saleLine.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.harvest.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.purchaseLine.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.task.deleteMany();
  await prisma.waterQualityRecord.deleteMany();
  await prisma.feedingRecord.deleteMany();
  await prisma.mortalityRecord.deleteMany();
  await prisma.sampling.deleteMany();
  await prisma.feedInventoryMovement.deleteMany();
  await prisma.feed.deleteMany();
  await prisma.fishTransfer.deleteMany();
  await prisma.stocking.deleteMany();
  await prisma.fishBatch.deleteMany();
  await prisma.species.deleteMany();
  await prisma.pond.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /api/sync/push", () => {
  it("aplica una operación CREATE una sola vez aunque se reenvíe varias veces", async () => {
    const payload = speciesPayload();
    const body = {
      deviceId: "device-a",
      operations: [
        {
          id: randomUUID(),
          entityType: "Species" as const,
          entityId: payload.id,
          operation: "CREATE" as const,
          deviceId: "device-a",
          payload,
        },
      ],
    };

    const first = await (await pushHandler(pushRequest(body))).json();
    const second = await (await pushHandler(pushRequest(body))).json();
    const third = await (await pushHandler(pushRequest(body))).json();

    expect(first.results[0].status).toBe("applied");
    expect(second.results[0].status).toBe("duplicate");
    expect(third.results[0].status).toBe("duplicate");

    const rows = await prisma.species.findMany({ where: { id: payload.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].commonName).toBe("Pacú");
  });

  it("Fase 7 (hardening): dos solicitudes CONCURRENTES con el MISMO operationId nunca terminan en 'error' aunque choquen en la llave primaria de la entidad", async () => {
    // Reproduce el escenario real encontrado en E2E
    // (productionReadiness.spec.ts, paso "reconectar y sincronizar"): una
    // página abandona un `push` en curso (navega antes de que la
    // respuesta llegue — ver OFFLINE_SYNC.md §14.4) y una página nueva
    // reintenta el MISMO elemento del outbox (mismo operationId, mismo
    // entityId) casi al mismo tiempo — la solicitud original puede seguir
    // procesándose en el servidor. A diferencia del test anterior
    // (reenvíos SECUENCIALES, donde el primero siempre ya terminó antes
    // del segundo), aquí dos solicitudes para el mismo operationId se
    // lanzan REALMENTE en paralelo (Promise.all sobre dos invocaciones
    // HTTP separadas), forzando la condición de carrera real: ambas
    // pueden ver `existing == null` antes de que ninguna haya
    // confirmado, y la perdedora choca contra la llave primaria de la
    // propia entidad (`mortality_records_pkey`, siempre `entityId`) en
    // vez de contra `SyncOperation.operationId` — un caso que el chequeo
    // original (`isUniqueConstraintOnOperationId`) no reconocía y que
    // antes de esta corrección se devolvía como "error" genuino, aun
    // cuando la operación sí se había aplicado con éxito del otro lado.
    const speciesId = randomUUID();
    await pushHandler(
      pushRequest({
        deviceId: "device-a",
        operations: [
          {
            id: randomUUID(),
            entityType: "Species",
            entityId: speciesId,
            operation: "CREATE",
            deviceId: "device-a",
            payload: speciesPayload({ id: speciesId }),
          },
        ],
      }),
    );
    const pondId = randomUUID();
    await pushHandler(
      pushRequest({
        deviceId: "device-a",
        operations: [
          {
            id: randomUUID(),
            entityType: "Pond",
            entityId: pondId,
            operation: "CREATE",
            deviceId: "device-a",
            payload: {
              id: pondId,
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
              capacityNotes: null,
              locationNotes: null,
              notes: null,
              status: "ACTIVE",
              active: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              deletedAt: null,
              version: 1,
              deviceId: "device-a",
              createdBy: null,
              updatedBy: null,
            },
          },
        ],
      }),
    );
    const batchId = randomUUID();
    const now = new Date().toISOString();
    await pushHandler(
      pushRequest({
        deviceId: "device-a",
        operations: [
          {
            id: randomUUID(),
            entityType: "FishBatch",
            entityId: batchId,
            operation: "CREATE",
            deviceId: "device-a",
            payload: {
              id: batchId,
              code: "PAC-2026-001-0000",
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
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
              version: 1,
              deviceId: "device-a",
              createdBy: null,
              updatedBy: null,
            },
          },
          {
            id: randomUUID(),
            entityType: "Stocking",
            entityId: randomUUID(),
            operation: "CREATE",
            deviceId: "device-a",
            payload: {
              id: randomUUID(),
              batchId,
              pondId,
              date: now,
              quantity: 1000,
              averageWeightG: 15,
              biomassKg: 15,
              responsibleName: null,
              notes: null,
              deviceId: "device-a",
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
            },
          },
        ],
      }),
    );

    const operationId = randomUUID();
    const mortalityId = randomUUID();
    const mortalityBody = {
      deviceId: "device-a",
      operations: [
        {
          id: operationId,
          entityType: "MortalityRecord" as const,
          entityId: mortalityId,
          operation: "CREATE" as const,
          deviceId: "device-a",
          payload: {
            id: mortalityId,
            batchId,
            pondId,
            date: now,
            quantity: 5,
            estimatedAverageWeightG: null,
            cause: "UNKNOWN",
            notes: null,
            responsibleName: null,
            deviceId: "device-a",
            createdAt: now,
            deletedAt: null,
          },
        },
      ],
    };

    // Las dos solicitudes comparten el mismo operationId Y el mismo
    // entityId — exactamente lo que hace el motor de sync al reintentar
    // el mismo elemento del outbox que abandonó una página anterior.
    const [resultA, resultB] = await Promise.all([
      pushHandler(pushRequest(mortalityBody)),
      pushHandler(pushRequest(mortalityBody)),
    ]);
    const [jsonA, jsonB] = await Promise.all([resultA.json(), resultB.json()]);

    const statuses = [jsonA.results[0].status, jsonB.results[0].status].sort();
    // Nunca "error": una de las dos gana ("applied"), la otra pierde la
    // carrera pero se reconoce como el mismo trabajo ya hecho
    // ("duplicate") — nunca se reporta como un fallo real.
    expect(statuses).toEqual(["applied", "duplicate"]);

    const rows = await prisma.mortalityRecord.findMany({ where: { id: mortalityId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(5);

    const syncOp = await prisma.syncOperation.findUnique({ where: { operationId } });
    expect(syncOp?.status).toBe("applied");
  });

  it("aplica un UPDATE con versión más nueva y descarta uno con versión igual o menor (conflicto)", async () => {
    const entityId = randomUUID();
    const createPayload = speciesPayload({ id: entityId, version: 1 });

    await pushHandler(
      pushRequest({
        deviceId: "device-a",
        operations: [
          {
            id: randomUUID(),
            entityType: "Species",
            entityId,
            operation: "CREATE",
            deviceId: "device-a",
            payload: createPayload,
          },
        ],
      }),
    );

    const updatePayload = speciesPayload({
      id: entityId,
      version: 2,
      commonName: "Pacú (actualizado)",
    });
    const updateResult = await (
      await pushHandler(
        pushRequest({
          deviceId: "device-a",
          operations: [
            {
              id: randomUUID(),
              entityType: "Species",
              entityId,
              operation: "UPDATE",
              deviceId: "device-a",
              payload: updatePayload,
            },
          ],
        }),
      )
    ).json();
    expect(updateResult.results[0].status).toBe("applied");

    const stalePayload = speciesPayload({
      id: entityId,
      version: 1,
      commonName: "Pacú (versión vieja, no debería aplicarse)",
    });
    const staleResult = await (
      await pushHandler(
        pushRequest({
          deviceId: "device-b",
          operations: [
            {
              id: randomUUID(),
              entityType: "Species",
              entityId,
              operation: "UPDATE",
              deviceId: "device-b",
              payload: stalePayload,
            },
          ],
        }),
      )
    ).json();
    expect(staleResult.results[0].status).toBe("conflict");

    const finalRow = await prisma.species.findUniqueOrThrow({ where: { id: entityId } });
    expect(finalRow.commonName).toBe("Pacú (actualizado)");
    expect(finalRow.version).toBe(2);
  });

  it("rechaza una operación con un payload inválido (validación de servidor)", async () => {
    const response = await pushHandler(
      pushRequest({
        deviceId: "device-a",
        operations: [
          {
            id: randomUUID(),
            entityType: "Species",
            entityId: randomUUID(),
            operation: "CREATE",
            deviceId: "device-a",
            payload: { commonName: "" }, // faltan campos requeridos
          },
        ],
      }),
    );

    expect(response.status).toBe(400);
  });
});

describe("GET /api/sync/pull", () => {
  it("solo entrega cambios posteriores al cursor 'since'", async () => {
    const first = speciesPayload({ commonName: "Pacú" });
    await pushHandler(
      pushRequest({
        deviceId: "device-a",
        operations: [
          {
            id: randomUUID(),
            entityType: "Species",
            entityId: first.id,
            operation: "CREATE",
            deviceId: "device-a",
            payload: first,
          },
        ],
      }),
    );

    const firstPull = await (await pullHandler(pullRequest())).json();
    expect(firstPull.species).toHaveLength(1);
    const cursor = firstPull.serverTime as string;

    // Nada nuevo desde el cursor recién obtenido.
    const emptyPull = await (await pullHandler(pullRequest(cursor))).json();
    expect(emptyPull.species).toHaveLength(0);

    // Espera 5ms para asegurar updatedAt estrictamente posterior al cursor.
    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = speciesPayload({ commonName: "Tilapia" });
    await pushHandler(
      pushRequest({
        deviceId: "device-a",
        operations: [
          {
            id: randomUUID(),
            entityType: "Species",
            entityId: second.id,
            operation: "CREATE",
            deviceId: "device-a",
            payload: second,
          },
        ],
      }),
    );

    const incrementalPull = await (await pullHandler(pullRequest(cursor))).json();
    expect(incrementalPull.species).toHaveLength(1);
    expect(incrementalPull.species[0].commonName).toBe("Tilapia");
  });
});
