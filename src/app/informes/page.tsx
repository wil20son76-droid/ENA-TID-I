"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { db } from "@/lib/db/schema";
import { getBatchEconomicsSummary } from "@/lib/db/repositories/batchEconomicsRepository";
import type { AnalyticsFilters } from "@/lib/analytics/filters";
import {
  buildEconomicsReport,
  buildFeedingReport,
  buildHarvestReport,
  buildMortalityReport,
  buildProductionReport,
  buildSalesReport,
  type EconomicsReportRow,
} from "@/lib/analytics/reports";
import { formatCount, formatKg, formatPercent } from "@/lib/domain/format";
import { formatMoney } from "@/lib/domain/money";
import { LineChart } from "@/components/charts/LineChart";
import { BarChart } from "@/components/charts/BarChart";
import { ReportFilterBar } from "@/components/analytics/ReportFilterBar";
import { KpiCard } from "@/components/analytics/KpiCard";
import { PrintButton } from "@/components/analytics/PrintButton";
import { PrintableReportHeader } from "@/components/analytics/PrintableReportHeader";

const REPORT_LINKS = [
  { href: "/informes/produccion", label: "Producción", icon: "📈" },
  { href: "/informes/mortalidad", label: "Mortalidad", icon: "💀" },
  { href: "/informes/alimentacion", label: "Alimentación", icon: "🍽️" },
  { href: "/informes/inventario", label: "Inventario", icon: "📦" },
  { href: "/informes/agua", label: "Calidad del agua", icon: "💧" },
  { href: "/informes/cosechas", label: "Cosechas", icon: "🎣" },
  { href: "/informes/ventas", label: "Ventas", icon: "💵" },
  { href: "/informes/economia", label: "Economía", icon: "💰" },
  { href: "/informes/comparacion", label: "Comparación por lote/especie", icon: "⚖️" },
] as const;

