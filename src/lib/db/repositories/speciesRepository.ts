import { db } from "../schema";
import type { SpeciesFields, SpeciesRecord } from "../types";
import { createRecord, softDeleteRecord, updateRecord } from "./base";

const ENTITY_TYPE = "Species" as const;

/** Especies activas (no eliminadas), ordenadas por nombre común. */
export async function listActiveSpecies(): Promise<SpeciesRecord[]> {
  const all = await db.species.toArray();
  return all
    .filter((s) => s.active && !s.deletedAt)
    .sort((a, b) => a.commonName.localeCompare(b.commonName, "es"));
}

export async function getSpeciesById(
  id: string,
): Promise<SpeciesRecord | undefined> {
  return db.species.get(id);
}

export async function createSpecies(
  input: Partial<SpeciesFields> & Pick<SpeciesFields, "commonName">,
): Promise<SpeciesRecord> {
  return createRecord<SpeciesRecord>(db.species, ENTITY_TYPE, {
    scientificName: null,
    description: null,
    targetWeightKg: null,
    estimatedCycleDays: null,
    minTemperatureC: null,
    maxTemperatureC: null,
    minPh: null,
    maxPh: null,
    minDissolvedOxygenMgL: null,
    expectedFcr: null,
    expectedMortalityPercent: null,
    active: true,
    ...input,
  });
}

export async function updateSpecies(
  id: string,
  patch: Partial<SpeciesFields>,
): Promise<SpeciesRecord> {
  return updateRecord<SpeciesRecord>(db.species, ENTITY_TYPE, id, patch);
}

export async function deactivateSpecies(id: string): Promise<SpeciesRecord> {
  return updateRecord<SpeciesRecord>(db.species, ENTITY_TYPE, id, {
    active: false,
  });
}

export async function deleteSpecies(id: string): Promise<void> {
  return softDeleteRecord<SpeciesRecord>(db.species, ENTITY_TYPE, id);
}
