// Pruebas de integración de los comandos de negocio compuestos de la
// Fase 3.5 (RegisterFeeding, CreateFeedWithInitialStock) contra PostgreSQL
// real (piscicultura_test) — el criterio de cierre del encargo: "Registrar
// alimentación 18 kg" es UNA operación de negocio, y el servidor debe
// terminar en exactamente uno de dos estados — (A) FeedingRecord +
// FeedInventoryMovement existen, o (B) ninguno existe — nunca uno sin el
// otro, pase lo que pase (reintento, caída del servidor, respuesta
// perdida, concurrencia).
//
// §15-20 del encargo de Fase 3.5. El rollback de §17 se fuerza con un
// fallo REAL de PostgreSQL (colisión de llave primaria a mitad de la
// transacción), no con un mock — así se prueba la reversión automática de
// `prisma.$transaction`, no una simulación de que "debería" revertir.
import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/server/prisma";
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

async function pushOne(entityType: string, entityId: string, payload: unknown, deviceId: string) {
  return pushBatch([{ entityType, entityId, payload, deviceId }]);
}

async function pushBatch(
  ops: Array<{
    entityType: string;
    entityId: string;
    payload: unknown;
    deviceId: string;
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
        operation: "CREATE",
        deviceId: op.deviceId,
        payload: op.payload,
      })),
    }),
  );
  const body = await response.json();
  return body.results as Array<{ id: string; status: string; error?: string }>;
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

async function setUpFeedNoStock(deviceId: string) {
  const feedId = randomUUID();
  await pushOne(
    "Feed",
    feedId,
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
      ...auditFields(deviceId),
    },
    deviceId,
  );
  return feedId;
}

async function setUpFeedWithStock(deviceId: string, initialStockKg: number) {
  const feedId = await setUpFeedNoStock(deviceId);
  const now = new Date().toISOString();
  await pushOne(
    "FeedInventoryMovement",
    randomUUID(),
    {
      id: randomUUID(),
      feedId,
      movementType: "INITIAL_STOCK",
      quantityKg: initialStockKg,
      unitCostPerKg: null,
      totalCost: null,
      date: now,
      sourceType: null,
      sourceId: null,
      notes: null,
      deviceId,
      createdAt: now,
      deletedAt: null,
    },
    deviceId,
  );
  return feedId;
}

function registerFeedingPayload(opts: {
  id?: string;
  movementId?: string;
  batchId: string;
  pondId: string;
  feedId: string;
  quantityKg: number;
  deviceId: string;
}) {
  const now = new Date().toISOString();
  return {
    id: opts.id ?? randomUUID(),
    movementId: opts.movementId ?? randomUUID(),
    batchId: opts.batchId,
    pondId: opts.pondId,
    feedId: opts.feedId,
    date: now,
    time: null,
    quantityKg: opts.quantityKg,
    shift: "MORNING" as const,
    responsibleName: null,
    notes: null,
    deviceId: opts.deviceId,
    createdAt: now,
    deletedAt: null,
  };
}

function createFeedWithInitialStockPayload(opts: {
  id?: string;
  initialStockMovementId?: string;
  initialStockKg: number;
  deviceId: string;
}) {
  const now = new Date().toISOString();
  return {
    id: opts.id ?? randomUUID(),
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
    ...auditFields(opts.deviceId),
    initialStockMovementId: opts.initialStockMovementId ?? randomUUID(),
    initialStockKg: opts.initialStockKg,
    initialStockDate: now,
  };
}

