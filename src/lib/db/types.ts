// Tipos de dominio para la base de datos local (IndexedDB / Dexie).
//
// Se definen de forma independiente al cliente Prisma generado: el
// navegador nunca importa "@/generated/prisma" (es código orientado a
// Node/servidor). Los nombres de campo se mantienen alineados 1:1 con
// prisma/schema.prisma para que el mapeo en la sincronización sea directo.

/** Campos de auditoría/sincronización presentes en toda entidad sincronizable. */
export interface AuditFields {
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  version: number;
  deviceId: string;
  createdBy: string | null;
  updatedBy: string | null;
}

/**
 * Campos de auditoría reducidos para eventos append-only (Stocking,
 * FishTransfer, y desde la Fase 3: FeedInventoryMovement, FeedingRecord,
 * MortalityRecord, Sampling): sin `version`/`createdBy`/`updatedBy`
 * porque nunca se editan desde la UI, solo se crean.
 */
export interface EventAuditFields {
  deviceId: string;
  createdAt: string;
  deletedAt: string | null;
}

export interface SpeciesFields {
  commonName: string;
  scientificName: string | null;
  description: string | null;
  targetWeightKg: number | null;
  estimatedCycleDays: number | null;
  minTemperatureC: number | null;
  maxTemperatureC: number | null;
  minPh: number | null;
  maxPh: number | null;
  minDissolvedOxygenMgL: number | null;
  expectedFcr: number | null;
  expectedMortalityPercent: number | null;
  active: boolean;
}

export interface SpeciesRecord extends SpeciesFields, AuditFields {
  id: string;
}

export type PondStatus =
  | "EMPTY"
  | "PREPARATION"
  | "ACTIVE"
  | "HARVEST"
  | "CLEANING"
  | "MAINTENANCE";

/** Ver src/lib/domain/pondGeometry.ts para la lógica calculado/manual. */
export type GeometrySource = "CALCULATED" | "MANUAL";

export interface PondFields {
  code: string;
  name: string;
  type: string | null;
  lengthM: number | null;
  widthM: number | null;
  averageDepthM: number | null;
  areaM2: number | null;
  areaSource: GeometrySource;
  estimatedVolumeM3: number | null;
  volumeSource: GeometrySource;
  capacityNotes: string | null;
  locationNotes: string | null;
  notes: string | null;
  status: PondStatus;
  active: boolean;
}

export interface PondRecord extends PondFields, AuditFields {
  id: string;
}

export type BatchStatus =
  | "PLANNED"
  | "STOCKED"
  | "GROWING"
  | "PRE_HARVEST"
  | "PARTIAL_HARVEST"
  | "HARVESTED"
  | "CLOSED";

export interface FishBatchFields {
  code: string;
  speciesId: string;
  supplierId: string | null;
  purchaseDate: string | null;
  initialStockingDate: string;
  initialQuantity: number;
  initialAverageWeightG: number;
  initialBiomassKg: number;
  fryCost: number | null;
  targetWeightKg: number | null;
  expectedHarvestDate: string | null;
  status: BatchStatus;
  notes: string | null;
}

export interface FishBatchRecord extends FishBatchFields, AuditFields {
  id: string;
}

/**
 * Siembra: evento append-only (§8 del encargo de Fase 2). No lleva
 * `version`/`createdBy`/`updatedBy` — nunca se edita desde la UI de esta
 * fase, solo se crea; `deletedAt` queda preparado por si en el futuro se
 * implementa una corrección auditada (§25).
 */
export interface StockingFields {
  batchId: string;
  pondId: string;
  date: string;
  quantity: number;
  averageWeightG: number;
  biomassKg: number;
  responsibleName: string | null;
  notes: string | null;
}

