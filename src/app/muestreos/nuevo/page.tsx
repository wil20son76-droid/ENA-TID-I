"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";

import { formatG } from "@/lib/domain/format";
import { calculateSampleAverageWeightG } from "@/lib/domain/sampling";
import { db } from "@/lib/db/schema";
import { getPondOccupancy } from "@/lib/db/repositories/ledgerQueries";
import { createSampling } from "@/lib/db/repositories/samplingRepository";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function NewSamplingForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedPondId = searchParams.get("pondId") ?? "";
  const preselectedBatchId = searchParams.get("batchId") ?? "";

  const ponds = useLiveQuery(async () => {
    const all = await db.ponds.toArray();
    return all.filter((p) => !p.deletedAt).sort((a, b) => a.code.localeCompare(b.code, "es"));
  }, []) ?? [];

  const [pondId, setPondId] = useState(preselectedPondId);
  const [batchId, setBatchId] = useState(preselectedBatchId);
  const [date, setDate] = useState(todayIsoDate());
  const [sampleFishCount, setSampleFishCount] = useState("");
  const [totalSampleWeightKg, setTotalSampleWeightKg] = useState("");
  const [averageLengthCm, setAverageLengthCm] = useState("");
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

  const countNumber = Number(sampleFishCount);
  const weightNumber = Number(totalSampleWeightKg);
  const preview =
    sampleFishCount && totalSampleWeightKg && countNumber > 0 && weightNumber > 0
      ? calculateSampleAverageWeightG(countNumber, weightNumber)
      : null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pondId || !batchId) {
      setError("Selecciona el estanque y el lote.");
      return;
    }
    if (!countNumber || countNumber <= 0) {
      setError("El número de peces debe ser mayor que cero.");
      return;
    }
    if (!weightNumber || weightNumber <= 0) {
      setError("El peso total de la muestra debe ser mayor que cero.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await createSampling({
        batchId,
        pondId,
        date: new Date(date).toISOString(),
        sampleFishCount: countNumber,
        totalSampleWeightKg: weightNumber,
        averageLengthCm: averageLengthCm ? Number(averageLengthCm) : null,
        notes: notes.trim() || null,
      });
      router.push(`/lotes/${batchId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar. Intenta de nuevo.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">
        Registrar muestreo
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
        </label>

        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Número de peces</span>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              placeholder="30"
              value={sampleFishCount}
              onChange={(event) => setSampleFishCount(event.target.value)}
              disabled={submitting}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Peso total (kg)</span>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              placeholder="15.3"
              value={totalSampleWeightKg}
              onChange={(event) => setTotalSampleWeightKg(event.target.value)}
              disabled={submitting}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        </div>

        {preview !== null && (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Peso promedio: <span className="font-medium tabular-nums">{formatG(preview)}</span>
          </p>
        )}

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
          <span className="text-zinc-600 dark:text-zinc-400">Longitud promedio (cm, opcional)</span>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={averageLengthCm}
            onChange={(event) => setAverageLengthCm(event.target.value)}
            disabled={submitting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          />
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
          Guardar muestreo
        </button>
      </form>
    </div>
  );
}

export default function NewSamplingPage() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Cargando…</p>}>
      <NewSamplingForm />
    </Suspense>
  );
}
