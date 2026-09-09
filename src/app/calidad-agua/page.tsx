"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { db } from "@/lib/db/schema";
import { getPondOccupancy } from "@/lib/db/repositories/ledgerQueries";
import {
  compareMeasurementRecency,
  evaluateWaterQuality,
  getLatestMeasurement,
  isMeasurementStale,
  type WaterQualityAlert,
} from "@/lib/domain/waterQuality";
import { WATER_QUALITY_SEVERITY_LABEL } from "@/lib/labels";
import type { PondRecord, WaterQualityRecordRecord } from "@/lib/db/types";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("es", { dateStyle: "short" }).format(new Date(iso));
}

function AlertBadge({ alert }: { alert: WaterQualityAlert }) {
  const color =
    alert.severity === "critical"
      ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
      : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${color}`}>
      {WATER_QUALITY_SEVERITY_LABEL[alert.severity]} — {alert.message}
    </span>
  );
}

export default function WaterQualityPage() {
  const data = useLiveQuery(async () => {
    const [ponds, records, batches, species] = await Promise.all([
      db.ponds.toArray(),
      db.waterQualityRecords.toArray(),
      db.fishBatches.toArray(),
      db.species.toArray(),
    ]);

    const activePonds = ponds.filter((p) => !p.deletedAt);
    const activeRecords = records
      .filter((r) => !r.deletedAt)
      .sort((a, b) => compareMeasurementRecency(b, a));
    const batchById = new Map(batches.map((b) => [b.id, b]));
    const speciesById = new Map(species.map((s) => [s.id, s]));

    const perPond = await Promise.all(
      activePonds.map(async (pond) => {
        const latest = getLatestMeasurement(activeRecords.filter((r) => r.pondId === pond.id));
        const occupancy = await getPondOccupancy(pond.id);
        const speciesInPond = Object.keys(occupancy)
          .map((batchId) => batchById.get(batchId))
          .filter((b): b is NonNullable<typeof b> => !!b)
          .map((b) => speciesById.get(b.speciesId))
          .filter((s): s is NonNullable<typeof s> => !!s);

        const alerts = latest
          ? evaluateWaterQuality(
              {
                temperatureC: latest.temperatureC,
                ph: latest.ph,
                dissolvedOxygenMgL: latest.dissolvedOxygenMgL,
              },
              speciesInPond,
            )
          : [];

        return {
          pond,
          latest,
          alerts,
          stale: isMeasurementStale(latest?.date ?? null),
        };
      }),
    );

    return { perPond, recentHistory: activeRecords.slice(0, 30) };
  }, []);

  const perPond = data?.perPond ?? [];
  const recentHistory = data?.recentHistory ?? [];
  const pondById = new Map(perPond.map((p) => [p.pond.id, p.pond] as [string, PondRecord]));

  const activeAlerts = perPond.flatMap((p) => p.alerts.map((alert) => ({ pond: p.pond, alert })));
  const stalePonds = perPond.filter((p) => p.stale);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">
          Calidad del agua
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Historial de mediciones y alertas operativas por estanque.
        </p>
      </div>

      <Link
        href="/calidad-agua/nueva"
        className="rounded-lg bg-emerald-700 px-5 py-4 text-center text-base font-medium text-white transition-colors hover:bg-emerald-800"
      >
        + Registrar medición
      </Link>

      {activeAlerts.length > 0 && (
        <section className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
          <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            Alertas activas
          </h3>
          <ul className="flex flex-col gap-2">
            {activeAlerts.map(({ pond, alert }, index) => (
              <li key={`${pond.id}-${index}`} className="flex flex-col gap-1 text-sm">
                <span className="font-medium">{pond.code} — {pond.name}</span>
                <AlertBadge alert={alert} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {stalePonds.length > 0 && (
        <section className="flex flex-col gap-2 rounded-lg border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Estanques sin medición reciente
          </h3>
          <ul className="flex flex-col gap-1 text-sm text-zinc-500 dark:text-zinc-400">
            {stalePonds.map(({ pond, latest }) => (
              <li key={pond.id}>
                {pond.code} — {pond.name}
                {latest ? ` (última: ${formatDate(latest.date)})` : " (nunca medido)"}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Últimas mediciones por estanque
        </h3>
        {perPond.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700">
            Todavía no hay estanques.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {perPond.map(({ pond, latest }) => (
              <li key={pond.id}>
                <Link
                  href={`/estanques/${pond.id}`}
                  className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <span>{pond.code} — {pond.name}</span>
                  {latest ? (
                    <span className="text-right text-xs text-zinc-500 dark:text-zinc-400">
                      {formatDate(latest.date)}
                      {latest.temperatureC != null && ` · ${latest.temperatureC} °C`}
                      {latest.ph != null && ` · pH ${latest.ph}`}
                      {latest.dissolvedOxygenMgL != null && ` · O₂ ${latest.dissolvedOxygenMgL} mg/L`}
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-400">Sin mediciones</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Historial reciente
        </h3>
        {recentHistory.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700">
            Todavía no hay mediciones registradas.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {recentHistory.map((record: WaterQualityRecordRecord) => (
              <li
                key={record.id}
                className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <span>
                  {formatDate(record.date)} — {pondById.get(record.pondId)?.code ?? "?"}
                </span>
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
    </div>
  );
}
