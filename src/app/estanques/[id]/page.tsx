"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { PondGeometryFields } from "@/components/ponds/PondGeometryFields";
import { db } from "@/lib/db/schema";
import { getPondHistory, getPondOccupancy } from "@/lib/db/repositories/ledgerQueries";
import { updatePond } from "@/lib/db/repositories/pondRepository";
import { applyPondGeometryPatch, resetToCalculated, type PondGeometryState } from "@/lib/domain/pondGeometry";
import { getEstimatedWeightForPond } from "@/lib/domain/sampling";
import { calculateBiomassKg } from "@/lib/domain/biomass";
import { formatCount, formatG, formatKg } from "@/lib/domain/format";
import { MORTALITY_CAUSE_LABEL, WATER_QUALITY_SEVERITY_LABEL } from "@/lib/labels";
import {
  compareMeasurementRecency,
  evaluateWaterQuality,
  getLatestMeasurement,
  isMeasurementStale,
} from "@/lib/domain/waterQuality";

const STATUS_LABEL: Record<string, string> = {
  EMPTY: "Vacío",
  PREPARATION: "En preparación",
  ACTIVE: "Activo",
  HARVEST: "En cosecha",
  CLEANING: "En limpieza",
  MAINTENANCE: "En mantenimiento",
};

