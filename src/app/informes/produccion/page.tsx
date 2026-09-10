"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { db } from "@/lib/db/schema";
import type { AnalyticsFilters } from "@/lib/analytics/filters";
import { buildProductionReport } from "@/lib/analytics/reports";
import { formatKg, formatPercent } from "@/lib/domain/format";
import { LineChart } from "@/components/charts/LineChart";
import { BarChart } from "@/components/charts/BarChart";
import { ReportFilterBar } from "@/components/analytics/ReportFilterBar";
import { KpiCard } from "@/components/analytics/KpiCard";
import { CsvExportButton } from "@/components/analytics/CsvExportButton";
import { PrintButton } from "@/components/analytics/PrintButton";

export default function ProductionReportPage() {
  const [filters, setFilters] = useState<AnalyticsFilters>({});

  const data = useLiveQuery(async () => {
    const [species, batches, ponds, stockings, transfers, mortalities, harvests, samplings] = await Promise.all([
      db.species.toArray(),
      db.fishBatches.toArray(),
      db.ponds.toArray(),
      db.stockings.toArray(),
      db.fishTransfers.toArray(),
      db.mortalityRecords.toArray(),
      db.harvests.toArray(),
      db.samplings.toArray(),
    ]);
    return {
      species: species.filter((s) => !s.deletedAt),
      batches: batches.filter((b) => !b.deletedAt),
      ponds: ponds.filter((p) => !p.deletedAt),
      stockings,
      transfers,
      mortalities: mortalities.filter((m) => !m.deletedAt),
      harvests: harvests.filter((h) => !h.deletedAt),
      samplings: samplings.filter((s) => !s.deletedAt),
    };
  }, []);

  const report = useMemo(() => {
    if (!data) return null;
    return buildProductionReport({ ...data, filters });
  }, [data, filters]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Link href="/informes" className="text-sm text-emerald-700 dark:text-emerald-400">
            ← Informes
          </Link>
          <h2 className="mt-1 text-base font-semibold text-zinc-700 dark:text-zinc-300">Producción</h2>
        </div>
        <div className="flex gap-2">
          <CsvExportButton
            filename="produccion.csv"
            rows={report?.rows ?? []}
            columns={[
              { key: "batchCode", label: "Lote", value: (r) => r.batchCode },
              { key: "speciesName", label: "Especie", value: (r) => r.speciesName },
              { key: "stockedTotal", label: "Sembrados", value: (r) => r.stockedTotal },
              { key: "mortalityTotal", label: "Mortalidad total", value: (r) => r.mortalityTotal },
              { key: "harvestedFishTotal", label: "Peces cosechados", value: (r) => r.harvestedFishTotal },
              { key: "harvestedWeightKgTotal", label: "Kg cosechados", value: (r) => r.harvestedWeightKgTotal },
              { key: "currentLiving", label: "Vivos actuales", value: (r) => r.currentLiving },
              {
                key: "survivalPercent",
                label: "Supervivencia %",
                value: (r) => (r.survivalPercent != null ? r.survivalPercent.toFixed(2) : ""),
              },
              { key: "currentBiomassKg", label: "Biomasa actual (kg)", value: (r) => r.currentBiomassKg.toFixed(2) },
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
        <KpiCard label="Sembrados" value={report ? report.totals.stockedTotal.toLocaleString("es") : "—"} />
        <KpiCard label="Mortalidad total" value={report ? report.totals.mortalityTotal.toLocaleString("es") : "—"} />
        <KpiCard label="Vivos actuales" value={report ? report.totals.currentLiving.toLocaleString("es") : "—"} />
        <KpiCard
          label="Supervivencia agregada"
          value={report?.totals.survivalPercent != null ? formatPercent(report.totals.survivalPercent) : "—"}
          hint="Σ vivos / Σ sembrados, nunca el promedio de los % por lote"
        />
        <KpiCard label="Biomasa actual" value={report ? formatKg(report.totals.currentBiomassKg) : "—"} />
        <KpiCard label="Kg cosechados" value={report ? formatKg(report.totals.harvestedWeightKgTotal) : "—"} />
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Peso promedio en el tiempo</h3>
        <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <LineChart
            data={(report?.weightTrend ?? []).map((p) => ({ label: p.month, value: p.value }))}
            ariaLabel="Peso promedio por mes"
            valueFormatter={(v) => `${v.toLocaleString("es", { maximumFractionDigits: 0 })} g`}
          />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Biomasa actual por lote</h3>
        <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <BarChart
            data={(report?.rows ?? []).map((r) => ({ label: r.batchCode, value: r.currentBiomassKg }))}
            ariaLabel="Biomasa actual por lote"
            valueFormatter={(v) => formatKg(v)}
          />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Por lote</h3>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2">Lote</th>
                <th className="px-3 py-2">Especie</th>
                <th className="px-3 py-2 text-right">Vivos</th>
                <th className="px-3 py-2 text-right">Supervivencia</th>
                <th className="px-3 py-2 text-right">Biomasa</th>
              </tr>
            </thead>
            <tbody>
              {(report?.rows ?? []).map((r) => (
                <tr key={r.batchId} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-3 py-2 font-medium">{r.batchCode}</td>
                  <td className="px-3 py-2">{r.speciesName}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.currentLiving.toLocaleString("es")}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.survivalPercent != null ? formatPercent(r.survivalPercent) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatKg(r.currentBiomassKg)}</td>
                </tr>
              ))}
              {(report?.rows.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-zinc-500 dark:text-zinc-400">
                    Sin lotes que coincidan con los filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
