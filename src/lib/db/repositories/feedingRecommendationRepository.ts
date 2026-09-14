import { db } from "../schema";
import type { FeedingRecommendationFields, FeedingRecommendationRecord } from "../types";
import { createRecord, softDeleteRecord, updateRecord } from "./base";

const ENTITY_TYPE = "FeedingRecommendation" as const;

/** Recomendaciones activas (no eliminadas), ordenadas por especie y peso mínimo. */
export async function listActiveFeedingRecommendations(): Promise<FeedingRecommendationRecord[]> {
  const all = await db.feedingRecommendations.toArray();
  return all
    .filter((r) => r.active && !r.deletedAt)
    .sort((a, b) => a.speciesId.localeCompare(b.speciesId, "es") || a.minWeightG - b.minWeightG);
}

export async function getFeedingRecommendationById(
  id: string,
): Promise<FeedingRecommendationRecord | undefined> {
  return db.feedingRecommendations.get(id);
}

export async function createFeedingRecommendation(
  input: Partial<FeedingRecommendationFields> &
    Pick<FeedingRecommendationFields, "speciesId" | "minWeightG" | "maxWeightG" | "feedPercent" | "feedingsPerDay">,
): Promise<FeedingRecommendationRecord> {
  return createRecord<FeedingRecommendationRecord>(db.feedingRecommendations, ENTITY_TYPE, {
    active: true,
    ...input,
  });
}

export async function updateFeedingRecommendation(
  id: string,
  patch: Partial<FeedingRecommendationFields>,
): Promise<FeedingRecommendationRecord> {
  return updateRecord<FeedingRecommendationRecord>(db.feedingRecommendations, ENTITY_TYPE, id, patch);
}

export async function deactivateFeedingRecommendation(
  id: string,
): Promise<FeedingRecommendationRecord> {
  return updateRecord<FeedingRecommendationRecord>(db.feedingRecommendations, ENTITY_TYPE, id, {
    active: false,
  });
}

export async function deleteFeedingRecommendation(id: string): Promise<void> {
  return softDeleteRecord<FeedingRecommendationRecord>(db.feedingRecommendations, ENTITY_TYPE, id);
}
