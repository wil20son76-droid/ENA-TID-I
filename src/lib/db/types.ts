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
  | "Sampling";

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
