"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { getBatchDistribution } from "@/lib/domain/batchLedger";
import { db } from "@/lib/db/schema";

const STATUS_LABEL: Record<string, string> = {
  PLANNED: "Planeado",
  STOCKED: "Sembrado",
  GROWING: "En crecimiento",
  PRE_HARVEST: "Pre-cosecha",
  PARTIAL_HARVEST: "Cosecha parcial",
  HARVESTED: "Cosechado",
  CLOSED: "Cerrado",
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("es", { dateStyle: "short" }).format(new Date(iso));
}

export default function FishBatchesPage() {
  const data = useLiveQuery(async () => {
    const [batches, species, ponds, stockings, transfers] = await Promise.all([
      db.fishBatches.toArray(),
      db.species.toArray(),
      db.ponds.toArray(),
      db.stockings.toArray(),
      db.fishTransfers.toArray(),
    ]);
    return {
      batches: batches
        .filter((b) => !b.deletedAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      species,
      ponds,
      stockings,
      transfers,
    };
  }, []);

  const batches = data?.batches ?? [];
  const speciesById = new Map((data?.species ?? []).map((s) => [s.id, s]));
  const pondById = new Map((data?.ponds ?? []).map((p) => [p.id, p]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">Lotes</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Lotes productivos de la piscicultura.
          </p>
        </div>
        <Link
          href="/lotes/nuevo"
          className="shrink-0 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-800"
        >
          + Nuevo lote
        </Link>
      </div>

      <ul className="flex flex-col gap-2">
        {batches.length === 0 && (
          <li className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            Todavía no hay lotes registrados.
          </li>
        )}
        {batches.map((batch) => {
          const distribution = getBatchDistribution(
            data?.stockings ?? [],
            data?.transfers ?? [],
            batch.id,
          );
          const locationSummary = Object.entries(distribution)
            .map(([pondId, quantity]) => `${pondById.get(pondId)?.code ?? "?"}: ${quantity}`)
            .join(" · ");

          return (
            <li key={batch.id}>
              <Link
                href={`/lotes/${batch.id}`}
                className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-3 transition-colors hover:border-emerald-300 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex items-center justify-between">
                  <p className="font-medium">{batch.code}</p>
                  <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {STATUS_LABEL[batch.status] ?? batch.status}
                  </span>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {speciesById.get(batch.speciesId)?.commonName ?? "Especie desconocida"} · Siembra{" "}
                  {formatDate(batch.initialStockingDate)}
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                  <span>Inicial: {batch.initialQuantity.toLocaleString("es")} peces</span>
                  <span>Biomasa inicial: {batch.initialBiomassKg.toLocaleString("es")} kg</span>
                </div>
                {locationSummary && (
                  <p className="text-xs text-zinc-600 dark:text-zinc-300">
                    Ubicación: {locationSummary}
                  </p>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
