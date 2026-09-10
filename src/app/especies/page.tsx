"use client";

import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import {
  createSpecies,
  deactivateSpecies,
  listActiveSpecies,
  updateSpecies,
} from "@/lib/db/repositories/speciesRepository";
import type { SpeciesFields, SpeciesRecord } from "@/lib/db/types";

type OptionalFieldsState = {
  scientificName: string;
  description: string;
  targetWeightKg: string;
  estimatedCycleDays: string;
  minTemperatureC: string;
  maxTemperatureC: string;
  minPh: string;
  maxPh: string;
  minDissolvedOxygenMgL: string;
  expectedFcr: string;
  expectedMortalityPercent: string;
};

const EMPTY_OPTIONAL_FIELDS: OptionalFieldsState = {
  scientificName: "",
  description: "",
  targetWeightKg: "",
  estimatedCycleDays: "",
  minTemperatureC: "",
  maxTemperatureC: "",
  minPh: "",
  maxPh: "",
  minDissolvedOxygenMgL: "",
  expectedFcr: "",
  expectedMortalityPercent: "",
};

function speciesToOptionalFields(species: SpeciesRecord): OptionalFieldsState {
  return {
    scientificName: species.scientificName ?? "",
    description: species.description ?? "",
    targetWeightKg: species.targetWeightKg?.toString() ?? "",
    estimatedCycleDays: species.estimatedCycleDays?.toString() ?? "",
    minTemperatureC: species.minTemperatureC?.toString() ?? "",
    maxTemperatureC: species.maxTemperatureC?.toString() ?? "",
    minPh: species.minPh?.toString() ?? "",
    maxPh: species.maxPh?.toString() ?? "",
    minDissolvedOxygenMgL: species.minDissolvedOxygenMgL?.toString() ?? "",
    expectedFcr: species.expectedFcr?.toString() ?? "",
    expectedMortalityPercent: species.expectedMortalityPercent?.toString() ?? "",
  };
}

function optionalFieldsToPatch(fields: OptionalFieldsState): Partial<SpeciesFields> {
  const num = (raw: string): number | null => (raw.trim() === "" ? null : Number(raw));
  return {
    scientificName: fields.scientificName.trim() || null,
    description: fields.description.trim() || null,
    targetWeightKg: num(fields.targetWeightKg),
    estimatedCycleDays: num(fields.estimatedCycleDays),
    minTemperatureC: num(fields.minTemperatureC),
    maxTemperatureC: num(fields.maxTemperatureC),
    minPh: num(fields.minPh),
    maxPh: num(fields.maxPh),
    minDissolvedOxygenMgL: num(fields.minDissolvedOxygenMgL),
    expectedFcr: num(fields.expectedFcr),
    expectedMortalityPercent: num(fields.expectedMortalityPercent),
  };
}

function OptionalFieldsFieldset({
  fields,
  onChange,
  disabled,
}: {
  fields: OptionalFieldsState;
  onChange: (patch: Partial<OptionalFieldsState>) => void;
  disabled?: boolean;
}) {
  const field = (key: keyof OptionalFieldsState) => ({
    value: fields[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange({ [key]: event.target.value }),
    disabled,
    className:
      "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900",
  });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-600 dark:text-zinc-400">Nombre científico (opcional)</span>
        <input type="text" {...field("scientificName")} />
      </label>

      <div className="flex gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Peso objetivo (kg, opcional)</span>
          <input type="number" inputMode="decimal" step="any" min="0" {...field("targetWeightKg")} />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Ciclo estimado (días, opcional)</span>
          <input type="number" inputMode="numeric" min="0" {...field("estimatedCycleDays")} />
        </label>
      </div>

      <div className="flex gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Temp. mínima (°C, opcional)</span>
          <input type="number" inputMode="decimal" step="any" {...field("minTemperatureC")} />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Temp. máxima (°C, opcional)</span>
          <input type="number" inputMode="decimal" step="any" {...field("maxTemperatureC")} />
        </label>
      </div>

      <div className="flex gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">pH mínimo (opcional)</span>
          <input type="number" inputMode="decimal" step="any" min="0" max="14" {...field("minPh")} />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">pH máximo (opcional)</span>
          <input type="number" inputMode="decimal" step="any" min="0" max="14" {...field("maxPh")} />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-600 dark:text-zinc-400">Oxígeno disuelto mínimo (mg/L, opcional)</span>
        <input type="number" inputMode="decimal" step="any" min="0" {...field("minDissolvedOxygenMgL")} />
      </label>

      <div className="flex gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">FCR esperado (opcional)</span>
          <input type="number" inputMode="decimal" step="any" min="0" {...field("expectedFcr")} />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Mortalidad esperada (%, opcional)</span>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            max="100"
            {...field("expectedMortalityPercent")}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-600 dark:text-zinc-400">Descripción (opcional)</span>
        <textarea
          value={fields.description}
          onChange={(event) => onChange({ description: event.target.value })}
          disabled={disabled}
          rows={2}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>
    </div>
  );
}

