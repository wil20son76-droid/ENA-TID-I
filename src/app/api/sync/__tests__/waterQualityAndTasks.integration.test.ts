// Pruebas de integración de calidad del agua y tareas (Fase 4, §33-§34
// del encargo) contra PostgreSQL real (piscicultura_test), sin mocks.
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

function pullRequest() {
  return new Request("http://localhost/api/sync/pull", { headers: authHeader(testToken) });
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

async function pushBatch(
  ops: Array<{
    entityType: string;
    entityId: string;
    payload: unknown;
    deviceId: string;
    operation?: "CREATE" | "UPDATE" | "DELETE";
    operationId?: string;
  }>,
) {
  const response = await pushHandler(
    pushRequest({
      deviceId: ops[0]?.deviceId ?? "device-a",
      operations: ops.map((op) => ({
        id: op.operationId ?? randomUUID(),
        entityType: op.entityType,
        entityId: op.entityId,
        operation: op.operation ?? "CREATE",
        deviceId: op.deviceId,
        payload: op.payload,
      })),
    }),
  );
  const body = await response.json();
  return body.results as Array<{ id: string; status: string; error?: string }>;
}

async function pushOne(
  entityType: string,
  entityId: string,
  payload: unknown,
  deviceId: string,
  operation: "CREATE" | "UPDATE" | "DELETE" = "CREATE",
  operationId?: string,
) {
  const [result] = await pushBatch([{ entityType, entityId, payload, deviceId, operation, operationId }]);
  return result;
}

async function setUpPond(deviceId: string) {
  const pondId = randomUUID();
  await pushOne(
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
  return pondId;
}

function waterQualityPayload(opts: { pondId: string; ph: number; deviceId: string }) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    pondId: opts.pondId,
    batchId: null,
    date: now,
    time: null,
    temperatureC: null,
    ph: opts.ph,
    dissolvedOxygenMgL: null,
    transparencyCm: null,
    ammoniaMgL: null,
    nitriteMgL: null,
    alkalinityMgL: null,
    waterLevelCm: null,
    notes: null,
    responsibleName: null,
    deviceId: opts.deviceId,
    createdAt: now,
    deletedAt: null,
  };
}

function taskPayload(opts: {
  id?: string;
  title: string;
  status?: "PENDING" | "COMPLETED" | "CANCELLED";
  version?: number;
  deviceId: string;
}) {
  const now = new Date().toISOString();
  return {
    id: opts.id ?? randomUUID(),
    title: opts.title,
    description: null,
    dueDate: now,
    dueTime: null,
    priority: "NORMAL" as const,
    status: opts.status ?? "PENDING",
    pondId: null,
    batchId: null,
    assignedToName: null,
    notes: null,
    completedAt: opts.status === "COMPLETED" ? now : null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: opts.version ?? 1,
    deviceId: opts.deviceId,
    createdBy: null,
    updatedBy: null,
  };
}

beforeEach(async () => {
  await prisma.syncOperation.deleteMany();
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
  await prisma.pond.deleteMany();
  await prisma.species.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("WaterQualityRecord: idempotencia (§33)", () => {
  it("enviar la misma medición tres veces con el mismo operationId deja exactamente 1 fila", async () => {
    const deviceId = "device-a";
    const pondId = await setUpPond(deviceId);
    const payload = waterQualityPayload({ pondId, ph: 7.2, deviceId });
    const operationId = randomUUID();

    const first = await pushOne("WaterQualityRecord", payload.id, payload, deviceId, "CREATE", operationId);
    expect(first.status).toBe("applied");
    const second = await pushOne("WaterQualityRecord", payload.id, payload, deviceId, "CREATE", operationId);
    expect(second.status).toBe("duplicate");
    const third = await pushOne("WaterQualityRecord", payload.id, payload, deviceId, "CREATE", operationId);
    expect(third.status).toBe("duplicate");

    const rows = await prisma.waterQualityRecord.findMany({ where: { pondId } });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].ph)).toBe(7.2);
  });

  it("rechaza un pH físicamente imposible (§3, §42: el servidor también valida)", async () => {
    const deviceId = "device-a";
    const pondId = await setUpPond(deviceId);
    const payload = waterQualityPayload({ pondId, ph: 20, deviceId });

    const response = await pushHandler(
      pushRequest({
        deviceId,
        operations: [
          { id: randomUUID(), entityType: "WaterQualityRecord", entityId: payload.id, operation: "CREATE", deviceId, payload },
        ],
      }),
    );
    expect(response.status).toBe(400);
    expect(await prisma.waterQualityRecord.count()).toBe(0);
  });

  it("pull entrega las mediciones sincronizadas", async () => {
    const deviceId = "device-a";
    const pondId = await setUpPond(deviceId);
    const payload = waterQualityPayload({ pondId, ph: 7.0, deviceId });
    await pushOne("WaterQualityRecord", payload.id, payload, deviceId);

    const pullResponse = await (await pullHandler(pullRequest())).json();
    expect(pullResponse.waterQualityRecords).toHaveLength(1);
    expect(pullResponse.waterQualityRecords[0].pondId).toBe(pondId);
  });
});

