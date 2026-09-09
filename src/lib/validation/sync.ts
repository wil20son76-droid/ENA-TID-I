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

export type SpeciesPayload = z.infer<typeof speciesPayloadSchema>;
export type PondPayload = z.infer<typeof pondPayloadSchema>;
export type FishBatchPayload = z.infer<typeof fishBatchPayloadSchema>;
export type StockingPayload = z.infer<typeof stockingPayloadSchema>;
export type FishTransferPayload = z.infer<typeof fishTransferPayloadSchema>;

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
