"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { db } from "@/lib/db/schema";
import { getBatchTotalBalance } from "@/lib/domain/batchLedger";
import type { AnalyticsFilters } from "@/lib/analytics/filters";
import { buildFeedingReport } from "@/lib/analytics/reports";
import { formatKg } from "@/lib/domain/format";
import { LineChart } from "@/components/charts/LineChart";
import { BarChart } from "@/components/charts/BarChart";
import { ReportFilterBar } from "@/components/analytics/ReportFilterBar";
import { KpiCard } from "@/components/analytics/KpiCard";
import { CsvExportButton } from "@/components/analytics/CsvExportButton";
import { PrintButton } from "@/components/analytics/PrintButton";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("es", { dateStyle: "short" }).format(new Date(iso));
}

export default function FeedingReportPage() {
  const [filters, setFilters] = useState<AnalyticsFilters>({});

  const data = useLiveQuery(async () => {
    const [species, batches, ponds, feeds, feedings, stockings, transfers, mortalities, harvests, samplings] =
      await Promise.all([
        db.species.toArray(),
        db.fishBatches.toArray(),
        db.ponds.toArray(),
        db.feeds.toArray(),
        db.feedingRecords.toArray(),
        db.stockings.toArray(),
        db.fishTransfers.toArray(),
        db.mortalityRecords.toArray(),
        db.harvests.toArray(),
        db.samplings.toArray(),
      ]);

    const activeBatches = batches.filter((b) => !b.deletedAt);
    const activeMortalities = mortalities.filter((m) => !m.deletedAt);
    const activeHarvests = harvests.filter((h) => !h.deletedAt);
    const livingQuantityByBatch = new Map(
      activeBatches.map((b) => [
        b.id,
        getBatchTotalBalance(
          stockings.filter((s) => s.batchId === b.id),
          transfers.filter((t) => t.batchId === b.id),
          activeMortalities.filter((m) => m.batchId === b.id),
          activeHarvests.filter((h) => h.batchId === b.id),
          b.id,
        ),
      ]),
    );

    return {
      species: species.filter((s) => !s.deletedAt),
      batches: activeBatches,
      ponds: ponds.filter((p) => !p.deletedAt),
      feeds: feeds.filter((f) => f.active && !f.deletedAt),
      feedings: feedings.filter((f) => !f.deletedAt),
      samplings: samplings.filter((s) => !s.deletedAt),
      livingQuantityByBatch,
    };
  }, []);

  const report = useMemo(() => {
    if (!data) return null;
    return buildFeedingReport({ ...data, filters });
  }, [data, filters]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Link href="/informes" className="text-sm text-emerald-700 dark:text-emerald-400">
            ← Informes
          </Link>
          <h2 className="mt-1 text-base font-semibold text-zinc-700 dark:text-zinc-300">Alimentación</h2>
        </div>
        <div className="flex gap-2">
          <CsvExportButton
            filename="alimentacion.csv"
            rows={report?.rows ?? []}
            columns={[
              { key: "date", label: "Fecha", value: (r) => formatDate(r.date) },
              { key: "batchId", label: "Lote", value: (r) => data?.batches.find((b) => b.id === r.batchId)?.code ?? r.batchId },
              { key: "feedId", label: "Alimento", value: (r) => data?.feeds.find((f) => f.id === r.feedId)?.name ?? r.feedId },
              { key: "quantityKg", label: "Kg", value: (r) => r.quantityKg },
            ]}
          />
          <PrintButton />
        </div>
      </div>

      <ReportFilterBar
        filters={filters}
        onChange={setFilters}
        species={data?.species ?? []}
        batches={data?.batches ?? []}
        ponds={data?.ponds ?? []}
      />

      <div className="grid grid-cols-2 gap-3">
        <KpiCard label="Kg en el período" value={report ? formatKg(report.totalKgInPeriod) : "—"} />
        <KpiCard
          label="FCR estimado"
          value={
            report?.fcrEstimate
              ? `${report.fcrEstimate.fcr.toLocaleString("es", { maximumFractionDigits: 2 })} (estimado)`
              : "Datos insuficientes"
          }
          hint="Ponderado por ganancia de biomasa, nunca promedio de FCR por lote"
        />
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Consumo por mes</h3>
        <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <LineChart
            data={report?.byMonth.map((p) => ({ label: p.month, value: p.value })) ?? []}
            ariaLabel="Alimento consumido por mes"
            valueFormatter={(v) => formatKg(v)}
          />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Por alimento</h3>
        <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <BarChart
            data={report?.byFeed.map((f) => ({ label: f.feedName, value: f.quantityKg })) ?? []}
            ariaLabel="Consumo por alimento"
            valueFormatter={(v) => formatKg(v)}
          />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Por lote</h3>
        <ul className="flex flex-col gap-2 text-sm">
          {(report?.byBatch ?? []).map((b) => (
            <li
              key={b.batchId}
              className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <span>{b.batchCode}</span>
              <span className="tabular-nums">{formatKg(b.quantityKg)}</span>
            </li>
          ))}
          {(report?.byBatch.length ?? 0) === 0 && (
            <li className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              Sin alimentación registrada en este período.
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
