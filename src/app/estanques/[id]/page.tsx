"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { PondGeometryFields } from "@/components/ponds/PondGeometryFields";
import { db } from "@/lib/db/schema";
import { getPondHistory, getPondOccupancy } from "@/lib/db/repositories/ledgerQueries";
import { updatePond } from "@/lib/db/repositories/pondRepository";
import { applyPondGeometryPatch, resetToCalculated, type PondGeometryState } from "@/lib/domain/pondGeometry";

const STATUS_LABEL: Record<string, string> = {
  EMPTY: "Vacío",
  PREPARATION: "En preparación",
  ACTIVE: "Activo",
  HARVEST: "En cosecha",
  CLEANING: "En limpieza",
  MAINTENANCE: "En mantenimiento",
};

function formatNumber(value: number | null, unit: string): string {
  if (value === null) return "—";
  return `${value.toLocaleString("es")} ${unit}`;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("es", { dateStyle: "short" }).format(new Date(iso));
}

export default function PondDetailPage({ params }: PageProps<"/estanques/[id]">) {
  const { id } = use(params);

  const pond = useLiveQuery(() => db.ponds.get(id), [id]);
  const occupancy = useLiveQuery(() => getPondOccupancy(id), [id]) ?? {};
  const history = useLiveQuery(() => getPondHistory(id), [id]) ?? [];
  const batches = useLiveQuery(() => db.fishBatches.toArray(), []) ?? [];
  const species = useLiveQuery(() => db.species.toArray(), []) ?? [];

  const [editing, setEditing] = useState(false);
  const [geometry, setGeometry] = useState<PondGeometryState | null>(null);
  const [saving, setSaving] = useState(false);

  if (pond === undefined) {
    return <p className="text-sm text-zinc-500">Cargando…</p>;
  }
  if (pond === null || (pond && pond.deletedAt)) {
    return <p className="text-sm text-zinc-500">Este estanque no existe.</p>;
  }

  const batchById = new Map(batches.map((b) => [b.id, b]));
  const speciesById = new Map(species.map((s) => [s.id, s]));

  function startEditing() {
    setGeometry({
      lengthM: pond!.lengthM,
      widthM: pond!.widthM,
      averageDepthM: pond!.averageDepthM,
      areaM2: pond!.areaM2,
      areaSource: pond!.areaSource,
      estimatedVolumeM3: pond!.estimatedVolumeM3,
      volumeSource: pond!.volumeSource,
    });
    setEditing(true);
  }

  async function saveGeometry() {
    if (!geometry) return;
    setSaving(true);
    try {
      await updatePond(id, geometry);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/estanques" className="text-sm text-emerald-700 dark:text-emerald-400">
          ← Estanques
        </Link>
        <div className="mt-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {pond.code} — {pond.name}
          </h2>
          <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {STATUS_LABEL[pond.status] ?? pond.status}
          </span>
        </div>
      </div>

      <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Resumen</h3>
          {!editing && (
            <button
              type="button"
              onClick={startEditing}
              className="text-sm text-emerald-700 underline dark:text-emerald-400"
            >
              Editar medidas
            </button>
          )}
        </div>

        {editing && geometry ? (
          <div className="flex flex-col gap-3">
            <PondGeometryFields
              geometry={geometry}
              onFieldChange={(patch) =>
                setGeometry((current) => (current ? applyPondGeometryPatch(current, patch) : current))
              }
              onResetArea={() =>
                setGeometry((current) => (current ? resetToCalculated(current, "area") : current))
              }
              onResetVolume={() =>
                setGeometry((current) => (current ? resetToCalculated(current, "volume") : current))
              }
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveGeometry}
                disabled={saving}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Guardar
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={saving}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <span className="text-zinc-500">Superficie</span>
            <span>{formatNumber(pond.areaM2, "m²")}</span>
            <span className="text-zinc-500">Volumen estimado</span>
            <span>{formatNumber(pond.estimatedVolumeM3, "m³")}</span>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Producción actual
        </h3>
        {Object.keys(occupancy).length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No hay lotes en este estanque.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {Object.entries(occupancy).map(([batchId, quantity]) => {
              const batch = batchById.get(batchId);
              const speciesName = batch ? speciesById.get(batch.speciesId)?.commonName : undefined;
              return (
                <li key={batchId}>
                  <Link
                    href={`/lotes/${batchId}`}
                    className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <span>
                      {batch?.code ?? batchId}
                      {speciesName ? ` · ${speciesName}` : ""}
                    </span>
                    <span className="font-medium tabular-nums">
                      {quantity.toLocaleString("es")} peces
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Historial</h3>
        {history.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700">
            Todavía no hay movimientos.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {history.map((event) => (
              <li
                key={event.record.id}
                className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <span>
                  {formatDate(event.date)} —{" "}
                  {event.kind === "stocking"
                    ? "Siembra"
                    : event.kind === "transfer-in"
                      ? "Traslado (entrada)"
                      : "Traslado (salida)"}
                </span>
                <span className="tabular-nums">
                  {event.record.quantity.toLocaleString("es")} peces
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
