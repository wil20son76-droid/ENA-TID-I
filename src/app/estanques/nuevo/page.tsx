"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { PondGeometryFields } from "@/components/ponds/PondGeometryFields";
import { createPond } from "@/lib/db/repositories/pondRepository";
import { applyPondGeometryPatch, resetToCalculated, type PondGeometryState } from "@/lib/domain/pondGeometry";

const EMPTY_GEOMETRY: PondGeometryState = {
  lengthM: null,
  widthM: null,
  averageDepthM: null,
  areaM2: null,
  areaSource: "CALCULATED",
  estimatedVolumeM3: null,
  volumeSource: "CALCULATED",
};

export default function NewPondPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [geometry, setGeometry] = useState<PondGeometryState>(EMPTY_GEOMETRY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const pond = await createPond({
        code: trimmedCode,
        name: trimmedName,
        ...geometry,
      });
      router.push(`/estanques/${pond.id}`);
    } catch {
      setError("No se pudo guardar. Intenta de nuevo.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">
          Nuevo estanque
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex gap-2">
          <label className="flex w-28 flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Código</span>
            <input
              type="text"
              placeholder="E01"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              disabled={submitting}
              autoComplete="off"
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Nombre</span>
            <input
              type="text"
              placeholder="Estanque Norte"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={submitting}
              autoComplete="off"
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        </div>

        <PondGeometryFields
          geometry={geometry}
          onFieldChange={(patch) => setGeometry((current) => applyPondGeometryPatch(current, patch))}
          onResetArea={() => setGeometry((current) => resetToCalculated(current, "area"))}
          onResetVolume={() => setGeometry((current) => resetToCalculated(current, "volume"))}
        />

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-emerald-700 px-5 py-3 text-base font-medium text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Guardar estanque
        </button>
      </form>
    </div>
  );
}
