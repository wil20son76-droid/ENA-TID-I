// Pruebas de integración de la operación diaria (Fase 3) contra
// PostgreSQL real (piscicultura_test): rechazo de consumos de alimento
// que dejarían el stock negativo (§10-§11 del encargo) y de mortalidad
// que dejaría un estanque en negativo (§16), más el escenario de
// concurrencia multi-dispositivo para ambos ledgers (§57) — mismo
// patrón ya probado en fishTransfer.integration.test.ts para peces.
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

async function setUpFeed(deviceId: string, initialStockKg: number) {
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

function consumptionPayload(opts: { feedId: string; quantityKg: number; deviceId: string }) {
  const now = new Date().toISOString();
  const id = randomUUID();
  return {
    id,
    feedId: opts.feedId,
    movementType: "CONSUMPTION" as const,
    quantityKg: opts.quantityKg,
    unitCostPerKg: null,
    totalCost: null,
    date: now,
    sourceType: "FEEDING",
    sourceId: randomUUID(),
    notes: null,
    deviceId: opts.deviceId,
    createdAt: now,
    deletedAt: null,
  };
}

function mortalityPayload(opts: {
  batchId: string;
  pondId: string;
  quantity: number;
  deviceId: string;
}) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    batchId: opts.batchId,
    pondId: opts.pondId,
    date: now,
    quantity: opts.quantity,
    estimatedAverageWeightG: null,
    cause: "UNKNOWN" as const,
    notes: null,
    responsibleName: null,
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

describe("Ledger de alimento: consumo vía /api/sync/push", () => {
  it("rechaza un consumo que dejaría el stock en negativo, sin tocar la base", async () => {
    const deviceId = "device-a";
    const feedId = await setUpFeed(deviceId, 20);

    const okResult = await pushOne(
      "FeedInventoryMovement",
      randomUUID(),
      consumptionPayload({ feedId, quantityKg: 15, deviceId }),
      deviceId,
    );
    expect(okResult.status).toBe("applied");

    // Quedan 5 kg; intentar consumir 25 debe rechazarse.
    const rejected = await pushOne(
      "FeedInventoryMovement",
      randomUUID(),
      consumptionPayload({ feedId, quantityKg: 25, deviceId }),
      deviceId,
    );
    expect(rejected.status).toBe("conflict");

    const movements = await prisma.feedInventoryMovement.findMany({
      where: { feedId, movementType: "CONSUMPTION" },
    });
    expect(movements).toHaveLength(1); // el rechazado no se insertó
  });

  it("dos consumos concurrentes del mismo alimento nunca dejan el stock negativo", async () => {
    const deviceA = "device-a";
    const deviceB = "device-b";
    const feedId = await setUpFeed(deviceA, 100);

    // Ambos dispositivos, offline el uno del otro, creen que pueden
    // consumir 70 de los mismos 100 kg disponibles.
    const [resultA, resultB] = await Promise.all([
      pushOne(
        "FeedInventoryMovement",
        randomUUID(),
        consumptionPayload({ feedId, quantityKg: 70, deviceId: deviceA }),
        deviceA,
      ),
      pushOne(
        "FeedInventoryMovement",
        randomUUID(),
        consumptionPayload({ feedId, quantityKg: 70, deviceId: deviceB }),
        deviceB,
      ),
    ]);

    const statuses = [resultA.status, resultB.status].sort();
    expect(statuses).toEqual(["applied", "conflict"]);

    const movements = await prisma.feedInventoryMovement.findMany({
      where: { feedId, movementType: "CONSUMPTION" },
    });
    expect(movements).toHaveLength(1);
    expect(Number(movements[0].quantityKg)).toBe(70);

    const allMovements = await prisma.feedInventoryMovement.findMany({ where: { feedId } });
    const stock = allMovements.reduce((sum, m) => {
      const qty = Number(m.quantityKg);
      return m.movementType === "CONSUMPTION" ? sum - qty : sum + qty;
    }, 0);
    expect(stock).toBe(30);
    expect(stock).toBeGreaterThanOrEqual(0);
  });
});

describe("Ledger de peces: mortalidad vía /api/sync/push", () => {
  it("rechaza mortalidad que dejaría el estanque en negativo, sin tocar la base", async () => {
    const deviceId = "device-a";
    const { batchId, pondId } = await setUpBatchInPond(deviceId, 600);

    const okResult = await pushOne(
      "MortalityRecord",
      randomUUID(),
      mortalityPayload({ batchId, pondId, quantity: 400, deviceId }),
      deviceId,
    );
    expect(okResult.status).toBe("applied");

    // Quedan 200; mortalidad de 300 debe rechazarse.
    const rejected = await pushOne(
      "MortalityRecord",
      randomUUID(),
      mortalityPayload({ batchId, pondId, quantity: 300, deviceId }),
      deviceId,
    );
    expect(rejected.status).toBe("conflict");

    const mortalities = await prisma.mortalityRecord.findMany({ where: { batchId } });
    expect(mortalities).toHaveLength(1);
  });

  it("dos registros de mortalidad concurrentes del mismo lote nunca dejan el balance negativo", async () => {
    const deviceA = "device-a";
    const deviceB = "device-b";
    const { batchId, pondId } = await setUpBatchInPond(deviceA, 600);

    const [resultA, resultB] = await Promise.all([
      pushOne(
        "MortalityRecord",
        randomUUID(),
        mortalityPayload({ batchId, pondId, quantity: 400, deviceId: deviceA }),
        deviceA,
      ),
      pushOne(
        "MortalityRecord",
        randomUUID(),
        mortalityPayload({ batchId, pondId, quantity: 400, deviceId: deviceB }),
        deviceB,
      ),
    ]);

    const statuses = [resultA.status, resultB.status].sort();
    expect(statuses).toEqual(["applied", "conflict"]);

    const mortalities = await prisma.mortalityRecord.findMany({ where: { batchId } });
    expect(mortalities).toHaveLength(1);

    const stockings = await prisma.stocking.findMany({ where: { batchId } });
    const totalStocked = stockings.reduce((sum, s) => sum + s.quantity, 0);
    const totalMortality = mortalities.reduce((sum, m) => sum + m.quantity, 0);
    expect(totalStocked - totalMortality).toBe(200);
    expect(totalStocked - totalMortality).toBeGreaterThanOrEqual(0);
  });

  it("§37 (Fase 3.5) confirma atomicidad real: un fallo de Postgres a mitad de la transacción revierte la mortalidad, sin dejar un SyncOperation huérfano", async () => {
    // Mismo criterio que la confirmación de FishTransfer: applyMortalityRecordOperation
    // corre dentro de la misma transacción que registra el SyncOperation.
    // Se planta de antemano un MortalityRecord con el mismo id que usará
    // la operación para forzar una violación real de llave primaria.
    const deviceId = "device-a";
    const { batchId, pondId } = await setUpBatchInPond(deviceId, 600);

    const mortalityId = randomUUID();
    const payload = mortalityPayload({ batchId, pondId, quantity: 100, deviceId });
    await prisma.mortalityRecord.create({
      data: {
        id: mortalityId,
        batchId: payload.batchId,
        pondId: payload.pondId,
        date: new Date(payload.date),
        quantity: payload.quantity,
        estimatedAverageWeightG: null,
        cause: "UNKNOWN",
        notes: "fila plantada para forzar colisión de PK en el test de rollback",
        responsibleName: null,
        deviceId: "test-setup",
        createdAt: new Date(payload.createdAt),
        deletedAt: null,
      },
    });

    const result = await pushOne(
      "MortalityRecord",
      mortalityId,
      { ...payload, id: mortalityId },
      deviceId,
    );

    expect(result.status).toBe("error"); // nunca "applied": el INSERT chocó de verdad
    expect(result.error).toBeTruthy();

    const mortalities = await prisma.mortalityRecord.findMany({ where: { id: mortalityId } });
    expect(mortalities).toHaveLength(1);
    expect(mortalities[0].notes).toBe(
      "fila plantada para forzar colisión de PK en el test de rollback",
    );

    const op = await prisma.syncOperation.findUnique({ where: { operationId: result.id } });
    expect(op?.status).toBe("error");
  });
});
