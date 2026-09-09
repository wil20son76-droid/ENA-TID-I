"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { db } from "@/lib/db/schema";
import { getBatchDistribution, getBatchHistory } from "@/lib/db/repositories/ledgerQueries";
import { createFishTransfer } from "@/lib/db/repositories/fishTransferRepository";

const STATUS_LABEL: Record<string, string> = {
  PLANNED: "Planeado",
  STOCKED: "Sembrado",
  GROWING: "En crecimiento",
  PRE_HARVEST: "Pre-cosecha",
  PARTIAL_HARVEST: "Cosecha parcial",
  HARVESTED: "Cosechado",
  CLOSED: "Cerrado",
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("es", { dateStyle: "short" }).format(new Date(iso));
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function TransferForm({
  batchId,
  distribution,
  ponds,
  onDone,
}: {
  batchId: string;
  distribution: Record<string, number>;
  ponds: Array<{ id: string; code: string; name: string }>;
  onDone: () => void;
}) {
  const originOptions = ponds.filter((p) => (distribution[p.id] ?? 0) > 0);
  const [fromPondId, setFromPondId] = useState(originOptions[0]?.id ?? "");
  const [toPondId, setToPondId] = useState("");
  const [date, setDate] = useState(todayIsoDate());
  const [quantity, setQuantity] = useState("");
  const [averageWeightG, setAverageWeightG] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = distribution[fromPondId] ?? 0;
  const quantityNumber = Number(quantity) || 0;
  const remaining = available - quantityNumber;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fromPondId || !toPondId) {
      setError("Selecciona el estanque de origen y el de destino.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await createFishTransfer({
        batchId,
        fromPondId,
        toPondId,
        date: new Date(date).toISOString(),
        quantity: quantityNumber,
        averageWeightG: averageWeightG ? Number(averageWeightG) : null,
        reason: reason.trim() || null,
        notes: notes.trim() || null,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar. Intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30"
    >
      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Origen</span>
          <select
            value={fromPondId}
            onChange={(event) => setFromPondId(event.target.value)}
            disabled={submitting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">Selecciona</option>
            {originOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} ({distribution[p.id]} disp.)
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Destino</span>
          <select
            value={toPondId}
            onChange={(event) => setToPondId(event.target.value)}
            disabled={submitting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">Selecciona</option>
            {ponds
              .filter((p) => p.id !== fromPondId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code}
                </option>
              ))}
          </select>
        </label>
      </div>

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
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Fecha</span>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            disabled={submitting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
      </div>

      {fromPondId && (
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Disponibles en origen: <span className="font-medium">{available}</span> · Trasladar:{" "}
          <span className="font-medium">{quantityNumber}</span> · Quedarán:{" "}
          <span className={`font-medium ${remaining < 0 ? "text-red-600" : ""}`}>{remaining}</span>
        </p>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-600 dark:text-zinc-400">Peso promedio (g, opcional)</span>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={averageWeightG}
          onChange={(event) => setAverageWeightG(event.target.value)}
          disabled={submitting}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-600 dark:text-zinc-400">Motivo (opcional)</span>
        <input
          type="text"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={submitting}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-600 dark:text-zinc-400">Notas (opcional)</span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          disabled={submitting}
          rows={2}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Confirmar traslado
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={submitting}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

export default function FishBatchDetailPage({ params }: PageProps<"/lotes/[id]">) {
  const { id } = use(params);

  const batch = useLiveQuery(() => db.fishBatches.get(id), [id]);
  const distribution = useLiveQuery(() => getBatchDistribution(id), [id]) ?? {};
  const history = useLiveQuery(() => getBatchHistory(id), [id]) ?? [];
  const species = useLiveQuery(() => db.species.toArray(), []) ?? [];
  const ponds = useLiveQuery(() => db.ponds.toArray(), []) ?? [];

  const [showTransferForm, setShowTransferForm] = useState(false);

  if (batch === undefined) {
    return <p className="text-sm text-zinc-500">Cargando…</p>;
  }
  if (batch === null || batch.deletedAt) {
    return <p className="text-sm text-zinc-500">Este lote no existe.</p>;
  }

  const speciesName = species.find((s) => s.id === batch.speciesId)?.commonName ?? "—";
  const pondById = new Map(ponds.map((p) => [p.id, p]));
  const totalNow = Object.values(distribution).reduce((sum, q) => sum + q, 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/lotes" className="text-sm text-emerald-700 dark:text-emerald-400">
          ← Lotes
        </Link>
        <div className="mt-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{batch.code}</h2>
          <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {STATUS_LABEL[batch.status] ?? batch.status}
          </span>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <span className="text-zinc-500">Especie</span>
        <span>{speciesName}</span>
        <span className="text-zinc-500">Siembra</span>
        <span>{formatDate(batch.initialStockingDate)}</span>
        <span className="text-zinc-500">Cantidad inicial</span>
        <span>{batch.initialQuantity.toLocaleString("es")} peces</span>
        <span className="text-zinc-500">Peso inicial</span>
        <span>{batch.initialAverageWeightG.toLocaleString("es")} g</span>
        <span className="text-zinc-500">Biomasa inicial</span>
        <span>{batch.initialBiomassKg.toLocaleString("es", { maximumFractionDigits: 3 })} kg</span>
        <span className="text-zinc-500">Peces actuales</span>
        <span className="font-medium">{totalNow.toLocaleString("es")}</span>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Distribución actual
          </h3>
          {!showTransferForm && totalNow > 0 && (
            <button
              type="button"
              onClick={() => setShowTransferForm(true)}
              className="rounded-full border border-emerald-600 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400"
            >
              Trasladar peces
            </button>
          )}
        </div>

        {showTransferForm && (
          <TransferForm
            batchId={id}
            distribution={distribution}
            ponds={ponds}
            onDone={() => setShowTransferForm(false)}
          />
        )}

        {Object.keys(distribution).length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700">
            Este lote no tiene peces en ningún estanque.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {Object.entries(distribution).map(([pondId, quantity]) => (
              <li
                key={pondId}
                className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <span>{pondById.get(pondId)?.code ?? pondId}</span>
                <span className="font-medium tabular-nums">
                  {quantity.toLocaleString("es")} peces
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Historial</h3>
        <ul className="flex flex-col gap-2 text-sm">
          {history.map((event) => (
            <li
              key={event.record.id}
              className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <span>
                {formatDate(event.date)} —{" "}
                {event.kind === "stocking"
                  ? `Siembra ${pondById.get(event.record.pondId)?.code ?? ""}`
                  : `Traslado ${pondById.get(event.record.fromPondId)?.code ?? "?"} → ${
                      pondById.get(event.record.toPondId)?.code ?? "?"
                    }`}
              </span>
              <span className="tabular-nums">
                {event.record.quantity.toLocaleString("es")} peces
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