const TABS = [
  { key: "resumen", label: "Resumen" },
  { key: "produccion", label: "Producción" },
  { key: "alimentacion", label: "Alimentación" },
  { key: "mortalidad", label: "Mortalidad" },
  { key: "muestreos", label: "Muestreos" },
  { key: "agua", label: "Calidad del agua" },
  { key: "historial", label: "Historial" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function formatNumber(value: number | null, unit: string): string {
  if (value === null) return "—";
  return `${value.toLocaleString("es")} ${unit}`;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("es", { dateStyle: "short" }).format(new Date(iso));
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function PondDetailPage({ params }: PageProps<"/estanques/[id]">) {
  const { id } = use(params);

  const pond = useLiveQuery(() => db.ponds.get(id), [id]);
  const occupancy = useLiveQuery(() => getPondOccupancy(id), [id]) ?? {};
  const history = useLiveQuery(() => getPondHistory(id), [id]) ?? [];
  const batches = useLiveQuery(() => db.fishBatches.toArray(), []) ?? [];
  const species = useLiveQuery(() => db.species.toArray(), []) ?? [];
  const samplings = useLiveQuery(() => db.samplings.where("pondId").equals(id).toArray(), [id]) ?? [];
  const feedings = useLiveQuery(
    () => db.feedingRecords.where("pondId").equals(id).toArray(),
    [id],
  ) ?? [];
  const mortalities = useLiveQuery(
    () => db.mortalityRecords.where("pondId").equals(id).toArray(),
    [id],
  ) ?? [];
  const feeds = useLiveQuery(() => db.feeds.toArray(), []) ?? [];
  const waterQualityRecords = useLiveQuery(
    () => db.waterQualityRecords.where("pondId").equals(id).toArray(),
    [id],
  ) ?? [];

  const [tab, setTab] = useState<TabKey>("resumen");
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
  const feedById = new Map(feeds.map((f) => [f.id, f]));

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

  // Peces/biomasa actuales del estanque: suma de cada lote presente,
  // usando el peso estimado DE ESE LOTE EN ESTE ESTANQUE (§24 — un
  // muestreo de otro estanque no se aplica aquí).
  let totalFishNow = 0;
  let totalBiomassNow = 0;
  for (const [batchId, quantity] of Object.entries(occupancy)) {
    const batch = batchById.get(batchId);
    if (!batch) continue;
    const estimate = getEstimatedWeightForPond(samplings, batchId, id, batch.initialAverageWeightG);
    totalFishNow += quantity;
    totalBiomassNow += calculateBiomassKg(quantity, estimate.averageWeightG);
  }
  const weightedAverageWeightG = totalFishNow > 0 ? (totalBiomassNow * 1000) / totalFishNow : null;

  const today = todayIsoDate();
  const feedingToday = feedings
    .filter((f) => !f.deletedAt && f.date.slice(0, 10) === today)
    .reduce((sum, f) => sum + f.quantityKg, 0);
  const mortalityTotal = mortalities
    .filter((m) => !m.deletedAt)
    .reduce((sum, m) => sum + m.quantity, 0);

  const activeWaterRecords = [...waterQualityRecords]
    .filter((r) => !r.deletedAt)
    .sort((a, b) => compareMeasurementRecency(b, a));
  const latestWaterRecord = getLatestMeasurement(activeWaterRecords);
  const speciesInPond = Object.keys(occupancy)
    .map((batchId) => batchById.get(batchId))
    .filter((b): b is NonNullable<typeof b> => !!b)
    .map((b) => speciesById.get(b.speciesId))
    .filter((s): s is NonNullable<typeof s> => !!s);
  const waterAlerts = latestWaterRecord
    ? evaluateWaterQuality(
        {
          temperatureC: latestWaterRecord.temperatureC,
          ph: latestWaterRecord.ph,
          dissolvedOxygenMgL: latestWaterRecord.dissolvedOxygenMgL,
        },
        speciesInPond,
      )
    : [];
  const waterStale = isMeasurementStale(latestWaterRecord?.date ?? null);

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

      <div className="grid grid-cols-2 gap-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <span className="text-zinc-500">Peces actuales estimados</span>
        <span className="text-right font-medium tabular-nums">{formatCount(totalFishNow)}</span>
        <span className="text-zinc-500">Biomasa estimada</span>
        <span className="text-right font-medium tabular-nums">{formatKg(totalBiomassNow)}</span>
        <span className="text-zinc-500">Peso promedio estimado</span>
        <span className="text-right font-medium tabular-nums">
          {weightedAverageWeightG !== null ? formatG(weightedAverageWeightG) : "—"}
        </span>
        <span className="text-zinc-500">Alimentación hoy</span>
        <span className="text-right font-medium tabular-nums">{formatKg(feedingToday)}</span>
        <span className="text-zinc-500">Mortalidad acumulada</span>
        <span className="text-right font-medium tabular-nums">{formatCount(mortalityTotal)}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Link
          href={`/alimentacion/nueva?pondId=${id}`}
          className="rounded-lg bg-emerald-700 px-3 py-3 text-center text-sm font-medium text-white transition-colors hover:bg-emerald-800"
        >
          Registrar alimentación
        </Link>
        <Link
          href={`/mortalidad/nueva?pondId=${id}`}
          className="rounded-lg bg-emerald-700 px-3 py-3 text-center text-sm font-medium text-white transition-colors hover:bg-emerald-800"
        >
          Registrar mortalidad
        </Link>
        <Link
          href={`/muestreos/nuevo?pondId=${id}`}
          className="rounded-lg bg-emerald-700 px-3 py-3 text-center text-sm font-medium text-white transition-colors hover:bg-emerald-800"
        >
          Registrar muestreo
        </Link>
        <Link
          href={`/calidad-agua/nueva?pondId=${id}`}
          className="rounded-lg bg-emerald-700 px-3 py-3 text-center text-sm font-medium text-white transition-colors hover:bg-emerald-800"
        >
          Registrar calidad del agua
        </Link>
        <Link
          href={`/cosechas/nueva?pondId=${id}`}
          className="rounded-lg bg-emerald-700 px-3 py-3 text-center text-sm font-medium text-white transition-colors hover:bg-emerald-800"
        >
          Registrar cosecha
        </Link>
        <Link
          href={`/gastos/nuevo?pondId=${id}`}
          className="rounded-lg border border-emerald-700 px-3 py-3 text-center text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950"
        >
          Registrar gasto
        </Link>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? "border-emerald-700 text-emerald-700 dark:border-emerald-400 dark:text-emerald-400"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "resumen" && (
        <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Medidas</h3>
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
      )}

      {tab === "produccion" && (
        <section className="flex flex-col gap-2">
          {Object.keys(occupancy).length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700">
              No hay lotes en este estanque.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {Object.entries(occupancy).map(([batchId, quantity]) => {
                const batch = batchById.get(batchId);
                const speciesName = batch ? speciesById.get(batch.speciesId)?.commonName : undefined;
                const estimate = batch
                  ? getEstimatedWeightForPond(samplings, batchId, id, batch.initialAverageWeightG)
                  : null;
                return (
                  <li key={batchId}>
                    <Link
                      href={`/lotes/${batchId}`}
                      className="flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <div className="flex items-center justify-between">
                        <span>
                          {batch?.code ?? batchId}
                          {speciesName ? ` · ${speciesName}` : ""}
                        </span>
                        <span className="font-medium tabular-nums">{formatCount(quantity)} peces</span>
                      </div>
                      {estimate && (
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          Peso estimado: {formatG(estimate.averageWeightG)}
                          {estimate.source === "INITIAL_STOCKING" ? " (peso de siembra, sin muestreo aún)" : ""}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {tab === "alimentacion" && (
        <section className="flex flex-col gap-2">
          {feedings.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700">
              Todavía no hay alimentación registrada en este estanque.
            </p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {[...feedings]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <span>
                      {formatDate(f.date)} — {feedById.get(f.feedId)?.name ?? "?"}
                    </span>
                    <span className="tabular-nums">{formatKg(f.quantityKg)}</span>
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}

      {tab === "mortalidad" && (
        <section className="flex flex-col gap-2">
          {mortalities.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700">
              Todavía no hay mortalidad registrada en este estanque.
            </p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {[...mortalities]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <span>
                      {formatDate(m.date)} — {MORTALITY_CAUSE_LABEL[m.cause]}
                    </span>
                    <span className="tabular-nums">{formatCount(m.quantity)}</span>
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}

      {tab === "muestreos" && (
        <section className="flex flex-col gap-2">
          {samplings.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700">
              Todavía no hay muestreos en este estanque.
            </p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {[...samplings]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <span>
                      {formatDate(s.date)} — {batchById.get(s.batchId)?.code ?? "?"} ·{" "}
                      {formatCount(s.sampleFishCount)} peces
                    </span>
                    <span className="tabular-nums">{formatG(s.averageWeightG)}</span>
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}

      {tab === "agua" && (
        <section className="flex flex-col gap-3">
          {waterStale && (
            <p className="rounded-lg border border-dashed border-amber-400 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              Sin medición reciente.
            </p>
          )}

          {latestWaterRecord ? (
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
              <span className="text-zinc-500">Última medición</span>
              <span className="text-right font-medium">{formatDate(latestWaterRecord.date)}</span>
              {latestWaterRecord.temperatureC != null && (
                <>
                  <span className="text-zinc-500">Temperatura</span>
                  <span className="text-right font-medium tabular-nums">{latestWaterRecord.temperatureC} °C</span>
                </>
              )}
              {latestWaterRecord.ph != null && (
                <>
                  <span className="text-zinc-500">pH</span>
                  <span className="text-right font-medium tabular-nums">{latestWaterRecord.ph}</span>
                </>
              )}
              {latestWaterRecord.dissolvedOxygenMgL != null && (
                <>
                  <span className="text-zinc-500">Oxígeno disuelto</span>
                  <span className="text-right font-medium tabular-nums">
                    {latestWaterRecord.dissolvedOxygenMgL} mg/L
                  </span>
                </>
              )}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700">
              Todavía no hay mediciones de calidad del agua en este estanque.
            </p>
          )}

          {waterAlerts.length > 0 && (
            <div className="flex flex-col gap-2">
              {waterAlerts.map((alert, index) => (
                <span
                  key={index}
                  className={`rounded-lg px-3 py-2 text-sm ${
                    alert.severity === "critical"
                      ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                  }`}
                >
                  {WATER_QUALITY_SEVERITY_LABEL[alert.severity]} — {alert.message}
                </span>
              ))}
            </div>
          )}

          {activeWaterRecords.length > 0 && (
            <ul className="flex flex-col gap-2 text-sm">
              {activeWaterRecords.slice(0, 10).map((record) => (
                <li
                  key={record.id}
                  className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <span>{formatDate(record.date)}</span>
                  <span className="text-right text-xs text-zinc-500 dark:text-zinc-400">
                    {record.temperatureC != null && `${record.temperatureC} °C `}
                    {record.ph != null && `pH ${record.ph} `}
                    {record.dissolvedOxygenMgL != null && `O₂ ${record.dissolvedOxygenMgL} mg/L`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "historial" && (
        <section className="flex flex-col gap-2">
          {history.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700">
              Todavía no hay movimientos.
            </p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {history.map((event) => {
                let label: string;
                let value: string;
                switch (event.kind) {
                  case "stocking":
                    label = "Siembra";
                    value = `${formatCount(event.record.quantity)} peces`;
                    break;
                  case "transfer-in":
                    label = "Traslado (entrada)";
                    value = `${formatCount(event.record.quantity)} peces`;
                    break;
                  case "transfer-out":
                    label = "Traslado (salida)";
                    value = `${formatCount(event.record.quantity)} peces`;
                    break;
                  case "mortality":
                    label = `Mortalidad — ${MORTALITY_CAUSE_LABEL[event.record.cause]}`;
                    value = `${formatCount(event.record.quantity)} peces`;
                    break;
                  case "feeding":
                    label = `Alimentación — ${feedById.get(event.record.feedId)?.name ?? "?"}`;
                    value = formatKg(event.record.quantityKg);
                    break;
                  case "sampling":
                    label = "Muestreo";
                    value = formatG(event.record.averageWeightG);
                    break;
                  case "harvest":
                    label = "Cosecha";
                    value = `${formatCount(event.record.quantityFish)} peces / ${formatKg(event.record.totalWeightKg)}`;
                    break;
                }
                return (
                  <li
                    key={event.record.id}
                    className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <span>
                      {formatDate(event.date)} — {label}
                    </span>
                    <span className="tabular-nums">{value}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
