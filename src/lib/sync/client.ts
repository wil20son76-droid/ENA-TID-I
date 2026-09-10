// Cliente HTTP delgado hacia /api/sync/push y /api/sync/pull. No contiene
// lógica de reintentos ni de estado: eso vive en engine.ts. Este módulo
// solo sabe hablar el protocolo (IMPLEMENTATION_PLAN.md §6.3).
//
// Fase 7: ambas rutas exigen un token de sesión (Authorization: Bearer).
// `SyncAuthError` distingue un rechazo de autenticación (401 — sesión
// ausente/expirada/revocada) de un fallo de red real o un error de
// servidor: engine.ts la usa para mostrar "inicia sesión de nuevo para
// sincronizar" en vez de tratarlo como "sin conexión" (nunca se pierde el
// dato local en ningún caso — sigue en el outbox hasta el próximo intento
// exitoso).
import { getSession } from "../auth/session";
import type {
  CustomerRecord,
  ExpenseRecord,
  FarmSettingsRecord,
  FeedingRecordRecord,
  FeedInventoryMovementRecord,
  FeedRecord,
  FishBatchRecord,
  FishTransferRecord,
  HarvestRecord,
  MortalityRecordRecord,
  PondRecord,
  PurchaseLineRecord,
  PurchaseRecord,
  SaleLineRecord,
  SaleRecord,
  SamplingRecord,
  SpeciesRecord,
  StockingRecord,
  SupplierRecord,
  SyncQueueRecord,
  TaskRecord,
  WaterQualityRecordRecord,
} from "../db/types";

export class SyncAuthError extends Error {}

function authHeader(): Record<string, string> {
  const session = getSession();
  return session ? { authorization: `Bearer ${session.token}` } : {};
}

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
    headers: { "content-type": "application/json", ...authHeader() },
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

  if (response.status === 401) {
    throw new SyncAuthError("La sesión expiró o fue revocada. Inicia sesión de nuevo para sincronizar.");
  }
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
  farmSettings: FarmSettingsRecord[];
  suppliers: SupplierRecord[];
  customers: CustomerRecord[];
  purchases: PurchaseRecord[];
  purchaseLines: PurchaseLineRecord[];
  expenses: ExpenseRecord[];
  harvests: HarvestRecord[];
  sales: SaleRecord[];
  saleLines: SaleLineRecord[];
  serverTime: string;
}

export async function pullChanges(since: string | null): Promise<PullResponse> {
  const url = new URL("/api/sync/pull", window.location.origin);
  if (since) {
    url.searchParams.set("since", since);
  }

  const response = await fetch(url.toString(), { headers: { ...authHeader() } });
  if (response.status === 401) {
    throw new SyncAuthError("La sesión expiró o fue revocada. Inicia sesión de nuevo para sincronizar.");
  }
  if (!response.ok) {
    throw new Error(`Fallo en /api/sync/pull (HTTP ${response.status})`);
  }

  return (await response.json()) as PullResponse;
}
