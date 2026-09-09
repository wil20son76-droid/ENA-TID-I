"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { formatCount } from "@/lib/domain/format";
import { MORTALITY_CAUSE_LABEL } from "@/lib/labels";
import { db } from "@/lib/db/schema";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIsoDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function isSameDate(isoDateTime: string, isoDate: string): boolean {
  return isoDateTime.slice(0, 10) === isoDate;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("es", { dateStyle: "short" }).format(new Date(iso));
}

export default function MortalityPage() {
  const data = useLiveQuery(async () => {
    const [mortalities, ponds] = await Promise.all([
      db.mortalityRecords.toArray(),
      db.ponds.toArray(),
    ]);
    const active = mortalities
      .filter((m) => !m.deletedAt)
      .sort((a, b) => b.date.localeCompare(a.date));
    return { mortalities: active, ponds };
  }, []);

  const mortalities = data?.mortalities ?? [];
  const pondById = new Map((data?.ponds ?? []).map((p) => [p.id, p]));

  const today = todayIsoDate();
  const weekAgo = daysAgoIsoDate(7);

  const todayTotal = mortalities
    .filter((m) => isSameDate(m.date, today))
    .reduce((sum, m) => sum + m.quantity, 0);
  const weekTotal = mortalities
    .filter((m) => m.date.slice(0, 10) >= weekAgo)
    .reduce((sum, m) => sum + m.quantity, 0);
  const accumulatedTotal = mortalities.reduce((sum, m) => sum + m.quantity, 0);

  const byPond = new Map<string, number>();
  for (const m of mortalities) {
    byPond.set(m.pondId, (byPond.get(m.pondId) ?? 0) + m.quantity);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">Mortalidad</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Registro de mortalidad por lote y estanque.
        </p>
      </div>

      <Link
        href="/mortalidad/nueva"
        className="rounded-lg bg-emerald-700 px-5 py-4 text-center text-base font-medium text-white transition-colors hover:bg-emerald-800"
      >
        + Registrar mortalidad
      </Link>

      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Hoy</span>
          <span className="text-xl font-semibold tabular-nums">{formatCount(todayTotal)}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Semana</span>
          <span className="text-xl font-semibold tabular-nums">{formatCount(weekTotal)}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Acumulada</span>
          <span className="text-xl font-semibold tabular-nums">{formatCount(accumulatedTotal)}</span>
        </div>
      </div>

      {byPond.size > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Por estanque</h3>
          <div className="flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
            {[...byPond.entries()].map(([pondId, qty]) => (
              <div key={pondId} className="flex justify-between">
                <span>{pondById.get(pondId)?.code ?? pondId}</span>
                <span className="tabular-nums">{formatCount(qty)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Historial</h3>
        {mortalities.length === 0 && (
          <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700">
            Todavía no hay mortalidad registrada.
          </p>
        )}
        <ul className="flex flex-col gap-2 text-sm">
          {mortalities.slice(0, 30).map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <span>
                {formatDate(m.date)} — {pondById.get(m.pondId)?.code ?? "?"} ·{" "}
                {MORTALITY_CAUSE_LABEL[m.cause]}
              </span>
              <span className="tabular-nums">{formatCount(m.quantity)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
