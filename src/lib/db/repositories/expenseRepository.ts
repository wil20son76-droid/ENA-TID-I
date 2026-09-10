// Gastos (§17-§19 del encargo de Fase 5): append-only, nunca duplica una
// compra ya registrada vía Purchase (§1 — ver ECONOMICS.md). Una
// corrección se audita anulando (`deletedAt` + `voidReason`), nunca con
// borrado físico de un gasto ya sincronizado (§58, §72).
import { getDeviceId } from "../deviceId";
import { db } from "../schema";
import type { ExpenseFields, ExpenseRecord } from "../types";
import { createEventRecord, enqueueSyncOperation } from "./base";

const ENTITY_TYPE = "Expense" as const;

export interface CreateExpenseInput {
  date: string;
  category: ExpenseFields["category"];
  description: string;
  quantity?: number | null;
  unit?: string | null;
  unitPrice?: number | null;
  totalAmount: number;
  supplierId?: string | null;
  batchId?: string | null;
  pondId?: string | null;
  notes?: string | null;
}

export async function createExpense(input: CreateExpenseInput): Promise<ExpenseRecord> {
  if (!input.description.trim()) {
    throw new Error("La descripción del gasto es obligatoria.");
  }
  if (input.totalAmount <= 0) {
    throw new Error("El importe del gasto debe ser mayor que cero.");
  }

  const fields: ExpenseFields = {
    date: input.date,
    category: input.category,
    description: input.description,
    quantity: input.quantity ?? null,
    unit: input.unit ?? null,
    unitPrice: input.unitPrice ?? null,
    totalAmount: input.totalAmount,
    supplierId: input.supplierId ?? null,
    batchId: input.batchId ?? null,
    pondId: input.pondId ?? null,
    notes: input.notes ?? null,
    voidReason: null,
  };

  return createEventRecord<ExpenseRecord>(db.expenses, ENTITY_TYPE, fields);
}

export async function listExpenses(): Promise<ExpenseRecord[]> {
  const all = await db.expenses.toArray();
  return all.filter((e) => !e.deletedAt).sort((a, b) => b.date.localeCompare(a.date));
}

export async function listExpensesForBatch(batchId: string): Promise<ExpenseRecord[]> {
  const all = await db.expenses.where("batchId").equals(batchId).toArray();
  return all.filter((e) => !e.deletedAt).sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Anula un gasto ya sincronizado (§58: nunca borrado físico de un
 * registro económico sincronizado — solo local/pendiente puede
 * eliminarse de verdad, lo cual esta fase no expone en la UI). Queda
 * como DELETE en el outbox: el servidor aplica el mismo soft-delete.
 */
export async function voidExpense(id: string, reason: string): Promise<ExpenseRecord> {
  if (!reason.trim()) {
    throw new Error("Se requiere un motivo para anular el gasto.");
  }

  const deviceId = getDeviceId();
  let updated: ExpenseRecord | undefined;

  await db.transaction("rw", db.expenses, db.syncQueue, async () => {
    const current = await db.expenses.get(id);
    if (!current) {
      throw new Error("El gasto no existe.");
    }
    if (current.deletedAt) {
      throw new Error("El gasto ya está anulado.");
    }

    updated = {
      ...current,
      deletedAt: new Date().toISOString(),
      voidReason: reason,
      deviceId,
    };
    await db.expenses.put(updated);
    await enqueueSyncOperation(ENTITY_TYPE, id, "DELETE", updated, deviceId);
  });

  return updated as ExpenseRecord;
}
