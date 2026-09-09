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
  Feed,
  FeedingRecord,
  FeedInventoryMovement,
  FishBatch,
  FishTransfer,
  MortalityRecord,
  Pond,
  Sampling,
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

function serializeFeed(feed: Feed) {
  return {
    id: feed.id,
    name: feed.name,
    brand: feed.brand,
    proteinPercent: toNullableNumber(feed.proteinPercent),
    pelletSizeMm: toNullableNumber(feed.pelletSizeMm),
    bagWeightKg: toNullableNumber(feed.bagWeightKg),
    defaultBagPrice: toNullableNumber(feed.defaultBagPrice),
    defaultCostPerKg: toNullableNumber(feed.defaultCostPerKg),
    recommendedStage: feed.recommendedStage,
    notes: feed.notes,
    minimumStockKg: toNullableNumber(feed.minimumStockKg),
    active: feed.active,
    createdAt: feed.createdAt.toISOString(),
    updatedAt: feed.updatedAt.toISOString(),
    deletedAt: feed.deletedAt ? feed.deletedAt.toISOString() : null,
    version: feed.version,
    deviceId: feed.deviceId,
    createdBy: feed.createdBy,
    updatedBy: feed.updatedBy,
  };
}

function serializeFeedInventoryMovement(movement: FeedInventoryMovement) {
  return {
    id: movement.id,
    feedId: movement.feedId,
    movementType: movement.movementType,
    quantityKg: toNullableNumber(movement.quantityKg) ?? 0,
    unitCostPerKg: toNullableNumber(movement.unitCostPerKg),
    totalCost: toNullableNumber(movement.totalCost),
    date: movement.date.toISOString(),
    sourceType: movement.sourceType,
    sourceId: movement.sourceId,
    notes: movement.notes,
    deviceId: movement.deviceId,
    createdAt: movement.createdAt.toISOString(),
    deletedAt: movement.deletedAt ? movement.deletedAt.toISOString() : null,
  };
}

function serializeFeedingRecord(feeding: FeedingRecord) {
  return {
    id: feeding.id,
    batchId: feeding.batchId,
    pondId: feeding.pondId,
    feedId: feeding.feedId,
    date: feeding.date.toISOString(),
    time: feeding.time,
    quantityKg: toNullableNumber(feeding.quantityKg) ?? 0,
    shift: feeding.shift,
    responsibleName: feeding.responsibleName,
    notes: feeding.notes,
    deviceId: feeding.deviceId,
    createdAt: feeding.createdAt.toISOString(),
    deletedAt: feeding.deletedAt ? feeding.deletedAt.toISOString() : null,
  };
}

function serializeMortalityRecord(mortality: MortalityRecord) {
  return {
    id: mortality.id,
    batchId: mortality.batchId,
    pondId: mortality.pondId,
    date: mortality.date.toISOString(),
    quantity: mortality.quantity,
    estimatedAverageWeightG: toNullableNumber(mortality.estimatedAverageWeightG),
    cause: mortality.cause,
    notes: mortality.notes,
    responsibleName: mortality.responsibleName,
    deviceId: mortality.deviceId,
    createdAt: mortality.createdAt.toISOString(),
    deletedAt: mortality.deletedAt ? mortality.deletedAt.toISOString() : null,
  };
}

function serializeSampling(sampling: Sampling) {
  return {
    id: sampling.id,
    batchId: sampling.batchId,
    pondId: sampling.pondId,
    date: sampling.date.toISOString(),
    sampleFishCount: sampling.sampleFishCount,
    totalSampleWeightKg: toNullableNumber(sampling.totalSampleWeightKg) ?? 0,
    averageWeightG: toNullableNumber(sampling.averageWeightG) ?? 0,
    averageLengthCm: toNullableNumber(sampling.averageLengthCm),
    notes: sampling.notes,
    responsibleName: sampling.responsibleName,
    deviceId: sampling.deviceId,
    createdAt: sampling.createdAt.toISOString(),
    deletedAt: sampling.deletedAt ? sampling.deletedAt.toISOString() : null,
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

  const [
    species,
    ponds,
    fishBatches,
    stockings,
    fishTransfers,
    feeds,
    feedInventoryMovements,
    feedingRecords,
    mortalityRecords,
    samplings,
  ] = await Promise.all([
    prisma.species.findMany({ where: byUpdatedAt, orderBy: { updatedAt: "asc" } }),
    prisma.pond.findMany({ where: byUpdatedAt, orderBy: { updatedAt: "asc" } }),
    prisma.fishBatch.findMany({ where: byUpdatedAt, orderBy: { updatedAt: "asc" } }),
    prisma.stocking.findMany({ where: byUpdatedAt, orderBy: { updatedAt: "asc" } }),
    prisma.fishTransfer.findMany({ where: byCreatedAt, orderBy: { createdAt: "asc" } }),
    prisma.feed.findMany({ where: byUpdatedAt, orderBy: { updatedAt: "asc" } }),
    // Feed*/Mortality*/Sampling son append-only (sin updatedAt), igual
    // criterio que FishTransfer: su cursor incremental es createdAt.
    prisma.feedInventoryMovement.findMany({ where: byCreatedAt, orderBy: { createdAt: "asc" } }),
    prisma.feedingRecord.findMany({ where: byCreatedAt, orderBy: { createdAt: "asc" } }),
    prisma.mortalityRecord.findMany({ where: byCreatedAt, orderBy: { createdAt: "asc" } }),
    prisma.sampling.findMany({ where: byCreatedAt, orderBy: { createdAt: "asc" } }),
  ]);

  return NextResponse.json({
    species: species.map(serializeSpecies),
    ponds: ponds.map(serializePond),
    fishBatches: fishBatches.map(serializeFishBatch),
    stockings: stockings.map(serializeStocking),
    fishTransfers: fishTransfers.map(serializeFishTransfer),
    feeds: feeds.map(serializeFeed),
    feedInventoryMovements: feedInventoryMovements.map(serializeFeedInventoryMovement),
    feedingRecords: feedingRecords.map(serializeFeedingRecord),
    mortalityRecords: mortalityRecords.map(serializeMortalityRecord),
    samplings: samplings.map(serializeSampling),
    serverTime: serverTime.toISOString(),
  });
}
