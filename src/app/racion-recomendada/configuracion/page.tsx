"use client";

// Configuración de "Ración recomendada": tabla especie + rango de peso →
// % de alimentación + número de raciones (§"Recomendaciones configurables"
// del encargo). Deliberadamente editable desde aquí, nunca hardcodeada en
// código — el % correcto depende del alimento, la temperatura y el
// criterio técnico, y puede cambiar con el tiempo.
import { useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { RequireCapability } from "@/components/auth/RequireCapability";
import { db } from "@/lib/db/schema";
import {
  createFeedingRecommendation,
  deactivateFeedingRecommendation,
} from "@/lib/db/repositories/feedingRecommendationRepository";

export default function FeedingRecommendationConfigPage() {
  const data = useLiveQuery(async () => {
    const [species, recommendations] = await Promise.all([
      db.species.toArray(),
      db.feedingRecommendations.toArray(),
    ]);
    return {
      species: species.filter((s) => s.active && !s.deletedAt).sort((a, b) => a.commonName.localeCompare(b.commonName, "es")),
      recommendations: recommendations
        .filter((r) => r.active && !r.deletedAt)
        .sort((a, b) => a.speciesId.localeCompare(b.speciesId) || a.minWeightG - b.minWeightG),
    };
  }, []);

  const speciesList = data?.species ?? [];
  const recommendations = data?.recommendations ?? [];
  const speciesById = new Map(speciesList.map((s) => [s.id, s]));

  const [speciesId, setSpeciesId] = useState("");
  const [minWeightG, setMinWeightG] = useState("");
  const [maxWeightG, setMaxWeightG] = useState("");
  const [feedPercent, setFeedPercent] = useState("");
  const [feedingsPerDay, setFeedingsPerDay] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const min = Number(minWeightG);
    const max = Number(maxWeightG);
    const percent = Number(feedPercent);
    const feedings = Number(feedingsPerDay);

    if (!speciesId) {
      setError("Selecciona una especie.");
      return;
    }
    if (!minWeightG || !maxWeightG || min < 0 || max <= min) {
      setError("El rango de peso no es válido (mínimo ≥ 0 y menor que el máximo).");
      return;
    }
    if (!feedPercent || percent <= 0 || percent > 100) {
      setError("El % de alimentación debe estar entre 0 y 100.");
      return;
    }
    if (!feedingsPerDay || feedings <= 0 || !Number.isInteger(feedings)) {
      setError("El número de raciones debe ser un entero mayor que cero.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await createFeedingRecommendation({
        speciesId,
        minWeightG: min,
        maxWeightG: max,
        feedPercent: percent,
        feedingsPerDay: feedings,
      });
      setMinWeightG("");
      setMaxWeightG("");
      setFeedPercent("");
      setFeedingsPerDay("");
    } catch {
      setError("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <RequireCapability capability="MANAGE_CATALOG">
      <div className="flex flex-col gap-6">
        <div>
          <Link href="/racion-recomendada" className="text-sm text-emerald-700 dark:text-emerald-400">
            ← Ración recomendada
          </Link>
          <h2 className="mt-1 text-base font-semibold text-zinc-700 dark:text-zinc-300">
            Configurar recomendaciones
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Por especie y rango de peso: % de alimentación diario y número de raciones. Edítalo cuando cambie el
            alimento, la temperatura o el criterio técnico.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Especie</span>
            <select
              value={speciesId}
              onChange={(event) => setSpeciesId(event.target.value)}
              disabled={submitting}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="">Selecciona una especie</option>
              {speciesList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.commonName}
                </option>
              ))}
            </select>
          </label>

          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Peso mín. (g)</span>
              <input
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={minWeightG}
                onChange={(event) => setMinWeightG(event.target.value)}
                disabled={submitting}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Peso máx. (g)</span>
              <input
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={maxWeightG}
                onChange={(event) => setMaxWeightG(event.target.value)}
                disabled={submitting}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
          </div>

          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">% de alimentación</span>
              <input
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                max="100"
                placeholder="3"
                value={feedPercent}
                onChange={(event) => setFeedPercent(event.target.value)}
                disabled={submitting}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Raciones/día</span>
              <input
                type="number"
                inputMode="numeric"
                step="1"
                min="1"
                placeholder="3"
                value={feedingsPerDay}
                onChange={(event) => setFeedingsPerDay(event.target.value)}
                disabled={submitting}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="self-start rounded-lg bg-emerald-700 px-5 py-3 text-base font-medium text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Agregar
          </button>
        </form>

        <ul className="flex flex-col gap-2">
          {recommendations.length === 0 && (
            <li className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              Todavía no hay recomendaciones configuradas.
            </li>
          )}
          {recommendations.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div>
                <p className="font-medium">{speciesById.get(r.speciesId)?.commonName ?? "?"}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {r.minWeightG.toLocaleString("es")}–{r.maxWeightG.toLocaleString("es")} g · {r.feedPercent}% ·{" "}
                  {r.feedingsPerDay} {r.feedingsPerDay === 1 ? "ración" : "raciones"}/día
                </p>
              </div>
              <button
                type="button"
                onClick={() => void deactivateFeedingRecommendation(r.id)}
                className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-zinc-300 px-3 text-xs font-medium text-zinc-600 transition-colors hover:border-red-400 hover:text-red-600 dark:border-zinc-700 dark:text-zinc-300"
              >
                Desactivar
              </button>
            </li>
          ))}
        </ul>
      </div>
    </RequireCapability>
  );
}
