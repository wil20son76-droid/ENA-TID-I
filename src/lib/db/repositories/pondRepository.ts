import { applyPondGeometryPatch, resetToCalculated, type PondGeometryPatch } from "../../domain/pondGeometry";
import { db } from "../schema";
import type { PondFields, PondRecord } from "../types";
import { createRecord, softDeleteRecord, updateRecord } from "./base";

const ENTITY_TYPE = "Pond" as const;

const GEOMETRY_KEYS = ["lengthM", "widthM", "averageDepthM", "areaM2", "estimatedVolumeM3"] as const;

/** Extrae del patch solo las claves de geometría que la persona TOCÓ de
 * verdad (no las que simplemente no vinieron en el patch) — necesario para
 * que applyPondGeometryPatch distinga "no cambié esto" de "lo puse en
 * null". */
function extractGeometryPatch(input: Partial<PondFields>): PondGeometryPatch {
  const patch: PondGeometryPatch = {};
  for (const key of GEOMETRY_KEYS) {
    if (key in input) {
      patch[key] = input[key] ?? null;
    }
  }
  return patch;
}

/** Estanques activos (no eliminados), ordenados por código. */
export async function listActivePonds(): Promise<PondRecord[]> {
  const all = await db.ponds.toArray();
  return all
    .filter((p) => !p.deletedAt)
    .sort((a, b) => a.code.localeCompare(b.code, "es"));
}

export async function getPondById(id: string): Promise<PondRecord | undefined> {
  return db.ponds.get(id);
}

export async function createPond(
  input: Partial<PondFields> & Pick<PondFields, "code" | "name">,
): Promise<PondRecord> {
  const geometry = applyPondGeometryPatch(
    {
      lengthM: null,
      widthM: null,
      averageDepthM: null,
      areaM2: null,
      areaSource: "CALCULATED",
      estimatedVolumeM3: null,
      volumeSource: "CALCULATED",
    },
    extractGeometryPatch(input),
  );

  return createRecord<PondRecord>(db.ponds, ENTITY_TYPE, {
    type: null,
    capacityNotes: null,
    locationNotes: null,
    notes: null,
    status: "EMPTY",
    active: true,
    ...input,
    ...geometry,
  });
}

/**
 * Actualiza un estanque. Si el patch toca alguna medida (largo/ancho/
 * profundidad) o el área/volumen directamente, recalcula la geometría
 * respetando el modo calculado/manual de cada campo (ver
 * src/lib/domain/pondGeometry.ts) antes de guardar.
 */
export async function updatePond(id: string, patch: Partial<PondFields>): Promise<PondRecord> {
  const geometryPatch = extractGeometryPatch(patch);
  let geometryUpdate: PondGeometryPatch = {};

  if (Object.keys(geometryPatch).length > 0) {
    const current = await db.ponds.get(id);
    if (!current) {
      throw new Error(`No existe Pond con id ${id}`);
    }
    geometryUpdate = applyPondGeometryPatch(current, geometryPatch);
  }

  return updateRecord<PondRecord>(db.ponds, ENTITY_TYPE, id, {
    ...patch,
    ...geometryUpdate,
  });
}

/** Vuelve a poner área o volumen en modo calculado, recalculándolo ya. */
export async function resetPondGeometryField(
  id: string,
  field: "area" | "volume",
): Promise<PondRecord> {
  const current = await db.ponds.get(id);
  if (!current) {
    throw new Error(`No existe Pond con id ${id}`);
  }
  const geometry = resetToCalculated(current, field);
  return updateRecord<PondRecord>(db.ponds, ENTITY_TYPE, id, geometry);
}

export async function deletePond(id: string): Promise<void> {
  return softDeleteRecord<PondRecord>(db.ponds, ENTITY_TYPE, id);
}
