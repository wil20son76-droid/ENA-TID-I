"use client";

// Ajuste manual de la ración de un estanque (§"Ajuste manual" del encargo):
// guarda `manualDailyRationKg`/`manualFeedingsPerDay` como un campo más del
// estanque (updatePond), NUNCA registra una alimentación ni descuenta
// inventario — eso solo ocurre al registrar un FeedingRecord/RegisterFeeding
// real, en /alimentacion/nueva.
import { use, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { db } from "@/lib/db/schema";
import { updatePond } from "@/lib/db/repositories/pondRepository";
import { getPondOccupancy } from "@/lib/domain/batchLedger";
import { getEstimatedWeightForPond } from "@/lib/domain/sampling";
import {
  calculatePondRationSummary,
  resolvePondRationDisplay,
  type PondRationBatchInput,
} from "@/lib/domain/pondRation";
import { formatCount, formatG, formatKg } from "@/lib/domain/format";
import { DEFAULT_FEEDINGS_PER_DAY } from "@/lib/domain/rationDefaults";
import type {
  FishBatchRecord,
  FishTransferRecord,
  HarvestRecord,
  MortalityRecordRecord,
  PondRecord,
  SamplingRecord,
  SpeciesRecord,
  StockingRecord,
  FeedingRecommendationRecord,
} from "@/lib/db/types";

export default function ModifyPondRationPage({ params }: PageProps<"/racion-recomendada/[pondId]">) {
  const { pondId } = use(params);

  const data = useLiveQuery(async () => {
    const [pond, batches, species, stockings, transfers, mortalities, harvests, samplings, recommendations] =
      await Promise.all([
        db.ponds.get(pondId),
        db.fishBatches.toArray(),
        db.species.toArray(),
        db.stockings.toArray(),
        db.fishTransfers.toArray(),
        db.mortalityRecords.toArray(),
        db.harvests.toArray(),
        db.samplings.toArray(),
        db.feedingRecommendations.toArray(),
      ]);
    return { pond, batches, species, stockings, transfers, mortalities, harvests, samplings, recommendations };
  }, [pondId]);

  if (data === undefined) {
    return <p className="text-sm text-zinc-500">Cargando…</p>;
  }
  if (!data.pond || data.pond.deletedAt) {
    return <p className="text-sm text-zinc-500">Este estanque no existe.</p>;
  }

  // key={pond.id}: el formulario inicializa su estado editable UNA vez al
  // entrar a este estanque (useState perezoso, sin useEffect) y lo
  // conserva mientras la persona escribe, aunque el resto de la consulta
  // viva se refresque por cambios no relacionados — solo se reinicia si
  // se navega a OTRO estanque.
  return <RationModifyForm key={data.pond.id} pondId={pondId} pond={data.pond} data={data} />;
}

interface RationModifyFormProps {
  pondId: string;
  pond: PondRecord;
  data: {
    batches: FishBatchRecord[];
    species: SpeciesRecord[];
    stockings: StockingRecord[];
    transfers: FishTransferRecord[];
    mortalities: MortalityRecordRecord[];
    harvests: HarvestRecord[];
    samplings: SamplingRecord[];
    recommendations: FeedingRecommendationRecord[];
  };
}

function RationModifyForm({ pondId, pond, data }: RationModifyFormProps) {
  const [manualDailyRationKg, setManualDailyRationKg] = useState(
    pond.manualDailyRationKg != null ? String(pond.manualDailyRationKg) : "",
  );
  const [manualFeedingsPerDay, setManualFeedingsPerDay] = useState(
    pond.manualFeedingsPerDay != null ? String(pond.manualFeedingsPerDay) : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const batchById = new Map(data.batches.map((b) => [b.id, b]));
  const speciesById = new Map(data.species.map((s) => [s.id, s]));
  const activeRecommendations = data.recommendations.filter((r) => r.active && !r.deletedAt);

  const occupancy = getPondOccupancy(data.stockings, data.transfers, data.mortalities, data.harvests, pondId);
  const batchInputs: PondRationBatchInput[] = [];
  const speciesNames = new Set<string>();
  for (const [batchId, quantity] of Object.entries(occupancy)) {
    const batch = batchById.get(batchId);
    if (!batch) continue;
    const estimate = getEstimatedWeightForPond(data.samplings, batchId, pondId, batch.initialAverageWeightG);
    batchInputs.push({ batchId, speciesId: batch.speciesId, quantity, averageWeightG: estimate.averageWeightG });
    const speciesName = speciesById.get(batch.speciesId)?.commonName;
    if (speciesName) speciesNames.add(speciesName);
  }

  const summary = calculatePondRationSummary(batchInputs, activeRecommendations);
  const display = resolvePondRationDisplay(
    summary,
    pond.manualDailyRationKg,
    pond.manualFeedingsPerDay,
    DEFAULT_FEEDINGS_PER_DAY,
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const trimmedRation = manualDailyRationKg.trim();
      const trimmedFeedings = manualFeedingsPerDay.trim();
      if (trimmedRation && Number(trimmedRation) < 0) {
        setError("La ración configurada no puede ser negativa.");
        return;
      }
      if (trimmedFeedings && Number(trimmedFeedings) <= 0) {
        setError("El número de raciones debe ser mayor que cero.");
        return;
      }
      await updatePond(pondId, {
        manualDailyRationKg: trimmedRation ? Number(trimmedRation) : null,
        manualFeedingsPerDay: trimmedFeedings ? Number(trimmedFeedings) : null,
      });
    } catch {
      setError("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    setError(null);
    try {
      await updatePond(pondId, { manualDailyRationKg: null, manualFeedingsPerDay: null });
      setManualDailyRationKg("");
      setManualFeedingsPerDay("");
    } catch {
      setError("No se pudo restablecer. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/racion-recomendada" className="text-sm text-emerald-700 dark:text-emerald-400">
          ← Ración recomendada
        </Link>
        <h2 className="mt-1 text-lg font-semibold">
          {pond.code} — {pond.name}
        </h2>
        {speciesNames.size > 0 && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{[...speciesNames].join(", ")}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <span className="text-zinc-500">Peces</span>
        <span className="text-right font-medium tabular-nums">{formatCount(summary.totalFish)}</span>
        <span className="text-zinc-500">Peso promedio</span>
        <span className="text-right font-medium tabular-nums">
          {summary.totalFish > 0 ? formatG((summary.totalBiomassKg * 1000) / summary.totalFish) : "—"}
        </span>
        <span className="text-zinc-500">Biomasa</span>
        <span className="text-right font-medium tabular-nums">{formatKg(summary.totalBiomassKg)}</span>
        <span className="text-zinc-500">Recomendado (calculado)</span>
        <span className="text-right font-medium tabular-nums">{formatKg(display.recommendedDailyRationKg)}/día</span>
      </div>

      {!summary.fullyConfigured && (
        <p className="rounded-lg border border-dashed border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          Falta configurar el % de alimentación para alguna especie/peso presente en este estanque.{" "}
          <Link href="/racion-recomendada/configuracion" className="underline">
            Ir a configuración
          </Link>
        </p>
      )}

      <div className="rounded-lg bg-emerald-50 px-3 py-3 text-sm dark:bg-emerald-950/40">
        <div className="flex items-center justify-between">
          <span className="text-zinc-600 dark:text-zinc-300">
            {display.hasManualOverride ? "Ración configurada (ajuste manual)" : "Ración efectiva"}
          </span>
          <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
            {formatKg(display.effectiveDailyRationKg)}/día
          </span>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {display.effectiveFeedingsPerDay} {display.effectiveFeedingsPerDay === 1 ? "ración" : "raciones"} de{" "}
          {formatKg(display.perFeedingKg)}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Modificar ración</h3>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Ración diaria configurada (kg, opcional)</span>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            placeholder={`Recomendado: ${formatKg(display.recommendedDailyRationKg)}`}
            value={manualDailyRationKg}
            onChange={(event) => setManualDailyRationKg(event.target.value)}
            disabled={saving}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Número de raciones al día (opcional)</span>
          <input
            type="number"
            inputMode="numeric"
            step="1"
            min="1"
            placeholder={String(display.effectiveFeedingsPerDay)}
            value={manualFeedingsPerDay}
            onChange={(event) => setManualFeedingsPerDay(event.target.value)}
            disabled={saving}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Modificar la ración no registra ninguna alimentación ni descuenta inventario — solo cambia cuánto se
          recomienda dar. El inventario de alimento solo cambia al registrar una alimentación real.
        </p>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-emerald-700 px-5 py-3 text-base font-medium text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Guardar
          </button>
          {display.hasManualOverride && (
            <button
              type="button"
              onClick={handleReset}
              disabled={saving}
              className="rounded-lg border border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
            >
              Usar la recomendación calculada
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