function EditSpeciesForm({ species, onDone }: { species: SpeciesRecord; onDone: () => void }) {
  const [commonName, setCommonName] = useState(species.commonName);
  const [optionalFields, setOptionalFields] = useState<OptionalFieldsState>(
    speciesToOptionalFields(species),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      await updateSpecies(species.id, {
        commonName: trimmed,
        ...optionalFieldsToPatch(optionalFields),
      });
      onDone();
    } catch {
      setError("No se pudo guardar. Intenta de nuevo.");
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30"
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-600 dark:text-zinc-400">Nombre común</span>
        <input
          type="text"
          value={commonName}
          onChange={(event) => setCommonName(event.target.value)}
          disabled={submitting}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      <OptionalFieldsFieldset
        fields={optionalFields}
        onChange={(patch) => setOptionalFields((current) => ({ ...current, ...patch }))}
        disabled={submitting}
      />

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Guardar cambios
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

export default function SpeciesPage() {
  const species = useLiveQuery(() => listActiveSpecies(), []) ?? [];
  const [commonName, setCommonName] = useState("");
  const [showOptional, setShowOptional] = useState(false);
  const [optionalFields, setOptionalFields] = useState<OptionalFieldsState>(EMPTY_OPTIONAL_FIELDS);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
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
      await createSpecies({ commonName: trimmed, ...optionalFieldsToPatch(optionalFields) });
      setCommonName("");
      setOptionalFields(EMPTY_OPTIONAL_FIELDS);
      setShowOptional(false);
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

        <button
          type="button"
          onClick={() => setShowOptional((v) => !v)}
          className="self-start text-xs font-medium text-emerald-700 underline dark:text-emerald-400"
        >
          {showOptional ? "Ocultar detalles opcionales" : "+ Detalles opcionales"}
        </button>

        {showOptional && (
          <OptionalFieldsFieldset
            fields={optionalFields}
            onChange={(patch) => setOptionalFields((current) => ({ ...current, ...patch }))}
            disabled={submitting}
          />
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </form>

      <ul className="flex flex-col gap-2">
        {species.length === 0 && (
          <li className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            Todavía no hay especies registradas.
          </li>
        )}
        {species.map((s) =>
          editingId === s.id ? (
            <li key={s.id}>
              <EditSpeciesForm species={s} onDone={() => setEditingId(null)} />
            </li>
          ) : (
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
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setEditingId(s.id)}
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-zinc-300 px-3 text-xs font-medium text-zinc-600 transition-colors hover:border-emerald-400 hover:text-emerald-700 dark:border-zinc-700 dark:text-zinc-300"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => void deactivateSpecies(s.id)}
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-zinc-300 px-3 text-xs font-medium text-zinc-600 transition-colors hover:border-red-400 hover:text-red-600 dark:border-zinc-700 dark:text-zinc-300"
                >
                  Desactivar
                </button>
              </div>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