async function currentFeedStock(feedId: string): Promise<number> {
  const movements = await prisma.feedInventoryMovement.findMany({ where: { feedId } });
  return movements.reduce((sum, m) => {
    const qty = Number(m.quantityKg);
    const isExit = m.movementType === "CONSUMPTION" || m.movementType === "LOSS" || m.movementType === "ADJUSTMENT_OUT";
    return isExit ? sum - qty : sum + qty;
  }, 0);
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

describe("RegisterFeeding: atomicidad (Fase 3.5 §15-19)", () => {
  it("§15 caso normal: stock 100, RegisterFeeding 18 -> FeedingRecord=1, movimiento=1, stock=82", async () => {
    const deviceId = "device-a";
    const { batchId, pondId } = await setUpBatchInPond(deviceId, 1000);
    const feedId = await setUpFeedWithStock(deviceId, 100);

    const feedingId = randomUUID();
    const [result] = await pushOne(
      "RegisterFeeding",
      feedingId,
      registerFeedingPayload({ id: feedingId, batchId, pondId, feedId, quantityKg: 18, deviceId }),
      deviceId,
    );
    expect(result.status).toBe("applied");

    const feedingRecords = await prisma.feedingRecord.findMany({ where: { id: feedingId } });
    expect(feedingRecords).toHaveLength(1);

    const movements = await prisma.feedInventoryMovement.findMany({
      where: { feedId, movementType: "CONSUMPTION" },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0].sourceType).toBe("FEEDING");
    expect(movements[0].sourceId).toBe(feedingId);

    expect(await currentFeedStock(feedId)).toBe(82);
  });

  it("§16 retry después del commit: reenviar la misma operación nunca duplica (FeedingRecord=1, movimiento=1, stock=82)", async () => {
    const deviceId = "device-a";
    const { batchId, pondId } = await setUpBatchInPond(deviceId, 1000);
    const feedId = await setUpFeedWithStock(deviceId, 100);

    const feedingId = randomUUID();
    const operationId = randomUUID();
    const payload = registerFeedingPayload({ id: feedingId, batchId, pondId, feedId, quantityKg: 18, deviceId });

    const [first] = await pushBatch([
      { entityType: "RegisterFeeding", entityId: feedingId, payload, deviceId, operationId },
    ]);
    expect(first.status).toBe("applied");

    // El dispositivo nunca recibió la respuesta (o se cortó la conexión):
    // reenvía la MISMA operación (mismo operationId).
    const [second] = await pushBatch([
      { entityType: "RegisterFeeding", entityId: feedingId, payload, deviceId, operationId },
    ]);
    expect(second.status).toBe("duplicate");
    const [third] = await pushBatch([
      { entityType: "RegisterFeeding", entityId: feedingId, payload, deviceId, operationId },
    ]);
    expect(third.status).toBe("duplicate");

    expect(await prisma.feedingRecord.count({ where: { id: feedingId } })).toBe(1);
    expect(
      await prisma.feedInventoryMovement.count({ where: { feedId, movementType: "CONSUMPTION" } }),
    ).toBe(1);
    expect(await currentFeedStock(feedId)).toBe(82); // nunca 64 (18 descontado dos veces)
  });

  it("§17 rollback real: un fallo de Postgres a mitad de la transacción revierte TODO (FeedingRecord=0, movimiento=0, stock sin cambios)", async () => {
    const deviceId = "device-a";
    const { batchId, pondId } = await setUpBatchInPond(deviceId, 1000);
    const feedId = await setUpFeedWithStock(deviceId, 100);

    // Fuerza un fallo real de PostgreSQL DESPUÉS de que
    // applyRegisterFeedingOperation ya creó el FeedingRecord pero ANTES de
    // que termine de crear el FeedInventoryMovement: se inserta por fuera
    // de la transacción (con el propio cliente Prisma, sin pasar por
    // push/route.ts) un FeedInventoryMovement que ya ocupa el mismo id que
    // el `movementId` del payload. Cuando la transacción intente crear su
    // propio movimiento con ese id, Postgres rechaza el INSERT por
    // violación de llave primaria (P2002 sobre "id", no sobre
    // "operationId" — así que push/route.ts NO lo trata como duplicado) y
    // prisma.$transaction revierte automáticamente TODO lo que la
    // transacción llevaba escrito hasta ese punto, incluido el
    // FeedingRecord ya creado.
    const feedingId = randomUUID();
    const movementId = randomUUID();
    await prisma.feedInventoryMovement.create({
      data: {
        id: movementId,
        feedId,
        movementType: "ADJUSTMENT_IN",
        quantityKg: 0.001,
        unitCostPerKg: null,
        totalCost: null,
        date: new Date(),
        sourceType: null,
        sourceId: null,
        notes: "fila plantada para forzar colisión de PK en el test de rollback",
        deviceId: "test-setup",
        createdAt: new Date(),
        deletedAt: null,
      },
    });
    const stockBeforeAttempt = await currentFeedStock(feedId);
    const movementCountBeforeAttempt = await prisma.feedInventoryMovement.count({ where: { feedId } });

    const [result] = await pushOne(
      "RegisterFeeding",
      feedingId,
      registerFeedingPayload({ id: feedingId, movementId, batchId, pondId, feedId, quantityKg: 18, deviceId }),
      deviceId,
    );

    expect(result.status).toBe("error"); // nunca "applied": la transacción falló de verdad
    expect(result.error).toBeTruthy();

    // El FeedingRecord NUNCA queda huérfano: la transacción lo revirtió
    // junto con el intento de movimiento.
    expect(await prisma.feedingRecord.count({ where: { id: feedingId } })).toBe(0);
    // Ningún CONSUMPTION quedó escrito, y el número total de movimientos no
    // cambió respecto a antes del intento (stock inicial + la fila
    // plantada por el test, nada más).
    expect(
      await prisma.feedInventoryMovement.count({ where: { feedId, movementType: "CONSUMPTION" } }),
    ).toBe(0);
    expect(await prisma.feedInventoryMovement.count({ where: { feedId } })).toBe(
      movementCountBeforeAttempt,
    );
    expect(await currentFeedStock(feedId)).toBe(stockBeforeAttempt); // sin cambios

    // El intento fallido queda registrado para diagnóstico, pero no bloquea
    // que el mismo operationId se reintente después con un movementId que
    // no colisione (el flujo real del cliente nunca reutiliza un
    // movementId ya usado por otra entidad).
    const op = await prisma.syncOperation.findUnique({ where: { operationId: result.id } });
    expect(op?.status).toBe("error");
  });

  it("§18 conflicto: stock 10, RegisterFeeding 18 -> conflict, FeedingRecord=0, movimiento=0, stock=10", async () => {
    const deviceId = "device-a";
    const { batchId, pondId } = await setUpBatchInPond(deviceId, 1000);
    const feedId = await setUpFeedWithStock(deviceId, 10);

    const feedingId = randomUUID();
    const [result] = await pushOne(
      "RegisterFeeding",
      feedingId,
      registerFeedingPayload({ id: feedingId, batchId, pondId, feedId, quantityKg: 18, deviceId }),
      deviceId,
    );

    expect(result.status).toBe("conflict");
    expect(await prisma.feedingRecord.count({ where: { id: feedingId } })).toBe(0);
    expect(
      await prisma.feedInventoryMovement.count({ where: { feedId, movementType: "CONSUMPTION" } }),
    ).toBe(0);
    expect(await currentFeedStock(feedId)).toBe(10);
  });

  it("§19 concurrencia: stock 100, dos RegisterFeeding de 70 en paralelo -> una aplicada, una en conflicto, stock=30", async () => {
    const deviceA = "device-a";
    const deviceB = "device-b";
    const { batchId, pondId } = await setUpBatchInPond(deviceA, 1000);
    const feedId = await setUpFeedWithStock(deviceA, 100);

    const feedingIdA = randomUUID();
    const feedingIdB = randomUUID();

    const [resultA, resultB] = await Promise.all([
      pushOne(
        "RegisterFeeding",
        feedingIdA,
        registerFeedingPayload({ id: feedingIdA, batchId, pondId, feedId, quantityKg: 70, deviceId: deviceA }),
        deviceA,
      ).then((r) => r[0]),
      pushOne(
        "RegisterFeeding",
        feedingIdB,
        registerFeedingPayload({ id: feedingIdB, batchId, pondId, feedId, quantityKg: 70, deviceId: deviceB }),
        deviceB,
      ).then((r) => r[0]),
    ]);

    const statuses = [resultA.status, resultB.status].sort();
    expect(statuses).toEqual(["applied", "conflict"]);

    // Nunca dos FeedingRecords, nunca stock negativo, nunca un
    // FeedingRecord sin su movimiento ni un movimiento sin su FeedingRecord.
    const feedingRecords = await prisma.feedingRecord.findMany({ where: { batchId } });
    expect(feedingRecords).toHaveLength(1);
    const movements = await prisma.feedInventoryMovement.findMany({
      where: { feedId, movementType: "CONSUMPTION" },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0].sourceId).toBe(feedingRecords[0].id);

    expect(await currentFeedStock(feedId)).toBe(30);
    expect(await currentFeedStock(feedId)).toBeGreaterThanOrEqual(0);
  });
});

describe("CreateFeedWithInitialStock: atomicidad (Fase 3.5 §20)", () => {
  it("crea Feed + movimiento INITIAL_STOCK juntos; reenviar la misma operación nunca duplica", async () => {
    const deviceId = "device-a";
    const feedId = randomUUID();
    const operationId = randomUUID();
    const payload = createFeedWithInitialStockPayload({ id: feedId, initialStockKg: 500, deviceId });

    const [first] = await pushBatch([
      { entityType: "CreateFeedWithInitialStock", entityId: feedId, payload, deviceId, operationId },
    ]);
    expect(first.status).toBe("applied");

    expect(await prisma.feed.count({ where: { id: feedId } })).toBe(1);
    const movements = await prisma.feedInventoryMovement.findMany({
      where: { feedId, movementType: "INITIAL_STOCK" },
    });
    expect(movements).toHaveLength(1);
    expect(Number(movements[0].quantityKg)).toBe(500);
    expect(await currentFeedStock(feedId)).toBe(500);

    // Retry: la respuesta se perdió y el dispositivo reenvía la misma operación.
    const [retry] = await pushBatch([
      { entityType: "CreateFeedWithInitialStock", entityId: feedId, payload, deviceId, operationId },
    ]);
    expect(retry.status).toBe("duplicate");

    expect(await prisma.feed.count({ where: { id: feedId } })).toBe(1);
    expect(
      await prisma.feedInventoryMovement.count({ where: { feedId, movementType: "INITIAL_STOCK" } }),
    ).toBe(1);
    expect(await currentFeedStock(feedId)).toBe(500);
  });
});
