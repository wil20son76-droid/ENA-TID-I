"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";

import type { MortalityCause } from "@/lib/db/types";
import { MORTALITY_CAUSE_LABEL } from "@/lib/labels";
import { db } from "@/lib/db/schema";
import { getPondOccupancy } from "@/lib/db/repositories/ledgerQueries";
import { createMortality } from "@/lib/db/repositories/mortalityRepository";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function NewMortalityForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedPondId = searchParams.get("pondId") ?? "";

  const ponds = useLiveQuery(async () => {
    const all = await db.ponds.toArray();
    return all.filter((p) => !p.deletedAt).sort((a, b) => a.code.localeCompare(b.code, "es"));
  }, []) ?? [];

  const [pondId, setPondId] = useState(preselectedPondId);
  const [batchId, setBatchId] = useState("");
  const [date, setDate] = useState(todayIsoDate());
  const [quantity, setQuantity] = useState("");
  const [cause, setCause] = useState<MortalityCause>("UNKNOWN");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const occupancy = useLiveQuery(
    () => (pondId ? getPondOccupancy(pondId) : Promise.resolve({} as Record<string, number>)),
    [pondId],
  ) ?? {};
  const batches = useLiveQuery(async () => {
    const ids = Object.keys(occupancy);
    if (ids.length === 0) return [];
    const all = await db.fishBatches.where("id").anyOf(ids).toArray();
    return all.sort((a, b) => a.code.localeCompare(b.code, "es"));
  }, [occupancy]) ?? [];

  const available = batchId ? occupancy[batchId] ?? 0 : null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pondId || !batchId) {
      setError("Selecciona el estanque y el lote.");
      return;
    }
    const quantityNumber = Number(quantity);
    if (!quantityNumber || quantityNumber <= 0) {
      setError("La cantidad debe ser mayor que cero.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await createMortality({
        batchId,
        pondId,
        date: new Date(date).toISOString(),
        quantity: quantityNumber,
        cause,
        notes: notes.trim() || null,
      });
      router.push("/mortalidad");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar. Intenta de nuevo.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">
        Registrar mortalidad
      </h2>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Estanque</span>
          <select
            value={pondId}
            onChange={(event) => {
              setPondId(event.target.value);
              setBatchId("");
            }}
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
          <span className="text-zinc-600 dark:text-zinc-400">Lote</span>
          <select
            value={batchId}
            onChange={(event) => setBatchId(event.target.value)}
            disabled={submitting || !pondId}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900 disabled:opacity-50"
          >
            <option value="">
              {pondId ? "Selecciona un lote" : "Primero selecciona un estanque"}
            </option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code}
              </option>
            ))}
          </select>
          {available !== null && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Disponibles: {available.toLocaleString("es")}
            </span>
          )}
        </label>

        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Cantidad</span>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              disabled={submitting}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Fecha</span>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              disabled={submitting}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        </div>

        {quantity && available !== null && Number(quantity) > available && (
          <p className="text-sm text-red-600 dark:text-red-400">
            Quedarán: {available - Number(quantity)} — no hay suficientes peces disponibles.
          </p>
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Causa</span>
          <select
            value={cause}
            onChange={(event) => setCause(event.target.value as MortalityCause)}
            disabled={submitting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {(Object.keys(MORTALITY_CAUSE_LABEL) as MortalityCause[]).map((key) => (
              <option key={key} value={key}>
                {MORTALITY_CAUSE_LABEL[key]}
              </option>
            ))}
          </select>
        </label>

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
          Guardar mortalidad
        </button>
      </form>
    </div>
  );
}

export default function NewMortalityPage() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Cargando…</p>}>
      <NewMortalityForm />
    </Suspense>
  );
}
