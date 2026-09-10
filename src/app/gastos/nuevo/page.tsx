"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";

import type { ExpenseCategory } from "@/lib/db/types";
import { db } from "@/lib/db/schema";
import { createExpense } from "@/lib/db/repositories/expenseRepository";
import { listActiveSuppliers } from "@/lib/db/repositories/supplierRepository";

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

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function NewExpenseForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedBatchId = searchParams.get("batchId") ?? "";
  const preselectedPondId = searchParams.get("pondId") ?? "";

  const batches = useLiveQuery(async () => {
    const all = await db.fishBatches.toArray();
    return all.filter((b) => !b.deletedAt).sort((a, b) => a.code.localeCompare(b.code, "es"));
  }, []) ?? [];
  const ponds = useLiveQuery(async () => {
    const all = await db.ponds.toArray();
    return all.filter((p) => !p.deletedAt).sort((a, b) => a.code.localeCompare(b.code, "es"));
  }, []) ?? [];
  const suppliers = useLiveQuery(() => listActiveSuppliers(), []) ?? [];

  const [date, setDate] = useState(todayIsoDate());
  const [category, setCategory] = useState<ExpenseCategory>("OTHER");
  const [description, setDescription] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [batchId, setBatchId] = useState(preselectedBatchId);
  const [pondId, setPondId] = useState(preselectedPondId);
  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!description.trim()) {
      setError("Escribe una descripción del gasto.");
      return;
    }
    const amount = Number(totalAmount);
    if (!amount || amount <= 0) {
      setError("El importe debe ser mayor que cero.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await createExpense({
        date: new Date(date).toISOString(),
        category,
        description: description.trim(),
        totalAmount: amount,
        batchId: batchId || null,
        pondId: pondId || null,
        supplierId: supplierId || null,
        notes: notes.trim() || null,
      });
      router.push("/gastos");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar. Intenta de nuevo.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">
        Registrar gasto
      </h2>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Descripción</span>
          <input
            type="text"
            placeholder="Ej. Combustible generador"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={submitting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Categoría</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as ExpenseCategory)}
              disabled={submitting}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
            >
              {(Object.keys(EXPENSE_CATEGORY_LABEL) as ExpenseCategory[]).map((key) => (
                <option key={key} value={key}>
                  {EXPENSE_CATEGORY_LABEL[key]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Importe</span>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={totalAmount}
              onChange={(event) => setTotalAmount(event.target.value)}
              disabled={submitting}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Fecha</span>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            disabled={submitting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Asignación (opcional): directa a un lote, a un estanque, o ninguna (gasto general de la
          finca) — §18. Nunca se reparte automáticamente un gasto general entre lotes.
        </p>

        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Lote (opcional)</span>
            <select
              value={batchId}
              onChange={(event) => setBatchId(event.target.value)}
              disabled={submitting}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="">Sin lote</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Estanque (opcional)</span>
            <select
              value={pondId}
              onChange={(event) => setPondId(event.target.value)}
              disabled={submitting}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="">Sin estanque</option>
              {ponds.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Proveedor (opcional)</span>
          <select
            value={supplierId}
            onChange={(event) => setSupplierId(event.target.value)}
            disabled={submitting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">Sin proveedor</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Observación (opcional)</span>
          <input
            type="text"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={submitting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-emerald-700 px-5 py-3 text-base font-medium text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Guardar gasto
        </button>
      </form>
    </div>
  );
}

export default function NewExpensePage() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Cargando…</p>}>
      <NewExpenseForm />
    </Suspense>
  );
}
