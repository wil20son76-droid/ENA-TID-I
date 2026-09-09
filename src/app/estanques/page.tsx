"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { getPondOccupancy } from "@/lib/domain/batchLedger";
import { db } from "@/lib/db/schema";

const STATUS_LABEL: Record<string, string> = {
  EMPTY: "Vacío",
  PREPARATION: "En preparación",
  ACTIVE: "Activo",
  HARVEST: "En cosecha",
  CLEANING: "En limpieza",
  MAINTENANCE: "En mantenimiento",
};

function formatNumber(value: number | null, unit: string): string {
  if (value === null) return "—";
  return `${value.toLocaleString("es")} ${unit}`;
}

export default function PondsPage() {
  const data = useLiveQuery(async () => {
    const [ponds, stockings, transfers, mortalities] = await Promise.all([
      db.ponds.toArray(),
      db.stockings.toArray(),
      db.fishTransfers.toArray(),
      db.mortalityRecords.toArray(),
    ]);
    return {
      ponds: ponds
        .filter((p) => !p.deletedAt)
        .sort((a, b) => a.code.localeCompare(b.code, "es")),
      stockings,
      transfers,
      mortalities,
    };
  }, []);

  const ponds = data?.ponds ?? [];
  const stockings = data?.stockings ?? [];
  const transfers = data?.transfers ?? [];
  const mortalities = data?.mortalities ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">
            Estanques
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Estanques de la piscicultura.
          </p>
        </div>
        <Link
          href="/estanques/nuevo"
          className="shrink-0 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-800"
        >
          + Nuevo estanque
        </Link>
      </div>

      <ul className="flex flex-col gap-2">
        {ponds.length === 0 && (
          <li className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            Todavía no hay estanques registrados.
          </li>
        )}
        {ponds.map((pond) => {
          const occupancy = getPondOccupancy(stockings, transfers, mortalities, pond.id);
          const batchCount = Object.keys(occupancy).length;

          return (
            <li key={pond.id}>
              <Link
                href={`/estanques/${pond.id}`}
                className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-3 transition-colors hover:border-emerald-300 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex items-center justify-between">
                  <p className="font-medium">
                    {pond.code} — {pond.name}
                  </p>
                  <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {STATUS_LABEL[pond.status] ?? pond.status}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                  <span>Superficie: {formatNumber(pond.areaM2, "m²")}</span>
                  <span>Volumen: {formatNumber(pond.estimatedVolumeM3, "m³")}</span>
                  <span>Lotes: {batchCount}</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
