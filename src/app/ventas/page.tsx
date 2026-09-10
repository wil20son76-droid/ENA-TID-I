"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { formatMoney } from "@/lib/domain/money";
import { db } from "@/lib/db/schema";
import { listSales } from "@/lib/db/repositories/saleRepository";
import type { PaymentStatus } from "@/lib/db/types";

const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING: "Pendiente",
  PARTIAL: "Parcial",
  PAID: "Pagado",
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("es", { dateStyle: "short" }).format(new Date(iso));
}

export default function SalesPage() {
  const data = useLiveQuery(async () => {
    const [sales, saleLines, customers] = await Promise.all([
      listSales(),
      db.saleLines.toArray(),
      db.customers.toArray(),
    ]);
    return { sales, saleLines, customers };
  }, []);

  const sales = data?.sales ?? [];
  const customerById = new Map((data?.customers ?? []).map((c) => [c.id, c]));
  const kgBySaleId = new Map<string, number>();
  for (const line of data?.saleLines ?? []) {
    if (line.deletedAt) continue;
    kgBySaleId.set(line.saleId, (kgBySaleId.get(line.saleId) ?? 0) + line.weightKg);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">Ventas</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Ventas de pescado producido (§27-§32).
          </p>
        </div>
        <Link
          href="/ventas/nueva"
          className="shrink-0 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-800"
        >
          + Nueva venta
        </Link>
      </div>

      <ul className="flex flex-col gap-2">
        {sales.length === 0 && (
          <li className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            Todavía no hay ventas registradas.
          </li>
        )}
        {sales.map((sale) => {
          const outstanding = Math.max(0, sale.totalAmount - sale.amountPaid);
          return (
            <li
              key={sale.id}
              className="flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">
                  {sale.customerId
                    ? customerById.get(sale.customerId)?.name ?? "Cliente desconocido"
                    : "Venta externa"}
                </p>
                <span className="tabular-nums">{formatMoney(sale.totalAmount)}</span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {formatDate(sale.date)} · {(kgBySaleId.get(sale.id) ?? 0).toLocaleString("es")} kg ·{" "}
                {PAYMENT_STATUS_LABEL[sale.paymentStatus]}
                {outstanding > 0 && sale.paymentStatus !== "PAID"
                  ? ` (pendiente ${formatMoney(outstanding)})`
                  : ""}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
