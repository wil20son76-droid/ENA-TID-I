// Compras (§8-§13 del encargo de Fase 5): "REGISTER_FEED_PURCHASE" y, en
// general, cualquier compra con líneas se registra como UNA sola
// operación de negocio atómica ("RegisterPurchase"), igual criterio que
// `createFeedingWithConsumption`/`RegisterFeeding` de la Fase 3.5 — nunca
// una Purchase sin sus líneas ni un movimiento de inventario sin su
// Purchase (§11). Cuando una línea es de alimento (`itemType: "FEED"`),
// genera además un FeedInventoryMovement PURCHASE vinculado
// (`sourceType: "PURCHASE"`, `sourceId: <purchaseLineId>` — la misma
// restricción única de `[sourceType, sourceId]` que ya protege a
// FeedingRecord contra doble descuento protege aquí contra doble alta de
// stock si se reintenta el mismo push, §12).
import { getDeviceId } from "../deviceId";
import { db } from "../schema";
import type { PurchaseFields, PurchaseLineFields, PurchaseLineRecord, PurchaseRecord } from "../types";
import { generateId } from "../uuid";
import { enqueueSyncOperation, updateRecord } from "./base";

const ENTITY_TYPE = "Purchase" as const;
const REGISTER_PURCHASE_ENTITY_TYPE = "RegisterPurchase" as const;
const PURCHASE_SOURCE_TYPE = "PURCHASE";

export interface CreatePurchaseLineInput {
  itemType: PurchaseLineFields["itemType"];
  feedId?: string | null;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}

export interface CreatePurchaseInput {
  supplierId?: string | null;
  date: string;
  referenceNumber?: string | null;
  notes?: string | null;
  lines: CreatePurchaseLineInput[];
}

export interface RegisterPurchaseResult {
  purchase: PurchaseRecord;
  lines: PurchaseLineRecord[];
}

function lineTotal(line: CreatePurchaseLineInput): number {
  return Math.round(line.quantity * line.unitPrice * 100) / 100;
}

/**
 * Registra una compra con sus líneas (y, si corresponde, el/los
 * movimiento(s) de inventario de alimento) como una única operación de
 * negocio. Válida cuando se registra: al menos una línea, cantidades y
 * precios positivos, y que toda línea de alimento (`itemType: "FEED"`)
 * traiga `feedId`.
 */
