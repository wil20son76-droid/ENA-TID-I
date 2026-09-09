// Aplica una operación de sincronización validada contra PostgreSQL.
//
// Estrategia de conflictos (IMPLEMENTATION_PLAN.md §6.4): last-write-wins
// por número de versión. Si la versión que trae el cliente no es más
// nueva que la que ya existe en el servidor, la escritura se descarta sin
// sobrescribir nada (nunca se pierde silenciosamente un cambio: queda
// registrado como "conflict" en SyncOperation, visible para diagnóstico).
import type { Prisma } from "@/generated/prisma/client";
import type { PondPayload, PushOperation, SpeciesPayload } from "@/lib/validation/sync";

export type ApplyResult = "applied" | "conflict";

type TransactionClient = Prisma.TransactionClient;

function speciesData(payload: SpeciesPayload) {
  return {
    id: payload.id,
    commonName: payload.commonName,
    scientificName: payload.scientificName,
    description: payload.description,
    targetWeightGrams: payload.targetWeightGrams,
    cultureDurationDays: payload.cultureDurationDays,
    minTemperatureC: payload.minTemperatureC,
    maxTemperatureC: payload.maxTemperatureC,
    minPh: payload.minPh,
    maxPh: payload.maxPh,
    minDissolvedOxygen: payload.minDissolvedOxygen,
    expectedFcr: payload.expectedFcr,
    expectedMortalityPct: payload.expectedMortalityPct,
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

function pondData(payload: PondPayload) {
  return {
    id: payload.id,
    code: payload.code,
    name: payload.name,
    type: payload.type,
    lengthM: payload.lengthM,
    widthM: payload.widthM,
    averageDepthM: payload.averageDepthM,
    surfaceM2: payload.surfaceM2,
    volumeM3: payload.volumeM3,
    location: payload.location,
    notes: payload.notes,
    status: payload.status,
    createdAt: new Date(payload.createdAt),
    updatedAt: new Date(payload.updatedAt),
    deletedAt: payload.deletedAt ? new Date(payload.deletedAt) : null,
    version: payload.version,
    deviceId: payload.deviceId,
    createdBy: payload.createdBy,
    updatedBy: payload.updatedBy,
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

export async function applyOperation(
  tx: TransactionClient,
  op: PushOperation,
): Promise<ApplyResult> {
  switch (op.entityType) {
    case "Species":
      return applySpeciesOperation(tx, op);
    case "Pond":
      return applyPondOperation(tx, op);
  }
}