export default function AnalyticsDashboardPage() {
  const [filters, setFilters] = useState<AnalyticsFilters>({});

  const data = useLiveQuery(async () => {
    const [
      species,
      batches,
      ponds,
      stockings,
      transfers,
      mortalities,
      harvests,
      samplings,
      feedings,
      feeds,
      saleLines,
      sales,
      customers,
    ] = await Promise.all([
      db.species.toArray(),
      db.fishBatches.toArray(),
      db.ponds.toArray(),
      db.stockings.toArray(),
      db.fishTransfers.toArray(),
      db.mortalityRecords.toArray(),
      db.harvests.toArray(),
      db.samplings.toArray(),
      db.feedingRecords.toArray(),
      db.feeds.toArray(),
      db.saleLines.toArray(),
      db.sales.toArray(),
      db.customers.toArray(),
    ]);

    const activeBatches = batches.filter((b) => !b.deletedAt);
    const economics = await Promise.all(activeBatches.map((b) => getBatchEconomicsSummary(b.id)));
    const economicsRows: EconomicsReportRow[] = economics.map((e, index) => ({
      ...e,
      batchCode: activeBatches[index].code,
      speciesId: activeBatches[index].speciesId,
      speciesName: species.find((s) => s.id === activeBatches[index].speciesId)?.commonName ?? "—",
    }));

    return {
      species: species.filter((s) => !s.deletedAt),
      batches: activeBatches,
      ponds: ponds.filter((p) => !p.deletedAt),
      stockings,
      transfers,
      mortalities: mortalities.filter((m) => !m.deletedAt),
      harvests: harvests.filter((h) => !h.deletedAt),
      samplings: samplings.filter((s) => !s.deletedAt),
      feedings: feedings.filter((f) => !f.deletedAt),
      feeds: feeds.filter((f) => f.active && !f.deletedAt),
      saleLines: saleLines.filter((l) => !l.deletedAt),
      sales: sales.filter((s) => !s.deletedAt),
      customers: customers.filter((c) => !c.deletedAt),
      economicsRows,
    };
  }, []);

  const production = useMemo(() => {
    if (!data) return null;
    return buildProductionReport({
      batches: data.batches,
      species: data.species,
      stockings: data.stockings,
      transfers: data.transfers,
      mortalities: data.mortalities,
      harvests: data.harvests,
      samplings: data.samplings,
      filters,
    });
  }, [data, filters]);

  const mortality = useMemo(() => {
    if (!data) return null;
    return buildMortalityReport({ mortalities: data.mortalities, batches: data.batches, filters });
  }, [data, filters]);

  const feeding = useMemo(() => {
    if (!data || !production) return null;
    const livingQuantityByBatch = new Map(production.rows.map((r) => [r.batchId, r.currentLiving]));
    return buildFeedingReport({
      feedings: data.feedings,
      feeds: data.feeds,
      batches: data.batches,
      samplings: data.samplings,
      filters,
      livingQuantityByBatch,
    });
  }, [data, production, filters]);

  const harvest = useMemo(() => {
    if (!data) return null;
    return buildHarvestReport({ harvests: data.harvests, batches: data.batches, species: data.species, filters });
  }, [data, filters]);

  const sales = useMemo(() => {
    if (!data) return null;
    return buildSalesReport({
      sales: data.sales,
      saleLines: data.saleLines,
      customers: data.customers,
      batches: data.batches,
      filters,
    });
  }, [data, filters]);

  const economics = useMemo(() => {
    if (!data) return null;
    const scoped = data.economicsRows.filter((row) => {
      if (filters.batchId && row.batchId !== filters.batchId) return false;
      if (filters.speciesId && row.speciesId !== filters.speciesId) return false;
      return true;
    });
    return buildEconomicsReport(scoped);
  }, [data, filters]);

  return (
    <div className="flex flex-col gap-6">
      <PrintableReportHeader title="Panel de informes" />
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">
            Informes y analítica
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Todos los KPIs se calculan sin conexión, a partir del historial ya sincronizado en este
            dispositivo.
          </p>
        </div>
        <PrintButton />
      </div>

      <ReportFilterBar
        filters={filters}
        onChange={setFilters}
        species={data?.species ?? []}
        batches={data?.batches ?? []}
        ponds={data?.ponds ?? []}
      />

      <div className="grid grid-cols-2 gap-3">
        <KpiCard
          label="Supervivencia"
          value={production?.totals.survivalPercent != null ? formatPercent(production.totals.survivalPercent) : "—"}
          hint="Agregada: Σ vivos / Σ sembrados"
        />
        <KpiCard
          label="FCR estimado"
          value={
            feeding?.fcrEstimate
              ? `${feeding.fcrEstimate.fcr.toLocaleString("es", { maximumFractionDigits: 2 })} (estimado)`
              : "Datos insuficientes"
          }
        />
        <KpiCard
          label="Costo/kg"
          value={economics?.totals.costPerKg != null ? formatMoney(economics.totals.costPerKg) : "Datos insuficientes"}
        />
        <KpiCard
          label="Precio medio/kg"
          value={sales?.averagePricePerKg != null ? formatMoney(sales.averagePricePerKg) : "Datos insuficientes"}
        />
        <KpiCard label="Ingresos" value={economics ? formatMoney(economics.totals.incomeTotal) : "—"} />
        <KpiCard
          label="Ganancia"
          value={economics ? formatMoney(economics.totals.profit) : "—"}
        />
        <KpiCard
          label="Margen"
          value={economics?.totals.marginPercent != null ? formatPercent(economics.totals.marginPercent) : "Datos insuficientes"}
        />
        <KpiCard label="Kg cosechados" value={harvest ? formatKg(harvest.totalWeightKgInPeriod) : "—"} />
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Peso promedio (muestreos)</h3>
        <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <LineChart
            data={(production?.weightTrend ?? []).map((p) => ({ label: p.month, value: p.value }))}
            ariaLabel="Peso promedio por mes"
            valueFormatter={(v) => `${v.toLocaleString("es", { maximumFractionDigits: 0 })} g`}
          />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Mortalidad por mes</h3>
        <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <BarChart
            data={(mortality?.byMonth ?? []).map((p) => ({ label: p.month, value: p.value }))}
            ariaLabel="Mortalidad por mes"
            valueFormatter={(v) => formatCount(v)}
          />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Alimento consumido por mes</h3>
        <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <BarChart
            data={(feeding?.byMonth ?? []).map((p) => ({ label: p.month, value: p.value }))}
            ariaLabel="Alimento consumido por mes"
            valueFormatter={(v) => formatKg(v)}
          />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Ventas por mes</h3>
        <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <LineChart
            data={(sales?.byMonth ?? []).map((p) => ({ label: p.month, value: p.value }))}
            ariaLabel="Ingresos por ventas por mes"
            valueFormatter={(v) => formatMoney(v)}
          />
        </div>
      </section>

      <section className="flex flex-col gap-2 print:hidden">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Informes detallados</h3>
        <div className="grid grid-cols-2 gap-2">
          {REPORT_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm font-medium transition-colors hover:border-emerald-300 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <span aria-hidden="true">{link.icon}</span>
              {link.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
