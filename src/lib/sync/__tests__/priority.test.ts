import { describe, expect, it } from "vitest";

import type { SyncEntityType, SyncQueueRecord } from "../../db/types";
import { getDependencyEntityIds, getSyncPriority, selectReadyOperations } from "../priority";

function makeItem(overrides: Partial<SyncQueueRecord> & { entityType: SyncEntityType }): SyncQueueRecord {
  return {
    id: crypto.randomUUID(),
    entityId: crypto.randomUUID(),
    operation: "CREATE",
    payload: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    retryCount: 0,
    status: "pending",
    lastError: null,
    deviceId: "device-1",
    ...overrides,
  };
}

describe("getSyncPriority", () => {
  it("nivel 1: catálogos sin dependencias locales", () => {
    expect(getSyncPriority("Species")).toBe(1);
    expect(getSyncPriority("Pond")).toBe(1);
    expect(getSyncPriority("Feed")).toBe(1);
    expect(getSyncPriority("CreateFeedWithInitialStock")).toBe(1);
  });

  it("nivel 2: FishBatch depende de Species", () => {
    expect(getSyncPriority("FishBatch")).toBe(2);
  });

  it("nivel 3: Stocking depende de FishBatch + Pond", () => {
    expect(getSyncPriority("Stocking")).toBe(3);
  });

  it("nivel 3: WaterQualityRecord/Task (Fase 4) no validan balance, no necesitan esperar a Stocking", () => {
    expect(getSyncPriority("WaterQualityRecord")).toBe(3);
    expect(getSyncPriority("Task")).toBe(3);
  });

  it("nivel 4: eventos que dependen de FishBatch/Pond/Feed/Stocking", () => {
    expect(getSyncPriority("FishTransfer")).toBe(4);
    expect(getSyncPriority("MortalityRecord")).toBe(4);
    expect(getSyncPriority("Sampling")).toBe(4);
    expect(getSyncPriority("FeedInventoryMovement")).toBe(4);
    expect(getSyncPriority("FeedingRecord")).toBe(4);
    expect(getSyncPriority("RegisterFeeding")).toBe(4);
  });

  it("Fase 5, nivel 1: Supplier/Customer/FarmSettings son catálogos sin dependencias", () => {
    expect(getSyncPriority("Supplier")).toBe(1);
    expect(getSyncPriority("Customer")).toBe(1);
    expect(getSyncPriority("FarmSettings")).toBe(1);
  });

  it("Fase 5, nivel 2: RegisterPurchase/Purchase dependen solo de catálogos de nivel 1", () => {
    expect(getSyncPriority("RegisterPurchase")).toBe(2);
    expect(getSyncPriority("Purchase")).toBe(2);
  });

  it("Fase 5, nivel 3: Expense no valida balance, no necesita esperar a Stocking", () => {
    expect(getSyncPriority("Expense")).toBe(3);
  });

  it("Fase 5, nivel 4: Harvest compite por el mismo balance que traslados/mortalidad", () => {
    expect(getSyncPriority("Harvest")).toBe(4);
  });

  it("Fase 5, nivel 5: RegisterSale/Sale dependen de que un Harvest referenciado ya se haya aplicado", () => {
    expect(getSyncPriority("RegisterSale")).toBe(5);
    expect(getSyncPriority("Sale")).toBe(5);
    expect(getSyncPriority("RegisterSale")).toBeGreaterThan(getSyncPriority("Harvest"));
  });
});

