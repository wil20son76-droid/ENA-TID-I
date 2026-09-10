// Pruebas de integración de autenticación y permisos en /api/sync/push y
// /api/sync/pull (Fase 7, §"Protección de API y rutas" /
// §"Validación de permisos también en servidor") contra PostgreSQL real
// (piscicultura_test) — sin mocks, mismo criterio que el resto de la
// suite de sync. Cubre: rechazo sin token, rechazo por rol insuficiente
// (por entityType), lectura universal para cualquier rol autenticado
// (incluido solo lectura), usuario inactivo, y revocación de sesión
// (tokenVersion) efectiva en el siguiente intento de sync.
import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/server/prisma";
import { authHeader, createTestUser } from "@/test/authTestHelpers";
import { POST as pushHandler } from "../push/route";
import { GET as pullHandler } from "../pull/route";

function pushRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/sync/push", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function pullRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/sync/pull", { headers });
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

function speciesPayload(deviceId: string, overrides: Record<string, unknown> = {}) {
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
    ...auditFields(deviceId),
    ...overrides,
  };
}

async function pushOne(
  token: string,
  entityType: string,
  entityId: string,
  payload: unknown,
  deviceId: string,
) {
  const response = await pushHandler(
    pushRequest(
      {
        deviceId,
        operations: [{ id: randomUUID(), entityType, entityId, operation: "CREATE", deviceId, payload }],
      },
      authHeader(token),
    ),
  );
  const body = await response.json();
  return body.results[0] as { id: string; status: string; error?: string };
}

