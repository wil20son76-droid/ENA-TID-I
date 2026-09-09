// Aplica una operación de sincronización validada contra PostgreSQL.
//
// Estrategia de conflictos para entidades mutables (Species, Pond,
// FishBatch) — IMPLEMENTATION_PLAN.md §6.4: last-write-wins por número de
// versión. Si la versión que trae el cliente no es más nueva que la que
// ya existe en el servidor, la escritura se descarta sin sobrescribir
// nada (nunca se pierde silenciosamente un cambio: queda registrado como
// "conflict" en SyncOperation, visible para diagnóstico).
//
// Stocking y FishTransfer son eventos append-only sin versión: su único
// "conflicto" posible es de balance, no de edición concurrente — ver
// applyFishTransferOperation y OFFLINE_SYNC.md §8 (multi-dispositivo).
import type { Prisma } from "@/generated/prisma/client";
import { getBatchPondBalance } from "@/lib/domain/batchLedger";
import { getFeedStock, isFeedExitMovement } from "@/lib/domain/feedLedger";
import type {
  FeedingRecordPayload,
  FeedInventoryMovementPayload,
  FeedPayload,
  FishBatchPayload,
  FishTransferPayload,
  MortalityRecordPayload,
  PondPayload,
  PushOperation,
  SamplingPayload,
  SpeciesPayload,
  StockingPayload,
} from "@/lib/validation/sync";

export type ApplyResult = "applied" | "conflict";

type TransactionClient = Prisma.TransactionClient;

function speciesData(payload: SpeciesPayload) {
  return {
    id: payload.id,
    commonName: payload.commonName,
    scientificName: payload.scientificName,
    description: payload.description,
    targetWeightKg: payload.targetWeightKg,
    estimatedCycleDays: payload.estimatedCycleDays,
    minTemperatureC: payload.minTemperatureC,
    maxTemperatureC: payload.maxTemperatureC,
    minPh: payload.minPh,
    maxPh: payload.maxPh,
    minDissolvedOxygenMgL: payload.minDissolvedOxygenMgL,
    expectedFcr: payload.expectedFcr,
    expectedMortalityPercent: payload.expectedMortalityPercent,
    active: payload.active,
    createdAt: new Date(payload.createdAt),
    updatedAt: new Date(payload.updatedAt),
    deletedAt: payload.deletedAt ? new Date(payload.deletedAt) : null,
    version: payload.version,
    deviceId: payload.deviceId,
    createdBy: payload.createdBy,
    updatedBy: payload.updatedBy,
  };
}

function pondData(payload: PondPayload) {
  return {
    id: payload.id,
    code: payload.code,
    name: payload.name,
    type: payload.type,
    lengthM: payload.lengthM,
    widthM: payload.widthM,
    averageDepthM: payload.averageDepthM,
    areaM2: payload.areaM2,
    areaSource: payload.areaSource,
    estimatedVolumeM3: payload.estimatedVolumeM3,
    volumeSource: payload.volumeSource,
    capacityNotes: payload.capacityNotes,
    locationNotes: payload.locationNotes,
    notes: payload.notes,
    status: payload.status,
    active: payload.active,
    createdAt: new Date(payload.createdAt),
    updatedAt: new Date(payload.updatedAt),
    deletedAt: payload.deletedAt ? new Date(payload.deletedAt) : null,
    version: payload.version,
    deviceId: payload.deviceId,
    createdBy: payload.createdBy,
    updatedBy: payload.updatedBy,
  };
}

