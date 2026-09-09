"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { formatKg } from "@/lib/domain/format";
import { db } from "@/lib/db/schema";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isSameDate(isoDateTime: string, isoDate: string): boolean {
  return isoDateTime.slice(0, 10) === isoDate;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("es", { dateStyle: "short" }).format(new Date(iso));
}

export default function FeedingPage() {
  const data = useLiveQuery(async () => {
    const [feedings, ponds, feeds] = await Promise.all([
      db.feedingRecords.toArray(),
      db.ponds.toArray(),
      db.feeds.toArray(),
    ]);
    const active = feedings.filter((f) => !f.deletedAt).sort((a, b) => b.date.localeCompare(a.date));
    return { feedings: active, ponds, feeds };
  }, []);

  const feedings = data?.feedings ?? [];
  const pondById = new Map((data?.ponds ?? []).map((p) => [p.id, p]));
  const feedById = new Map((data?.feeds ?? []).map((f) => [f.id, f]));

  const today = todayIsoDate();
  const todayFeedings = feedings.filter((f) => isSameDate(f.date, today));
  const totalToday = todayFeedings.reduce((sum, f) => sum + f.quantityKg, 0);

  const byPondToday = new Map<string, number>();
  const byFeedToday = new Map<string, number>();
  for (const f of todayFeedings) {
    byPondToday.set(f.pondId, (byPondToday.get(f.pondId) ?? 0) + f.quantityKg);
    byFeedToday.set(f.feedId, (byFeedToday.get(f.feedId) ?? 0) + f.quantityKg);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">
            Alimentación
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Registro diario de alimentación e inventario de alimento.
          </p>
        </div>
        <Link
          href="/alimentos"
          className="shrink-0 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
        >
          Alimentos
        </Link>
      </div>

      <Link
        href="/alimentacion/nueva"
        className="rounded-lg bg-emerald-700 px-5 py-4 text-center text-base font-medium text-white transition-colors hover:bg-emerald-800"
      >
        + Registrar alimentación
      </Link>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Hoy</h3>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{formatKg(totalToday)}</p>

        {byPondToday.size > 0 && (
          <div className="mt-3 flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Por estanque
            </span>
            {[...byPondToday.entries()].map(([pondId, qty]) => (
              <div key={pondId} className="flex justify-between">
                <span>{pondById.get(pondId)?.code ?? pondId}</span>
                <span className="tabular-nums">{formatKg(qty)}</span>
              </div>
            ))}
          </div>
        )}

        {byFeedToday.size > 0 && (
          <div className="mt-3 flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Por alimento
            </span>
            {[...byFeedToday.entries()].map(([feedId, qty]) => (
              <div key={feedId} className="flex justify-between">
                <span>{feedById.get(feedId)?.name ?? feedId}</span>
                <span className="tabular-nums">{formatKg(qty)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Historial reciente
        </h3>
        {feedings.length === 0 && (
          <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700">
            Todavía no hay alimentación registrada.
          </p>
        )}
        <ul className="flex flex-col gap-2 text-sm">
          {feedings.slice(0, 30).map((f) => (
            <li
              key={f.id}
              className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <span>
                {formatDate(f.date)} — {pondById.get(f.pondId)?.code ?? "?"} ·{" "}
                {feedById.get(f.feedId)?.name ?? "?"}
              </span>
              <span className="tabular-nums">{formatKg(f.quantityKg)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
