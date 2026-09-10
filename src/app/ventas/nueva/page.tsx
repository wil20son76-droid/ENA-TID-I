"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";

import { RequireCapability } from "@/components/auth/RequireCapability";
import { db } from "@/lib/db/schema";
import { listActiveCustomers } from "@/lib/db/repositories/customerRepository";
import { getAvailableKgForHarvest, registerSale } from "@/lib/db/repositories/saleRepository";
import { formatMoney } from "@/lib/domain/money";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function NewSalePage() {
  const router = useRouter();
  const customers = useLiveQuery(() => listActiveCustomers(), []) ?? [];
  const batches = useLiveQuery(async () => {
    const all = await db.fishBatches.toArray();
    return all.filter((b) => !b.deletedAt).sort((a, b) => a.code.localeCompare(b.code, "es"));
  }, []) ?? [];

  const [customerId, setCustomerId] = useState("");
  const [date, setDate] = useState(todayIsoDate());
  const [batchId, setBatchId] = useState("");
  const [harvestId, setHarvestId] = useState("");
  const [quantityFish, setQuantityFish] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [pricePerKg, setPricePerKg] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const batchHarvests = useLiveQuery(async () => {
    if (!batchId) return [];
    const all = await db.harvests.where("batchId").equals(batchId).toArray();
    return all.filter((h) => !h.deletedAt).sort((a, b) => b.date.localeCompare(a.date));
  }, [batchId]) ?? [];

  const availableKg = useLiveQuery(
    () => (harvestId ? getAvailableKgForHarvest(harvestId) : Promise.resolve(null)),
    [harvestId],
  ) ?? null;

  const total = Number(weightKg || 0) * Number(pricePerKg || 0);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!batchId) {
      setError("Selecciona el lote de origen del pescado vendido.");
      return;
    }
    const weight = Number(weightKg);
    const price = Number(pricePerKg);
    if (!weight || weight <= 0) {
      setError("El peso vendido debe ser mayor que cero.");
      return;
    }
    if (!price || price <= 0) {
      setError("El precio por kg debe ser mayor que cero.");
      return;
    }

    const batch = batches.find((b) => b.id === batchId);

    setSubmitting(true);
    setError(null);
    try {
      await registerSale({
        customerId: customerId || null,
        date: new Date(date).toISOString(),
        notes: notes.trim() || null,
        lines: [
          {
            batchId,
            harvestId: harvestId || null,
            description: `Venta ${batch?.code ?? ""}`.trim(),
            quantityFish: quantityFish ? Number(quantityFish) : null,
            weightKg: weight,
            pricePerKg: price,
          },
        ],
      });
      router.push("/ventas");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar. Intenta de nuevo.");
      setSubmitting(false);
    }
  }

  return (
    <RequireCapability capability="MANAGE_ECONOMY">
    <div className="flex flex-col gap-6">
      <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">Nueva venta</h2>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Cliente (opcional)</span>
          <select
            value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}
            disabled={submitting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">Venta externa / sin cliente registrado</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Fecha</span>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            disabled={submitting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Lote de origen</span>
          <select
            value={batchId}
            onChange={(event) => {
              setBatchId(event.target.value);
              setHarvestId("");
            }}
            disabled={submitting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">Selecciona un lote</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Cosecha (opcional)</span>
          <select
            value={harvestId}
            onChange={(event) => setHarvestId(event.target.value)}
            disabled={submitting || !batchId}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900 disabled:opacity-50"
          >
            <option value="">Venta no reconciliada con una cosecha</option>
            {batchHarvests.map((h) => (
              <option key={h.id} value={h.id}>
                {new Intl.DateTimeFormat("es", { dateStyle: "short" }).format(new Date(h.date))} —{" "}
                {h.totalWeightKg.toLocaleString("es")} kg cosechados
              </option>
            ))}
          </select>
          {availableKg !== null && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Disponible de esta cosecha: {availableKg.toLocaleString("es")} kg
            </span>
          )}
        </label>

        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Peces (opcional)</span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              value={quantityFish}
              onChange={(event) => setQuantityFish(event.target.value)}
              disabled={submitting}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Kg vendidos</span>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={weightKg}
              onChange={(event) => setWeightKg(event.target.value)}
              disabled={submitting}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Precio/kg</span>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={pricePerKg}
              onChange={(event) => setPricePerKg(event.target.value)}
              disabled={submitting}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        </div>

        <p className="text-sm text-zinc-600 dark:text-zinc-400">Total: {formatMoney(total)}</p>

        {harvestId && weightKg && availableKg !== null && Number(weightKg) > availableKg && (
          <p className="text-sm text-red-600 dark:text-red-400">
            No hay suficiente peso disponible de esta cosecha. Disponible: {availableKg.toLocaleString("es")} kg.
          </p>
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Observación (opcional)</span>
          <input
            type="text"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={submitting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-emerald-700 px-5 py-3 text-base font-medium text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Guardar venta
        </button>
      </form>
    </div>
    </RequireCapability>
  );
}
