// Esquemas Zod compartidos entre cliente y servidor para el protocolo de
// sincronización (IMPLEMENTATION_PLAN.md §6). El servidor NUNCA confía
// únicamente en que el cliente ya validó los datos (§59 del encargo): toda
// operación que llega a /api/sync/push se vuelve a validar aquí.
import { z } from "zod";

export const syncOperationTypeSchema = z.enum(["CREATE", "UPDATE", "DELETE"]);
export const syncEntityTypeSchema = z.enum([
  "Species",
  "Pond",
  "FishBatch",
  "Stocking",
  "FishTransfer",
  "Feed",
  "FeedInventoryMovement",
  "FeedingRecord",
  "MortalityRecord",
  "Sampling",
  // Comandos de negocio compuestos (Fase 3.5, §2/§9 del encargo): el
  // cliente ya no envía "FeedingRecord"+"FeedInventoryMovement" (o
  // "Feed"+"FeedInventoryMovement") como dos operaciones independientes
  // para una misma acción de usuario — las envía como UNA sola, que el
  // servidor aplica en una única transacción. Ver OFFLINE_SYNC.md §10.
  // "FeedingRecord"/"FeedInventoryMovement"/"Feed" se mantienen arriba
  // por compatibilidad con operaciones ya encoladas en dispositivos con
  // la versión anterior de la app (§6 del encargo) y para el pull, que
  // siempre entrega las entidades reales, nunca el comando que las creó.
  "RegisterFeeding",
  "CreateFeedWithInitialStock",
  // Fase 4 (calidad del agua, alertas y planificación).
  "WaterQualityRecord",
  "Task",
]);
export const pondStatusSchema = z.enum([
  "EMPTY",
  "PREPARATION",
  "ACTIVE",
  "HARVEST",
  "CLEANING",
  "MAINTENANCE",
]);
export const geometrySourceSchema = z.enum(["CALCULATED", "MANUAL"]);
export const batchStatusSchema = z.enum([
  "PLANNED",
  "STOCKED",
  "GROWING",
  "PRE_HARVEST",
  "PARTIAL_HARVEST",
  "HARVESTED",
  "CLOSED",
]);
export const feedMovementTypeSchema = z.enum([
  "PURCHASE",
  "INITIAL_STOCK",
  "CONSUMPTION",
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
  "LOSS",
  "RETURN",
]);
export const feedingShiftSchema = z.enum(["MORNING", "MIDDAY", "AFTERNOON", "NIGHT"]);
export const mortalityCauseSchema = z.enum([
  "UNKNOWN",
  "LOW_OXYGEN",
  "DISEASE",
  "HANDLING",
  "PREDATORS",
  "TEMPERATURE",
  "WATER_QUALITY",
  "ACCIDENT",
  "OTHER",
]);
export const taskStatusSchema = z.enum(["PENDING", "COMPLETED", "CANCELLED"]);
export const taskPrioritySchema = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]);

// Campos de auditoría completos: entidades mutables (Species, Pond,
// FishBatch), que sí se editan y por tanto necesitan versión para
// resolución de conflictos (§6.4).
const auditFieldsSchema = {
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
  version: z.number().int().positive(),
  deviceId: z.string().min(1).max(200),
  createdBy: z.string().max(200).nullable(),
  updatedBy: z.string().max(200).nullable(),
};

export const speciesPayloadSchema = z.object({
  id: z.uuid(),
  commonName: z.string().min(1).max(200),
  scientificName: z.string().max(200).nullable(),
  description: z.string().max(2000).nullable(),
  targetWeightKg: z.number().nonnegative().nullable(),
  estimatedCycleDays: z.number().int().nonnegative().nullable(),
  minTemperatureC: z.number().min(-10).max(60).nullable(),
  maxTemperatureC: z.number().min(-10).max(60).nullable(),
  minPh: z.number().min(0).max(14).nullable(),
  maxPh: z.number().min(0).max(14).nullable(),
  minDissolvedOxygenMgL: z.number().nonnegative().nullable(),
  expectedFcr: z.number().nonnegative().nullable(),
  expectedMortalityPercent: z.number().min(0).max(100).nullable(),
  active: z.boolean(),
  ...auditFieldsSchema,
});

export const pondPayloadSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  type: z.string().max(100).nullable(),
  lengthM: z.number().nonnegative().nullable(),
  widthM: z.number().nonnegative().nullable(),
  averageDepthM: z.number().nonnegative().nullable(),
  areaM2: z.number().nonnegative().nullable(),
  areaSource: geometrySourceSchema,
  estimatedVolumeM3: z.number().nonnegative().nullable(),
  volumeSource: geometrySourceSchema,
  capacityNotes: z.string().max(2000).nullable(),
  locationNotes: z.string().max(500).nullable(),
  notes: z.string().max(2000).nullable(),
  status: pondStatusSchema,
  active: z.boolean(),
  ...auditFieldsSchema,
});

