// Pruebas de integración de /api/sync/push y /api/sync/pull contra una
// base de datos PostgreSQL real (piscicultura_test, ver src/test/setup.ts).
// No se mockea Prisma: el requisito crítico de esta fase es que la
// idempotencia y la resolución de conflictos funcionen de verdad, no solo
// en teoría.
import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/server/prisma";
import { POST as pushHandler } from "../push/route";
import { GET as pullHandler } from "../pull/route";

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
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function pullRequest(since?: string) {
  const url = new URL("http://localhost/api/sync/pull");
  if (since) url.searchParams.set("since", since);
  return new Request(url);
}

beforeEach(async () => {
  await prisma.syncOperation.deleteMany();
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
