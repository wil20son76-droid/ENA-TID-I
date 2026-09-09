"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { getBatchTotalBalance } from "@/lib/domain/batchLedger";
import { db } from "@/lib/db/schema";

function StatCard({
  label,
  value,
  href,
}: {
  label: string;
  value: number | string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition-colors hover:border-emerald-300 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <span className="text-3xl font-semibold tabular-nums">{value}</span>
    </Link>
  );
}

export default function DashboardPage() {
  const data = useLiveQuery(async () => {
    const [species, ponds, batches, stockings, transfers] = await Promise.all([
      db.species.toArray(),
      db.ponds.toArray(),
      db.fishBatches.toArray(),
      db.stockings.toArray(),
      db.fishTransfers.toArray(),
    ]);

    const activeBatches = batches.filter((b) => !b.deletedAt);
    const livingFish = activeBatches.reduce(
      (sum, batch) => sum + getBatchTotalBalance(stockings, transfers, batch.id),
      0,
    );
    const initialBiomassKg = activeBatches.reduce((sum, batch) => sum + batch.initialBiomassKg, 0);

    return {
      activeSpeciesCount: species.filter((s) => s.active && !s.deletedAt).length,
      activePondsCount: ponds.filter((p) => !p.deletedAt).length,
      activeBatchesCount: activeBatches.length,
      livingFish,
      initialBiomassKg,
    };
  }, []);

  const activeSpeciesCount = data?.activeSpeciesCount ?? 0;
  const activePondsCount = data?.activePondsCount ?? 0;
  const activeBatchesCount = data?.activeBatchesCount ?? 0;
  const livingFish = data?.livingFish ?? 0;
  const initialBiomassKg = data?.initialBiomassKg ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">
          Resumen
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Funciona sin conexión: los datos se guardan en este dispositivo y se
          sincronizan solos al recuperar Internet.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Estanques activos" value={activePondsCount} href="/estanques" />
        <StatCard label="Lotes activos" value={activeBatchesCount} href="/lotes" />
        <StatCard label="Peces sembrados" value={livingFish.toLocaleString("es")} href="/lotes" />
        <StatCard
          label="Biomasa inicial (kg)"
          value={initialBiomassKg.toLocaleString("es", { maximumFractionDigits: 1 })}
          href="/lotes"
        />
      </div>

      <StatCard label="Especies" value={activeSpeciesCount} href="/especies" />

      <div className="flex flex-col gap-2 rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        <p>
          Fase 2: especies, estanques, lotes, siembras y traslados
          offline-first con sincronización automática. Alimentación,
          mortalidad, muestreos, cosechas y ventas se añaden en las próximas
          fases.
        </p>
      </div>
    </div>
  );
}
