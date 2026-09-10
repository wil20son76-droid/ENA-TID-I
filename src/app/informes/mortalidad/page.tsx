"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { db } from "@/lib/db/schema";
import type { AnalyticsFilters } from "@/lib/analytics/filters";
import { buildMortalityReport } from "@/lib/analytics/reports";
import { formatCount } from "@/lib/domain/format";
import { MORTALITY_CAUSE_LABEL } from "@/lib/labels";
import type { MortalityCause } from "@/lib/db/types";
import { BarChart } from "@/components/charts/BarChart";
import { ReportFilterBar } from "@/components/analytics/ReportFilterBar";
import { KpiCard } from "@/components/analytics/KpiCard";
import { CsvExportButton } from "@/components/analytics/CsvExportButton";
import { PrintButton } from "@/components/analytics/PrintButton";
import { PrintableReportHeader } from "@/components/analytics/PrintableReportHeader";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("es", { dateStyle: "short" }).format(new Date(iso));
}

export default function MortalityReportPage() {
  const [filters, setFilters] = useState<AnalyticsFilters>({});

  const data = useLiveQuery(async () => {
    const [species, batches, ponds, mortalities] = await Promise.all([
      db.species.toArray(),
      db.fishBatches.toArray(),
      db.ponds.toArray(),
      db.mortalityRecords.toArray(),
    ]);
    return {
      species: species.filter((s) => !s.deletedAt),
      batches: batches.filter((b) => !b.deletedAt),
      ponds: ponds.filter((p) => !p.deletedAt),
      mortalities: mortalities.filter((m) => !m.deletedAt),
    };
  }, []);

  const report = useMemo(() => {
    if (!data) return null;
    return buildMortalityReport({ mortalities: data.mortalities, batches: data.batches, filters });
  }, [data, filters]);

  return (
    <div className="flex flex-col gap-6">
      <PrintableReportHeader title="Mortalidad" />
      <div className="flex items-center justify-between gap-2">
        <div>
          <Link href="/informes" className="text-sm text-emerald-700 dark:text-emerald-400">
            ← Informes
          </Link>
          <h2 className="mt-1 text-base font-semibold text-zinc-700 dark:text-zinc-300">Mortalidad</h2>
        </div>
        <div className="flex gap-2">
          <CsvExportButton
            filename="mortalidad.csv"
            rows={report?.rows ?? []}
            columns={[
              { key: "date", label: "Fecha", value: (r) => formatDate(r.date) },
              { key: "batchId", label: "Lote", value: (r) => data?.batches.find((b) => b.id === r.batchId)?.code ?? r.batchId },
              { key: "pondId", label: "Estanque", value: (r) => data?.ponds.find((p) => p.id === r.pondId)?.code ?? r.pondId },
              { key: "quantity", label: "Cantidad", value: (r) => r.quantity },
              { key: "cause", label: "Causa", value: (r) => MORTALITY_CAUSE_LABEL[r.cause as MortalityCause] ?? r.cause },
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
        <KpiCard label="Mortalidad en el período" value={report ? formatCount(report.totalInPeriod) : "—"} />
        <KpiCard
          label="Causa principal"
          value={
            report && report.byCause.length > 0
              ? MORTALITY_CAUSE_LABEL[report.byCause[0].cause as MortalityCause] ?? report.byCause[0].cause
              : "—"
          }
        />
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Mortalidad por mes</h3>
        <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <BarChart
            data={report?.byMonth.map((p) => ({ label: p.month, value: p.value })) ?? []}
            ariaLabel="Mortalidad por mes"
            valueFormatter={(v) => formatCount(v)}
          />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Por causa</h3>
        <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <BarChart
            data={
              report?.byCause.map((c) => ({
                label: MORTALITY_CAUSE_LABEL[c.cause as MortalityCause] ?? c.cause,
                value: c.quantity,
              })) ?? []
            }
            ariaLabel="Mortalidad por causa"
            valueFormatter={(v) => formatCount(v)}
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
              <span className="tabular-nums">{formatCount(b.quantity)}</span>
            </li>
          ))}
          {(report?.byBatch.length ?? 0) === 0 && (
            <li className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              Sin mortalidad registrada en este período.
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