export interface StockingRecord extends StockingFields {
  id: string;
  deviceId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** Traslado: evento append-only (§10-§11). Mismo criterio que Stocking. */
export interface FishTransferFields {
  batchId: string;
  fromPondId: string;
  toPondId: string;
  date: string;
  quantity: number;
  averageWeightG: number | null;
  biomassKg: number | null;
  reason: string | null;
  responsibleName: string | null;
  notes: string | null;
}

export interface FishTransferRecord extends FishTransferFields {
  id: string;
  deviceId: string;
  createdAt: string;
  deletedAt: string | null;
}

// --- Fase 3: operación diaria ---

export type FeedMovementType =
  | "PURCHASE"
  | "INITIAL_STOCK"
  | "CONSUMPTION"
  | "ADJUSTMENT_IN"
  | "ADJUSTMENT_OUT"
  | "LOSS"
  | "RETURN";

export type FeedingShift = "MORNING" | "MIDDAY" | "AFTERNOON" | "NIGHT";

export type MortalityCause =
  | "UNKNOWN"
  | "LOW_OXYGEN"
  | "DISEASE"
  | "HANDLING"
  | "PREDATORS"
  | "TEMPERATURE"
  | "WATER_QUALITY"
  | "ACCIDENT"
  | "OTHER";

/** Catálogo de alimentos (§3 del encargo de Fase 3). Mutable, igual criterio que Species. */
export interface FeedFields {
  name: string;
  brand: string | null;
  proteinPercent: number | null;
  pelletSizeMm: number | null;
  bagWeightKg: number | null;
  defaultBagPrice: number | null;
  defaultCostPerKg: number | null;
  recommendedStage: string | null;
  notes: string | null;
  minimumStockKg: number | null;
  active: boolean;
}

export interface FeedRecord extends FeedFields, AuditFields {
  id: string;
}

/**
 * Movimiento de inventario de alimento (§4-§7): evento append-only.
 * `quantityKg` siempre positivo — el signo lo decide `movementType` (ver
 * src/lib/domain/feedLedger.ts). `sourceType`/`sourceId` vinculan un
 * movimiento CONSUMPTION a su FeedingRecord de origen (§9).
 */
export interface FeedInventoryMovementFields {
  feedId: string;
  movementType: FeedMovementType;
  quantityKg: number;
  unitCostPerKg: number | null;
  totalCost: number | null;
  date: string;
  sourceType: string | null;
  sourceId: string | null;
  notes: string | null;
}

export interface FeedInventoryMovementRecord extends FeedInventoryMovementFields, EventAuditFields {
  id: string;
}

/** Registro diario de alimentación (§8-§9): evento append-only. */
export interface FeedingRecordFields {
  batchId: string;
  pondId: string;
  feedId: string;
  date: string;
  time: string | null;
  quantityKg: number;
  shift: FeedingShift | null;
  responsibleName: string | null;
  notes: string | null;
}

export interface FeedingRecordRecord extends FeedingRecordFields, EventAuditFields {
  id: string;
}

/** Mortalidad (§15-§19): evento append-only, integrado en el ledger de peces. */
export interface MortalityRecordFields {
  batchId: string;
  pondId: string;
  date: string;
  quantity: number;
  estimatedAverageWeightG: number | null;
  cause: MortalityCause;
  notes: string | null;
  responsibleName: string | null;
}

export interface MortalityRecordRecord extends MortalityRecordFields, EventAuditFields {
  id: string;
}

/** Muestreo (§21-§24): evento append-only. `averageWeightG` ya viene calculado. */
export interface SamplingFields {
  batchId: string;
  pondId: string;
  date: string;
  sampleFishCount: number;
  totalSampleWeightKg: number;
  averageWeightG: number;
  averageLengthCm: number | null;
  notes: string | null;
  responsibleName: string | null;
}

export interface SamplingRecord extends SamplingFields, EventAuditFields {
  id: string;
}

// --- Fase 4: calidad del agua, alertas y planificación ---

/**
 * Medición de calidad del agua (§1-§11 del encargo de Fase 4):
 * evento append-only, igual criterio que Sampling/MortalityRecord — NUNCA
 * un `pond.currentPh` mutable. Ver src/lib/domain/waterQuality.ts.
 */
export interface WaterQualityRecordFields {
  pondId: string;
  batchId: string | null;
  date: string;
  time: string | null;
  temperatureC: number | null;
  ph: number | null;
  dissolvedOxygenMgL: number | null;
  transparencyCm: number | null;
  ammoniaMgL: number | null;
  nitriteMgL: number | null;
  alkalinityMgL: number | null;
  waterLevelCm: number | null;
  notes: string | null;
  responsibleName: string | null;
}

export interface WaterQualityRecordRecord extends WaterQualityRecordFields, EventAuditFields {
  id: string;
}

export type TaskStatus = "PENDING" | "COMPLETED" | "CANCELLED";
export type TaskPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

/**
 * Tarea manual (§18-§27 del encargo de Fase 4): MUTABLE, a diferencia
 * del resto del dominio productivo — usa AuditFields (version/LWW) igual
 * que Species/Pond/Feed, no EventAuditFields.
 */
export interface TaskFields {
  title: string;
  description: string | null;
  dueDate: string;
  dueTime: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  pondId: string | null;
  batchId: string | null;
  assignedToName: string | null;
  notes: string | null;
  completedAt: string | null;
}

export interface TaskRecord extends TaskFields, AuditFields {
  id: string;
}

// --- Fase 5: economía y cierre productivo ---

/** Configuración de moneda de la finca (§2 del encargo). Singleton: `id` siempre `"default"`. */
export interface FarmSettingsFields {
  currencyCode: string;
  currencySymbol: string;
}

export interface FarmSettingsRecord extends FarmSettingsFields, AuditFields {
  id: string;
}

export const FARM_SETTINGS_ID = "default";

/** Proveedor (§4-§5): mutable, mismo criterio que Species/Pond/Feed. */
export interface SupplierFields {
  name: string;
  contactName: string | null;
  phone: string | null;
  whatsapp: string | null;
  locality: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
}

export interface SupplierRecord extends SupplierFields, AuditFields {
  id: string;
}

export type CustomerType =
  | "INDIVIDUAL"
  | "RESTAURANT"
  | "MARKET"
  | "DISTRIBUTOR"
  | "WHOLESALER"
  | "OTHER";

/** Cliente/comprador (§6-§7): mismo criterio que Supplier. */
export interface CustomerFields {
  name: string;
  type: CustomerType;
  phone: string | null;
  whatsapp: string | null;
  locality: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
}

export interface CustomerRecord extends CustomerFields, AuditFields {
  id: string;
}

export type PaymentStatus = "PENDING" | "PARTIAL" | "PAID";

/**
 * Compra (§8-§13): cabecera. Se crea siempre junto a sus líneas (comando
 * compuesto "RegisterPurchase") — mutable SOLO para el estado de pago
 * (§32, §57): la UI nunca reedita fecha/proveedor/líneas ya confirmadas.
 */
export interface PurchaseFields {
  supplierId: string | null;
  date: string;
  referenceNumber: string | null;
  totalAmount: number;
  paymentStatus: PaymentStatus;
  amountPaid: number;
  notes: string | null;
}

export interface PurchaseRecord extends PurchaseFields, AuditFields {
  id: string;
}

export type PurchaseItemType = "FEED" | "FRY" | "MEDICINE" | "MATERIAL" | "EQUIPMENT" | "OTHER";

/** Línea de compra (§9): append-only, solo existe dentro de su Purchase. */
export interface PurchaseLineFields {
  purchaseId: string;
  itemType: PurchaseItemType;
  feedId: string | null;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalAmount: number;
}

export interface PurchaseLineRecord extends PurchaseLineFields, EventAuditFields {
  id: string;
}

export type ExpenseCategory =
  | "FRY"
  | "FUEL"
  | "ELECTRICITY"
  | "LABOR"
  | "TRANSPORT"
  | "MAINTENANCE"
  | "CONSTRUCTION"
  | "TOOLS"
  | "EQUIPMENT"
  | "MEDICINE"
  | "SERVICES"
  | "OTHER";

/**
 * Gasto (§17-§19): append-only. Nunca duplica una compra ya registrada vía
 * Purchase (§1 — ver ECONOMICS.md). Una corrección se audita anulando
 * (`deletedAt` + `voidReason`), nunca borrado físico de un gasto ya
 * sincronizado (§58, §72).
 */
export interface ExpenseFields {
  date: string;
  category: ExpenseCategory;
  description: string;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  totalAmount: number;
  supplierId: string | null;
  batchId: string | null;
  pondId: string | null;
  notes: string | null;
  voidReason: string | null;
}

export interface ExpenseRecord extends ExpenseFields, EventAuditFields {
  id: string;
}

export type HarvestType = "PARTIAL" | "TOTAL";

/** Cosecha (§20-§26): evento append-only, salida del ledger de peces. */
export interface HarvestFields {
  batchId: string;
  pondId: string;
  date: string;
  quantityFish: number;
  totalWeightKg: number;
  averageWeightG: number;
  harvestType: HarvestType;
  responsibleName: string | null;
  notes: string | null;
}

export interface HarvestRecord extends HarvestFields, EventAuditFields {
  id: string;
}

/**
 * Venta (§27-§32): cabecera. Se crea siempre junto a sus líneas (comando
 * compuesto "RegisterSale") — mutable SOLO para el estado de pago.
 */
export interface SaleFields {
  customerId: string | null;
  date: string;
  paymentStatus: PaymentStatus;
  amountPaid: number;
  totalAmount: number;
  notes: string | null;
}

export interface SaleRecord extends SaleFields, AuditFields {
  id: string;
}

/**
 * Línea de venta (§28-§31): append-only. `harvestId` opcional — presente
 * cuando la venta descuenta kg disponibles de una cosecha ya registrada;
 * ausente para una venta externa/no reconciliada con ninguna cosecha.
 */
export interface SaleLineFields {
  saleId: string;
  batchId: string;
  harvestId: string | null;
  description: string;
  quantityFish: number | null;
  weightKg: number;
  pricePerKg: number;
  totalAmount: number;
}

export interface SaleLineRecord extends SaleLineFields, EventAuditFields {
  id: string;
}

export type SyncEntityType =
  | "Species"
  | "Pond"
  | "FishBatch"
  | "Stocking"
  | "FishTransfer"
  | "Feed"
  | "FeedInventoryMovement"
  | "FeedingRecord"
  | "MortalityRecord"
  | "Sampling"
  // Comandos de negocio compuestos (Fase 3.5) — ver src/lib/validation/sync.ts.
  | "RegisterFeeding"
  | "CreateFeedWithInitialStock"
  // Fase 4.
  | "WaterQualityRecord"
  | "Task"
  // Fase 5 (economía y cierre productivo).
  | "FarmSettings"
  | "Supplier"
  | "Customer"
  | "Expense"
  | "Harvest"
  | "Purchase"
  | "Sale"
  | "RegisterPurchase"
  | "RegisterSale";

export type SyncOperationType = "CREATE" | "UPDATE" | "DELETE";

export type SyncQueueStatus = "pending" | "syncing" | "synced" | "error";

/** Entrada de la cola de sincronización local (outbox). Ver IMPLEMENTATION_PLAN.md §6.2. */
export interface SyncQueueRecord {
  /** Id de la propia operación — es la clave de idempotencia enviada al servidor. */
  id: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperationType;
  /** Snapshot completo de la entidad en el momento de encolar la operación. */
  payload: unknown;
  createdAt: string;
  updatedAt: string;
  retryCount: number;
  status: SyncQueueStatus;
  lastError: string | null;
  deviceId: string;
}

export interface SyncMetaRecord {
  key: string;
  value: string;
}
