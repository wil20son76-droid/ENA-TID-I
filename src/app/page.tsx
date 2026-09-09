"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { getBatchProductionSummary } from "@/lib/domain/productionSummary";
import { getAllFeedStocks } from "@/lib/domain/feedLedger";
import { formatCount, formatKg } from "@/lib/domain/format";
import { evaluateWaterQuality, getLatestMeasurement, isMeasurementStale } from "@/lib/domain/waterQuality";
import { classifyTask } from "@/lib/domain/task";
import { getPondOccupancy } from "@/lib/db/repositories/ledgerQueries";
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
    const [
      species,
      ponds,
      batches,
      stockings,
      transfers,
      mortalities,
      samplings,
      feedings,
      feeds,
      movements,
      waterQualityRecords,
      tasks,
    ] = await Promise.all([
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
      db.waterQualityRecords.toArray(),
      db.tasks.toArray(),
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

    // Calidad del agua: alertas de la última medición de cada estanque
    // activo, y estanques sin medición reciente (§17/§27 del encargo de
    // Fase 4) — nunca derivado de un campo mutable, siempre del historial.
    const activePonds = ponds.filter((p) => !p.deletedAt);
    const activeWaterRecords = waterQualityRecords.filter((r) => !r.deletedAt);
    const speciesById = new Map(species.map((s) => [s.id, s]));
    const batchById = new Map(batches.map((b) => [b.id, b]));

    let criticalAlerts = 0;
    let warningAlerts = 0;
    let staleWaterPondsCount = 0;
    for (const pond of activePonds) {
      const latest = getLatestMeasurement(activeWaterRecords.filter((r) => r.pondId === pond.id));
      if (isMeasurementStale(latest?.date ?? null)) staleWaterPondsCount += 1;
      if (!latest) continue;

      const occupancy = await getPondOccupancy(pond.id);
      const speciesRanges = Object.keys(occupancy)
        .map((batchId) => batchById.get(batchId))
        .filter((b): b is NonNullable<typeof b> => !!b)
        .map((b) => speciesById.get(b.speciesId))
        .filter((s): s is NonNullable<typeof s> => !!s);

      const alerts = evaluateWaterQuality(
        {
          temperatureC: latest.temperatureC,
          ph: latest.ph,
          dissolvedOxygenMgL: latest.dissolvedOxygenMgL,
        },
        speciesRanges,
      );
      for (const alert of alerts) {
        if (alert.severity === "critical") criticalAlerts += 1;
        else warningAlerts += 1;
      }
    }

    // Tareas: hoy/vencidas/próximas (§27), nunca contando completadas ni canceladas.
    const activeTasks = tasks.filter((t) => !t.deletedAt);
    let tasksToday = 0;
    let tasksOverdue = 0;
    let tasksUpcoming = 0;
    for (const task of activeTasks) {
      const bucket = classifyTask(task, today);
      if (bucket === "today") tasksToday += 1;
      else if (bucket === "overdue") tasksOverdue += 1;
      else if (bucket === "upcoming") tasksUpcoming += 1;
    }

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
      criticalAlerts,
      warningAlerts,
      staleWaterPondsCount,
      tasksToday,
      tasksOverdue,
      tasksUpcoming,
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
  const waterAlertsCount = (data?.criticalAlerts ?? 0) + (data?.warningAlerts ?? 0);
  const staleWaterPondsCount = data?.staleWaterPondsCount ?? 0;
  const tasksToday = data?.tasksToday ?? 0;
  const tasksOverdue = data?.tasksOverdue ?? 0;
  const tasksUpcoming = data?.tasksUpcoming ?? 0;

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

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Alertas de agua" value={waterAlertsCount} href="/calidad-agua" />
        <StatCard
          label="Estanques sin medición reciente"
          value={staleWaterPondsCount}
          href="/calidad-agua"
        />
        <StatCard label="Tareas vencidas" value={tasksOverdue} href="/tareas" />
        <StatCard label="Tareas hoy" value={tasksToday} href="/tareas" />
      </div>

      {tasksUpcoming > 0 && (
        <StatCard label="Próximas tareas" value={tasksUpcoming} href="/tareas" />
      )}

      <StatCard label="Especies" value={activeSpeciesCount} href="/especies" />

      <div className="flex flex-col gap-2 rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        <p>
          Fase 4: calidad del agua con alertas por especie, tareas y
          calendario, offline-first, sobre el mismo ledger de peces y
          alimento de las fases anteriores. Cosechas, ventas y
          rentabilidad se añaden en las próximas fases.
        </p>
      </div>
    </div>
  );
}