function fishBatchData(payload: FishBatchPayload) {
  return {
    id: payload.id,
    code: payload.code,
    speciesId: payload.speciesId,
    supplierId: payload.supplierId,
    purchaseDate: payload.purchaseDate ? new Date(payload.purchaseDate) : null,
    initialStockingDate: new Date(payload.initialStockingDate),
    initialQuantity: payload.initialQuantity,
    initialAverageWeightG: payload.initialAverageWeightG,
    initialBiomassKg: payload.initialBiomassKg,
    fryCost: payload.fryCost,
    targetWeightKg: payload.targetWeightKg,
    expectedHarvestDate: payload.expectedHarvestDate ? new Date(payload.expectedHarvestDate) : null,
    status: payload.status,
    notes: payload.notes,
    createdAt: new Date(payload.createdAt),
    updatedAt: new Date(payload.updatedAt),
    deletedAt: payload.deletedAt ? new Date(payload.deletedAt) : null,
    version: payload.version,
    deviceId: payload.deviceId,
    createdBy: payload.createdBy,
    updatedBy: payload.updatedBy,
  };
}

function stockingData(payload: StockingPayload) {
  return {
    id: payload.id,
    batchId: payload.batchId,
    pondId: payload.pondId,
    date: new Date(payload.date),
    quantity: payload.quantity,
    averageWeightG: payload.averageWeightG,
    biomassKg: payload.biomassKg,
    responsibleName: payload.responsibleName,
    notes: payload.notes,
    deviceId: payload.deviceId,
    createdAt: new Date(payload.createdAt),
    updatedAt: new Date(payload.updatedAt),
    deletedAt: payload.deletedAt ? new Date(payload.deletedAt) : null,
  };
}

function fishTransferData(payload: FishTransferPayload) {
  return {
    id: payload.id,
    batchId: payload.batchId,
    fromPondId: payload.fromPondId,
    toPondId: payload.toPondId,
    date: new Date(payload.date),
    quantity: payload.quantity,
    averageWeightG: payload.averageWeightG,
    biomassKg: payload.biomassKg,
    reason: payload.reason,
    responsibleName: payload.responsibleName,
    notes: payload.notes,
    deviceId: payload.deviceId,
    createdAt: new Date(payload.createdAt),
    deletedAt: payload.deletedAt ? new Date(payload.deletedAt) : null,
  };
}

function feedData(payload: FeedPayload) {
  return {
    id: payload.id,
    name: payload.name,
    brand: payload.brand,
    proteinPercent: payload.proteinPercent,
    pelletSizeMm: payload.pelletSizeMm,
    bagWeightKg: payload.bagWeightKg,
    defaultBagPrice: payload.defaultBagPrice,
    defaultCostPerKg: payload.defaultCostPerKg,
    recommendedStage: payload.recommendedStage,
    notes: payload.notes,
    minimumStockKg: payload.minimumStockKg,
    active: payload.active,
    createdAt: new Date(payload.createdAt),
    updatedAt: new Date(payload.updatedAt),
    deletedAt: payload.deletedAt ? new Date(payload.deletedAt) : null,
    version: payload.version,
    deviceId: payload.deviceId,
    createdBy: payload.createdBy,
    updatedBy: payload.updatedBy,
  };
}

function feedInventoryMovementData(payload: FeedInventoryMovementPayload) {
  return {
    id: payload.id,
    feedId: payload.feedId,
    movementType: payload.movementType,
    quantityKg: payload.quantityKg,
    unitCostPerKg: payload.unitCostPerKg,
    totalCost: payload.totalCost,
    date: new Date(payload.date),
    sourceType: payload.sourceType,
    sourceId: payload.sourceId,
    notes: payload.notes,
    deviceId: payload.deviceId,
    createdAt: new Date(payload.createdAt),
    deletedAt: payload.deletedAt ? new Date(payload.deletedAt) : null,
  };
}

function feedingRecordData(payload: FeedingRecordPayload) {
  return {
    id: payload.id,
    batchId: payload.batchId,
    pondId: payload.pondId,
    feedId: payload.feedId,
    date: new Date(payload.date),
    time: payload.time,
    quantityKg: payload.quantityKg,
    shift: payload.shift,
    responsibleName: payload.responsibleName,
    notes: payload.notes,
    deviceId: payload.deviceId,
    createdAt: new Date(payload.createdAt),
    deletedAt: payload.deletedAt ? new Date(payload.deletedAt) : null,
  };
}

