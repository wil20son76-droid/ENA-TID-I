import { beforeEach, describe, expect, it } from "vitest";

import { createExpense, listExpenses, voidExpense } from "../repositories/expenseRepository";
import { db } from "../schema";

describe("expenseRepository", () => {
  beforeEach(async () => {
    await db.expenses.clear();
    await db.syncQueue.clear();
  });

  it("crea un gasto general (sin lote ni estanque)", async () => {
    const expense = await createExpense({
      date: "2026-09-10T00:00:00.000Z",
      category: "ELECTRICITY",
      description: "Factura de luz",
      totalAmount: 250,
    });

    expect(expense.batchId).toBeNull();
    expect(expense.pondId).toBeNull();
    expect(expense.totalAmount).toBe(250);
  });

  it("§18: un gasto puede asignarse directamente a un lote", async () => {
    const expense = await createExpense({
      date: "2026-09-10T00:00:00.000Z",
      category: "FUEL",
      description: "Combustible generador",
      totalAmount: 100,
      batchId: "batch-1",
    });
    expect(expense.batchId).toBe("batch-1");

    const list = await listExpenses();
    expect(list).toHaveLength(1);
  });

  it("rechaza un importe cero o negativo", async () => {
    await expect(
      createExpense({
        date: "2026-09-10T00:00:00.000Z",
        category: "OTHER",
        description: "Gasto inválido",
        totalAmount: 0,
      }),
    ).rejects.toThrow(/mayor que cero/);
  });

  it("§58/§72: anular un gasto lo marca borrado con motivo, nunca lo borra físicamente", async () => {
    const expense = await createExpense({
      date: "2026-09-10T00:00:00.000Z",
      category: "OTHER",
      description: "Gasto a anular",
      totalAmount: 50,
    });

    const voided = await voidExpense(expense.id, "Registrado por error");
    expect(voided.deletedAt).not.toBeNull();
    expect(voided.voidReason).toBe("Registrado por error");

    // Sigue existiendo en Dexie (soft-delete), solo desaparece de listExpenses().
    expect(await db.expenses.get(expense.id)).toBeDefined();
    expect(await listExpenses()).toHaveLength(0);
  });

  it("requiere un motivo para anular", async () => {
    const expense = await createExpense({
      date: "2026-09-10T00:00:00.000Z",
      category: "OTHER",
      description: "Gasto",
      totalAmount: 50,
    });
    await expect(voidExpense(expense.id, "")).rejects.toThrow(/motivo/);
  });
});