export const fishBatchPayloadSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1).max(50),
  speciesId: z.uuid(),
  supplierId: z.string().max(200).nullable(),
  purchaseDate: z.iso.datetime().nullable(),
  initialStockingDate: z.iso.datetime(),
  initialQuantity: z.number().int().positive(),
  initialAverageWeightG: z.number().positive(),
  initialBiomassKg: z.number().nonnegative(),
  fryCost: z.number().nonnegative().nullable(),
  targetWeightKg: z.number().nonnegative().nullable(),
  expectedHarvestDate: z.iso.datetime().nullable(),
  status: batchStatusSchema,
  notes: z.string().max(2000).nullable(),
  ...auditFieldsSchema,
});

// Stocking y FishTransfer son eventos append-only (§8/§10): nunca se
// editan desde la UI, así que no llevan version/createdBy/updatedBy — solo
// lo mínimo para crearlos y, si algún día se corrigen, marcarlos borrados.
export const stockingPayloadSchema = z.object({
  id: z.uuid(),
  batchId: z.uuid(),
  pondId: z.uuid(),
  date: z.iso.datetime(),
  quantity: z.number().int().positive(),
  averageWeightG: z.number().positive(),
  biomassKg: z.number().nonnegative(),
  responsibleName: z.string().max(200).nullable(),
  notes: z.string().max(2000).nullable(),
  deviceId: z.string().min(1).max(200),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});

export const fishTransferPayloadSchema = z.object({
  id: z.uuid(),
  batchId: z.uuid(),
  fromPondId: z.uuid(),
  toPondId: z.uuid(),
  date: z.iso.datetime(),
  quantity: z.number().int().positive(),
  averageWeightG: z.number().positive().nullable(),
  biomassKg: z.number().nonnegative().nullable(),
  reason: z.string().max(500).nullable(),
  responsibleName: z.string().max(200).nullable(),
  notes: z.string().max(2000).nullable(),
  deviceId: z.string().min(1).max(200),
  createdAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});

// Fase 3: catálogo de alimentos (mutable, igual criterio que Species/Pond).
export const feedPayloadSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(200),
  brand: z.string().max(200).nullable(),
  proteinPercent: z.number().min(0).max(100).nullable(),
  pelletSizeMm: z.number().nonnegative().nullable(),
  bagWeightKg: z.number().nonnegative().nullable(),
  defaultBagPrice: z.number().nonnegative().nullable(),
  defaultCostPerKg: z.number().nonnegative().nullable(),
  recommendedStage: z.string().max(200).nullable(),
  notes: z.string().max(2000).nullable(),
  minimumStockKg: z.number().nonnegative().nullable(),
  active: z.boolean(),
  ...auditFieldsSchema,
});

// Fase 3: eventos append-only (§4, §8, §15, §21) — mismo criterio que
// Stocking/FishTransfer: sin version/createdBy/updatedBy.
export const feedInventoryMovementPayloadSchema = z.object({
  id: z.uuid(),
  feedId: z.uuid(),
  movementType: feedMovementTypeSchema,
  quantityKg: z.number().positive(),
  unitCostPerKg: z.number().nonnegative().nullable(),
  totalCost: z.number().nonnegative().nullable(),
  date: z.iso.datetime(),
  sourceType: z.string().max(50).nullable(),
  sourceId: z.uuid().nullable(),
  notes: z.string().max(2000).nullable(),
  deviceId: z.string().min(1).max(200),
  createdAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});

export const feedingRecordPayloadSchema = z.object({
  id: z.uuid(),
  batchId: z.uuid(),
  pondId: z.uuid(),
  feedId: z.uuid(),
  date: z.iso.datetime(),
  time: z.string().max(10).nullable(),
  quantityKg: z.number().positive(),
  shift: feedingShiftSchema.nullable(),
  responsibleName: z.string().max(200).nullable(),
  notes: z.string().max(2000).nullable(),
  deviceId: z.string().min(1).max(200),
  createdAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});

export const mortalityRecordPayloadSchema = z.object({
  id: z.uuid(),
  batchId: z.uuid(),
  pondId: z.uuid(),
  date: z.iso.datetime(),
  quantity: z.number().int().positive(),
  estimatedAverageWeightG: z.number().positive().nullable(),
  cause: mortalityCauseSchema,
  notes: z.string().max(2000).nullable(),
  responsibleName: z.string().max(200).nullable(),
  deviceId: z.string().min(1).max(200),
  createdAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});

