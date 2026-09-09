"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";

import { formatKg } from "@/lib/domain/format";
import { getFeedStock } from "@/lib/domain/feedLedger";
import type { FeedingShift } from "@/lib/db/types";
import { FEEDING_SHIFT_LABEL } from "@/lib/labels";
import { db } from "@/lib/db/schema";
import { getPondOccupancy } from "@/lib/db/repositories/ledgerQueries";
import { createFeedingWithConsumption } from "@/lib/db/repositories/feedingRepository";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function NewFeedingForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedPondId = searchParams.get("pondId") ?? "";

  const ponds = useLiveQuery(async () => {
    const all = await db.ponds.toArray();
    return all.filter((p) => !p.deletedAt).sort((a, b) => a.code.localeCompare(b.code, "es"));
  }, []) ?? [];
  const feeds = useLiveQuery(async () => {
    const all = await db.feeds.toArray();
    return all.filter((f) => f.active && !f.deletedAt).sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, []) ?? [];

  const [pondId, setPondId] = useState(preselectedPondId);
  const [batchId, setBatchId] = useState("");
  const [feedId, setFeedId] = useState("");
  const [date, setDate] = useState(todayIsoDate());
  const [time, setTime] = useState("");
  const [quantityKg, setQuantityKg] = useState("");
  const [shift, setShift] = useState<FeedingShift | "">("");
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

  const feedStock = useLiveQuery(async () => {
    if (!feedId) return null;
    const movements = await db.feedInventoryMovements.where("feedId").equals(feedId).toArray();
    return getFeedStock(movements, feedId);
  }, [feedId]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pondId || !batchId || !feedId) {
      setError("Selecciona estanque, lote y alimento.");
      return;
    }
    const quantityNumber = Number(quantityKg);
    if (!quantityNumber || quantityNumber <= 0) {
      setError("La cantidad debe ser mayor que cero.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await createFeedingWithConsumption({
        batchId,
        pondId,
        feedId,
        date: new Date(date).toISOString(),
        time: time || null,
        quantityKg: quantityNumber,
        shift: shift || null,
        notes: notes.trim() || null,
      });
      router.push("/alimentacion");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar. Intenta de nuevo.");
      setSubmitting(false);
    }
  }

  const selectedPondFishCount = batchId ? occupancy[batchId] ?? 0 : null;

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">
        Registrar alimentación
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
              {pondId ? "Selecciona un lote" : "Elige primero el paso anterior"}
            </option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code}
              </option>
            ))}
          </select>
          {selectedPondFishCount !== null && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Peces presentes: {selectedPondFishCount.toLocaleString("es")}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Alimento</span>
          <select
            value={feedId}
            onChange={(event) => setFeedId(event.target.value)}
            disabled={submitting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">Selecciona un alimento</option>
            {feeds.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          {feedId && feedStock !== null && feedStock !== undefined && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Stock disponible: {formatKg(feedStock)}
            </span>
          )}
        </label>

        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Cantidad (kg)</span>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              placeholder="18"
              value={quantityKg}
              onChange={(event) => setQuantityKg(event.target.value)}
              disabled={submitting}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Turno (opcional)</span>
            <select
              value={shift}
              onChange={(event) => setShift(event.target.value as FeedingShift | "")}
              disabled={submitting}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="">—</option>
              {(Object.keys(FEEDING_SHIFT_LABEL) as FeedingShift[]).map((key) => (
                <option key={key} value={key}>
                  {FEEDING_SHIFT_LABEL[key]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex gap-2">
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
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Hora (opcional)</span>
            <input
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              disabled={submitting}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        </div>

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
          Guardar alimentación
        </button>
      </form>
    </div>
  );
}

export default function NewFeedingPage() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Cargando…</p>}>
      <NewFeedingForm />
    </Suspense>
  );
}