function mortalityRecordData(payload: MortalityRecordPayload) {
  return {
    id: payload.id,
    batchId: payload.batchId,
    pondId: payload.pondId,
    date: new Date(payload.date),
    quantity: payload.quantity,
    estimatedAverageWeightG: payload.estimatedAverageWeightG,
    cause: payload.cause,
    notes: payload.notes,
    responsibleName: payload.responsibleName,
    deviceId: payload.deviceId,
    createdAt: new Date(payload.createdAt),
    deletedAt: payload.deletedAt ? new Date(payload.deletedAt) : null,
  };
}

function samplingData(payload: SamplingPayload) {
  return {
    id: payload.id,
    batchId: payload.batchId,
    pondId: payload.pondId,
    date: new Date(payload.date),
    sampleFishCount: payload.sampleFishCount,
    totalSampleWeightKg: payload.totalSampleWeightKg,
    averageWeightG: payload.averageWeightG,
    averageLengthCm: payload.averageLengthCm,
    notes: payload.notes,
    responsibleName: payload.responsibleName,
    deviceId: payload.deviceId,
    createdAt: new Date(payload.createdAt),
    deletedAt: payload.deletedAt ? new Date(payload.deletedAt) : null,
  };
}

async function applySpeciesOperation(
  tx: TransactionClient,
  op: Extract<PushOperation, { entityType: "Species" }>,
): Promise<ApplyResult> {
  const data = speciesData(op.payload);

  if (op.operation === "CREATE") {
    await tx.species.create({ data });
    return "applied";
  }

  // UPDATE y DELETE (soft-delete) comparten la misma lógica de
  // last-write-wins: solo cambia qué campos trae el payload.
  const current = await tx.species.findUnique({ where: { id: op.entityId } });
  if (!current) {
    // El servidor nunca vio este registro (por ejemplo, la operación CREATE
    // original sigue en la cola local pendiente de sincronizar). Se trata
    // como una creación para no perder el dato.
    await tx.species.create({ data });
    return "applied";
  }

  if (data.version <= current.version) {
    return "conflict";
  }

  await tx.species.update({ where: { id: op.entityId }, data });
  return "applied";
}

async function applyPondOperation(
  tx: TransactionClient,
  op: Extract<PushOperation, { entityType: "Pond" }>,
): Promise<ApplyResult> {
  const data = pondData(op.payload);

  if (op.operation === "CREATE") {
    await tx.pond.create({ data });
    return "applied";
  }

  const current = await tx.pond.findUnique({ where: { id: op.entityId } });
  if (!current) {
    await tx.pond.create({ data });
    return "applied";
  }

  if (data.version <= current.version) {
    return "conflict";
  }

  await tx.pond.update({ where: { id: op.entityId }, data });
  return "applied";
}

async function applyFishBatchOperation(
  tx: TransactionClient,
  op: Extract<PushOperation, { entityType: "FishBatch" }>,
): Promise<ApplyResult> {
  const data = fishBatchData(op.payload);

  if (op.operation === "CREATE") {
    await tx.fishBatch.create({ data });
    return "applied";
  }

  const current = await tx.fishBatch.findUnique({ where: { id: op.entityId } });
  if (!current) {
    await tx.fishBatch.create({ data });
    return "applied";
  }

  if (data.version <= current.version) {
    return "conflict";
  }

  await tx.fishBatch.update({ where: { id: op.entityId }, data });
  return "applied";
}

async function applyStockingOperation(
  tx: TransactionClient,
  op: Extract<PushOperation, { entityType: "Stocking" }>,
): Promise<ApplyResult> {
  // Append-only en esta fase: el cliente solo envía CREATE. UPDATE/DELETE
  // se soportan de forma defensiva (nunca confiar solo en el cliente, §59)
  // para una futura corrección auditada (§25), sin semántica de versión
  // porque no hay edición concurrente posible sobre un evento que nadie
  // más está editando a la vez.
  const data = stockingData(op.payload);
  await tx.stocking.upsert({ where: { id: op.entityId }, create: data, update: data });
  return "applied";
}

