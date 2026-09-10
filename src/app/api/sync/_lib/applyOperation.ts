// Aplica una operación de sincronización validada contra PostgreSQL.
//
// Estrategia de conflictos para entidades mutables (Species, Pond,
// FishBatch, Feed y, desde la Fase 4, Task) — IMPLEMENTATION_PLAN.md
// §6.4: last-write-wins por número de versión. Si la versión que trae el
// cliente no es más nueva que la que ya existe en el servidor, la
// escritura se descarta sin sobrescribir nada (nunca se pierde
// silenciosamente un cambio: queda registrado como "conflict" en
// SyncOperation, visible para diagnóstico).
//
// Stocking, FishTransfer y (desde la Fase 4) WaterQualityRecord son
// eventos append-only sin versión: su único "conflicto" posible sería de
// balance, no de edición concurrente — ver applyFishTransferOperation y
// OFFLINE_SYNC.md §8 (multi-dispositivo). WaterQualityRecord no valida
// ningún balance (§1: es solo un historial de mediciones).
//
// Fase 5 (economía y cierre productivo): Supplier/Customer/FarmSettings
// son mutables LWW, igual criterio que Species/Pond/Feed/Task.
// Purchase/Sale también son LWW, pero la UI solo los reedita para su
// estado de pago — su creación real siempre llega como el comando
// compuesto RegisterPurchase/RegisterSale (ver más abajo), nunca como un
// "Purchase"/"Sale" CREATE suelto. PurchaseLine, Expense, Harvest y
// SaleLine son append-only, mismo criterio que Stocking/FishTransfer.
// Harvest valida balance de peces (mismo lock por batchId que
// FishTransfer/MortalityRecord); RegisterSale valida balance de kg
// disponibles por cosecha (lock por harvestId) cuando alguna línea
// referencia una.
import type { Prisma } from "@/generated/prisma/client";
import { getBatchPondBalance } from "@/lib/domain/batchLedger";
import { getFeedStock, isFeedExitMovement } from "@/lib/domain/feedLedger";
import type {
  CreateFeedWithInitialStockPayload,
  CustomerPayload,
  ExpensePayload,
  FarmSettingsPayload,
  FeedingRecordPayload,
  FeedInventoryMovementPayload,
  FeedPayload,
  FishBatchPayload,
  FishTransferPayload,
  HarvestPayload,
  MortalityRecordPayload,
  PondPayload,
  PurchasePayload,
  PushOperation,
  RegisterFeedingPayload,
  RegisterPurchasePayload,
  RegisterSalePayload,
  SalePayload,
  SamplingPayload,
  SpeciesPayload,
  StockingPayload,
  SupplierPayload,
  TaskPayload,
  WaterQualityRecordPayload,
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

function waterQualityRecordData(payload: WaterQualityRecordPayload) {
  return {
    id: payload.id,
    pondId: payload.pondId,
    batchId: payload.batchId,
    date: new Date(payload.date),
    time: payload.time,
    temperatureC: payload.temperatureC,
    ph: payload.ph,
    dissolvedOxygenMgL: payload.dissolvedOxygenMgL,
    transparencyCm: payload.transparencyCm,
    ammoniaMgL: payload.ammoniaMgL,
    nitriteMgL: payload.nitriteMgL,
    alkalinityMgL: payload.alkalinityMgL,
    waterLevelCm: payload.waterLevelCm,
    notes: payload.notes,
    responsibleName: payload.responsibleName,
    deviceId: payload.deviceId,
    createdAt: new Date(payload.createdAt),
    deletedAt: payload.deletedAt ? new Date(payload.deletedAt) : null,
  };
}

function taskData(payload: TaskPayload) {
  return {
    id: payload.id,
    title: payload.title,
    description: payload.description,
    dueDate: new Date(payload.dueDate),
    dueTime: payload.dueTime,
    priority: payload.priority,
    status: payload.status,
    pondId: payload.pondId,
    batchId: payload.batchId,
    assignedToName: payload.assignedToName,
    notes: payload.notes,
    completedAt: payload.completedAt ? new Date(payload.completedAt) : null,
    createdAt: new Date(payload.createdAt),
    updatedAt: new Date(payload.updatedAt),
    deletedAt: payload.deletedAt ? new Date(payload.deletedAt) : null,
    version: payload.version,
    deviceId: payload.deviceId,
    createdBy: payload.createdBy,
    updatedBy: payload.updatedBy,
  };
}

// --- Fase 5: economía y cierre productivo ---

function farmSettingsData(payload: FarmSettingsPayload) {
  return {
    id: payload.id,
    currencyCode: payload.currencyCode,
    currencySymbol: payload.currencySymbol,
    createdAt: new Date(payload.createdAt),
    updatedAt: new Date(payload.updatedAt),
    deletedAt: payload.deletedAt ? new Date(payload.deletedAt) : null,
    version: payload.version,
    deviceId: payload.deviceId,
    createdBy: payload.createdBy,
    updatedBy: payload.updatedBy,
  };
}

function supplierData(payload: SupplierPayload) {
  return {
    id: payload.id,
    name: payload.name,
    contactName: payload.contactName,
    phone: payload.phone,
    whatsapp: payload.whatsapp,
    locality: payload.locality,
    address: payload.address,
    notes: payload.notes,
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

function customerData(payload: CustomerPayload) {
  return {
    id: payload.id,
    name: payload.name,
    type: payload.type,
    phone: payload.phone,
    whatsapp: payload.whatsapp,
    locality: payload.locality,
    address: payload.address,
    notes: payload.notes,
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

function purchaseData(payload: PurchasePayload) {
  return {
    id: payload.id,
    supplierId: payload.supplierId,
    date: new Date(payload.date),
    referenceNumber: payload.referenceNumber,
    totalAmount: payload.totalAmount,
    paymentStatus: payload.paymentStatus,
    amountPaid: payload.amountPaid,
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

function saleData(payload: SalePayload) {
  return {
    id: payload.id,
    customerId: payload.customerId,
    date: new Date(payload.date),
    paymentStatus: payload.paymentStatus,
    amountPaid: payload.amountPaid,
    totalAmount: payload.totalAmount,
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

function expenseData(payload: ExpensePayload) {
  return {
    id: payload.id,
    date: new Date(payload.date),
    category: payload.category,
    description: payload.description,
    quantity: payload.quantity,
    unit: payload.unit,
    unitPrice: payload.unitPrice,
    totalAmount: payload.totalAmount,
    supplierId: payload.supplierId,
    batchId: payload.batchId,
    pondId: payload.pondId,
    notes: payload.notes,
    voidReason: payload.voidReason,
    deviceId: payload.deviceId,
    createdAt: new Date(payload.createdAt),
    deletedAt: payload.deletedAt ? new Date(payload.deletedAt) : null,
  };
}

function harvestData(payload: HarvestPayload) {
  return {
    id: payload.id,
    batchId: payload.batchId,
    pondId: payload.pondId,
    date: new Date(payload.date),
    quantityFish: payload.quantityFish,
    totalWeightKg: payload.totalWeightKg,
    averageWeightG: payload.averageWeightG,
    harvestType: payload.harvestType,
    responsibleName: payload.responsibleName,
    notes: payload.notes,
    deviceId: payload.deviceId,
    createdAt: new Date(payload.createdAt),
    deletedAt: payload.deletedAt ? new Date(payload.deletedAt) : null,
  };
}

function purchaseDataFromRegisterPayload(payload: RegisterPurchasePayload) {
  return {
    id: payload.id,
    supplierId: payload.supplierId,
    date: new Date(payload.date),
    referenceNumber: payload.referenceNumber,
    totalAmount: payload.totalAmount,
    paymentStatus: payload.paymentStatus,
    amountPaid: payload.amountPaid,
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

function purchaseLinesDataFromRegisterPayload(payload: RegisterPurchasePayload) {
  return payload.lines.map((line) => ({
    id: line.id,
    purchaseId: payload.id,
    itemType: line.itemType,
    feedId: line.feedId,
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.unitPrice,
    totalAmount: line.totalAmount,
    deviceId: payload.deviceId,
    createdAt: new Date(payload.createdAt),
    deletedAt: null,
  }));
}

function feedMovementsDataFromRegisterPurchasePayload(payload: RegisterPurchasePayload) {
  return payload.feedMovements.map((movement) => ({
    id: movement.id,
    feedId: movement.feedId,
    movementType: "PURCHASE" as const,
    quantityKg: movement.quantityKg,
    unitCostPerKg: movement.unitCostPerKg,
    totalCost: movement.totalCost,
    date: new Date(payload.date),
    sourceType: "PURCHASE",
    sourceId: movement.purchaseLineId,
    notes: null,
    deviceId: payload.deviceId,
    createdAt: new Date(payload.createdAt),
    deletedAt: null,
  }));
}

function saleDataFromRegisterPayload(payload: RegisterSalePayload) {
  return {
    id: payload.id,
    customerId: payload.customerId,
    date: new Date(payload.date),
    paymentStatus: payload.paymentStatus,
    amountPaid: payload.amountPaid,
    totalAmount: payload.totalAmount,
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

function saleLinesDataFromRegisterPayload(payload: RegisterSalePayload) {
  return payload.lines.map((line) => ({
    id: line.id,
    saleId: payload.id,
    batchId: line.batchId,
    harvestId: line.harvestId,
    description: line.description,
    quantityFish: line.quantityFish,
    weightKg: line.weightKg,
    pricePerKg: line.pricePerKg,
    totalAmount: line.totalAmount,
    deviceId: payload.deviceId,
    createdAt: new Date(payload.createdAt),
    deletedAt: null,
  }));
}

// --- Comandos de negocio compuestos (Fase 3.5) ---

function feedingRecordDataFromRegisterPayload(payload: RegisterFeedingPayload) {
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

function consumptionMovementDataFromRegisterPayload(payload: RegisterFeedingPayload) {
  return {
    id: payload.movementId,
    feedId: payload.feedId,
    movementType: "CONSUMPTION" as const,
    quantityKg: payload.quantityKg,
    unitCostPerKg: null,
    totalCost: null,
    date: new Date(payload.date),
    sourceType: "FEEDING",
    sourceId: payload.id,
    notes: null,
    deviceId: payload.deviceId,
    createdAt: new Date(payload.createdAt),
    deletedAt: payload.deletedAt ? new Date(payload.deletedAt) : null,
  };
}

function feedDataFromCreateWithStockPayload(payload: CreateFeedWithInitialStockPayload) {
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

function initialStockMovementDataFromCreateWithStockPayload(
  payload: CreateFeedWithInitialStockPayload,
) {
  return {
    id: payload.initialStockMovementId,
    feedId: payload.id,
    movementType: "INITIAL_STOCK" as const,
    quantityKg: payload.initialStockKg,
    unitCostPerKg: null,
    totalCost: null,
    date: new Date(payload.initialStockDate),
    sourceType: null,
    sourceId: null,
    notes: null,
    deviceId: payload.deviceId,
    createdAt: new Date(payload.createdAt),
    deletedAt: null,
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
  const [stockings, transfers, mortalities, harvests] = await Promise.all([
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
    tx.harvest.findMany({
      where: { batchId, deletedAt: null },
      select: { batchId: true, pondId: true, quantityFish: true },
    }),
  ]);
  return getBatchPondBalance(
    stockings,
    transfers,
    mortalities,
    harvests.map((h) => ({ batchId: h.batchId, pondId: h.pondId, quantityFish: h.quantityFish })),
    batchId,
    pondId,
  );
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

/**
 * Medición de calidad del agua (Fase 4, §1-§3): evento append-only, sin
 * ningún tipo de validación de balance/stock — solo se re-valida lo que
 * ya valida Zod (rangos físicos, §42: nunca confiar solo en el cliente).
 */
async function applyWaterQualityRecordOperation(
  tx: TransactionClient,
  op: Extract<PushOperation, { entityType: "WaterQualityRecord" }>,
): Promise<ApplyResult> {
  const data = waterQualityRecordData(op.payload);
  await tx.waterQualityRecord.upsert({ where: { id: op.entityId }, create: data, update: data });
  return "applied";
}

/**
 * Tarea (Fase 4, §18-§19, §34): a diferencia del resto del dominio de
 * esta fase, es MUTABLE — mismo criterio de resolución de conflictos
 * last-write-wins por número de versión que Species/Pond/Feed (§6 de
 * OFFLINE_SYNC.md). Dos dispositivos editando la misma tarea offline
 * (uno la completa, otro le cambia el título desde una versión antigua)
 * nunca pierden el cambio en silencio: el que trae una versión igual o
 * menor que la ya aplicada queda en conflicto, visible para revisión.
 */
async function applyTaskOperation(
  tx: TransactionClient,
  op: Extract<PushOperation, { entityType: "Task" }>,
): Promise<ApplyResult> {
  const data = taskData(op.payload);

  if (op.operation === "CREATE") {
    await tx.task.create({ data });
    return "applied";
  }

  const current = await tx.task.findUnique({ where: { id: op.entityId } });
  if (!current) {
    // El servidor nunca vio la creación original (todavía pendiente de
    // sincronizar en otro lote) — se trata como una creación para no
    // perder el dato, mismo criterio que Species/Pond/FishBatch/Feed.
    await tx.task.create({ data });
    return "applied";
  }

  if (data.version <= current.version) {
    return "conflict";
  }

  await tx.task.update({ where: { id: op.entityId }, data });
  return "applied";
}

// --- Fase 5: economía y cierre productivo ---

/** FarmSettings (§2): singleton mutable, mismo criterio LWW que Species/Pond/Feed/Task. */
async function applyFarmSettingsOperation(
  tx: TransactionClient,
  op: Extract<PushOperation, { entityType: "FarmSettings" }>,
): Promise<ApplyResult> {
  const data = farmSettingsData(op.payload);

  if (op.operation === "CREATE") {
    // Puede llegar CREATE dos veces (dos dispositivos crean la
    // configuración por defecto la primera vez que la piden, offline
    // cada uno) — se resuelve como cualquier upsert LWW, nunca como un
    // error de llave duplicada.
    const current = await tx.farmSettings.findUnique({ where: { id: op.entityId } });
    if (!current) {
      await tx.farmSettings.create({ data });
      return "applied";
    }
    if (data.version <= current.version) return "conflict";
    await tx.farmSettings.update({ where: { id: op.entityId }, data });
    return "applied";
  }

  const current = await tx.farmSettings.findUnique({ where: { id: op.entityId } });
  if (!current) {
    await tx.farmSettings.create({ data });
    return "applied";
  }
  if (data.version <= current.version) return "conflict";
  await tx.farmSettings.update({ where: { id: op.entityId }, data });
  return "applied";
}

async function applySupplierOperation(
  tx: TransactionClient,
  op: Extract<PushOperation, { entityType: "Supplier" }>,
): Promise<ApplyResult> {
  const data = supplierData(op.payload);

  if (op.operation === "CREATE") {
    await tx.supplier.create({ data });
    return "applied";
  }

  const current = await tx.supplier.findUnique({ where: { id: op.entityId } });
  if (!current) {
    await tx.supplier.create({ data });
    return "applied";
  }
  if (data.version <= current.version) return "conflict";
  await tx.supplier.update({ where: { id: op.entityId }, data });
  return "applied";
}

async function applyCustomerOperation(
  tx: TransactionClient,
  op: Extract<PushOperation, { entityType: "Customer" }>,
): Promise<ApplyResult> {
  const data = customerData(op.payload);

  if (op.operation === "CREATE") {
    await tx.customer.create({ data });
    return "applied";
  }

  const current = await tx.customer.findUnique({ where: { id: op.entityId } });
  if (!current) {
    await tx.customer.create({ data });
    return "applied";
  }
  if (data.version <= current.version) return "conflict";
  await tx.customer.update({ where: { id: op.entityId }, data });
  return "applied";
}

/**
 * Purchase (§32, §57): la creación real SIEMPRE llega como
 * "RegisterPurchase" (más abajo) — este handler solo existe para la
 * única edición que la UI permite: el estado de pago. Mismo criterio LWW
 * que el resto de entidades mutables; si por alguna razón llega un CREATE
 * suelto (dispositivo con cola vieja) se trata igual que Species/Pond: se
 * crea si no existe, nunca se pierde el dato.
 */
async function applyPurchaseOperation(
  tx: TransactionClient,
  op: Extract<PushOperation, { entityType: "Purchase" }>,
): Promise<ApplyResult> {
  const data = purchaseData(op.payload);

  if (op.operation === "CREATE") {
    // La creación real siempre llega como "RegisterPurchase": un CREATE
    // suelto solo puede ser un reintento sobre algo que ya existe.
    const current = await tx.purchase.findUnique({ where: { id: op.entityId } });
    if (current) return "conflict";
    await tx.purchase.create({ data });
    return "applied";
  }

  const current = await tx.purchase.findUnique({ where: { id: op.entityId } });
  if (!current) return "conflict"; // Nunca se marca pagada una compra que el servidor no ha visto.
  if (data.version <= current.version) return "conflict";
  await tx.purchase.update({ where: { id: op.entityId }, data });
  return "applied";
}

async function applySaleOperation(
  tx: TransactionClient,
  op: Extract<PushOperation, { entityType: "Sale" }>,
): Promise<ApplyResult> {
  const data = saleData(op.payload);

  if (op.operation === "CREATE") {
    const current = await tx.sale.findUnique({ where: { id: op.entityId } });
    if (current) return "conflict";
    await tx.sale.create({ data });
    return "applied";
  }

  const current = await tx.sale.findUnique({ where: { id: op.entityId } });
  if (!current) return "conflict";
  if (data.version <= current.version) return "conflict";
  await tx.sale.update({ where: { id: op.entityId }, data });
  return "applied";
}

/**
 * Gasto (§17-§19): append-only, sin ninguna validación de balance/stock —
 * DELETE representa la anulación auditada (§58, nunca borrado físico).
 */
async function applyExpenseOperation(
  tx: TransactionClient,
  op: Extract<PushOperation, { entityType: "Expense" }>,
): Promise<ApplyResult> {
  const data = expenseData(op.payload);
  await tx.expense.upsert({ where: { id: op.entityId }, create: data, update: data });
  return "applied";
}

/**
 * Cosecha (§20-§26): mismo criterio que FishTransfer/MortalityRecord —
 * nunca puede dejar el balance del lote/estanque en negativo, y dos
 * cosechas concurrentes del mismo lote nunca deben poder "gastar" el
 * mismo balance (§22-§23). Comparte el lock por batchId con
 * traslados/mortalidad porque las tres compiten por el mismo balance.
 */
async function applyHarvestOperation(
  tx: TransactionClient,
  op: Extract<PushOperation, { entityType: "Harvest" }>,
): Promise<ApplyResult> {
  if (op.operation !== "CREATE") {
    const data = harvestData(op.payload);
    await tx.harvest.upsert({ where: { id: op.entityId }, create: data, update: data });
    return "applied";
  }

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${op.payload.batchId})::bigint)`;

  const available = await getCurrentPondBalance(tx, op.payload.batchId, op.payload.pondId);
  if (op.payload.quantityFish > available) {
    return "conflict";
  }

  await tx.harvest.create({ data: harvestData(op.payload) });
  return "applied";
}

/**
 * "Registrar alimentación" como una única operación de negocio atómica
 * (Fase 3.5, §2 del encargo): antes, el cliente enviaba dos operaciones
 * independientes (FeedingRecord CREATE + FeedInventoryMovement CREATE),
 * cada una en su propia transacción — un fallo entre las dos podía dejar
 * un FeedingRecord sin su movimiento de inventario, o viceversa. Ahora
 * ambas escrituras ocurren dentro de la MISMA transacción (la que ya
 * envuelve a `applyOperation` en `push/route.ts`, junto con el registro
 * de `SyncOperation`): si cualquier paso falla, Postgres revierte las
 * dos, nunca queda una sin la otra. Ver OFFLINE_SYNC.md §10.
 */
async function applyRegisterFeedingOperation(
  tx: TransactionClient,
  op: Extract<PushOperation, { entityType: "RegisterFeeding" }>,
): Promise<ApplyResult> {
  const payload = op.payload;

  // 1. Validar existencia de Feed/FishBatch/Pond. Si alguno todavía no
  // llegó (p. ej. el padre sigue en el outbox de otro lote de sync), se
  // lanza un error real: la transacción se revierte por completo, la
  // operación queda "error" (nunca "conflict" ni una escritura parcial)
  // y el motor de sync la reintenta sola una vez el padre exista — ver
  // OFFLINE_SYNC.md §10 (orden de sincronización) y §13 (retry sigue
  // siendo necesario incluso con el orden explícito).
  const [feed, batch, pond] = await Promise.all([
    tx.feed.findUnique({ where: { id: payload.feedId } }),
    tx.fishBatch.findUnique({ where: { id: payload.batchId } }),
    tx.pond.findUnique({ where: { id: payload.pondId } }),
  ]);
  if (!feed || !batch || !pond) {
    const missing = !feed ? "el alimento" : !batch ? "el lote" : "el estanque";
    throw new Error(
      `No se pudo registrar la alimentación: todavía no existe ${missing} en el servidor (pendiente de sincronizar).`,
    );
  }

  // 2. Lock por feedId (mismo mecanismo que un FeedInventoryMovement de
  // salida individual).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${payload.feedId})::bigint)`;

  // 3-4. Calcular y validar stock disponible.
  const currentStock = await getCurrentFeedStock(tx, payload.feedId);
  if (payload.quantityKg > currentStock) {
    // Nunca se crea ni el FeedingRecord ni el movimiento: se retorna sin
    // escribir nada, la transacción no tiene cambios que revertir.
    return "conflict";
  }

  // 5-6. Crear FeedingRecord y FeedInventoryMovement juntos.
  await tx.feedingRecord.create({ data: feedingRecordDataFromRegisterPayload(payload) });
  await tx.feedInventoryMovement.create({
    data: consumptionMovementDataFromRegisterPayload(payload),
  });

  // 7-8. El registro de SyncOperation y el commit los hace processOperation
  // (push/route.ts), envolviendo esta misma llamada en su transacción.
  return "applied";
}

/**
 * "Crear alimento con stock inicial" (Fase 3.5, §9 del encargo): mismo
 * criterio que `applyRegisterFeedingOperation` — Feed y su
 * FeedInventoryMovement INITIAL_STOCK se crean en la misma transacción,
 * nunca uno sin el otro. Sin stock inicial, el cliente sigue enviando un
 * `Feed` CREATE simple (ver `applyFeedOperation`), no este comando.
 */
async function applyCreateFeedWithInitialStockOperation(
  tx: TransactionClient,
  op: Extract<PushOperation, { entityType: "CreateFeedWithInitialStock" }>,
): Promise<ApplyResult> {
  const payload = op.payload;

  await tx.feed.create({ data: feedDataFromCreateWithStockPayload(payload) });
  await tx.feedInventoryMovement.create({
    data: initialStockMovementDataFromCreateWithStockPayload(payload),
  });

  return "applied";
}

/**
 * "REGISTER_FEED_PURCHASE" y, en general, cualquier compra con líneas
 * (§8-§13 del encargo de Fase 5): Purchase + PurchaseLine(s) + los
 * FeedInventoryMovement PURCHASE que correspondan (una por cada línea de
 * alimento) se crean en la MISMA transacción — nunca una Purchase sin sus
 * líneas ni inventario sin su Purchase (§11). Ninguna escritura de esta
 * operación valida un balance que pueda quedar negativo (una compra
 * siempre es una ENTRADA de inventario), así que no hace falta lock de
 * concurrencia aquí — solo verificar que el proveedor y los alimentos
 * referenciados ya existan.
 */
async function applyRegisterPurchaseOperation(
  tx: TransactionClient,
  op: Extract<PushOperation, { entityType: "RegisterPurchase" }>,
): Promise<ApplyResult> {
  const payload = op.payload;

  if (payload.supplierId) {
    const supplier = await tx.supplier.findUnique({ where: { id: payload.supplierId } });
    if (!supplier) {
      throw new Error(
        "No se pudo registrar la compra: todavía no existe el proveedor en el servidor (pendiente de sincronizar).",
      );
    }
  }

  const feedIds = [...new Set(payload.lines.map((l) => l.feedId).filter((id): id is string => !!id))];
  if (feedIds.length > 0) {
    const feeds = await tx.feed.findMany({ where: { id: { in: feedIds } } });
    if (feeds.length !== feedIds.length) {
      throw new Error(
        "No se pudo registrar la compra: todavía no existe alguno de los alimentos en el servidor (pendiente de sincronizar).",
      );
    }
  }

  await tx.purchase.create({ data: purchaseDataFromRegisterPayload(payload) });
  await tx.purchaseLine.createMany({ data: purchaseLinesDataFromRegisterPayload(payload) });
  if (payload.feedMovements.length > 0) {
    await tx.feedInventoryMovement.createMany({
      data: feedMovementsDataFromRegisterPurchasePayload(payload),
    });
  }

  return "applied";
}

/**
 * "REGISTER_SALE" (§27-§32 del encargo de Fase 5): Sale + SaleLine(s) se
 * crean en la misma transacción (§51). Si alguna línea referencia una
 * cosecha (`harvestId`), los kg disponibles de esa cosecha son
 * `kg cosechados - kg ya vendidos` (§30) y nunca pueden quedar negativos
 * (§31) — se bloquea por `harvestId` (mismo mecanismo que el lock por
 * batchId/feedId de otras operaciones) para que dos ventas concurrentes
 * de la misma cosecha nunca puedan ambas dar por válido el mismo saldo.
 */
async function applyRegisterSaleOperation(
  tx: TransactionClient,
  op: Extract<PushOperation, { entityType: "RegisterSale" }>,
): Promise<ApplyResult> {
  const payload = op.payload;

  if (payload.customerId) {
    const customer = await tx.customer.findUnique({ where: { id: payload.customerId } });
    if (!customer) {
      throw new Error(
        "No se pudo registrar la venta: todavía no existe el cliente en el servidor (pendiente de sincronizar).",
      );
    }
  }

  const batchIds = [...new Set(payload.lines.map((l) => l.batchId))];
  const batches = await tx.fishBatch.findMany({ where: { id: { in: batchIds } } });
  if (batches.length !== batchIds.length) {
    throw new Error(
      "No se pudo registrar la venta: todavía no existe alguno de los lotes en el servidor (pendiente de sincronizar).",
    );
  }

  const harvestIds = [
    ...new Set(payload.lines.map((l) => l.harvestId).filter((id): id is string => !!id)),
  ];

  if (harvestIds.length > 0) {
    // Se bloquean en un orden determinista (ordenados) para evitar
    // deadlocks entre dos ventas concurrentes que referencien las mismas
    // dos cosechas en orden distinto.
    for (const harvestId of [...harvestIds].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${harvestId})::bigint)`;
    }

    const harvests = await tx.harvest.findMany({ where: { id: { in: harvestIds } } });
    if (harvests.length !== harvestIds.length) {
      throw new Error(
        "No se pudo registrar la venta: todavía no existe alguna de las cosechas en el servidor (pendiente de sincronizar).",
      );
    }
    const harvestById = new Map(harvests.map((h) => [h.id, h]));

    const existingLines = await tx.saleLine.findMany({
      where: { harvestId: { in: harvestIds }, deletedAt: null },
      select: { harvestId: true, weightKg: true },
    });
    const soldByHarvest = new Map<string, number>();
    for (const line of existingLines) {
      const harvestId = line.harvestId as string;
      soldByHarvest.set(harvestId, (soldByHarvest.get(harvestId) ?? 0) + Number(line.weightKg));
    }

    const requestedByHarvest = new Map<string, number>();
    for (const line of payload.lines) {
      if (!line.harvestId) continue;
      requestedByHarvest.set(
        line.harvestId,
        (requestedByHarvest.get(line.harvestId) ?? 0) + line.weightKg,
      );
    }

    for (const [harvestId, requestedKg] of requestedByHarvest) {
      const harvest = harvestById.get(harvestId);
      if (!harvest) continue;
      const alreadySold = soldByHarvest.get(harvestId) ?? 0;
      const available = Number(harvest.totalWeightKg) - alreadySold;
      if (requestedKg > available) {
        // Nunca se inventa un saldo ni se permite vender más kg de los
        // disponibles de esa cosecha (§31): la operación queda como
        // conflicto, sin escribir nada.
        return "conflict";
      }
    }
  }

  await tx.sale.create({ data: saleDataFromRegisterPayload(payload) });
  await tx.saleLine.createMany({ data: saleLinesDataFromRegisterPayload(payload) });

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
    case "RegisterFeeding":
      return applyRegisterFeedingOperation(tx, op);
    case "CreateFeedWithInitialStock":
      return applyCreateFeedWithInitialStockOperation(tx, op);
    case "WaterQualityRecord":
      return applyWaterQualityRecordOperation(tx, op);
    case "Task":
      return applyTaskOperation(tx, op);
    case "FarmSettings":
      return applyFarmSettingsOperation(tx, op);
    case "Supplier":
      return applySupplierOperation(tx, op);
    case "Customer":
      return applyCustomerOperation(tx, op);
    case "Purchase":
      return applyPurchaseOperation(tx, op);
    case "Sale":
      return applySaleOperation(tx, op);
    case "Expense":
      return applyExpenseOperation(tx, op);
    case "Harvest":
      return applyHarvestOperation(tx, op);
    case "RegisterPurchase":
      return applyRegisterPurchaseOperation(tx, op);
    case "RegisterSale":
      return applyRegisterSaleOperation(tx, op);
  }
}
