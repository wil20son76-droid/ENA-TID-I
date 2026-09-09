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
import type { Pond, Species } from "@/generated/prisma/client";

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
    targetWeightGrams: toNullableNumber(species.targetWeightGrams),
    cultureDurationDays: species.cultureDurationDays,
    minTemperatureC: toNullableNumber(species.minTemperatureC),
    maxTemperatureC: toNullableNumber(species.maxTemperatureC),
    minPh: toNullableNumber(species.minPh),
    maxPh: toNullableNumber(species.maxPh),
    minDissolvedOxygen: toNullableNumber(species.minDissolvedOxygen),
    expectedFcr: toNullableNumber(species.expectedFcr),
    expectedMortalityPct: toNullableNumber(species.expectedMortalityPct),
    notes: species.notes,
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
    surfaceM2: toNullableNumber(pond.surfaceM2),
    volumeM3: toNullableNumber(pond.volumeM3),
    location: pond.location,
    notes: pond.notes,
    status: pond.status,
    createdAt: pond.createdAt.toISOString(),
    updatedAt: pond.updatedAt.toISOString(),
    deletedAt: pond.deletedAt ? pond.deletedAt.toISOString() : null,
    version: pond.version,
    deviceId: pond.deviceId,
    createdBy: pond.createdBy,
    updatedBy: pond.updatedBy,
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

  const where = since ? { updatedAt: { gt: since } } : {};

  const [species, ponds] = await Promise.all([
    prisma.species.findMany({ where, orderBy: { updatedAt: "asc" } }),
    prisma.pond.findMany({ where, orderBy: { updatedAt: "asc" } }),
  ]);

  return NextResponse.json({
    species: species.map(serializeSpecies),
    ponds: ponds.map(serializePond),
    serverTime: serverTime.toISOString(),
  });
}
