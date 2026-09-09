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

export type SyncEntityType = "Species" | "Pond" | "FishBatch" | "Stocking" | "FishTransfer";

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
