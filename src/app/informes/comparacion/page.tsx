"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { db } from "@/lib/db/schema";
import { getBatchEconomicsSummary } from "@/lib/db/repositories/batchEconomicsRepository";
import { buildProductionReport, type EconomicsReportRow } from "@/lib/analytics/reports";
import { buildBatchComparison, buildSpeciesComparison } from "@/lib/analytics/comparison";
import { formatKg, formatPercent } from "@/lib/domain/format";
import { formatMoney } from "@/lib/domain/money";
import { CsvExportButton } from "@/components/analytics/CsvExportButton";
import { PrintButton } from "@/components/analytics/PrintButton";
import { PrintableReportHeader } from "@/components/analytics/PrintableReportHeader";

export default function ComparisonReportPage() {
  const data = useLiveQuery(async () => {
    const [species, batches, stockings, transfers, mortalities, harvests, samplings] = await Promise.all([
      db.species.toArray(),
      db.fishBatches.toArray(),
      db.stockings.toArray(),
      db.fishTransfers.toArray(),
      db.mortalityRecords.toArray(),
      db.harvests.toArray(),
      db.samplings.toArray(),
    ]);

    const activeBatches = batches.filter((b) => !b.deletedAt);
    const activeSpecies = species.filter((s) => !s.deletedAt);
    const economics = await Promise.all(activeBatches.map((b) => getBatchEconomicsSummary(b.id)));
    const economicsRows: EconomicsReportRow[] = economics.map((e, index) => ({
      ...e,
      batchCode: activeBatches[index].code,
      speciesId: activeBatches[index].speciesId,
      speciesName: activeSpecies.find((s) => s.id === activeBatches[index].speciesId)?.commonName ?? "—",
    }));

    const production = buildProductionReport({
      batches: activeBatches,
      species: activeSpecies,
      stockings,
      transfers,
      mortalities: mortalities.filter((m) => !m.deletedAt),
      harvests: harvests.filter((h) => !h.deletedAt),
      samplings: samplings.filter((s) => !s.deletedAt),
      filters: {},
    });

    return {
      byBatch: buildBatchComparison(production.rows, economicsRows),
      bySpecies: buildSpeciesComparison(production.rows, economicsRows),
    };
  }, []);

  const byBatch = useMemo(() => data?.byBatch ?? [], [data]);
  const bySpecies = useMemo(() => data?.bySpecies ?? [], [data]);

  return (
    <div className="flex flex-col gap-6">
      <PrintableReportHeader title="Comparación por lote/especie" />
      <div className="flex items-center justify-between gap-2">
        <div>
          <Link href="/informes" className="text-sm text-emerald-700 dark:text-emerald-400">
            ← Informes
          </Link>
          <h2 className="mt-1 text-base font-semibold text-zinc-700 dark:text-zinc-300">
            Comparación por lote y especie
          </h2>
        </div>
        <PrintButton />
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Por lote</h3>
          <CsvExportButton
            filename="comparacion-lotes.csv"
            rows={byBatch}
            columns={[
              { key: "batchCode", label: "Lote", value: (r) => r.batchCode },
              { key: "speciesName", label: "Especie", value: (r) => r.speciesName },
              { key: "survivalPercent", label: "Supervivencia %", value: (r) => (r.survivalPercent != null ? r.survivalPercent.toFixed(2) : "") },
              { key: "harvestedWeightKgTotal", label: "Kg cosechados", value: (r) => r.harvestedWeightKgTotal.toFixed(2) },
              { key: "costPerKg", label: "Costo/kg", value: (r) => (r.costPerKg != null ? r.costPerKg.toFixed(2) : "") },
              { key: "incomeTotal", label: "Ingresos", value: (r) => r.incomeTotal.toFixed(2) },
              { key: "profit", label: "Ganancia", value: (r) => r.profit.toFixed(2) },
              { key: "marginPercent", label: "Margen %", value: (r) => (r.marginPercent != null ? r.marginPercent.toFixed(2) : "") },
            ]}
          />
        </div>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2">Lote</th>
                <th className="px-3 py-2">Especie</th>
                <th className="px-3 py-2 text-right">Supervivencia</th>
                <th className="px-3 py-2 text-right">Kg cosechados</th>
                <th className="px-3 py-2 text-right">Costo/kg</th>
                <th className="px-3 py-2 text-right">Margen</th>
              </tr>
            </thead>
            <tbody>
              {byBatch.map((r) => (
                <tr key={r.batchId} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-3 py-2 font-medium">{r.batchCode}</td>
                  <td className="px-3 py-2">{r.speciesName}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.survivalPercent != null ? formatPercent(r.survivalPercent) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatKg(r.harvestedWeightKgTotal)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.costPerKg != null ? formatMoney(r.costPerKg) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.marginPercent != null ? formatPercent(r.marginPercent) : "—"}
                  </td>
                </tr>
              ))}
              {byBatch.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-zinc-500 dark:text-zinc-400">
                    Sin lotes registrados todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Por especie</h3>
          <CsvExportButton
            filename="comparacion-especies.csv"
            rows={bySpecies}
            columns={[
              { key: "speciesName", label: "Especie", value: (r) => r.speciesName },
              { key: "batchCount", label: "Lotes", value: (r) => r.batchCount },
              { key: "survivalPercent", label: "Supervivencia %", value: (r) => (r.survivalPercent != null ? r.survivalPercent.toFixed(2) : "") },
              { key: "harvestedWeightKgTotal", label: "Kg cosechados", value: (r) => r.harvestedWeightKgTotal.toFixed(2) },
              { key: "costPerKg", label: "Costo/kg", value: (r) => (r.costPerKg != null ? r.costPerKg.toFixed(2) : "") },
              { key: "incomeTotal", label: "Ingresos", value: (r) => r.incomeTotal.toFixed(2) },
              { key: "profit", label: "Ganancia", value: (r) => r.profit.toFixed(2) },
              { key: "marginPercent", label: "Margen %", value: (r) => (r.marginPercent != null ? r.marginPercent.toFixed(2) : "") },
            ]}
          />
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Supervivencia, costo/kg y margen agregados por razón-de-sumas (§ regla crítica de Fase 6) — nunca
          el promedio de los valores ya calculados por lote.
        </p>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2">Especie</th>
                <th className="px-3 py-2 text-right">Lotes</th>
                <th className="px-3 py-2 text-right">Supervivencia</th>
                <th className="px-3 py-2 text-right">Kg cosechados</th>
                <th className="px-3 py-2 text-right">Costo/kg</th>
                <th className="px-3 py-2 text-right">Margen</th>
              </tr>
            </thead>
            <tbody>
              {bySpecies.map((r) => (
                <tr key={r.speciesId} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-3 py-2 font-medium">{r.speciesName}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.batchCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.survivalPercent != null ? formatPercent(r.survivalPercent) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatKg(r.harvestedWeightKgTotal)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.costPerKg != null ? formatMoney(r.costPerKg) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.marginPercent != null ? formatPercent(r.marginPercent) : "—"}
                  </td>
                </tr>
              ))}
              {bySpecies.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-zinc-500 dark:text-zinc-400">
                    Sin especies con lotes registrados todavía.
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
