// Pruebas de integración de Fase 5 (economía y cierre productivo) contra
// PostgreSQL real (piscicultura_test) — mismos criterios de la Fase 3.5:
// atomicidad real (rollback forzado con una colisión de PK, nunca un
// mock), idempotencia por operationId, y locks de concurrencia reales con
// Promise.all. Cubre §60-§69 del encargo de Fase 5.
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

async function setUpFeedWithStock(deviceId: string, initialStockKg: number) {
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

async function currentFeedStock(feedId: string): Promise<number> {
  const movements = await prisma.feedInventoryMovement.findMany({ where: { feedId } });
  return movements.reduce((sum, m) => {
    const qty = Number(m.quantityKg);
    const isExit = m.movementType === "CONSUMPTION" || m.movementType === "LOSS" || m.movementType === "ADJUSTMENT_OUT";
    return isExit ? sum - qty : sum + qty;
  }, 0);
}

function registerPurchasePayload(opts: {
  id?: string;
  supplierId?: string | null;
  feedId: string;
  quantityKg: number;
  unitPrice: number;
  purchaseLineId?: string;
  movementId?: string;
  deviceId: string;
}) {
  const now = new Date().toISOString();
  const purchaseLineId = opts.purchaseLineId ?? randomUUID();
  const totalAmount = Math.round(opts.quantityKg * opts.unitPrice * 100) / 100;
  return {
    id: opts.id ?? randomUUID(),
    supplierId: opts.supplierId ?? null,
    date: now,
    referenceNumber: null,
    totalAmount,
    paymentStatus: "PENDING" as const,
    amountPaid: 0,
    notes: null,
    ...auditFields(opts.deviceId),
    lines: [
      {
        id: purchaseLineId,
        itemType: "FEED" as const,
        feedId: opts.feedId,
        description: "Alimento",
        quantity: opts.quantityKg,
        unit: "kg",
        unitPrice: opts.unitPrice,
        totalAmount,
      },
    ],
    feedMovements: [
      {
        id: opts.movementId ?? randomUUID(),
        feedId: opts.feedId,
        quantityKg: opts.quantityKg,
        unitCostPerKg: opts.unitPrice,
        totalCost: totalAmount,
        purchaseLineId,
      },
    ],
  };
}

function harvestPayload(opts: {
  id?: string;
  batchId: string;
  pondId: string;
  quantityFish: number;
  totalWeightKg: number;
  deviceId: string;
}) {
  const now = new Date().toISOString();
  return {
    id: opts.id ?? randomUUID(),
    batchId: opts.batchId,
    pondId: opts.pondId,
    date: now,
    quantityFish: opts.quantityFish,
    totalWeightKg: opts.totalWeightKg,
    averageWeightG: (opts.totalWeightKg * 1000) / opts.quantityFish,
    harvestType: "PARTIAL" as const,
    responsibleName: null,
    notes: null,
    deviceId: opts.deviceId,
    createdAt: now,
    deletedAt: null,
  };
}

function registerSalePayload(opts: {
  id?: string;
  customerId?: string | null;
  batchId: string;
  harvestId?: string | null;
  weightKg: number;
  pricePerKg: number;
  lineId?: string;
  deviceId: string;
}) {
  const now = new Date().toISOString();
  const totalAmount = Math.round(opts.weightKg * opts.pricePerKg * 100) / 100;
  return {
    id: opts.id ?? randomUUID(),
    customerId: opts.customerId ?? null,
    date: now,
    paymentStatus: "PENDING" as const,
    amountPaid: 0,
    totalAmount,
    notes: null,
    ...auditFields(opts.deviceId),
    lines: [
      {
        id: opts.lineId ?? randomUUID(),
        batchId: opts.batchId,
        harvestId: opts.harvestId ?? null,
        description: "Venta",
        quantityFish: null,
        weightKg: opts.weightKg,
        pricePerKg: opts.pricePerKg,
        totalAmount,
      },
    ],
  };
}

beforeEach(async () => {
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
  await prisma.pond.deleteMany();
  await prisma.species.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("RegisterPurchase: atomicidad e idempotencia (§8-§13, §60-§61, §69)", () => {
  it("§60 stock 100, compra 500 kg -> 600; reenviar la misma operación nunca vuelve a sumar (sigue en 600)", async () => {
    const deviceId = "device-a";
    const feedId = await setUpFeedWithStock(deviceId, 100);

    const purchaseId = randomUUID();
    const operationId = randomUUID();
    const payload = registerPurchasePayload({ id: purchaseId, feedId, quantityKg: 500, unitPrice: 7.6, deviceId });

    const [first] = await pushBatch([
      { entityType: "RegisterPurchase", entityId: purchaseId, payload, deviceId, operationId },
    ]);
    expect(first.status).toBe("applied");
    expect(await currentFeedStock(feedId)).toBe(600);
    expect(await prisma.purchase.count({ where: { id: purchaseId } })).toBe(1);
    expect(await prisma.purchaseLine.count({ where: { purchaseId } })).toBe(1);

    // §69: la respuesta se pierde, el cliente reenvía la MISMA operación.
    const [retry] = await pushBatch([
      { entityType: "RegisterPurchase", entityId: purchaseId, payload, deviceId, operationId },
    ]);
    expect(retry.status).toBe("duplicate");

    expect(await currentFeedStock(feedId)).toBe(600); // nunca 1100
    expect(await prisma.purchase.count({ where: { id: purchaseId } })).toBe(1);
    expect(await prisma.purchaseLine.count({ where: { purchaseId } })).toBe(1);
    expect(
      await prisma.feedInventoryMovement.count({ where: { feedId, movementType: "PURCHASE" } }),
    ).toBe(1);
  });

  it("§61 rollback real: un fallo de Postgres a mitad de la transacción deja Purchase=0, PurchaseLine=0, InventoryMovement=0", async () => {
    const deviceId = "device-a";
    const feedId = await setUpFeedWithStock(deviceId, 100);

    const purchaseId = randomUUID();
    const movementId = randomUUID();
    const payload = registerPurchasePayload({ id: purchaseId, feedId, quantityKg: 500, unitPrice: 7.6, movementId, deviceId });

    // Planta una fila con el mismo id que el FeedInventoryMovement del
    // payload, por fuera de la transacción: cuando applyRegisterPurchaseOperation
    // intente crearlo, Postgres rechaza el INSERT por PK duplicada y
    // prisma.$transaction revierte TODO lo anterior de esa transacción
    // (Purchase + PurchaseLine ya creados).
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
        notes: "fila plantada para forzar colisión de PK",
        deviceId: "test-setup",
        createdAt: new Date(),
        deletedAt: null,
      },
    });
    const stockBefore = await currentFeedStock(feedId);

    const [result] = await pushOne("RegisterPurchase", purchaseId, payload, deviceId);

    expect(result.status).toBe("error");
    expect(await prisma.purchase.count({ where: { id: purchaseId } })).toBe(0);
    expect(await prisma.purchaseLine.count({ where: { purchaseId } })).toBe(0);
    expect(
      await prisma.feedInventoryMovement.count({ where: { feedId, movementType: "PURCHASE" } }),
    ).toBe(0);
    expect(await currentFeedStock(feedId)).toBe(stockBefore);
  });

  it("valida que el proveedor exista antes de aplicar (dependencia no resuelta -> error, retryable, nunca conflict)", async () => {
    const deviceId = "device-a";
    const feedId = await setUpFeedWithStock(deviceId, 100);
    const payload = registerPurchasePayload({
      supplierId: randomUUID(),
      feedId,
      quantityKg: 10,
      unitPrice: 5,
      deviceId,
    });

    const [result] = await pushOne("RegisterPurchase", payload.id, payload, deviceId);
    expect(result.status).toBe("error");
    expect(await prisma.purchase.count({ where: { id: payload.id } })).toBe(0);
  });
});