export const samplingPayloadSchema = z.object({
  id: z.uuid(),
  batchId: z.uuid(),
  pondId: z.uuid(),
  date: z.iso.datetime(),
  sampleFishCount: z.number().int().positive(),
  totalSampleWeightKg: z.number().positive(),
  averageWeightG: z.number().positive(),
  averageLengthCm: z.number().positive().nullable(),
  notes: z.string().max(2000).nullable(),
  responsibleName: z.string().max(200).nullable(),
  deviceId: z.string().min(1).max(200),
  createdAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});

// Comandos de negocio compuestos (Fase 3.5). Su `id` es el de la
// entidad PRINCIPAL que crean (el FeedingRecord / el Feed) — es también
// el `entityId` de la operación, para que el resto del protocolo
// (idempotencia por operationId, pull, etc.) no necesite distinguirlos
// de una entidad simple.
export const registerFeedingPayloadSchema = z.object({
  id: z.uuid(),
  movementId: z.uuid(),
  batchId: z.uuid(),
  pondId: z.uuid(),
  feedId: z.uuid(),
  date: z.iso.datetime(),
  time: z.string().max(10).nullable(),
  quantityKg: z.number().positive(),
  shift: feedingShiftSchema.nullable(),
  responsibleName: z.string().max(200).nullable(),
  notes: z.string().max(2000).nullable(),
  deviceId: z.string().min(1).max(200),
  createdAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});

export const createFeedWithInitialStockPayloadSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(200),
  brand: z.string().max(200).nullable(),
  proteinPercent: z.number().min(0).max(100).nullable(),
  pelletSizeMm: z.number().nonnegative().nullable(),
  bagWeightKg: z.number().nonnegative().nullable(),
  defaultBagPrice: z.number().nonnegative().nullable(),
  defaultCostPerKg: z.number().nonnegative().nullable(),
  recommendedStage: z.string().max(200).nullable(),
  notes: z.string().max(2000).nullable(),
  minimumStockKg: z.number().nonnegative().nullable(),
  active: z.boolean(),
  ...auditFieldsSchema,
  initialStockMovementId: z.uuid(),
  initialStockKg: z.number().positive(),
  initialStockDate: z.iso.datetime(),
});

// Fase 4: calidad del agua (§1-§11 del encargo) — evento append-only,
// igual criterio que Sampling/MortalityRecord (sin version/createdBy/
// updatedBy). Los límites de pH (0-14) y temperatura (-5 a 45 °C) son
// rangos FÍSICOS absolutos (§3, §42: "validar datos físicos también en
// servidor, no confiar solo en cliente") — nunca el rango recomendado
// para una especie, eso lo evalúa evaluateWaterQuality en el cliente
// (src/lib/domain/waterQuality.ts) contra el historial ya sincronizado.
// Al menos un parámetro medido, igual que exige el cliente (§2).
export const waterQualityRecordPayloadSchema = z
  .object({
    id: z.uuid(),
    pondId: z.uuid(),
    batchId: z.uuid().nullable(),
    date: z.iso.datetime(),
    time: z.string().max(10).nullable(),
    temperatureC: z.number().min(-5).max(45).nullable(),
    ph: z.number().min(0).max(14).nullable(),
    dissolvedOxygenMgL: z.number().nonnegative().nullable(),
    transparencyCm: z.number().nonnegative().nullable(),
    ammoniaMgL: z.number().nonnegative().nullable(),
    nitriteMgL: z.number().nonnegative().nullable(),
    alkalinityMgL: z.number().nonnegative().nullable(),
    waterLevelCm: z.number().nonnegative().nullable(),
    notes: z.string().max(2000).nullable(),
    responsibleName: z.string().max(200).nullable(),
    deviceId: z.string().min(1).max(200),
    createdAt: z.iso.datetime(),
    deletedAt: z.iso.datetime().nullable(),
  })
  .refine(
    (payload) =>
      payload.temperatureC != null ||
      payload.ph != null ||
      payload.dissolvedOxygenMgL != null ||
      payload.transparencyCm != null ||
      payload.ammoniaMgL != null ||
      payload.nitriteMgL != null ||
      payload.alkalinityMgL != null ||
      payload.waterLevelCm != null,
    { message: "Debe informarse al menos un parámetro medido." },
  );

