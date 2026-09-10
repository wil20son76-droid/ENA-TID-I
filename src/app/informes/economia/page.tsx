"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { db } from "@/lib/db/schema";
import { getBatchEconomicsSummary } from "@/lib/db/repositories/batchEconomicsRepository";
import type { AnalyticsFilters } from "@/lib/analytics/filters";
import { buildEconomicsReport, type EconomicsReportRow } from "@/lib/analytics/reports";
import { formatKg, formatPercent } from "@/lib/domain/format";
import { formatMoney } from "@/lib/domain/money";
import { BarChart } from "@/components/charts/BarChart";
import { ReportFilterBar } from "@/components/analytics/ReportFilterBar";
import { KpiCard } from "@/components/analytics/KpiCard";
import { CsvExportButton } from "@/components/analytics/CsvExportButton";
import { PrintButton } from "@/components/analytics/PrintButton";

export default function EconomicsReportPage() {
  const [filters, setFilters] = useState<AnalyticsFilters>({});

  const data = useLiveQuery(async () => {
    const [species, batches, ponds] = await Promise.all([
      db.species.toArray(),
      db.fishBatches.toArray(),
      db.ponds.toArray(),
    ]);
    const activeBatches = batches.filter((b) => !b.deletedAt);
    const economics = await Promise.all(activeBatches.map((b) => getBatchEconomicsSummary(b.id)));
    const rows: EconomicsReportRow[] = economics.map((e, index) => ({
      ...e,
      batchCode: activeBatches[index].code,
      speciesId: activeBatches[index].speciesId,
      speciesName: species.find((s) => s.id === activeBatches[index].speciesId)?.commonName ?? "—",
    }));

    return {
      species: species.filter((s) => !s.deletedAt),
      batches: activeBatches,
      ponds: ponds.filter((p) => !p.deletedAt),
      rows,
    };
  }, []);

  const report = useMemo(() => {
    if (!data) return null;
    const scoped = data.rows.filter((row) => {
      if (filters.batchId && row.batchId !== filters.batchId) return false;
      if (filters.speciesId && row.speciesId !== filters.speciesId) return false;
      return true;
    });
    return buildEconomicsReport(scoped);
  }, [data, filters]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Link href="/informes" className="text-sm text-emerald-700 dark:text-emerald-400">
            ← Informes
          </Link>
          <h2 className="mt-1 text-base font-semibold text-zinc-700 dark:text-zinc-300">Economía</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Costo/ingreso/ganancia por lote — no admite filtro de estanque ni de fecha (ver ECONOMICS.md).
          </p>
        </div>
        <div className="flex gap-2">
          <CsvExportButton
            filename="economia.csv"
            rows={report?.rows ?? []}
            columns={[
              { key: "batchCode", label: "Lote", value: (r) => r.batchCode },
              { key: "speciesName", label: "Especie", value: (r) => r.speciesName },
              { key: "fryCost", label: "Costo alevines", value: (r) => r.fryCost.toFixed(2) },
              { key: "feedCost", label: "Costo alimento", value: (r) => r.feedCost.toFixed(2) },
              { key: "directExpensesTotal", label: "Gastos directos", value: (r) => r.directExpensesTotal.toFixed(2) },
              { key: "directCostTotal", label: "Costo directo total", value: (r) => r.directCostTotal.toFixed(2) },
              { key: "harvestedWeightKgTotal", label: "Kg cosechados", value: (r) => r.harvestedWeightKgTotal.toFixed(2) },
              { key: "costPerKg", label: "Costo/kg", value: (r) => (r.costPerKg != null ? r.costPerKg.toFixed(2) : "") },
              { key: "incomeTotal", label: "Ingresos", value: (r) => r.incomeTotal.toFixed(2) },
              { key: "profit", label: "Ganancia", value: (r) => r.profit.toFixed(2) },
              { key: "marginPercent", label: "Margen %", value: (r) => (r.marginPercent != null ? r.marginPercent.toFixed(2) : "") },
              { key: "isProvisional", label: "Provisional", value: (r) => (r.isProvisional ? "Sí" : "No") },
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
        showPond={false}
      />

      <div className="grid grid-cols-2 gap-3">
        <KpiCard label="Ingresos" value={report ? formatMoney(report.totals.incomeTotal) : "—"} />
        <KpiCard label="Costo directo" value={report ? formatMoney(report.totals.directCostTotal) : "—"} />
        <KpiCard label="Ganancia" value={report ? formatMoney(report.totals.profit) : "—"} />
        <KpiCard
          label="Margen"
          value={report?.totals.marginPercent != null ? formatPercent(report.totals.marginPercent) : "Datos insuficientes"}
          hint="Σganancia / Σingresos, nunca el promedio de los márgenes por lote"
        />
        <KpiCard
          label="Costo/kg"
          value={report?.totals.costPerKg != null ? formatMoney(report.totals.costPerKg) : "Datos insuficientes"}
        />
        <KpiCard label="Kg cosechados" value={report ? formatKg(report.totals.harvestedWeightKgTotal) : "—"} />
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Ganancia por lote</h3>
        <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <BarChart
            data={report?.rows.map((r) => ({ label: r.batchCode, value: r.profit })) ?? []}
            ariaLabel="Ganancia por lote"
            valueFormatter={(v) => formatMoney(v)}
          />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2">Lote</th>
                <th className="px-3 py-2 text-right">Costo directo</th>
                <th className="px-3 py-2 text-right">Ingresos</th>
                <th className="px-3 py-2 text-right">Ganancia</th>
                <th className="px-3 py-2 text-right">Margen</th>
              </tr>
            </thead>
            <tbody>
              {(report?.rows ?? []).map((r) => (
                <tr key={r.batchId} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-3 py-2 font-medium">
                    {r.batchCode}
                    {r.isProvisional && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        Provisional
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.directCostTotal)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.incomeTotal)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.profit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.marginPercent != null ? formatPercent(r.marginPercent) : "—"}
                  </td>
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
