"use client";

// "Ración recomendada" (nueva función): tarjeta por estanque con la
// biomasa/ración calculada a partir de los ledgers YA existentes (peces,
// muestreos) — nunca otra fuente de verdad, ver src/lib/domain/pondRation.ts.
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { db } from "@/lib/db/schema";
import { getPondOccupancy } from "@/lib/domain/batchLedger";
import { getEstimatedWeightForPond } from "@/lib/domain/sampling";
import {
  calculatePondRationSummary,
  resolvePondRationDisplay,
  type PondRationBatchInput,
} from "@/lib/domain/pondRation";
import { formatCount, formatG, formatKg } from "@/lib/domain/format";
import { DEFAULT_FEEDINGS_PER_DAY } from "@/lib/domain/rationDefaults";

export default function FeedingRecommendationPage() {
  const data = useLiveQuery(async () => {
    const [ponds, batches, species, stockings, transfers, mortalities, harvests, samplings, recommendations] =
      await Promise.all([
        db.ponds.toArray(),
        db.fishBatches.toArray(),
        db.species.toArray(),
        db.stockings.toArray(),
        db.fishTransfers.toArray(),
        db.mortalityRecords.toArray(),
        db.harvests.toArray(),
        db.samplings.toArray(),
        db.feedingRecommendations.toArray(),
      ]);
    return { ponds, batches, species, stockings, transfers, mortalities, harvests, samplings, recommendations };
  }, []);

  const ponds = (data?.ponds ?? []).filter((p) => !p.deletedAt).sort((a, b) => a.code.localeCompare(b.code, "es"));
  const batches = data?.batches ?? [];
  const species = data?.species ?? [];
  const stockings = data?.stockings ?? [];
  const transfers = data?.transfers ?? [];
  const mortalities = data?.mortalities ?? [];
  const harvests = data?.harvests ?? [];
  const samplings = data?.samplings ?? [];
  const activeRecommendations = (data?.recommendations ?? []).filter((r) => r.active && !r.deletedAt);

  const batchById = new Map(batches.map((b) => [b.id, b]));
  const speciesById = new Map(species.map((s) => [s.id, s]));

  const cards = ponds
    .map((pond) => {
      const occupancy = getPondOccupancy(stockings, transfers, mortalities, harvests, pond.id);
      const batchInputs: PondRationBatchInput[] = [];
      const speciesNames = new Set<string>();

      for (const [batchId, quantity] of Object.entries(occupancy)) {
        const batch = batchById.get(batchId);
        if (!batch) continue;
        const estimate = getEstimatedWeightForPond(samplings, batchId, pond.id, batch.initialAverageWeightG);
        batchInputs.push({
          batchId,
          speciesId: batch.speciesId,
          quantity,
          averageWeightG: estimate.averageWeightG,
        });
        const speciesName = speciesById.get(batch.speciesId)?.commonName;
        if (speciesName) speciesNames.add(speciesName);
      }

      if (batchInputs.length === 0) return null;

      const summary = calculatePondRationSummary(batchInputs, activeRecommendations);
      const display = resolvePondRationDisplay(
        summary,
        pond.manualDailyRationKg,
        pond.manualFeedingsPerDay,
        DEFAULT_FEEDINGS_PER_DAY,
      );

      return { pond, summary, display, speciesLabel: [...speciesNames].join(", ") };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">Ración recomendada</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Cuánto alimento se recomienda dar por día en cada estanque, según especie, peces y peso estimados.
          </p>
        </div>
        <Link
          href="/racion-recomendada/configuracion"
          className="shrink-0 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:border-emerald-400 hover:text-emerald-700 dark:border-zinc-700 dark:text-zinc-300"
        >
          Configurar
        </Link>
      </div>

      <ul className="flex flex-col gap-2">
        {cards.length === 0 && (
          <li className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            Todavía no hay estanques con peces para calcular una ración.
          </li>
        )}
        {cards.map(({ pond, summary, display, speciesLabel }) => (
          <li
            key={pond.id}
            className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-center justify-between">
              <p className="font-medium">
                {pond.code} — {pond.name}
              </p>
              {speciesLabel && <span className="text-xs text-zinc-500 dark:text-zinc-400">{speciesLabel}</span>}
            </div>

            <div className="grid grid-cols-2 gap-1 text-sm">
              <span className="text-zinc-500">Peces</span>
              <span className="text-right tabular-nums">{formatCount(summary.totalFish)}</span>
              <span className="text-zinc-500">Peso promedio</span>
              <span className="text-right tabular-nums">
                {summary.totalFish > 0
                  ? formatG((summary.totalBiomassKg * 1000) / summary.totalFish)
                  : "—"}
              </span>
              <span className="text-zinc-500">Biomasa</span>
              <span className="text-right tabular-nums">{formatKg(summary.totalBiomassKg)}</span>
            </div>

            {summary.fullyConfigured || display.hasManualOverride ? (
              <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm dark:bg-emerald-950/40">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-600 dark:text-zinc-300">
                    {display.hasManualOverride ? "Ración configurada" : "Recomendado"}
                  </span>
                  <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                    {formatKg(display.effectiveDailyRationKg)}/día
                  </span>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {display.effectiveFeedingsPerDay} {display.effectiveFeedingsPerDay === 1 ? "ración" : "raciones"} de{" "}
                  {formatKg(display.perFeedingKg)}
                  {display.hasManualOverride && ` · Recomendado: ${formatKg(display.recommendedDailyRationKg)}`}
                </p>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                Falta configurar el % de alimentación para esta especie/peso.
              </p>
            )}

            <Link
              href={`/racion-recomendada/${pond.id}`}
              className="self-start text-sm text-emerald-700 underline dark:text-emerald-400"
            >
              Modificar
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