async function getCurrentPondBalance(
  tx: TransactionClient,
  batchId: string,
  pondId: string,
): Promise<number> {
  const [stockings, transfers, mortalities] = await Promise.all([
    tx.stocking.findMany({
      where: { batchId, deletedAt: null },
      select: { batchId: true, pondId: true, quantity: true },
    }),
    tx.fishTransfer.findMany({
      where: { batchId, deletedAt: null },
      select: { batchId: true, fromPondId: true, toPondId: true, quantity: true },
    }),
    tx.mortalityRecord.findMany({
      where: { batchId, deletedAt: null },
      select: { batchId: true, pondId: true, quantity: true },
    }),
  ]);
  return getBatchPondBalance(stockings, transfers, mortalities, batchId, pondId);
}

async function applyFishTransferOperation(
  tx: TransactionClient,
  op: Extract<PushOperation, { entityType: "FishTransfer" }>,
): Promise<ApplyResult> {
  if (op.operation !== "CREATE") {
    // Ver nota de applyStockingOperation: defensivo, sin semántica de
    // versión, no lo ejerce la UI de esta fase.
    const data = fishTransferData(op.payload);
    await tx.fishTransfer.upsert({ where: { id: op.entityId }, create: data, update: data });
    return "applied";
  }

  // Lock por lote (§16 del encargo — conflictos multi-dispositivo): dos
  // traslados concurrentes del MISMO lote nunca deben poder leer el mismo
  // balance "disponible" y ambos darlo por válido. El lock es de
  // transacción (se libera solo al terminar esta tx, haga commit o
  // rollback) y no bloquea traslados de otros lotes.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${op.payload.batchId})::bigint)`;

  const available = await getCurrentPondBalance(tx, op.payload.batchId, op.payload.fromPondId);
  if (op.payload.quantity > available) {
    // Nunca se inventa una cantidad ni se permite un balance negativo
    // (§15): la operación queda como conflicto, visible para revisión,
    // el dato local del dispositivo no se pierde (sigue en su outbox).
    return "conflict";
  }

  await tx.fishTransfer.create({ data: fishTransferData(op.payload) });
  return "applied";
}

async function applyFeedOperation(
  tx: TransactionClient,
  op: Extract<PushOperation, { entityType: "Feed" }>,
): Promise<ApplyResult> {
  const data = feedData(op.payload);

  if (op.operation === "CREATE") {
    await tx.feed.create({ data });
    return "applied";
  }

  const current = await tx.feed.findUnique({ where: { id: op.entityId } });
  if (!current) {
    await tx.feed.create({ data });
    return "applied";
  }

  if (data.version <= current.version) {
    return "conflict";
  }

  await tx.feed.update({ where: { id: op.entityId }, data });
  return "applied";
}

async function getCurrentFeedStock(tx: TransactionClient, feedId: string): Promise<number> {
  const movements = await tx.feedInventoryMovement.findMany({
    where: { feedId, deletedAt: null },
    select: { feedId: true, movementType: true, quantityKg: true },
  });
  return getFeedStock(
    movements.map((m) => ({ ...m, quantityKg: Number(m.quantityKg) })),
    feedId,
  );
}

