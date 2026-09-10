"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { formatCount, formatKg } from "@/lib/domain/format";
import { db } from "@/lib/db/schema";
import { listHarvests } from "@/lib/db/repositories/harvestRepository";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("es", { dateStyle: "short" }).format(new Date(iso));
}

const HARVEST_TYPE_LABEL: Record<string, string> = {
  PARTIAL: "Parcial",
  TOTAL: "Total",
};

export default function HarvestsPage() {
  const data = useLiveQuery(async () => {
    const [harvests, batches, ponds] = await Promise.all([
      listHarvests(),
      db.fishBatches.toArray(),
      db.ponds.toArray(),
    ]);
    return { harvests, batches, ponds };
  }, []);

  const harvests = data?.harvests ?? [];
  const batchById = new Map((data?.batches ?? []).map((b) => [b.id, b]));
  const pondById = new Map((data?.ponds ?? []).map((p) => [p.id, p]));

  const totalKgHarvested = harvests.reduce((sum, h) => sum + h.totalWeightKg, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">Cosechas</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {harvests.length} cosecha{harvests.length === 1 ? "" : "s"} · {formatKg(totalKgHarvested)} en total
          </p>
        </div>
        <Link
          href="/cosechas/nueva"
          className="shrink-0 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-800"
        >
          + Registrar cosecha
        </Link>
      </div>

      <ul className="flex flex-col gap-2">
        {harvests.length === 0 && (
          <li className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            Todavía no hay cosechas registradas.
          </li>
        )}
        {harvests.map((harvest) => (
          <li
            key={harvest.id}
            className="flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-center justify-between">
              <p className="font-medium">
                {batchById.get(harvest.batchId)?.code ?? "Lote desconocido"} —{" "}
                {pondById.get(harvest.pondId)?.code ?? "?"}
              </p>
              <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {HARVEST_TYPE_LABEL[harvest.harvestType] ?? harvest.harvestType}
              </span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{formatDate(harvest.date)}</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <span>{formatCount(harvest.quantityFish)} peces</span>
              <span>{formatKg(harvest.totalWeightKg)}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
