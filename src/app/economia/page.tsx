"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { getBatchTotalBalance } from "@/lib/domain/batchLedger";
import { formatKg } from "@/lib/domain/format";
import { formatMoney } from "@/lib/domain/money";
import { getBatchEconomicsSummary } from "@/lib/db/repositories/batchEconomicsRepository";
import { db } from "@/lib/db/schema";

function isSameMonth(isoDateTime: string, reference: string): boolean {
  return isoDateTime.slice(0, 7) === reference.slice(0, 7);
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function StatCard({ label, value, href }: { label: string; value: string; href?: string }) {
  const content = (
    <div className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
    </div>
  );
  return href ? (
    <Link href={href} className="transition-colors hover:border-emerald-300">
      {content}
    </Link>
  ) : (
    content
  );
}

export default function EconomicsSummaryPage() {
  const data = useLiveQuery(async () => {
    const today = todayIsoDate();
    const [purchases, expenses, sales, saleLines, harvests, batches, stockings, transfers, mortalities] =
      await Promise.all([
        db.purchases.toArray(),
        db.expenses.toArray(),
        db.sales.toArray(),
        db.saleLines.toArray(),
        db.harvests.toArray(),
        db.fishBatches.toArray(),
        db.stockings.toArray(),
        db.fishTransfers.toArray(),
        db.mortalityRecords.toArray(),
      ]);

    const activePurchases = purchases.filter((p) => !p.deletedAt);
    const purchasesThisMonth = activePurchases
      .filter((p) => isSameMonth(p.date, today))
      .reduce((sum, p) => sum + p.totalAmount, 0);

    const activeExpenses = expenses.filter((e) => !e.deletedAt);
    const expensesThisMonth = activeExpenses
      .filter((e) => isSameMonth(e.date, today))
      .reduce((sum, e) => sum + e.totalAmount, 0);
    const directExpensesThisMonth = activeExpenses
      .filter((e) => isSameMonth(e.date, today) && (e.batchId != null || e.pondId != null))
      .reduce((sum, e) => sum + e.totalAmount, 0);
    const generalExpensesThisMonth = expensesThisMonth - directExpensesThisMonth;

    const activeSales = sales.filter((s) => !s.deletedAt);
    const salesThisMonth = activeSales.filter((s) => isSameMonth(s.date, today));
    const kgBySaleId = new Map<string, number>();
    const amountBySaleId = new Map<string, number>();
    for (const line of saleLines) {
      if (line.deletedAt) continue;
      kgBySaleId.set(line.saleId, (kgBySaleId.get(line.saleId) ?? 0) + line.weightKg);
      amountBySaleId.set(line.saleId, (amountBySaleId.get(line.saleId) ?? 0) + line.totalAmount);
    }
    const salesThisMonthTotal = salesThisMonth.reduce(
      (sum, s) => sum + (amountBySaleId.get(s.id) ?? s.totalAmount),
      0,
    );
    const pendingIncomeTotal = activeSales
      .filter((s) => s.paymentStatus !== "PAID")
      .reduce((sum, s) => sum + Math.max(0, s.totalAmount - s.amountPaid), 0);

    const activeHarvests = harvests.filter((h) => !h.deletedAt);
    const harvestedKgThisMonth = activeHarvests
      .filter((h) => isSameMonth(h.date, today))
      .reduce((sum, h) => sum + h.totalWeightKg, 0);

    // Márgenes por lote cerrado (§43): un lote se considera "cerrado" para
    // este resumen cuando ya no tiene peces vivos en ningún estanque —
    // derivado del ledger, nunca de un estado guardado (§25).
    const activeBatches = batches.filter((b) => !b.deletedAt);
    const closedBatchSummaries = [];
    for (const batch of activeBatches) {
      const stockedTotal = stockings
        .filter((s) => s.batchId === batch.id)
        .reduce((sum, s) => sum + s.quantity, 0);
      if (stockedTotal === 0) continue;
      const batchHarvests = activeHarvests.filter((h) => h.batchId === batch.id);
      const totalLiving = getBatchTotalBalance(
        stockings.filter((s) => s.batchId === batch.id),
        transfers.filter((t) => t.batchId === batch.id),
        mortalities.filter((m) => m.batchId === batch.id),
        batchHarvests,
        batch.id,
      );
      if (totalLiving > 0) continue; // sigue activo: no entra en "lotes cerrados"
      if (batchHarvests.length === 0) continue; // nunca se cosechó nada, no hay margen que mostrar

      const economics = await getBatchEconomicsSummary(batch.id);
      closedBatchSummaries.push({ batch, economics });
    }

    return {
      purchasesThisMonth,
      expensesThisMonth,
      directExpensesThisMonth,
      generalExpensesThisMonth,
      salesThisMonthTotal,
      pendingIncomeTotal,
      harvestedKgThisMonth,
      closedBatchSummaries,
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">Economía</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Resumen general del mes en curso. No sustituye un balance contable completo (§76).
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Compras del mes" value={formatMoney(data?.purchasesThisMonth ?? 0)} href="/compras" />
        <StatCard label="Gastos del mes" value={formatMoney(data?.expensesThisMonth ?? 0)} href="/gastos" />
        <StatCard label="Ventas del mes" value={formatMoney(data?.salesThisMonthTotal ?? 0)} href="/ventas" />
        <StatCard label="Ingresos pendientes" value={formatMoney(data?.pendingIncomeTotal ?? 0)} href="/ventas" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Costos directos del mes" value={formatMoney(data?.directExpensesThisMonth ?? 0)} />
        <StatCard label="Gastos generales no asignados" value={formatMoney(data?.generalExpensesThisMonth ?? 0)} />
        <StatCard label="Producción cosechada (mes)" value={formatKg(data?.harvestedKgThisMonth ?? 0)} href="/cosechas" />
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/proveedores"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
        >
          Proveedores
        </Link>
        <Link
          href="/clientes"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
        >
          Clientes
        </Link>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Margen por lotes cerrados
        </h3>
        {(data?.closedBatchSummaries?.length ?? 0) === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            Todavía no hay lotes cerrados (sin peces vivos y con cosecha registrada).
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data?.closedBatchSummaries.map(({ batch, economics }) => (
              <li
                key={batch.id}
                className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div>
                  <p className="font-medium">{batch.code}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Ingresos {formatMoney(economics.incomeTotal)} · Costo directo{" "}
                    {formatMoney(economics.directCostTotal)}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`font-semibold ${economics.profit >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                    {formatMoney(economics.profit)}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {economics.marginPercent != null
                      ? `${economics.marginPercent.toLocaleString("es", { maximumFractionDigits: 1 })}%`
                      : "Sin ingresos"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
