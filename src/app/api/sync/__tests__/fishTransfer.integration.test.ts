// Pruebas de integración del ledger de peces contra PostgreSQL real
// (piscicultura_test): rechazo de traslados que dejarían un balance
// negativo (§15 del encargo de Fase 2), y el escenario de concurrencia
// multi-dispositivo (§16/§31): dos traslados del MISMO lote enviados en
// paralelo nunca deben poder los dos "gastar" el mismo balance.
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/server/prisma";
import { authHeader, createTestUser } from "@/test/authTestHelpers";
import { POST as pushHandler } from "../push/route";

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

async function pushOne(entityType: string, entityId: string, payload: unknown, deviceId: string) {
  const response = await pushHandler(
    pushRequest({
      deviceId,
      operations: [
        {
          id: randomUUID(),
          entityType,
          entityId,
          operation: "CREATE",
          deviceId,
          payload,
        },
      ],
    }),
  );
  const body = await response.json();
  return body.results[0] as { id: string; status: string; error?: string };
}

async function setUpBatchInPond(deviceId: string, initialQuantity: number) {
  const speciesId = randomUUID();
  await pushOne(
    "Species",
    speciesId,
    {
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
    deviceId,
  );

  const fromPondId = randomUUID();
  const toPondId = randomUUID();
  for (const [id, code] of [
    [fromPondId, `E01-${fromPondId.slice(0, 4)}`],
    [toPondId, `E02-${toPondId.slice(0, 4)}`],
  ] as const) {
    await pushOne(
      "Pond",
      id,
      {
        id,
        code,
        name: code,
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
  }

  const batchId = randomUUID();
  const now = new Date().toISOString();
  await pushOne(
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
    "Stocking",
    stockingId,
    {
      id: stockingId,
      batchId,
      pondId: fromPondId,
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

  return { batchId, fromPondId, toPondId };
}

function transferPayload(opts: {
  batchId: string;
  fromPondId: string;
  toPondId: string;
  quantity: number;
  deviceId: string;
}) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    batchId: opts.batchId,
    fromPondId: opts.fromPondId,
    toPondId: opts.toPondId,
    date: now,
    quantity: opts.quantity,
    averageWeightG: null,
    biomassKg: null,
    reason: null,
    responsibleName: null,
    notes: null,
    deviceId: opts.deviceId,
    createdAt: now,
    deletedAt: null,
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

describe("Ledger de peces: traslados vía /api/sync/push", () => {
  it("rechaza un traslado que dejaría el balance negativo, sin tocar la base", async () => {
    const deviceId = "device-a";
    const { batchId, fromPondId, toPondId } = await setUpBatchInPond(deviceId, 600);

    const okResult = await pushOne(
      "FishTransfer",
      randomUUID(),
      transferPayload({ batchId, fromPondId, toPondId, quantity: 400, deviceId }),
      deviceId,
    );
    expect(okResult.status).toBe("applied");

    // Solo quedan 200 en el origen; intentar sacar 500 debe rechazarse.
    const rejected = await pushOne(
      "FishTransfer",
      randomUUID(),
      transferPayload({ batchId, fromPondId, toPondId, quantity: 500, deviceId }),
      deviceId,
    );
    expect(rejected.status).toBe("conflict");

    const transfers = await prisma.fishTransfer.findMany({ where: { batchId } });
    expect(transfers).toHaveLength(1); // el rechazado no se insertó
    const totalTransferred = transfers.reduce((sum, t) => sum + t.quantity, 0);
    expect(totalTransferred).toBe(400);
  });

  it("dos traslados concurrentes del mismo lote nunca dejan un balance negativo", async () => {
    const deviceA = "device-a";
    const deviceB = "device-b";
    const { batchId, fromPondId, toPondId } = await setUpBatchInPond(deviceA, 600);

    // Dos dispositivos, offline el uno del otro, ambos creen que pueden
    // trasladar 400 de los mismos 600 disponibles. Se envían en paralelo
    // de verdad (Promise.all sobre dos invocaciones HTTP separadas) para
    // ejercer la condición de carrera real, no solo simularla en secuencia.
    const [resultA, resultB] = await Promise.all([
      pushOne(
        "FishTransfer",
        randomUUID(),
        transferPayload({ batchId, fromPondId, toPondId, quantity: 400, deviceId: deviceA }),
        deviceA,
      ),
      pushOne(
        "FishTransfer",
        randomUUID(),
        transferPayload({ batchId, fromPondId, toPondId, quantity: 400, deviceId: deviceB }),
        deviceB,
      ),
    ]);

    const statuses = [resultA.status, resultB.status].sort();
    expect(statuses).toEqual(["applied", "conflict"]);

    const transfers = await prisma.fishTransfer.findMany({ where: { batchId } });
    expect(transfers).toHaveLength(1);
    expect(transfers[0].quantity).toBe(400);

    // El balance en el estanque de origen nunca fue negativo: quedan 200.
    const stockings = await prisma.stocking.findMany({ where: { batchId } });
    const totalStocked = stockings.reduce((sum, s) => sum + s.quantity, 0);
    const totalOut = transfers
      .filter((t) => t.fromPondId === fromPondId)
      .reduce((sum, t) => sum + t.quantity, 0);
    expect(totalStocked - totalOut).toBe(200);
    expect(totalStocked - totalOut).toBeGreaterThanOrEqual(0);
  });

  it("§37 (Fase 3.5) confirma atomicidad real: un fallo de Postgres a mitad de la transacción revierte el traslado, sin dejar un SyncOperation huérfano", async () => {
    // applyFishTransferOperation corre dentro de la MISMA transacción que
    // registra el SyncOperation (push/route.ts, prisma.$transaction
    // envolviendo ambos). Para confirmarlo con un fallo real (no una
    // simulación): se planta de antemano un FishTransfer con el mismo id
    // que usará la operación, así el INSERT de la transacción choca por
    // violación de llave primaria y Postgres revierte todo — incluido el
    // registro de SyncOperation, que nunca debe quedar como "applied" sin
    // su traslado.
    const deviceId = "device-a";
    const { batchId, fromPondId, toPondId } = await setUpBatchInPond(deviceId, 600);

    const transferId = randomUUID();
    const payload = transferPayload({ batchId, fromPondId, toPondId, quantity: 100, deviceId });
    await prisma.fishTransfer.create({
      data: {
        id: transferId,
        batchId: payload.batchId,
        fromPondId: payload.fromPondId,
        toPondId: payload.toPondId,
        date: new Date(payload.date),
        quantity: payload.quantity,
        averageWeightG: null,
        biomassKg: null,
        reason: null,
        responsibleName: null,
        notes: "fila plantada para forzar colisión de PK en el test de rollback",
        deviceId: "test-setup",
        createdAt: new Date(payload.createdAt),
        deletedAt: null,
      },
    });

    const result = await pushOne("FishTransfer", transferId, { ...payload, id: transferId }, deviceId);

    expect(result.status).toBe("error"); // nunca "applied": el INSERT chocó de verdad
    expect(result.error).toBeTruthy();

    // Sigue existiendo exactamente el traslado plantado (1), nunca dos ni
    // uno "medio aplicado".
    const transfers = await prisma.fishTransfer.findMany({ where: { id: transferId } });
    expect(transfers).toHaveLength(1);
    expect(transfers[0].notes).toBe("fila plantada para forzar colisión de PK en el test de rollback");

    // El registro de SyncOperation nunca queda "applied" para una
    // operación cuya escritura de dominio en realidad falló.
    const op = await prisma.syncOperation.findUnique({ where: { operationId: result.id } });
    expect(op?.status).toBe("error");
  });
});
