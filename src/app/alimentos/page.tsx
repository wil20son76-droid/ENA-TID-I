"use client";

import { useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { formatKg } from "@/lib/domain/format";
import { getAllFeedStocks } from "@/lib/domain/feedLedger";
import { createFeed, deactivateFeed } from "@/lib/db/repositories/feedRepository";
import { db } from "@/lib/db/schema";

export default function FeedsPage() {
  const data = useLiveQuery(async () => {
    const [feeds, movements] = await Promise.all([
      db.feeds.toArray(),
      db.feedInventoryMovements.toArray(),
    ]);
    return {
      feeds: feeds
        .filter((f) => f.active && !f.deletedAt)
        .sort((a, b) => a.name.localeCompare(b.name, "es")),
      stocks: getAllFeedStocks(movements),
    };
  }, []);

  const feeds = data?.feeds ?? [];
  const stocks = data?.stocks ?? {};

  const [name, setName] = useState("");
  const [initialStockKg, setInitialStockKg] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Escribe el nombre del alimento.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await createFeed({
        name: trimmed,
        initialStockKg: initialStockKg ? Number(initialStockKg) : null,
      });
      setName("");
      setInitialStockKg("");
    } catch {
      setError("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/alimentacion" className="text-sm text-emerald-700 dark:text-emerald-400">
          ← Alimentación
        </Link>
        <h2 className="mt-1 text-base font-semibold text-zinc-700 dark:text-zinc-300">
          Alimentos
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Catálogo de alimentos balanceados (§3 de Fase 3).
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <label htmlFor="feedName" className="text-sm font-medium">
          Nuevo alimento
        </label>
        <div className="flex gap-2">
          <input
            id="feedName"
            type="text"
            placeholder="Ej. Balanceado Crecimiento 32%"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={submitting}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Stock inicial (kg, opcional)</span>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            placeholder="500"
            value={initialStockKg}
            onChange={(event) => setInitialStockKg(event.target.value)}
            disabled={submitting}
            className="w-40 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <button
          type="submit"
          disabled={submitting}
          className="self-start rounded-lg bg-emerald-700 px-5 py-3 text-base font-medium text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Agregar
        </button>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </form>

      <ul className="flex flex-col gap-2">
        {feeds.length === 0 && (
          <li className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            Todavía no hay alimentos registrados.
          </li>
        )}
        {feeds.map((f) => {
          const stock = stocks[f.id] ?? 0;
          const lowStock = f.minimumStockKg != null && stock <= f.minimumStockKg;
          return (
            <li
              key={f.id}
              className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div>
                <p className="font-medium">{f.name}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Stock: {formatKg(stock)}
                  {lowStock && (
                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      Stock bajo
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void deactivateFeed(f.id)}
                className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-zinc-300 px-3 text-xs font-medium text-zinc-600 transition-colors hover:border-red-400 hover:text-red-600 dark:border-zinc-700 dark:text-zinc-300"
              >
                Desactivar
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
