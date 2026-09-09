"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

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
  const activeSpeciesCount =
    useLiveQuery(async () => {
      const all = await db.species.toArray();
      return all.filter((s) => s.active && !s.deletedAt).length;
    }, []) ?? 0;

  const activePondsCount =
    useLiveQuery(async () => {
      const all = await db.ponds.toArray();
      return all.filter((p) => !p.deletedAt).length;
    }, []) ?? 0;

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
        <StatCard label="Especies" value={activeSpeciesCount} href="/especies" />
        <StatCard label="Estanques" value={activePondsCount} href="/estanques" />
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        <p>
          Esta es la base técnica de la aplicación (Fase 1): especies y
          estanques offline-first con sincronización automática. El resto del
          ciclo productivo (siembras, alimentación, mortalidad, cosechas,
          ventas…) se añade en las próximas fases.
        </p>
      </div>
    </div>
  );
}