// Fase 4: tarea manual (§18-§27) — a diferencia del resto del dominio
// productivo, SÍ es mutable (§19): lleva los mismos campos de auditoría
// que Species/Pond/Feed para resolución de conflictos last-write-wins.
export const taskPayloadSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(300),
  description: z.string().max(2000).nullable(),
  dueDate: z.iso.datetime(),
  dueTime: z.string().max(10).nullable(),
  priority: taskPrioritySchema,
  status: taskStatusSchema,
  pondId: z.uuid().nullable(),
  batchId: z.uuid().nullable(),
  assignedToName: z.string().max(200).nullable(),
  notes: z.string().max(2000).nullable(),
  completedAt: z.iso.datetime().nullable(),
  ...auditFieldsSchema,
});

export type SpeciesPayload = z.infer<typeof speciesPayloadSchema>;
export type PondPayload = z.infer<typeof pondPayloadSchema>;
export type FishBatchPayload = z.infer<typeof fishBatchPayloadSchema>;
export type StockingPayload = z.infer<typeof stockingPayloadSchema>;
export type FishTransferPayload = z.infer<typeof fishTransferPayloadSchema>;
export type FeedPayload = z.infer<typeof feedPayloadSchema>;
export type FeedInventoryMovementPayload = z.infer<typeof feedInventoryMovementPayloadSchema>;
export type FeedingRecordPayload = z.infer<typeof feedingRecordPayloadSchema>;
export type MortalityRecordPayload = z.infer<typeof mortalityRecordPayloadSchema>;
export type SamplingPayload = z.infer<typeof samplingPayloadSchema>;
export type RegisterFeedingPayload = z.infer<typeof registerFeedingPayloadSchema>;
export type CreateFeedWithInitialStockPayload = z.infer<typeof createFeedWithInitialStockPayloadSchema>;
export type WaterQualityRecordPayload = z.infer<typeof waterQualityRecordPayloadSchema>;
export type TaskPayload = z.infer<typeof taskPayloadSchema>;

const basePushOperationSchema = z.object({
  // Id de la propia operación de sincronización — es la clave de
  // idempotencia (§6.5): reenviarla no debe reaplicar su efecto.
  id: z.uuid(),
  entityId: z.uuid(),
  operation: syncOperationTypeSchema,
  deviceId: z.string().min(1).max(200),
});

export const pushOperationSchema = z.discriminatedUnion("entityType", [
  basePushOperationSchema.extend({
    entityType: z.literal("Species"),
    payload: speciesPayloadSchema,
  }),
  basePushOperationSchema.extend({
    entityType: z.literal("Pond"),
    payload: pondPayloadSchema,
  }),
  basePushOperationSchema.extend({
    entityType: z.literal("FishBatch"),
    payload: fishBatchPayloadSchema,
  }),
  basePushOperationSchema.extend({
    entityType: z.literal("Stocking"),
    payload: stockingPayloadSchema,
  }),
  basePushOperationSchema.extend({
    entityType: z.literal("FishTransfer"),
    payload: fishTransferPayloadSchema,
  }),
  basePushOperationSchema.extend({
    entityType: z.literal("Feed"),
    payload: feedPayloadSchema,
  }),
  basePushOperationSchema.extend({
    entityType: z.literal("FeedInventoryMovement"),
    payload: feedInventoryMovementPayloadSchema,
  }),
  basePushOperationSchema.extend({
    entityType: z.literal("FeedingRecord"),
    payload: feedingRecordPayloadSchema,
  }),
  basePushOperationSchema.extend({
    entityType: z.literal("MortalityRecord"),
    payload: mortalityRecordPayloadSchema,
  }),
  basePushOperationSchema.extend({
    entityType: z.literal("Sampling"),
    payload: samplingPayloadSchema,
  }),
  basePushOperationSchema.extend({
    entityType: z.literal("RegisterFeeding"),
    payload: registerFeedingPayloadSchema,
  }),
  basePushOperationSchema.extend({
    entityType: z.literal("CreateFeedWithInitialStock"),
    payload: createFeedWithInitialStockPayloadSchema,
  }),
  basePushOperationSchema.extend({
    entityType: z.literal("WaterQualityRecord"),
    payload: waterQualityRecordPayloadSchema,
  }),
  basePushOperationSchema.extend({
    entityType: z.literal("Task"),
    payload: taskPayloadSchema,
  }),
]);

export type PushOperation = z.infer<typeof pushOperationSchema>;

export const pushRequestSchema = z.object({
  deviceId: z.string().min(1).max(200),
  operations: z.array(pushOperationSchema).min(1).max(200),
});

export type PushRequest = z.infer<typeof pushRequestSchema>;

export const pushResultStatusSchema = z.enum([
  "applied",
  "duplicate",
  "conflict",
  "error",
]);

export const pullQuerySchema = z.object({
  since: z.iso.datetime().nullable().optional(),
});