describe("Harvest: ledger de peces y concurrencia (§20-§26, §62-§64)", () => {
  it("§62 E01: 500 peces, cosecha 200 peces/300kg -> E01: 300 peces, cosechado: 200/300kg", async () => {
    const deviceId = "device-a";
    const { batchId, pondId } = await setUpBatchInPond(deviceId, 500);

    const payload = harvestPayload({ batchId, pondId, quantityFish: 200, totalWeightKg: 300, deviceId });
    const [result] = await pushOne("Harvest", payload.id, payload, deviceId);
    expect(result.status).toBe("applied");

    const harvest = await prisma.harvest.findUnique({ where: { id: payload.id } });
    expect(harvest?.quantityFish).toBe(200);
    expect(Number(harvest?.totalWeightKg)).toBe(300);

    const stockings = await prisma.stocking.findMany({ where: { batchId } });
    const harvests = await prisma.harvest.findMany({ where: { batchId, deletedAt: null } });
    const remaining =
      stockings.reduce((sum, s) => sum + s.quantity, 0) -
      harvests.reduce((sum, h) => sum + h.quantityFish, 0);
    expect(remaining).toBe(300);
  });

  it("§63 cosecha inválida: disponible 300, intenta 400 -> conflict, nada insertado", async () => {
    const deviceId = "device-a";
    const { batchId, pondId } = await setUpBatchInPond(deviceId, 300);

    const payload = harvestPayload({ batchId, pondId, quantityFish: 400, totalWeightKg: 600, deviceId });
    const [result] = await pushOne("Harvest", payload.id, payload, deviceId);

    expect(result.status).toBe("conflict");
    expect(await prisma.harvest.count({ where: { batchId } })).toBe(0);
  });

  it("§64 cosecha concurrente: disponible 300, A cosecha 200 y B cosecha 200 en paralelo -> solo una se aplica, balance nunca negativo", async () => {
    const deviceA = "device-a";
    const deviceB = "device-b";
    const { batchId, pondId } = await setUpBatchInPond(deviceA, 300);

    const payloadA = harvestPayload({ batchId, pondId, quantityFish: 200, totalWeightKg: 300, deviceId: deviceA });
    const payloadB = harvestPayload({ batchId, pondId, quantityFish: 200, totalWeightKg: 300, deviceId: deviceB });

    const [resultA, resultB] = await Promise.all([
      pushOne("Harvest", payloadA.id, payloadA, deviceA).then((r) => r[0]),
      pushOne("Harvest", payloadB.id, payloadB, deviceB).then((r) => r[0]),
    ]);

    const statuses = [resultA.status, resultB.status].sort();
    expect(statuses).toEqual(["applied", "conflict"]);

    const harvests = await prisma.harvest.findMany({ where: { batchId } });
    expect(harvests).toHaveLength(1);

    const stockings = await prisma.stocking.findMany({ where: { batchId } });
    const remaining =
      stockings.reduce((sum, s) => sum + s.quantity, 0) -
      harvests.reduce((sum, h) => sum + h.quantityFish, 0);
    expect(remaining).toBeGreaterThanOrEqual(0);
    expect(remaining).toBe(100);
  });
});

