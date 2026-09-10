"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { formatMoney } from "@/lib/domain/money";
import { db } from "@/lib/db/schema";
import { listExpenses } from "@/lib/db/repositories/expenseRepository";
import type { ExpenseCategory } from "@/lib/db/types";

const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  FRY: "Alevines",
  FUEL: "Combustible",
  ELECTRICITY: "Electricidad",
  LABOR: "Mano de obra",
  TRANSPORT: "Transporte",
  MAINTENANCE: "Mantenimiento",
  CONSTRUCTION: "Construcción",
  TOOLS: "Herramientas",
  EQUIPMENT: "Equipamiento",
  MEDICINE: "Medicina",
  SERVICES: "Servicios",
  OTHER: "Otro",
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("es", { dateStyle: "short" }).format(new Date(iso));
}

export default function ExpensesPage() {
  const data = useLiveQuery(async () => {
    const [expenses, batches, ponds] = await Promise.all([
      listExpenses(),
      db.fishBatches.toArray(),
      db.ponds.toArray(),
    ]);
    return { expenses, batches, ponds };
  }, []);

  const expenses = data?.expenses ?? [];
  const batchById = new Map((data?.batches ?? []).map((b) => [b.id, b]));
  const pondById = new Map((data?.ponds ?? []).map((p) => [p.id, p]));

  const totalAmount = expenses.reduce((sum, e) => sum + e.totalAmount, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">Gastos</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {expenses.length} gasto{expenses.length === 1 ? "" : "s"} · {formatMoney(totalAmount)} en total
          </p>
        </div>
        <Link
          href="/gastos/nuevo"
          className="shrink-0 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-800"
        >
          + Registrar gasto
        </Link>
      </div>

      <ul className="flex flex-col gap-2">
        {expenses.length === 0 && (
          <li className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            Todavía no hay gastos registrados.
          </li>
        )}
        {expenses.map((expense) => {
          const assignment = [
            expense.batchId ? batchById.get(expense.batchId)?.code : null,
            expense.pondId ? pondById.get(expense.pondId)?.code : null,
          ].filter(Boolean);
          return (
            <li
              key={expense.id}
              className="flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">{expense.description}</p>
                <span className="tabular-nums">{formatMoney(expense.totalAmount)}</span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {formatDate(expense.date)} · {EXPENSE_CATEGORY_LABEL[expense.category]}
                {assignment.length > 0 ? ` · ${assignment.join(" / ")}` : " · Gasto general"}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
