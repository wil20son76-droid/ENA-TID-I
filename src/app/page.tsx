"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { getBatchProductionSummary } from "@/lib/domain/productionSummary";
import { getAllFeedStocks } from "@/lib/domain/feedLedger";
import { formatCount, formatKg } from "@/lib/domain/format";
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

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isSameDate(isoDateTime: string, isoDate: string): boolean {
  return isoDateTime.slice(0, 10) === isoDate;
}

function isSameMonth(isoDateTime: string, reference: string): boolean {
  return isoDateTime.slice(0, 7) === reference.slice(0, 7);
}

export default function DashboardPage() {
  const data = useLiveQuery(async () => {
    const [species, ponds, batches, stockings, transfers, mortalities, samplings, feedings, feeds, movements] =
      await Promise.all([
        db.species.toArray(),
        db.ponds.toArray(),
        db.fishBatches.toArray(),
        db.stockings.toArray(),
        db.fishTransfers.toArray(),
        db.mortalityRecords.toArray(),
        db.samplings.toArray(),
        db.feedingRecords.toArray(),
        db.feeds.toArray(),
        db.feedInventoryMovements.toArray(),
      ]);

    const activeBatches = batches.filter((b) => !b.deletedAt);
    let livingFish = 0;
    let estimatedBiomassKg = 0;
    for (const batch of activeBatches) {
      const summary = getBatchProductionSummary(
        stockings,
        transfers,
        mortalities,
        samplings,
        batch.id,
        batch.initialAverageWeightG,
      );
      livingFish += summary.totalQuantity;
      estimatedBiomassKg += summary.totalBiomassKg;
    }

    const today = todayIsoDate();
    const mortalityToday = mortalities
      .filter((m) => !m.deletedAt && isSameDate(m.date, today))
      .reduce((sum, m) => sum + m.quantity, 0);
    const mortalityTotal = mortalities
      .filter((m) => !m.deletedAt)
      .reduce((sum, m) => sum + m.quantity, 0);

    const feedToday = feedings
      .filter((f) => !f.deletedAt && isSameDate(f.date, today))
      .reduce((sum, f) => sum + f.quantityKg, 0);
    const feedThisMonth = feedings
      .filter((f) => !f.deletedAt && isSameMonth(f.date, today))
      .reduce((sum, f) => sum + f.quantityKg, 0);

    const activeFeeds = feeds.filter((f) => f.active && !f.deletedAt);
    const stocks = getAllFeedStocks(movements);
    const totalFeedStockKg = activeFeeds.reduce((sum, f) => sum + (stocks[f.id] ?? 0), 0);
    const lowStockFeedsCount = activeFeeds.filter(
      (f) => f.minimumStockKg != null && (stocks[f.id] ?? 0) <= f.minimumStockKg,
    ).length;

    return {
      activeSpeciesCount: species.filter((s) => s.active && !s.deletedAt).length,
      activePondsCount: ponds.filter((p) => !p.deletedAt).length,
      activeBatchesCount: activeBatches.length,
      livingFish,
      estimatedBiomassKg,
      mortalityToday,
      mortalityTotal,
      feedToday,
      feedThisMonth,
      totalFeedStockKg,
      lowStockFeedsCount,
    };
  }, []);

  const activeSpeciesCount = data?.activeSpeciesCount ?? 0;
  const activePondsCount = data?.activePondsCount ?? 0;
  const activeBatchesCount = data?.activeBatchesCount ?? 0;
  const livingFish = data?.livingFish ?? 0;
  const estimatedBiomassKg = data?.estimatedBiomassKg ?? 0;
  const mortalityToday = data?.mortalityToday ?? 0;
  const mortalityTotal = data?.mortalityTotal ?? 0;
  const feedToday = data?.feedToday ?? 0;
  const feedThisMonth = data?.feedThisMonth ?? 0;
  const totalFeedStockKg = data?.totalFeedStockKg ?? 0;
  const lowStockFeedsCount = data?.lowStockFeedsCount ?? 0;

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
        <StatCard label="Peces vivos estimados" value={formatCount(livingFish)} href="/lotes" />
        <StatCard label="Biomasa estimada" value={formatKg(estimatedBiomassKg)} href="/lotes" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Mortalidad hoy" value={formatCount(mortalityToday)} href="/mortalidad" />
        <StatCard
          label="Mortalidad acumulada"
          value={formatCount(mortalityTotal)}
          href="/mortalidad"
        />
        <StatCard label="Alimento hoy" value={formatKg(feedToday)} href="/alimentacion" />
        <StatCard label="Alimento este mes" value={formatKg(feedThisMonth)} href="/alimentacion" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Stock total de alimento" value={formatKg(totalFeedStockKg)} href="/alimentos" />
        <StatCard label="Alimentos bajo mínimo" value={lowStockFeedsCount} href="/alimentos" />
      </div>

      <StatCard label="Especies" value={activeSpeciesCount} href="/especies" />

      <div className="flex flex-col gap-2 rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        <p>
          Fase 3: alimentación, inventario de alimento, mortalidad y
          muestreos offline-first, integrados en el ledger de peces.
          Calidad de agua, cosechas y ventas se añaden en las próximas
          fases.
        </p>
      </div>
    </div>
  );
}