async function applyFeedInventoryMovementOperation(
  tx: TransactionClient,
  op: Extract<PushOperation, { entityType: "FeedInventoryMovement" }>,
): Promise<ApplyResult> {
  if (op.operation !== "CREATE") {
    // Ver nota de applyStockingOperation: defensivo, sin semántica de
    // versión, no lo ejerce la UI de esta fase.
    const data = feedInventoryMovementData(op.payload);
    await tx.feedInventoryMovement.upsert({ where: { id: op.entityId }, create: data, update: data });
    return "applied";
  }

  if (!isFeedExitMovement(op.payload.movementType)) {
    // Una entrada (compra, stock inicial, ajuste positivo, devolución)
    // nunca puede dejar el stock en negativo: no hace falta bloquear ni
    // validar nada, se aplica directo.
    await tx.feedInventoryMovement.create({ data: feedInventoryMovementData(op.payload) });
    return "applied";
  }

  // Lock por alimento (§11 del encargo de Fase 3 — mismo criterio que el
  // lock por lote de FishTransfer): dos consumos concurrentes del MISMO
  // alimento nunca deben poder leer el mismo stock "disponible" y ambos
  // darlo por válido.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${op.payload.feedId})::bigint)`;

  const currentStock = await getCurrentFeedStock(tx, op.payload.feedId);
  if (op.payload.quantityKg > currentStock) {
    // Nunca se inventa una cantidad ni se permite stock negativo (§10):
    // la operación queda como conflicto, visible para revisión.
    return "conflict";
  }

  await tx.feedInventoryMovement.create({ data: feedInventoryMovementData(op.payload) });
  return "applied";
}

async function applyFeedingRecordOperation(
  tx: TransactionClient,
  op: Extract<PushOperation, { entityType: "FeedingRecord" }>,
): Promise<ApplyResult> {
  // Append-only: el FeedInventoryMovement CONSUMPTION vinculado es la
  // única operación que valida stock (ver arriba). El FeedingRecord en sí
  // es solo el registro descriptivo del evento.
  const data = feedingRecordData(op.payload);
  await tx.feedingRecord.upsert({ where: { id: op.entityId }, create: data, update: data });
  return "applied";
}

async function applyMortalityRecordOperation(
  tx: TransactionClient,
  op: Extract<PushOperation, { entityType: "MortalityRecord" }>,
): Promise<ApplyResult> {
  if (op.operation !== "CREATE") {
    const data = mortalityRecordData(op.payload);
    await tx.mortalityRecord.upsert({ where: { id: op.entityId }, create: data, update: data });
    return "applied";
  }

  // Mismo criterio que FishTransfer (§16 del encargo de Fase 3): la
  // mortalidad nunca puede dejar el balance del estanque en negativo, y
  // dos registros de mortalidad concurrentes del mismo lote/estanque
  // nunca deben poder ambos "gastar" el mismo balance.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${op.payload.batchId})::bigint)`;

  const available = await getCurrentPondBalance(tx, op.payload.batchId, op.payload.pondId);
  if (op.payload.quantity > available) {
    return "conflict";
  }

  await tx.mortalityRecord.create({ data: mortalityRecordData(op.payload) });
  return "applied";
}

async function applySamplingOperation(
  tx: TransactionClient,
  op: Extract<PushOperation, { entityType: "Sampling" }>,
): Promise<ApplyResult> {
  const data = samplingData(op.payload);
  await tx.sampling.upsert({ where: { id: op.entityId }, create: data, update: data });
  return "applied";
}

export async function applyOperation(
  tx: TransactionClient,
  op: PushOperation,
): Promise<ApplyResult> {
  switch (op.entityType) {
    case "Species":
      return applySpeciesOperation(tx, op);
    case "Pond":
      return applyPondOperation(tx, op);
    case "FishBatch":
      return applyFishBatchOperation(tx, op);
    case "Stocking":
      return applyStockingOperation(tx, op);
    case "FishTransfer":
      return applyFishTransferOperation(tx, op);
    case "Feed":
      return applyFeedOperation(tx, op);
    case "FeedInventoryMovement":
      return applyFeedInventoryMovementOperation(tx, op);
    case "FeedingRecord":
      return applyFeedingRecordOperation(tx, op);
    case "MortalityRecord":
      return applyMortalityRecordOperation(tx, op);
    case "Sampling":
      return applySamplingOperation(tx, op);
  }
}