describe("getDependencyEntityIds", () => {
  it("catálogos de nivel 1 no dependen de nada", () => {
    expect(getDependencyEntityIds("Species", {})).toEqual([]);
    expect(getDependencyEntityIds("Pond", {})).toEqual([]);
    expect(getDependencyEntityIds("Feed", {})).toEqual([]);
    expect(getDependencyEntityIds("CreateFeedWithInitialStock", {})).toEqual([]);
  });

  it("FishBatch depende de speciesId", () => {
    expect(getDependencyEntityIds("FishBatch", { speciesId: "sp-1" })).toEqual(["sp-1"]);
    expect(getDependencyEntityIds("FishBatch", {})).toEqual([]);
  });

  it("Stocking depende de batchId + pondId", () => {
    expect(getDependencyEntityIds("Stocking", { batchId: "b-1", pondId: "p-1" })).toEqual([
      "b-1",
      "p-1",
    ]);
  });

  it("FishTransfer depende de batchId + fromPondId + toPondId", () => {
    expect(
      getDependencyEntityIds("FishTransfer", {
        batchId: "b-1",
        fromPondId: "p-1",
        toPondId: "p-2",
      }),
    ).toEqual(["b-1", "p-1", "p-2"]);
  });

  it("MortalityRecord y Sampling dependen de batchId + pondId", () => {
    expect(getDependencyEntityIds("MortalityRecord", { batchId: "b-1", pondId: "p-1" })).toEqual([
      "b-1",
      "p-1",
    ]);
    expect(getDependencyEntityIds("Sampling", { batchId: "b-1", pondId: "p-1" })).toEqual([
      "b-1",
      "p-1",
    ]);
  });

  it("FeedInventoryMovement depende de feedId", () => {
    expect(getDependencyEntityIds("FeedInventoryMovement", { feedId: "f-1" })).toEqual(["f-1"]);
  });

  it("FeedingRecord y RegisterFeeding dependen de batchId + pondId + feedId", () => {
    expect(
      getDependencyEntityIds("FeedingRecord", { batchId: "b-1", pondId: "p-1", feedId: "f-1" }),
    ).toEqual(["b-1", "p-1", "f-1"]);
    expect(
      getDependencyEntityIds("RegisterFeeding", { batchId: "b-1", pondId: "p-1", feedId: "f-1" }),
    ).toEqual(["b-1", "p-1", "f-1"]);
  });

  it("WaterQualityRecord depende de pondId; batchId es opcional (§32 de Fase 4)", () => {
    expect(getDependencyEntityIds("WaterQualityRecord", { pondId: "p-1" })).toEqual(["p-1"]);
    expect(
      getDependencyEntityIds("WaterQualityRecord", { pondId: "p-1", batchId: "b-1" }),
    ).toEqual(["p-1", "b-1"]);
    expect(getDependencyEntityIds("WaterQualityRecord", {})).toEqual([]);
  });

  it("Task: pondId y batchId son ambos opcionales (§23/§32 de Fase 4)", () => {
    expect(getDependencyEntityIds("Task", {})).toEqual([]);
    expect(getDependencyEntityIds("Task", { pondId: "p-1" })).toEqual(["p-1"]);
    expect(getDependencyEntityIds("Task", { pondId: "p-1", batchId: "b-1" })).toEqual([
      "p-1",
      "b-1",
    ]);
  });

  it("Fase 5: Supplier/Customer/FarmSettings no dependen de nada", () => {
    expect(getDependencyEntityIds("Supplier", {})).toEqual([]);
    expect(getDependencyEntityIds("Customer", {})).toEqual([]);
    expect(getDependencyEntityIds("FarmSettings", {})).toEqual([]);
  });

  it("Fase 5: RegisterPurchase/Purchase dependen solo del supplierId opcional", () => {
    expect(getDependencyEntityIds("RegisterPurchase", { supplierId: "s-1" })).toEqual(["s-1"]);
    expect(getDependencyEntityIds("RegisterPurchase", {})).toEqual([]);
    expect(getDependencyEntityIds("Purchase", { supplierId: "s-1" })).toEqual(["s-1"]);
  });

  it("Fase 5: Expense depende de supplierId/batchId/pondId, todos opcionales", () => {
    expect(getDependencyEntityIds("Expense", {})).toEqual([]);
    expect(
      getDependencyEntityIds("Expense", { supplierId: "s-1", batchId: "b-1", pondId: "p-1" }),
    ).toEqual(["s-1", "b-1", "p-1"]);
  });

  it("Fase 5: Harvest depende de batchId + pondId", () => {
    expect(getDependencyEntityIds("Harvest", { batchId: "b-1", pondId: "p-1" })).toEqual([
      "b-1",
      "p-1",
    ]);
  });

  it("Fase 5: RegisterSale/Sale dependen solo del customerId opcional a nivel de payload", () => {
    expect(getDependencyEntityIds("RegisterSale", { customerId: "c-1" })).toEqual(["c-1"]);
    expect(getDependencyEntityIds("RegisterSale", {})).toEqual([]);
    expect(getDependencyEntityIds("Sale", { customerId: "c-1" })).toEqual(["c-1"]);
  });

  it("payload no-objeto o campos faltantes no rompe: devuelve solo los ids presentes", () => {
    expect(getDependencyEntityIds("Stocking", null)).toEqual([]);
    expect(getDependencyEntityIds("Stocking", "no-es-un-objeto")).toEqual([]);
    expect(getDependencyEntityIds("Stocking", { batchId: "b-1" })).toEqual(["b-1"]);
  });
});

