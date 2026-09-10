"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { db } from "@/lib/db/schema";
import type { AnalyticsFilters } from "@/lib/analytics/filters";
import { buildHarvestReport } from "@/lib/analytics/reports";
import { formatCount, formatKg } from "@/lib/domain/format";
import { LineChart } from "@/components/charts/LineChart";
import { BarChart } from "@/components/charts/BarChart";
import { ReportFilterBar } from "@/components/analytics/ReportFilterBar";
import { KpiCard } from "@/components/analytics/KpiCard";
import { CsvExportButton } from "@/components/analytics/CsvExportButton";
import { PrintButton } from "@/components/analytics/PrintButton";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("es", { dateStyle: "short" }).format(new Date(iso));
}

export default function HarvestReportPage() {
  const [filters, setFilters] = useState<AnalyticsFilters>({});

  const data = useLiveQuery(async () => {
    const [species, batches, ponds, harvests] = await Promise.all([
      db.species.toArray(),
      db.fishBatches.toArray(),
      db.ponds.toArray(),
      db.harvests.toArray(),
    ]);
    return {
      species: species.filter((s) => !s.deletedAt),
      batches: batches.filter((b) => !b.deletedAt),
      ponds: ponds.filter((p) => !p.deletedAt),
      harvests: harvests.filter((h) => !h.deletedAt),
    };
  }, []);

  const report = useMemo(() => {
    if (!data) return null;
    return buildHarvestReport({ harvests: data.harvests, batches: data.batches, species: data.species, filters });
  }, [data, filters]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Link href="/informes" className="text-sm text-emerald-700 dark:text-emerald-400">
            ← Informes
          </Link>
          <h2 className="mt-1 text-base font-semibold text-zinc-700 dark:text-zinc-300">Cosechas</h2>
        </div>
        <div className="flex gap-2">
          <CsvExportButton
            filename="cosechas.csv"
            rows={report?.rows ?? []}
            columns={[
              { key: "date", label: "Fecha", value: (r) => formatDate(r.date) },
              { key: "batchId", label: "Lote", value: (r) => data?.batches.find((b) => b.id === r.batchId)?.code ?? r.batchId },
              { key: "pondId", label: "Estanque", value: (r) => data?.ponds.find((p) => p.id === r.pondId)?.code ?? r.pondId },
              { key: "quantityFish", label: "Peces", value: (r) => r.quantityFish },
              { key: "totalWeightKg", label: "Kg", value: (r) => r.totalWeightKg },
              { key: "averageWeightG", label: "Peso promedio (g)", value: (r) => r.averageWeightG.toFixed(1) },
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
        <KpiCard label="Peces cosechados" value={report ? formatCount(report.totalFishInPeriod) : "—"} />
        <KpiCard label="Kg cosechados" value={report ? formatKg(report.totalWeightKgInPeriod) : "—"} />
        <KpiCard
          label="Peso promedio"
          value={report?.averageWeightG != null ? `${report.averageWeightG.toLocaleString("es", { maximumFractionDigits: 0 })} g` : "—"}
          hint="Ponderado por peces cosechados"
        />
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Kg cosechados por mes</h3>
        <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <LineChart
            data={report?.byMonth.map((p) => ({ label: p.month, value: p.value })) ?? []}
            ariaLabel="Kg cosechados por mes"
            valueFormatter={(v) => formatKg(v)}
          />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Por especie</h3>
        <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <BarChart
            data={report?.bySpecies.map((s) => ({ label: s.speciesName, value: s.totalWeightKg })) ?? []}
            ariaLabel="Kg cosechados por especie"
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
              <span className="tabular-nums">
                {formatCount(b.quantityFish)} peces / {formatKg(b.totalWeightKg)}
              </span>
            </li>
          ))}
          {(report?.byBatch.length ?? 0) === 0 && (
            <li className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              Sin cosechas registradas en este período.
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
