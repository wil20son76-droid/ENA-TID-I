// Cliente HTTP delgado hacia /api/sync/push y /api/sync/pull. No contiene
// lógica de reintentos ni de estado: eso vive en engine.ts. Este módulo
// solo sabe hablar el protocolo (IMPLEMENTATION_PLAN.md §6.3).
import type {
  FeedingRecordRecord,
  FeedInventoryMovementRecord,
  FeedRecord,
  FishBatchRecord,
  FishTransferRecord,
  MortalityRecordRecord,
  PondRecord,
  SamplingRecord,
  SpeciesRecord,
  StockingRecord,
  SyncQueueRecord,
  TaskRecord,
  WaterQualityRecordRecord,
} from "../db/types";

export type PushResultStatus = "applied" | "duplicate" | "conflict" | "error";

export interface PushResultItem {
  id: string;
  status: PushResultStatus;
  error?: string;
}

export interface PushResponse {
  results: PushResultItem[];
  serverTime: string;
}

export async function pushOperations(
  deviceId: string,
  operations: SyncQueueRecord[],
): Promise<PushResponse> {
  const response = await fetch("/api/sync/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deviceId,
      operations: operations.map((op) => ({
        id: op.id,
        entityType: op.entityType,
        entityId: op.entityId,
        operation: op.operation,
        deviceId: op.deviceId,
        payload: op.payload,
      })),
    }),
  });

  if (!response.ok) {
    throw new Error(`Fallo en /api/sync/push (HTTP ${response.status})`);
  }

  return (await response.json()) as PushResponse;
}

export interface PullResponse {
  species: SpeciesRecord[];
  ponds: PondRecord[];
  fishBatches: FishBatchRecord[];
  stockings: StockingRecord[];
  fishTransfers: FishTransferRecord[];
  feeds: FeedRecord[];
  feedInventoryMovements: FeedInventoryMovementRecord[];
  feedingRecords: FeedingRecordRecord[];
  mortalityRecords: MortalityRecordRecord[];
  samplings: SamplingRecord[];
  waterQualityRecords: WaterQualityRecordRecord[];
  tasks: TaskRecord[];
  serverTime: string;
}

export async function pullChanges(since: string | null): Promise<PullResponse> {
  const url = new URL("/api/sync/pull", window.location.origin);
  if (since) {
    url.searchParams.set("since", since);
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Fallo en /api/sync/pull (HTTP ${response.status})`);
  }

  return (await response.json()) as PullResponse;
}