describe("selectReadyOperations", () => {
  it("ordena por nivel de prioridad, no por createdAt, cuando difieren", () => {
    const later4 = makeItem({
      entityType: "MortalityRecord",
      payload: {},
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const earlier1 = makeItem({
      entityType: "Species",
      payload: {},
      createdAt: "2026-01-02T00:00:00.000Z",
    });

    const result = selectReadyOperations([later4, earlier1], [later4, earlier1]);
    expect(result.map((r) => r.id)).toEqual([earlier1.id, later4.id]);
  });

  it("dentro del mismo nivel, ordena por createdAt", () => {
    const first = makeItem({ entityType: "Pond", createdAt: "2026-01-01T00:00:00.000Z" });
    const second = makeItem({ entityType: "Species", createdAt: "2026-01-02T00:00:00.000Z" });

    const result = selectReadyOperations([second, first], [second, first]);
    expect(result.map((r) => r.id)).toEqual([first.id, second.id]);
  });

  it("con createdAt empatado (mismo nivel), desempata por id de forma determinista", () => {
    const sameCreatedAt = "2026-01-01T00:00:00.000Z";
    const a = makeItem({ entityType: "Pond", createdAt: sameCreatedAt, id: "aaaa" });
    const b = makeItem({ entityType: "Species", createdAt: sameCreatedAt, id: "bbbb" });

    const result = selectReadyOperations([b, a], [b, a]);
    expect(result.map((r) => r.id)).toEqual(["aaaa", "bbbb"]);
  });

  it("un padre en estado 'pending' NO bloquea a su hijo", () => {
    const batchId = "batch-1";
    const parent = makeItem({ entityType: "FishBatch", entityId: batchId, status: "pending" });
    const child = makeItem({
      entityType: "Stocking",
      payload: { batchId, pondId: "pond-1" },
      status: "pending",
    });

    const result = selectReadyOperations([parent, child], [parent, child]);
    expect(result.map((r) => r.id).sort()).toEqual([child.id, parent.id].sort());
  });

  it("un padre en estado 'error' SÍ bloquea a su hijo (§14: no inundar con hijos que van a fallar)", () => {
    const batchId = "batch-1";
    const parent = makeItem({ entityType: "FishBatch", entityId: batchId, status: "error" });
    const child = makeItem({
      entityType: "Stocking",
      payload: { batchId, pondId: "pond-1" },
      status: "pending",
    });

    // El padre en error no está "listo para reintentar" todavía (backoff), pero
    // sigue en la cola completa (allQueueItems) y debe bloquear al hijo.
    const result = selectReadyOperations([child], [parent, child]);
    expect(result).toEqual([]);
  });

  it("una operación sin ninguna dependencia en error se mantiene", () => {
    const child = makeItem({
      entityType: "Stocking",
      payload: { batchId: "batch-ok", pondId: "pond-ok" },
    });
    const uncorrelatedError = makeItem({
      entityType: "FishBatch",
      entityId: "otro-batch",
      status: "error",
    });

    const result = selectReadyOperations([child], [child, uncorrelatedError]);
    expect(result.map((r) => r.id)).toEqual([child.id]);
  });
});
