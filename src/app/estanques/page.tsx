"use client";

import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { createPond, listActivePonds } from "@/lib/db/repositories/pondRepository";

const STATUS_LABEL: Record<string, string> = {
  EMPTY: "Vacío",
  PREPARATION: "En preparación",
  ACTIVE: "Activo",
  HARVEST: "En cosecha",
  CLEANING: "En limpieza",
  MAINTENANCE: "En mantenimiento",
};

export default function PondsPage() {
  const ponds = useLiveQuery(() => listActivePonds(), []) ?? [];
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedCode = code.trim();
    const trimmedName = name.trim();
    if (!trimmedCode || !trimmedName) {
      setError("Completa el código y el nombre del estanque.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await createPond({ code: trimmedCode, name: trimmedName });
      setCode("");
      setName("");
      codeInputRef.current?.focus();
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
          Estanques
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Estanques de la piscicultura.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            ref={codeInputRef}
            type="text"
            placeholder="Código"
            aria-label="Código del estanque"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            disabled={submitting}
            autoComplete="off"
            className="w-24 min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <input
            type="text"
            placeholder="Nombre (ej. Estanque Norte)"
            aria-label="Nombre del estanque"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={submitting}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-emerald-700 px-5 py-3 text-base font-medium text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Agregar estanque
        </button>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </form>

      <ul className="flex flex-col gap-2">
        {ponds.length === 0 && (
          <li className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            Todavía no hay estanques registrados.
          </li>
        )}
        {ponds.map((pond) => (
          <li
            key={pond.id}
            className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div>
              <p className="font-medium">
                {pond.code} — {pond.name}
              </p>
            </div>
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {STATUS_LABEL[pond.status] ?? pond.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
