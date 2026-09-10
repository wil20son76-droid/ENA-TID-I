"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { db } from "@/lib/db/schema";
import { buildBatchSpeciesIndex, type AnalyticsFilters } from "@/lib/analytics/filters";
import { buildWaterQualityReport } from "@/lib/analytics/reports";
import { LineChart } from "@/components/charts/LineChart";
import { ReportFilterBar } from "@/components/analytics/ReportFilterBar";
import { KpiCard } from "@/components/analytics/KpiCard";
import { CsvExportButton } from "@/components/analytics/CsvExportButton";
import { PrintButton } from "@/components/analytics/PrintButton";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("es", { dateStyle: "short" }).format(new Date(iso));
}

export default function WaterQualityReportPage() {
  const [filters, setFilters] = useState<AnalyticsFilters>({});

  const data = useLiveQuery(async () => {
    const [species, batches, ponds, records] = await Promise.all([
      db.species.toArray(),
      db.fishBatches.toArray(),
      db.ponds.toArray(),
      db.waterQualityRecords.toArray(),
    ]);
    return {
      species: species.filter((s) => !s.deletedAt),
      batches: batches.filter((b) => !b.deletedAt),
      ponds: ponds.filter((p) => !p.deletedAt),
      records: records.filter((r) => !r.deletedAt),
    };
  }, []);

  const report = useMemo(() => {
    if (!data) return null;
    return buildWaterQualityReport({
      records: data.records,
      filters,
      batchSpeciesIndex: buildBatchSpeciesIndex(data.batches),
    });
  }, [data, filters]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Link href="/informes" className="text-sm text-emerald-700 dark:text-emerald-400">
            ← Informes
          </Link>
          <h2 className="mt-1 text-base font-semibold text-zinc-700 dark:text-zinc-300">Calidad del agua</h2>
        </div>
        <div className="flex gap-2">
          <CsvExportButton
            filename="calidad-agua.csv"
            rows={report?.rows ?? []}
            columns={[
              { key: "date", label: "Fecha", value: (r) => formatDate(r.date) },
              { key: "pondId", label: "Estanque", value: (r) => data?.ponds.find((p) => p.id === r.pondId)?.code ?? r.pondId },
              { key: "temperatureC", label: "Temperatura (°C)", value: (r) => r.temperatureC },
              { key: "ph", label: "pH", value: (r) => r.ph },
              { key: "dissolvedOxygenMgL", label: "O₂ disuelto (mg/L)", value: (r) => r.dissolvedOxygenMgL },
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
        <KpiCard label="Mediciones en el período" value={report ? report.countInPeriod.toLocaleString("es") : "—"} />
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Temperatura promedio por mes</h3>
        <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <LineChart
            data={report?.byMonth.averageTemperatureC.map((p) => ({ label: p.month, value: p.value })) ?? []}
            ariaLabel="Temperatura promedio por mes"
            valueFormatter={(v) => `${v.toLocaleString("es", { maximumFractionDigits: 1 })} °C`}
          />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">pH promedio por mes</h3>
        <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <LineChart
            data={report?.byMonth.averagePh.map((p) => ({ label: p.month, value: p.value })) ?? []}
            ariaLabel="pH promedio por mes"
            valueFormatter={(v) => v.toLocaleString("es", { maximumFractionDigits: 2 })}
          />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Oxígeno disuelto promedio por mes</h3>
        <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <LineChart
            data={report?.byMonth.averageDissolvedOxygenMgL.map((p) => ({ label: p.month, value: p.value })) ?? []}
            ariaLabel="Oxígeno disuelto promedio por mes"
            valueFormatter={(v) => `${v.toLocaleString("es", { maximumFractionDigits: 2 })} mg/L`}
          />
        </div>
      </section>
    </div>
  );
}
