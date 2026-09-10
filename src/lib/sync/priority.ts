// Orden y dependencias de sincronización (Fase 3.5, §10-§14 del
// encargo). Antes de esta fase, el outbox se enviaba ordenado solo por
// `createdAt`, confiando en que la UI nunca deja crear una entidad
// dependiente antes de que su referencia exista localmente — cierto,
// pero no un orden EXPLÍCITO: dos operaciones con el mismo timestamp
// (posible en una creación compuesta) podían enviarse en el orden
// equivocado, y el primer sync de un dispositivo que trabajó offline
// mucho tiempo dependía de esa coincidencia de timestamps para no
// generar errores de llave foránea evitables.
//
// Esto NO sustituye idempotencia/retries/backoff (§13): siguen siendo
// necesarios para fallos de red genuinos y para el caso raro de empate
// de timestamp dentro de un mismo nivel. El orden solo reduce cuántas
// veces hace falta ese reintento en el camino feliz.
import type { SyncEntityType, SyncQueueRecord } from "../db/types";

/**
 * Nivel de prioridad de cada tipo de entidad: cuanto más bajo, antes se
 * envía. Dentro del mismo nivel no hay dependencias entre sí, así que el
 * orden se decide por `createdAt` (y, en un empate exacto, por
 * `operationId`/`id` para que el orden sea 100% determinista — nunca
 * depender de que dos timestamps generados por separado coincidan o no).
 *
 * Basado en las relaciones reales de `prisma/schema.prisma`, no en el
 * ejemplo del encargo tal cual: `Feed` no depende de nada, así que
 * `CreateFeedWithInitialStock` (que solo crea un `Feed` + su movimiento
 * de stock inicial) puede ir en el mismo nivel 1 — no depende de
 * `FishBatch`/`Pond` como sí depende `RegisterFeeding`.
 */
const SYNC_PRIORITY: Record<SyncEntityType, number> = {
  // Nivel 1: catálogos sin dependencias locales.
  Species: 1,
  Pond: 1,
  Feed: 1,
  CreateFeedWithInitialStock: 1,
  // Fase 5 (§56 del encargo): Supplier/Customer/FarmSettings son
  // catálogos base sin dependencias, igual criterio que Species/Pond/Feed.
  Supplier: 1,
  Customer: 1,
  FarmSettings: 1,
  // Nivel 2: depende de un catálogo de nivel 1.
  FishBatch: 2,
  // RegisterPurchase depende solo de Supplier (opcional) y Feed
  // (opcional, si alguna línea es de alimento) — ambos nivel 1, así que
  // nivel 2 basta; no necesita esperar a Stocking porque no valida
  // ningún balance de peces. La actualización de estado de pago
  // (entityType "Purchase") comparte nivel: como es SIEMPRE una
  // operación posterior a la creación por RegisterPurchase, el
  // desempate por `createdAt` dentro del mismo nivel ya garantiza que
  // la creación se envíe primero.
  RegisterPurchase: 2,
  Purchase: 2,
  // Nivel 3: depende de FishBatch (nivel 2) + Pond (nivel 1). También
  // WaterQualityRecord/Task (Fase 4, §32 del encargo): dependen de Pond
  // (Task solo opcionalmente) y opcionalmente de FishBatch, pero —a
  // diferencia del nivel 4— ninguna de las dos valida balance de peces
  // ni de alimento, así que no necesitan esperar a que Stocking se haya
  // aplicado: solo que exista el Pond/FishBatch que referencian. Expense
  // (Fase 5, §56) es igual: nunca valida balance, solo necesita que
  // Supplier/FishBatch/Pond (si están asignados) ya existan.
  Stocking: 3,
  WaterQualityRecord: 3,
  Task: 3,
  Expense: 3,
  // Nivel 4: eventos que dependen de FishBatch/Pond/Feed ya existentes,
  // y cuya validación de negocio (balance/stock) además necesita que
  // Stocking ya se haya aplicado para no fallar como "conflict" por un
  // balance que en realidad sí existe, solo que el servidor no lo vio
  // todavía. Harvest (Fase 5, §56) comparte el mismo criterio que
  // FishTransfer/MortalityRecord: compite por el mismo balance de peces.
  FishTransfer: 4,
  MortalityRecord: 4,
  Sampling: 4,
  FeedInventoryMovement: 4,
  FeedingRecord: 4,
  RegisterFeeding: 4,
  Harvest: 4,
  // Nivel 5: RegisterSale depende de FishBatch (nivel 2), Customer
  // (nivel 1) y, si la línea referencia una cosecha, de que ESA Harvest
  // ya se haya aplicado (nivel 4) — su propia validación de balance
  // (§30-§31) necesita ver el Harvest real, no solo que exista. La
  // actualización de estado de pago ("Sale") comparte nivel por el mismo
  // motivo que "Purchase" arriba.
  RegisterSale: 5,
  Sale: 5,
};

/** Prioridad de sincronización de un tipo de entidad — más bajo = antes. */
export function getSyncPriority(entityType: SyncEntityType): number {
  return SYNC_PRIORITY[entityType];
}

