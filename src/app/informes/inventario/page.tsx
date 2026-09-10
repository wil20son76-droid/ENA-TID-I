"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { db } from "@/lib/db/schema";
import { buildInventoryReport } from "@/lib/analytics/reports";
import { formatKg } from "@/lib/domain/format";
import { formatMoney } from "@/lib/domain/money";
import { BarChart } from "@/components/charts/BarChart";
import { KpiCard } from "@/components/analytics/KpiCard";
import { CsvExportButton } from "@/components/analytics/CsvExportButton";
import { PrintButton } from "@/components/analytics/PrintButton";

export default function InventoryReportPage() {
  const data = useLiveQuery(async () => {
    const [feeds, movements] = await Promise.all([
      db.feeds.toArray(),
      db.feedInventoryMovements.toArray(),
    ]);
    return {
      feeds: feeds.filter((f) => f.active && !f.deletedAt),
      movements: movements.filter((m) => !m.deletedAt),
    };
  }, []);

  const report = useMemo(() => {
    if (!data) return null;
    return buildInventoryReport(data);
  }, [data]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Link href="/informes" className="text-sm text-emerald-700 dark:text-emerald-400">
            ← Informes
          </Link>
          <h2 className="mt-1 text-base font-semibold text-zinc-700 dark:text-zinc-300">Inventario</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Estado actual de stock — no admite filtro de fecha (es una foto de hoy, no un período).
          </p>
        </div>
        <div className="flex gap-2">
          <CsvExportButton
            filename="inventario.csv"
            rows={report?.rows ?? []}
            columns={[
              { key: "feedName", label: "Alimento", value: (r) => r.feedName },
              { key: "stockKg", label: "Stock (kg)", value: (r) => r.stockKg.toFixed(2) },
              {
                key: "averageCostPerKg",
                label: "Costo promedio/kg",
                value: (r) => (r.averageCostPerKg != null ? r.averageCostPerKg.toFixed(4) : ""),
              },
              { key: "totalValue", label: "Valor total", value: (r) => r.totalValue.toFixed(2) },
              {
                key: "daysOfStockRemaining",
                label: "Días de stock restantes",
                value: (r) => (r.daysOfStockRemaining != null ? r.daysOfStockRemaining.toFixed(1) : ""),
              },
            ]}
          />
          <PrintButton />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <KpiCard label="Stock total" value={report ? formatKg(report.totals.stockKg) : "—"} />
        <KpiCard label="Valor total del inventario" value={report ? formatMoney(report.totals.totalValue) : "—"} />
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Stock por alimento</h3>
        <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <BarChart
            data={report?.rows.map((r) => ({ label: r.feedName, value: r.stockKg })) ?? []}
            ariaLabel="Stock por alimento"
            valueFormatter={(v) => formatKg(v)}
          />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <ul className="flex flex-col gap-2 text-sm">
          {(report?.rows ?? []).map((r) => (
            <li
              key={r.feedId}
              className="flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">{r.feedName}</p>
                <span className="tabular-nums">{formatKg(r.stockKg)}</span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Costo promedio: {r.averageCostPerKg != null ? formatMoney(r.averageCostPerKg) + "/kg" : "sin datos"} ·
                Valor: {formatMoney(r.totalValue)} ·{" "}
                {r.daysOfStockRemaining != null
                  ? `${r.daysOfStockRemaining.toLocaleString("es", { maximumFractionDigits: 0 })} días de stock`
                  : "sin consumo reciente para estimar días de stock"}
              </p>
            </li>
          ))}
          {(report?.rows.length ?? 0) === 0 && (
            <li className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              Sin alimentos activos en el catálogo.
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
