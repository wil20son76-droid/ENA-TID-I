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
  targetWeightGrams: number | null;
  cultureDurationDays: number | null;
  minTemperatureC: number | null;
  maxTemperatureC: number | null;
  minPh: number | null;
  maxPh: number | null;
  minDissolvedOxygen: number | null;
  expectedFcr: number | null;
  expectedMortalityPct: number | null;
  notes: string | null;
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

export interface PondFields {
  code: string;
  name: string;
  type: string | null;
  lengthM: number | null;
  widthM: number | null;
  averageDepthM: number | null;
  surfaceM2: number | null;
  volumeM3: number | null;
  location: string | null;
  notes: string | null;
  status: PondStatus;
}

export interface PondRecord extends PondFields, AuditFields {
  id: string;
}

export type SyncEntityType = "Species" | "Pond";

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
