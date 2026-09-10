"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { db } from "@/lib/db/schema";
import type { AnalyticsFilters } from "@/lib/analytics/filters";
import { buildSalesReport } from "@/lib/analytics/reports";
import { formatKg } from "@/lib/domain/format";
import { formatMoney } from "@/lib/domain/money";
import { LineChart } from "@/components/charts/LineChart";
import { BarChart } from "@/components/charts/BarChart";
import { ReportFilterBar } from "@/components/analytics/ReportFilterBar";
import { KpiCard } from "@/components/analytics/KpiCard";
import { CsvExportButton } from "@/components/analytics/CsvExportButton";
import { PrintButton } from "@/components/analytics/PrintButton";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("es", { dateStyle: "short" }).format(new Date(iso));
}

export default function SalesReportPage() {
  const [filters, setFilters] = useState<AnalyticsFilters>({});

  const data = useLiveQuery(async () => {
    const [species, batches, ponds, sales, saleLines, customers] = await Promise.all([
      db.species.toArray(),
      db.fishBatches.toArray(),
      db.ponds.toArray(),
      db.sales.toArray(),
      db.saleLines.toArray(),
      db.customers.toArray(),
    ]);
    return {
      species: species.filter((s) => !s.deletedAt),
      batches: batches.filter((b) => !b.deletedAt),
      ponds: ponds.filter((p) => !p.deletedAt),
      sales: sales.filter((s) => !s.deletedAt),
      saleLines: saleLines.filter((l) => !l.deletedAt),
      customers: customers.filter((c) => !c.deletedAt),
    };
  }, []);

  const report = useMemo(() => {
    if (!data) return null;
    return buildSalesReport({
      sales: data.sales,
      saleLines: data.saleLines,
      customers: data.customers,
      batches: data.batches,
      filters,
    });
  }, [data, filters]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Link href="/informes" className="text-sm text-emerald-700 dark:text-emerald-400">
            ← Informes
          </Link>
          <h2 className="mt-1 text-base font-semibold text-zinc-700 dark:text-zinc-300">Ventas</h2>
        </div>
        <div className="flex gap-2">
          <CsvExportButton
            filename="ventas.csv"
            rows={report?.rows ?? []}
            columns={[
              { key: "date", label: "Fecha", value: (r) => formatDate(r.date) },
              {
                key: "customerId",
                label: "Cliente",
                value: (r) =>
                  r.customerId ? data?.customers.find((c) => c.id === r.customerId)?.name ?? r.customerId : "Externa",
              },
              { key: "batchCodes", label: "Lotes", value: (r) => r.batchCodes },
              { key: "totalAmount", label: "Total", value: (r) => r.totalAmount.toFixed(2) },
              { key: "amountPaid", label: "Pagado", value: (r) => r.amountPaid.toFixed(2) },
              { key: "paymentStatus", label: "Estado de pago", value: (r) => r.paymentStatus },
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
        <KpiCard label="Ingresos en el período" value={report ? formatMoney(report.totalRevenueInPeriod) : "—"} />
        <KpiCard label="Kg vendidos" value={report ? formatKg(report.totalKgInPeriod) : "—"} />
        <KpiCard
          label="Precio medio/kg"
          value={report?.averagePricePerKg != null ? formatMoney(report.averagePricePerKg) : "Datos insuficientes"}
          hint="Σ(kg×precio) / Σkg, nunca el promedio simple de precios"
        />
        <KpiCard label="Pagos pendientes" value={report ? formatMoney(report.pendingPaymentsTotal) : "—"} />
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Ingresos por mes</h3>
        <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <LineChart
            data={report?.byMonth.map((p) => ({ label: p.month, value: p.value })) ?? []}
            ariaLabel="Ingresos por ventas por mes"
            valueFormatter={(v) => formatMoney(v)}
          />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Por cliente</h3>
        <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <BarChart
            data={report?.byCustomer.map((c) => ({ label: c.customerName, value: c.totalAmount })) ?? []}
            ariaLabel="Ingresos por cliente"
            valueFormatter={(v) => formatMoney(v)}
          />
        </div>
      </section>
    </div>
  );
}
