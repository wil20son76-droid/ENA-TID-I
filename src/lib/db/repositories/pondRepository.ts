import { db } from "../schema";
import type { PondFields, PondRecord } from "../types";
import { createRecord, softDeleteRecord, updateRecord } from "./base";

const ENTITY_TYPE = "Pond" as const;

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
  return createRecord<PondRecord>(db.ponds, ENTITY_TYPE, {
    type: null,
    lengthM: null,
    widthM: null,
    averageDepthM: null,
    surfaceM2: null,
    volumeM3: null,
    location: null,
    notes: null,
    status: "EMPTY",
    ...input,
  });
}

export async function updatePond(
  id: string,
  patch: Partial<PondFields>,
): Promise<PondRecord> {
  return updateRecord<PondRecord>(db.ponds, ENTITY_TYPE, id, patch);
}

export async function deletePond(id: string): Promise<void> {
  return softDeleteRecord<PondRecord>(db.ponds, ENTITY_TYPE, id);
}
