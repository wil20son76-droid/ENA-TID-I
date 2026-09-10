"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";

import { RequireCapability } from "@/components/auth/RequireCapability";
import { calculateBiomassKg } from "@/lib/domain/biomass";
import { db } from "@/lib/db/schema";
import { createFishBatchWithStocking } from "@/lib/db/repositories/fishBatchRepository";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function NewFishBatchPage() {
  const router = useRouter();
  const species = useLiveQuery(async () => {
    const all = await db.species.toArray();
    return all.filter((s) => s.active && !s.deletedAt).sort((a, b) => a.commonName.localeCompare(b.commonName, "es"));
  }, []) ?? [];
  const ponds = useLiveQuery(async () => {
    const all = await db.ponds.toArray();
    return all.filter((p) => !p.deletedAt).sort((a, b) => a.code.localeCompare(b.code, "es"));
  }, []) ?? [];

  const [speciesId, setSpeciesId] = useState("");
  const [pondId, setPondId] = useState("");
  const [date, setDate] = useState(todayIsoDate());
  const [quantity, setQuantity] = useState("");
  const [averageWeightG, setAverageWeightG] = useState("");
  const [fryCost, setFryCost] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const quantityNumber = Number(quantity);
  const weightNumber = Number(averageWeightG);
  const biomassPreview =
    quantity && averageWeightG && quantityNumber > 0 && weightNumber > 0
      ? calculateBiomassKg(quantityNumber, weightNumber)
      : null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!speciesId || !pondId) {
      setError("Selecciona la especie y el estanque.");
      return;
    }
    if (!quantityNumber || quantityNumber <= 0) {
      setError("La cantidad inicial debe ser mayor que cero.");
      return;
    }
    if (!weightNumber || weightNumber <= 0) {
      setError("El peso promedio inicial debe ser mayor que cero.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const { batch } = await createFishBatchWithStocking({
        speciesId,
        pondId,
        initialStockingDate: new Date(date).toISOString(),
        initialQuantity: quantityNumber,
        initialAverageWeightG: weightNumber,
        fryCost: fryCost ? Number(fryCost) : null,
        notes: notes.trim() || null,
      });
      router.push(`/lotes/${batch.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar. Intenta de nuevo.");
      setSubmitting(false);
    }
  }

  return (
    <RequireCapability capability="MANAGE_CATALOG">
    <div className="flex flex-col gap-6">
      <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">Nuevo lote</h2>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Especie</span>
          <select
            value={speciesId}
            onChange={(event) => setSpeciesId(event.target.value)}
            disabled={submitting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">Selecciona una especie</option>
            {species.map((s) => (
              <option key={s.id} value={s.id}>
                {s.commonName}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Estanque de siembra</span>
          <select
            value={pondId}
            onChange={(event) => setPondId(event.target.value)}
            disabled={submitting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">Selecciona un estanque</option>
            {ponds.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Fecha de siembra</span>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            disabled={submitting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <div className="flex gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Cantidad</span>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              placeholder="1000"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              disabled={submitting}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Peso prom. inicial (g)</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              placeholder="15"
              value={averageWeightG}
              onChange={(event) => setAverageWeightG(event.target.value)}
              disabled={submitting}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        </div>

        {biomassPreview !== null && (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Biomasa inicial:{" "}
            <span className="font-medium tabular-nums">
              {biomassPreview.toLocaleString("es", { maximumFractionDigits: 3 })} kg
            </span>
          </p>
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Costo de alevines (opcional)</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={fryCost}
            onChange={(event) => setFryCost(event.target.value)}
            disabled={submitting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Notas (opcional)</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={submitting}
            rows={2}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-emerald-700 px-5 py-3 text-base font-medium text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Sembrar lote
        </button>
      </form>
    </div>
    </RequireCapability>
  );
}