export async function registerPurchase(input: CreatePurchaseInput): Promise<RegisterPurchaseResult> {
  if (input.lines.length === 0) {
    throw new Error("Una compra debe tener al menos una línea.");
  }
  for (const line of input.lines) {
    if (line.quantity <= 0) throw new Error("La cantidad de cada línea debe ser mayor que cero.");
    if (line.unitPrice < 0) throw new Error("El precio unitario no puede ser negativo.");
    if (line.itemType === "FEED" && !line.feedId) {
      throw new Error("Una línea de alimento debe indicar a qué alimento del catálogo corresponde.");
    }
    if (line.itemType === "FEED" && line.unit !== "kg") {
      throw new Error("Una línea de alimento debe registrarse en kilogramos.");
    }
  }

  const deviceId = getDeviceId();
  const now = new Date().toISOString();
  const purchaseId = generateId();

  const lines: PurchaseLineRecord[] = input.lines.map((line) => ({
    id: generateId(),
    purchaseId,
    itemType: line.itemType,
    feedId: line.feedId ?? null,
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.unitPrice,
    totalAmount: lineTotal(line),
    deviceId,
    createdAt: now,
    deletedAt: null,
  }));

  const totalAmount = Math.round(lines.reduce((sum, l) => sum + l.totalAmount, 0) * 100) / 100;

  const purchase: PurchaseRecord = {
    id: purchaseId,
    supplierId: input.supplierId ?? null,
    date: input.date,
    referenceNumber: input.referenceNumber ?? null,
    totalAmount,
    paymentStatus: "PENDING",
    amountPaid: 0,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1,
    deviceId,
    createdBy: null,
    updatedBy: null,
  };

  const feedMovements = lines
    .filter((line) => line.itemType === "FEED" && line.feedId)
    .map((line) => ({
      id: generateId(),
      feedId: line.feedId as string,
      movementType: "PURCHASE" as const,
      quantityKg: line.quantity,
      unitCostPerKg: line.unitPrice,
      totalCost: line.totalAmount,
      date: purchase.date,
      sourceType: PURCHASE_SOURCE_TYPE,
      sourceId: line.id,
      notes: null,
      deviceId,
      createdAt: now,
      deletedAt: null,
    }));

  // Payload del comando de negocio: trae Purchase + líneas + movimientos
  // de inventario derivados, todo lo que el servidor necesita para
  // recrear las escrituras dentro de su única transacción (ver
  // applyRegisterPurchaseOperation en applyOperation.ts).
  const registerPurchasePayload = {
    id: purchase.id,
    supplierId: purchase.supplierId,
    date: purchase.date,
    referenceNumber: purchase.referenceNumber,
    totalAmount: purchase.totalAmount,
    paymentStatus: purchase.paymentStatus,
    amountPaid: purchase.amountPaid,
    notes: purchase.notes,
    createdAt: purchase.createdAt,
    updatedAt: purchase.updatedAt,
    deletedAt: purchase.deletedAt,
    version: purchase.version,
    deviceId: purchase.deviceId,
    createdBy: purchase.createdBy,
    updatedBy: purchase.updatedBy,
    lines: lines.map((line) => ({
      id: line.id,
      itemType: line.itemType,
      feedId: line.feedId,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice,
      totalAmount: line.totalAmount,
    })),
    feedMovements: feedMovements.map((m) => ({
      id: m.id,
      feedId: m.feedId,
      quantityKg: m.quantityKg,
      unitCostPerKg: m.unitCostPerKg,
      totalCost: m.totalCost,
      purchaseLineId: m.sourceId,
    })),
  };

  await db.transaction(
    "rw",
    db.purchases,
    db.purchaseLines,
    db.feedInventoryMovements,
    db.syncQueue,
    async () => {
      await db.purchases.add(purchase);
      await db.purchaseLines.bulkAdd(lines);
      if (feedMovements.length > 0) {
        await db.feedInventoryMovements.bulkAdd(feedMovements);
      }
      await enqueueSyncOperation(
        REGISTER_PURCHASE_ENTITY_TYPE,
        purchase.id,
        "CREATE",
        registerPurchasePayload,
        deviceId,
      );
    },
  );

  return { purchase, lines };
}

export async function listPurchases(): Promise<PurchaseRecord[]> {
  const all = await db.purchases.toArray();
  return all.filter((p) => !p.deletedAt).sort((a, b) => b.date.localeCompare(a.date));
}

export async function getPurchaseById(id: string): Promise<PurchaseRecord | undefined> {
  return db.purchases.get(id);
}

export async function listPurchaseLinesForPurchase(purchaseId: string): Promise<PurchaseLineRecord[]> {
  const all = await db.purchaseLines.where("purchaseId").equals(purchaseId).toArray();
  return all.filter((l) => !l.deletedAt);
}

/**
 * Marca el estado de pago de una compra ya confirmada (§32, §57): la
 * ÚNICA edición que la UI permite sobre una Purchase existente — nunca
 * fecha/proveedor/líneas, que se consideran inmutables tras confirmar.
 */
export async function updatePurchasePaymentStatus(
  id: string,
  paymentStatus: PurchaseFields["paymentStatus"],
  amountPaid: number,
): Promise<PurchaseRecord> {
  if (amountPaid < 0) {
    throw new Error("El monto pagado no puede ser negativo.");
  }
  return updateRecord<PurchaseRecord>(db.purchases, ENTITY_TYPE, id, { paymentStatus, amountPaid });
}