function readField(payload: unknown, field: string): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const value = (payload as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

/**
 * Ids de las entidades de las que depende una operación, extraídos de su
 * payload (§11 del encargo: "la dependencia padre/hijo debe determinarse
 * explícitamente"). Catálogos de nivel 1 no dependen de nada local.
 */
export function getDependencyEntityIds(entityType: SyncEntityType, payload: unknown): string[] {
  switch (entityType) {
    case "Species":
    case "Pond":
    case "Feed":
    case "CreateFeedWithInitialStock":
      return [];
    case "FishBatch": {
      const speciesId = readField(payload, "speciesId");
      return speciesId ? [speciesId] : [];
    }
    case "Stocking": {
      const batchId = readField(payload, "batchId");
      const pondId = readField(payload, "pondId");
      return [batchId, pondId].filter((id): id is string => !!id);
    }
    case "FishTransfer": {
      const batchId = readField(payload, "batchId");
      const fromPondId = readField(payload, "fromPondId");
      const toPondId = readField(payload, "toPondId");
      return [batchId, fromPondId, toPondId].filter((id): id is string => !!id);
    }
    case "MortalityRecord":
    case "Sampling": {
      const batchId = readField(payload, "batchId");
      const pondId = readField(payload, "pondId");
      return [batchId, pondId].filter((id): id is string => !!id);
    }
    case "FeedInventoryMovement": {
      const feedId = readField(payload, "feedId");
      return feedId ? [feedId] : [];
    }
    case "FeedingRecord":
    case "RegisterFeeding": {
      const batchId = readField(payload, "batchId");
      const pondId = readField(payload, "pondId");
      const feedId = readField(payload, "feedId");
      return [batchId, pondId, feedId].filter((id): id is string => !!id);
    }
    case "WaterQualityRecord": {
      // pondId siempre presente; batchId es opcional (§2/§32 del encargo
      // de Fase 4 — una medición puede no estar ligada a ningún lote).
      const pondId = readField(payload, "pondId");
      const batchId = readField(payload, "batchId");
      return [pondId, batchId].filter((id): id is string => !!id);
    }
    case "Task": {
      // Ambos opcionales (§23/§32): una tarea puede no estar ligada a
      // ningún estanque ni lote.
      const pondId = readField(payload, "pondId");
      const batchId = readField(payload, "batchId");
      return [pondId, batchId].filter((id): id is string => !!id);
    }
    // Fase 5 (§56 del encargo de Fase 5).
    case "Supplier":
    case "Customer":
    case "FarmSettings":
      return [];
    case "RegisterPurchase":
    case "Purchase": {
      const supplierId = readField(payload, "supplierId");
      return supplierId ? [supplierId] : [];
    }
    case "Expense": {
      const supplierId = readField(payload, "supplierId");
      const batchId = readField(payload, "batchId");
      const pondId = readField(payload, "pondId");
      return [supplierId, batchId, pondId].filter((id): id is string => !!id);
    }
    case "Harvest": {
      const batchId = readField(payload, "batchId");
      const pondId = readField(payload, "pondId");
      return [batchId, pondId].filter((id): id is string => !!id);
    }
    case "RegisterSale":
    case "Sale": {
      // `customerId` es la única dependencia extraíble de forma genérica
      // en el nivel superior del payload; las dependencias por línea
      // (batchId/harvestId de cada SaleLine) no se resuelven aquí porque
      // `getDependencyEntityIds` solo se usa para excluir una operación
      // cuya dependencia esté en "error" (§14) — el batchId/harvestId de
      // las líneas ya se validan de verdad dentro de la transacción del
      // servidor (applyRegisterSaleOperation), que es donde importa que
      // sean correctos, no solo que "no estén en error" en la cola local.
      const customerId = readField(payload, "customerId");
      return customerId ? [customerId] : [];
    }
  }
}

/**
 * Ordena de forma determinista (prioridad, luego `createdAt`, luego
 * `id` de la operación como desempate final — nunca depender solo de
 * que dos timestamps coincidan o no, §12) y excluye las operaciones
 * cuya dependencia todavía tiene una operación en estado `"error"` en
 * la cola (§14: no inundar el servidor con hijos que sabemos que van a
 * fallar porque su padre sigue fallando). Una dependencia meramente
 * `"pending"` NO se excluye: gracias al orden, el padre va antes en el
 * mismo lote y `push/route.ts` los procesa uno a uno, así que para
 * cuando le toca al hijo el padre ya se aplicó dentro de esa misma
 * solicitud.
 *
 * No es un scheduler: es una función pura de un solo paso sobre una
 * lista ya cargada en memoria — no reintenta, no espera, no mantiene
 * estado entre llamadas. Los reintentos siguen viniendo de que algo
 * vuelve a llamar a `runSync` más tarde (§13).
 */
export function selectReadyOperations(
  eligible: readonly SyncQueueRecord[],
  allQueueItems: readonly SyncQueueRecord[],
): SyncQueueRecord[] {
  const erroredEntityIds = new Set(
    allQueueItems.filter((item) => item.status === "error").map((item) => item.entityId),
  );

  const sorted = [...eligible].sort((a, b) => {
    const priorityDiff = getSyncPriority(a.entityType) - getSyncPriority(b.entityType);
    if (priorityDiff !== 0) return priorityDiff;
    const createdAtDiff = a.createdAt.localeCompare(b.createdAt);
    if (createdAtDiff !== 0) return createdAtDiff;
    return a.id.localeCompare(b.id);
  });

  return sorted.filter((op) => {
    const dependencyIds = getDependencyEntityIds(op.entityType, op.payload);
    return !dependencyIds.some((depId) => erroredEntityIds.has(depId));
  });
}
