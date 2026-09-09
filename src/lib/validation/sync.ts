// Esquemas Zod compartidos entre cliente y servidor para el protocolo de
// sincronización (IMPLEMENTATION_PLAN.md §6). El servidor NUNCA confía
// únicamente en que el cliente ya validó los datos (§59 del encargo): toda
// operación que llega a /api/sync/push se vuelve a validar aquí.
import { z } from "zod";

export const syncOperationTypeSchema = z.enum(["CREATE", "UPDATE", "DELETE"]);
export const syncEntityTypeSchema = z.enum(["Species", "Pond"]);
export const pondStatusSchema = z.enum([
  "EMPTY",
  "PREPARATION",
  "ACTIVE",
  "HARVEST",
  "CLEANING",
  "MAINTENANCE",
]);

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
  targetWeightGrams: z.number().nonnegative().nullable(),
  cultureDurationDays: z.number().int().nonnegative().nullable(),
  minTemperatureC: z.number().min(-10).max(60).nullable(),
  maxTemperatureC: z.number().min(-10).max(60).nullable(),
  minPh: z.number().min(0).max(14).nullable(),
  maxPh: z.number().min(0).max(14).nullable(),
  minDissolvedOxygen: z.number().nonnegative().nullable(),
  expectedFcr: z.number().nonnegative().nullable(),
  expectedMortalityPct: z.number().min(0).max(100).nullable(),
  notes: z.string().max(2000).nullable(),
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
  surfaceM2: z.number().nonnegative().nullable(),
  volumeM3: z.number().nonnegative().nullable(),
  location: z.string().max(200).nullable(),
  notes: z.string().max(2000).nullable(),
  status: pondStatusSchema,
  ...auditFieldsSchema,
});

export type SpeciesPayload = z.infer<typeof speciesPayloadSchema>;
export type PondPayload = z.infer<typeof pondPayloadSchema>;

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