/** Lote sembrado en un estanque (mismo criterio que dailyOperations.integration.test.ts) — usando un token ADMIN para el catálogo. */
async function setUpBatchInPond(adminToken: string, deviceId: string, initialQuantity: number) {
  const speciesId = randomUUID();
  await pushOne(adminToken, "Species", speciesId, speciesPayload(deviceId, { id: speciesId }), deviceId);

  const pondId = randomUUID();
  await pushOne(
    adminToken,
    "Pond",
    pondId,
    {
      id: pondId,
      code: `E01-${pondId.slice(0, 4)}`,
      name: "Estanque",
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
    deviceId,
  );

  const batchId = randomUUID();
  const now = new Date().toISOString();
  await pushOne(
    adminToken,
    "FishBatch",
    batchId,
    {
      id: batchId,
      code: `PAC-2026-${batchId.slice(0, 6)}`,
      speciesId,
      supplierId: null,
      purchaseDate: null,
      initialStockingDate: now,
      initialQuantity,
      initialAverageWeightG: 15,
      initialBiomassKg: (initialQuantity * 15) / 1000,
      fryCost: null,
      targetWeightKg: null,
      expectedHarvestDate: null,
      status: "STOCKED",
      notes: null,
      ...auditFields(deviceId),
    },
    deviceId,
  );

  const stockingId = randomUUID();
  await pushOne(
    adminToken,
    "Stocking",
    stockingId,
    {
      id: stockingId,
      batchId,
      pondId,
      date: now,
      quantity: initialQuantity,
      averageWeightG: 15,
      biomassKg: (initialQuantity * 15) / 1000,
      responsibleName: null,
      notes: null,
      deviceId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    deviceId,
  );

  return { batchId, pondId };
}

beforeEach(async () => {
  await prisma.syncOperation.deleteMany();
  await prisma.mortalityRecord.deleteMany();
  await prisma.task.deleteMany();
  await prisma.stocking.deleteMany();
  await prisma.fishBatch.deleteMany();
  await prisma.species.deleteMany();
  await prisma.pond.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("autenticación en /api/sync/push y /api/sync/pull", () => {
  it("push sin Authorization se rechaza con 401 y no toca la base", async () => {
    const payload = speciesPayload("device-a");
    const response = await pushHandler(
      pushRequest({
        deviceId: "device-a",
        operations: [
          { id: randomUUID(), entityType: "Species", entityId: payload.id, operation: "CREATE", deviceId: "device-a", payload },
        ],
      }),
    );
    expect(response.status).toBe(401);
    expect(await prisma.species.count()).toBe(0);
  });

  it("pull sin Authorization se rechaza con 401", async () => {
    const response = await pullHandler(pullRequest());
    expect(response.status).toBe(401);
  });

  it("push con un token con formato inválido se rechaza con 401", async () => {
    const response = await pushHandler(
      pushRequest(
        { deviceId: "device-a", operations: [] },
        { authorization: "Bearer no-es-un-jwt-valido" },
      ),
    );
    expect(response.status).toBe(401);
  });

  it("un usuario inactivo no puede sincronizar aunque presente un token con firma válida", async () => {
    const { user, token } = await createTestUser("ADMIN");
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    const response = await pullHandler(pullRequest(authHeader(token)));
    expect(response.status).toBe(401);
  });

  it("revocar sesiones (tokenVersion++) invalida un token ya emitido en el siguiente intento de sync", async () => {
    const { user, token } = await createTestUser("MANAGER");

    const before = await pullHandler(pullRequest(authHeader(token)));
    expect(before.status).toBe(200);

    await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } });

    const after = await pullHandler(pullRequest(authHeader(token)));
    expect(after.status).toBe(401);
  });
});

describe("permisos por rol en /api/sync/push", () => {
  it("un Trabajador no puede crear una Especie (MANAGE_CATALOG): la operación se rechaza sin escribir nada", async () => {
    const { token } = await createTestUser("WORKER");
    const payload = speciesPayload("device-worker");
    const result = await pushOne(token, "Species", payload.id, payload, "device-worker");

    expect(result.status).toBe("error");
    expect(result.error).toMatch(/permiso/i);
    expect(await prisma.species.count()).toBe(0);
  });

  it("un Trabajador SÍ puede registrar mortalidad (FIELD_OPS) sobre un lote ya sembrado", async () => {
    const { token: adminToken } = await createTestUser("ADMIN");
    const { token: workerToken } = await createTestUser("WORKER");
    const { batchId, pondId } = await setUpBatchInPond(adminToken, "device-admin", 1000);

    const mortalityId = randomUUID();
    const result = await pushOne(
      workerToken,
      "MortalityRecord",
      mortalityId,
      {
        id: mortalityId,
        batchId,
        pondId,
        date: new Date().toISOString(),
        quantity: 10,
        estimatedAverageWeightG: null,
        cause: "UNKNOWN",
        notes: null,
        responsibleName: null,
        deviceId: "device-worker",
        createdAt: new Date().toISOString(),
        deletedAt: null,
      },
      "device-worker",
    );

    expect(result.status).toBe("applied");
    expect(await prisma.mortalityRecord.count()).toBe(1);
  });

  it("Solo lectura no puede escribir NINGÚN entityType, ni siquiera operación de campo", async () => {
    const { token } = await createTestUser("READ_ONLY");
    const taskId = randomUUID();
    const result = await pushOne(
      token,
      "Task",
      taskId,
      {
        id: taskId,
        title: "Revisar estanque",
        description: null,
        dueDate: new Date().toISOString(),
        dueTime: null,
        priority: "NORMAL",
        status: "PENDING",
        pondId: null,
        batchId: null,
        assignedToName: null,
        notes: null,
        completedAt: null,
        ...auditFields("device-readonly"),
      },
      "device-readonly",
    );

    expect(result.status).toBe("error");
    expect(result.error).toMatch(/permiso/i);
    expect(await prisma.task.count()).toBe(0);
  });

  it("Solo lectura SÍ puede leer (pull) — la restricción de rol nunca aplica a la lectura", async () => {
    const { token } = await createTestUser("READ_ONLY");
    const response = await pullHandler(pullRequest(authHeader(token)));
    expect(response.status).toBe(200);
  });

  it("un Encargado puede crear catálogos Y economía (Purchase/Sale se prueban en otras suites; aquí solo Species)", async () => {
    const { token } = await createTestUser("MANAGER");
    const payload = speciesPayload("device-manager");
    const result = await pushOne(token, "Species", payload.id, payload, "device-manager");
    expect(result.status).toBe("applied");
  });
});
