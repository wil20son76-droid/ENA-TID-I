// GET /api/sync/pull?since=<ISO8601> — entrega los cambios posteriores al
// cursor que envía el dispositivo (IMPLEMENTATION_PLAN.md §6.3/§6.6).
//
// Es deliberadamente incremental: nunca se descarga la base de datos
// completa en cada sincronización. Si "since" no se envía (primera
// sincronización del dispositivo), se entrega el estado completo una vez;
// a partir de ahí el cliente siempre manda su último cursor guardado.
//
// El cursor que el cliente debe guardar es el "serverTime" de la propia
// respuesta (no un reloj local), para no depender de que los relojes de
// cliente y servidor estén perfectamente sincronizados.
import { NextResponse } from "next/server";

import { prisma } from "@/lib/server/prisma";
import { pullQuerySchema } from "@/lib/validation/sync";
import type {
  FishBatch,
  FishTransfer,
  Pond,
  Species,
  Stocking,
} from "@/generated/prisma/client";

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return Number(value);
}

function serializeSpecies(species: Species) {
  return {
    id: species.id,
    commonName: species.commonName,
    scientificName: species.scientificName,
    description: species.description,
    targetWeightKg: toNullableNumber(species.targetWeightKg),
    estimatedCycleDays: species.estimatedCycleDays,
    minTemperatureC: toNullableNumber(species.minTemperatureC),
    maxTemperatureC: toNullableNumber(species.maxTemperatureC),
    minPh: toNullableNumber(species.minPh),
    maxPh: toNullableNumber(species.maxPh),
    minDissolvedOxygenMgL: toNullableNumber(species.minDissolvedOxygenMgL),
    expectedFcr: toNullableNumber(species.expectedFcr),
    expectedMortalityPercent: toNullableNumber(species.expectedMortalityPercent),
    active: species.active,
    createdAt: species.createdAt.toISOString(),
    updatedAt: species.updatedAt.toISOString(),
    deletedAt: species.deletedAt ? species.deletedAt.toISOString() : null,
    version: species.version,
    deviceId: species.deviceId,
    createdBy: species.createdBy,
    updatedBy: species.updatedBy,
  };
}

function serializePond(pond: Pond) {
  return {
    id: pond.id,
    code: pond.code,
    name: pond.name,
    type: pond.type,
    lengthM: toNullableNumber(pond.lengthM),
    widthM: toNullableNumber(pond.widthM),
    averageDepthM: toNullableNumber(pond.averageDepthM),
    areaM2: toNullableNumber(pond.areaM2),
    areaSource: pond.areaSource,
    estimatedVolumeM3: toNullableNumber(pond.estimatedVolumeM3),
    volumeSource: pond.volumeSource,
    capacityNotes: pond.capacityNotes,
    locationNotes: pond.locationNotes,
    notes: pond.notes,
    status: pond.status,
    active: pond.active,
    createdAt: pond.createdAt.toISOString(),
    updatedAt: pond.updatedAt.toISOString(),
    deletedAt: pond.deletedAt ? pond.deletedAt.toISOString() : null,
    version: pond.version,
    deviceId: pond.deviceId,
    createdBy: pond.createdBy,
    updatedBy: pond.updatedBy,
  };
}

function serializeFishBatch(batch: FishBatch) {
  return {
    id: batch.id,
    code: batch.code,
    speciesId: batch.speciesId,
    supplierId: batch.supplierId,
    purchaseDate: batch.purchaseDate ? batch.purchaseDate.toISOString() : null,
    initialStockingDate: batch.initialStockingDate.toISOString(),
    initialQuantity: batch.initialQuantity,
    initialAverageWeightG: toNullableNumber(batch.initialAverageWeightG) ?? 0,
    initialBiomassKg: toNullableNumber(batch.initialBiomassKg) ?? 0,
    fryCost: toNullableNumber(batch.fryCost),
    targetWeightKg: toNullableNumber(batch.targetWeightKg),
    expectedHarvestDate: batch.expectedHarvestDate ? batch.expectedHarvestDate.toISOString() : null,
    status: batch.status,
    notes: batch.notes,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
    deletedAt: batch.deletedAt ? batch.deletedAt.toISOString() : null,
    version: batch.version,
    deviceId: batch.deviceId,
    createdBy: batch.createdBy,
    updatedBy: batch.updatedBy,
  };
}

function serializeStocking(stocking: Stocking) {
  return {
    id: stocking.id,
    batchId: stocking.batchId,
    pondId: stocking.pondId,
    date: stocking.date.toISOString(),
    quantity: stocking.quantity,
    averageWeightG: toNullableNumber(stocking.averageWeightG) ?? 0,
    biomassKg: toNullableNumber(stocking.biomassKg) ?? 0,
    responsibleName: stocking.responsibleName,
    notes: stocking.notes,
    deviceId: stocking.deviceId,
    createdAt: stocking.createdAt.toISOString(),
    updatedAt: stocking.updatedAt.toISOString(),
    deletedAt: stocking.deletedAt ? stocking.deletedAt.toISOString() : null,
  };
}

function serializeFishTransfer(transfer: FishTransfer) {
  return {
    id: transfer.id,
    batchId: transfer.batchId,
    fromPondId: transfer.fromPondId,
    toPondId: transfer.toPondId,
    date: transfer.date.toISOString(),
    quantity: transfer.quantity,
    averageWeightG: toNullableNumber(transfer.averageWeightG),
    biomassKg: toNullableNumber(transfer.biomassKg),
    reason: transfer.reason,
    responsibleName: transfer.responsibleName,
    notes: transfer.notes,
    deviceId: transfer.deviceId,
    createdAt: transfer.createdAt.toISOString(),
    deletedAt: transfer.deletedAt ? transfer.deletedAt.toISOString() : null,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = pullQuerySchema.safeParse({
    since: url.searchParams.get("since"),
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Parámetro 'since' inválido", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // El servidor calcula su marca de tiempo ANTES de leer los datos: así,
  // si llegan escrituras nuevas mientras se ejecuta esta consulta, el
  // cliente las volverá a pedir en la próxima sincronización en vez de
  // darlas por incluidas por error.
  const serverTime = new Date();
  const since = parsed.data.since ? new Date(parsed.data.since) : null;

  const byUpdatedAt = since ? { updatedAt: { gt: since } } : {};
  // FishTransfer no tiene updatedAt (es un evento append-only que nunca se
  // edita desde la UI de esta fase, ver prisma/schema.prisma): su cursor
  // incremental es createdAt.
  const byCreatedAt = since ? { createdAt: { gt: since } } : {};

  const [species, ponds, fishBatches, stockings, fishTransfers] = await Promise.all([
    prisma.species.findMany({ where: byUpdatedAt, orderBy: { updatedAt: "asc" } }),
    prisma.pond.findMany({ where: byUpdatedAt, orderBy: { updatedAt: "asc" } }),
    prisma.fishBatch.findMany({ where: byUpdatedAt, orderBy: { updatedAt: "asc" } }),
    prisma.stocking.findMany({ where: byUpdatedAt, orderBy: { updatedAt: "asc" } }),
    prisma.fishTransfer.findMany({ where: byCreatedAt, orderBy: { createdAt: "asc" } }),
  ]);

  return NextResponse.json({
    species: species.map(serializeSpecies),
    ponds: ponds.map(serializePond),
    fishBatches: fishBatches.map(serializeFishBatch),
    stockings: stockings.map(serializeStocking),
    fishTransfers: fishTransfers.map(serializeFishTransfer),
    serverTime: serverTime.toISOString(),
  });
}
