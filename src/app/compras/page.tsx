"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { formatMoney } from "@/lib/domain/money";
import { db } from "@/lib/db/schema";
import { listPurchases } from "@/lib/db/repositories/purchaseRepository";
import type { PaymentStatus } from "@/lib/db/types";

const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING: "Pendiente",
  PARTIAL: "Parcial",
  PAID: "Pagado",
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("es", { dateStyle: "short" }).format(new Date(iso));
}

export default function PurchasesPage() {
  const data = useLiveQuery(async () => {
    const [purchases, suppliers] = await Promise.all([listPurchases(), db.suppliers.toArray()]);
    return { purchases, suppliers };
  }, []);

  const purchases = data?.purchases ?? [];
  const supplierById = new Map((data?.suppliers ?? []).map((s) => [s.id, s]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">Compras</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Alimento, alevines y otros insumos adquiridos (§8-§13).
          </p>
        </div>
        <Link
          href="/compras/nueva"
          className="shrink-0 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-800"
        >
          + Nueva compra
        </Link>
      </div>

      <ul className="flex flex-col gap-2">
        {purchases.length === 0 && (
          <li className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            Todavía no hay compras registradas.
          </li>
        )}
        {purchases.map((purchase) => (
          <li
            key={purchase.id}
            className="flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-center justify-between">
              <p className="font-medium">
                {purchase.supplierId
                  ? supplierById.get(purchase.supplierId)?.name ?? "Proveedor desconocido"
                  : "Sin proveedor"}
              </p>
              <span className="tabular-nums">{formatMoney(purchase.totalAmount)}</span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {formatDate(purchase.date)} · {PAYMENT_STATUS_LABEL[purchase.paymentStatus]}
              {purchase.referenceNumber ? ` · Ref. ${purchase.referenceNumber}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