describe("Task: conflicto (§34, obligatorio)", () => {
  it("dispositivo A completa la tarea (version 2); dispositivo B, desde version 1, cambia el título -> conflicto, el cambio de B no se pierde en silencio", async () => {
    const deviceA = "device-a";
    const deviceB = "device-b";
    const taskId = randomUUID();

    const created = taskPayload({ id: taskId, title: "Revisar E01", version: 1, deviceId: deviceA });
    const createResult = await pushOne("Task", taskId, created, deviceA, "CREATE");
    expect(createResult.status).toBe("applied");

    // Dispositivo A completa la tarea -> version 2.
    const completedByA = taskPayload({
      id: taskId,
      title: "Revisar E01",
      status: "COMPLETED",
      version: 2,
      deviceId: deviceA,
    });
    const updateAResult = await pushOne("Task", taskId, completedByA, deviceA, "UPDATE");
    expect(updateAResult.status).toBe("applied");

    // Dispositivo B, sin haber visto la actualización de A, edita el
    // título desde su copia offline (todavía en version 1).
    const staleUpdateByB = taskPayload({
      id: taskId,
      title: "Revisar E01 urgente (cambio de B)",
      status: "PENDING",
      version: 1,
      deviceId: deviceB,
    });
    const updateBResult = await pushOne("Task", taskId, staleUpdateByB, deviceB, "UPDATE");
    expect(updateBResult.status).toBe("conflict");

    // El estado final es el de A (COMPLETED, version 2) — el cambio de B
    // nunca se aplicó silenciosamente por encima, y tampoco se perdió sin
    // dejar rastro: la operación de B quedó registrada como "conflict".
    const finalTask = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(finalTask.status).toBe("COMPLETED");
    expect(finalTask.version).toBe(2);
    expect(finalTask.title).toBe("Revisar E01"); // el título de B NUNCA sobrescribió

    const conflictOp = await prisma.syncOperation.findUnique({ where: { operationId: updateBResult.id } });
    expect(conflictOp?.status).toBe("conflict");
  });

  it("retry tras el commit: reenviar la misma operación CREATE nunca duplica la tarea", async () => {
    const deviceId = "device-a";
    const taskId = randomUUID();
    const payload = taskPayload({ id: taskId, title: "Comprar alimento crecimiento", deviceId });
    const operationId = randomUUID();

    const first = await pushOne("Task", taskId, payload, deviceId, "CREATE", operationId);
    expect(first.status).toBe("applied");
    const retry = await pushOne("Task", taskId, payload, deviceId, "CREATE", operationId);
    expect(retry.status).toBe("duplicate");

    expect(await prisma.task.count({ where: { id: taskId } })).toBe(1);
  });

  it("pull entrega las tareas sincronizadas", async () => {
    const deviceId = "device-a";
    const taskId = randomUUID();
    const payload = taskPayload({ id: taskId, title: "Muestrear Pacú", deviceId });
    await pushOne("Task", taskId, payload, deviceId);

    const pullResponse = await (await pullHandler(pullRequest())).json();
    expect(pullResponse.tasks).toHaveLength(1);
    expect(pullResponse.tasks[0].title).toBe("Muestrear Pacú");
  });
});
