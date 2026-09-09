"use client";

import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import {
  createSpecies,
  deactivateSpecies,
  listActiveSpecies,
} from "@/lib/db/repositories/speciesRepository";

export default function SpeciesPage() {
  const species = useLiveQuery(() => listActiveSpecies(), []) ?? [];
  const [commonName, setCommonName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = commonName.trim();
    if (!trimmed) {
      setError("Escribe el nombre de la especie.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await createSpecies({ commonName: trimmed });
      setCommonName("");
      inputRef.current?.focus();
    } catch {
      setError("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">
          Especies
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Catálogo de especies que se cultivan en la piscicultura.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <label htmlFor="commonName" className="text-sm font-medium">
          Nueva especie
        </label>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            id="commonName"
            name="commonName"
            type="text"
            placeholder="Ej. Pacú"
            value={commonName}
            onChange={(event) => setCommonName(event.target.value)}
            disabled={submitting}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            disabled={submitting}
            className="shrink-0 rounded-lg bg-emerald-700 px-5 py-3 text-base font-medium text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Agregar
          </button>
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </form>

      <ul className="flex flex-col gap-2">
        {species.length === 0 && (
          <li className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            Todavía no hay especies registradas.
          </li>
        )}
        {species.map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div>
              <p className="font-medium">{s.commonName}</p>
              {s.scientificName && (
                <p className="text-xs italic text-zinc-500 dark:text-zinc-400">
                  {s.scientificName}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void deactivateSpecies(s.id)}
              className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:border-red-400 hover:text-red-600 dark:border-zinc-700 dark:text-zinc-300"
            >
              Desactivar
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