describe("RegisterSale: atomicidad, balance de cosecha y concurrencia (§27-§32, §65-§66, §69)", () => {
  it("§65 200kg x 32 Bs/kg -> 6400 Bs", async () => {
    const deviceId = "device-a";
    const { batchId } = await setUpBatchInPond(deviceId, 1000);

    const payload = registerSalePayload({ batchId, weightKg: 200, pricePerKg: 32, deviceId });
    const [result] = await pushOne("RegisterSale", payload.id, payload, deviceId);

    expect(result.status).toBe("applied");
    const sale = await prisma.sale.findUnique({ where: { id: payload.id } });
    expect(Number(sale?.totalAmount)).toBe(6400);
    const lines = await prisma.saleLine.findMany({ where: { saleId: payload.id } });
    expect(lines).toHaveLength(1);
    expect(Number(lines[0].totalAmount)).toBe(6400);
  });

  it("§69 reenviar la misma operación de venta nunca duplica", async () => {
    const deviceId = "device-a";
    const { batchId } = await setUpBatchInPond(deviceId, 1000);
    const operationId = randomUUID();
    const payload = registerSalePayload({ batchId, weightKg: 200, pricePerKg: 32, deviceId });

    const [first] = await pushBatch([
      { entityType: "RegisterSale", entityId: payload.id, payload, deviceId, operationId },
    ]);
    expect(first.status).toBe("applied");
    const [retry] = await pushBatch([
      { entityType: "RegisterSale", entityId: payload.id, payload, deviceId, operationId },
    ]);
    expect(retry.status).toBe("duplicate");

    expect(await prisma.sale.count({ where: { id: payload.id } })).toBe(1);
    expect(await prisma.saleLine.count({ where: { saleId: payload.id } })).toBe(1);
  });

  it("§30-§31 venta contra cosecha: 300 kg cosechados, vender 200 dentro de balance -> aplicada; vender 150 más (excede 100 restantes) -> conflict", async () => {
    const deviceId = "device-a";
    const { batchId, pondId } = await setUpBatchInPond(deviceId, 1000);
    const harvest = harvestPayload({ batchId, pondId, quantityFish: 200, totalWeightKg: 300, deviceId });
    await pushOne("Harvest", harvest.id, harvest, deviceId);

    const saleA = registerSalePayload({ batchId, harvestId: harvest.id, weightKg: 200, pricePerKg: 32, deviceId });
    const [resultA] = await pushOne("RegisterSale", saleA.id, saleA, deviceId);
    expect(resultA.status).toBe("applied");

    const saleB = registerSalePayload({ batchId, harvestId: harvest.id, weightKg: 150, pricePerKg: 32, deviceId });
    const [resultB] = await pushOne("RegisterSale", saleB.id, saleB, deviceId);
    expect(resultB.status).toBe("conflict");

    const lines = await prisma.saleLine.findMany({ where: { harvestId: harvest.id } });
    expect(lines).toHaveLength(1);
    const totalSoldKg = lines.reduce((sum, l) => sum + Number(l.weightKg), 0);
    expect(totalSoldKg).toBeLessThanOrEqual(300);
  });

  it("§66 venta concurrente de la misma cosecha: 300 kg disponibles, A vende 200 y B vende 200 en paralelo -> nunca 400kg vendidos, solo una se aplica", async () => {
    const deviceA = "device-a";
    const deviceB = "device-b";
    const { batchId, pondId } = await setUpBatchInPond(deviceA, 1000);
    const harvest = harvestPayload({ batchId, pondId, quantityFish: 200, totalWeightKg: 300, deviceId: deviceA });
    await pushOne("Harvest", harvest.id, harvest, deviceA);

    const saleA = registerSalePayload({ batchId, harvestId: harvest.id, weightKg: 200, pricePerKg: 32, deviceId: deviceA });
    const saleB = registerSalePayload({ batchId, harvestId: harvest.id, weightKg: 200, pricePerKg: 32, deviceId: deviceB });

    const [resultA, resultB] = await Promise.all([
      pushOne("RegisterSale", saleA.id, saleA, deviceA).then((r) => r[0]),
      pushOne("RegisterSale", saleB.id, saleB, deviceB).then((r) => r[0]),
    ]);

    const statuses = [resultA.status, resultB.status].sort();
    expect(statuses).toEqual(["applied", "conflict"]);

    const lines = await prisma.saleLine.findMany({ where: { harvestId: harvest.id } });
    expect(lines).toHaveLength(1);
    const totalSoldKg = lines.reduce((sum, l) => sum + Number(l.weightKg), 0);
    expect(totalSoldKg).toBe(200);
    expect(totalSoldKg).toBeLessThanOrEqual(300);
  });

  it("valida que el lote exista antes de aplicar (dependencia no resuelta -> error)", async () => {
    const deviceId = "device-a";
    const payload = registerSalePayload({ batchId: randomUUID(), weightKg: 10, pricePerKg: 5, deviceId });
    const [result] = await pushOne("RegisterSale", payload.id, payload, deviceId);
    expect(result.status).toBe("error");
    expect(await prisma.sale.count({ where: { id: payload.id } })).toBe(0);
  });
});
