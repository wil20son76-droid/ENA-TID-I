"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";

import { RequireCapability } from "@/components/auth/RequireCapability";
import { db } from "@/lib/db/schema";
import { createWaterQualityRecord } from "@/lib/db/repositories/waterQualityRepository";
import { getPondOccupancy } from "@/lib/db/repositories/ledgerQueries";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

interface NumberFieldProps {
  label: string;
  unit: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}

function NumberField({ label, unit, value, onChange, disabled }: NumberFieldProps) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-zinc-600 dark:text-zinc-400">
        {label}
        {unit && <span className="text-xs text-zinc-400"> ({unit})</span>}
      </span>
      <input
        type="number"
        inputMode="decimal"
        step="any"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
      />
    </label>
  );
}

function NewWaterQualityForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedPondId = searchParams.get("pondId") ?? "";

  const ponds = useLiveQuery(async () => {
    const all = await db.ponds.toArray();
    return all.filter((p) => !p.deletedAt).sort((a, b) => a.code.localeCompare(b.code, "es"));
  }, []) ?? [];

  const [pondId, setPondId] = useState(preselectedPondId);
  const [batchId, setBatchId] = useState("");
  const [date, setDate] = useState(todayIsoDate());
  const [time, setTime] = useState("");
  const [temperatureC, setTemperatureC] = useState("");
  const [ph, setPh] = useState("");
  const [dissolvedOxygenMgL, setDissolvedOxygenMgL] = useState("");
  const [transparencyCm, setTransparencyCm] = useState("");
  const [ammoniaMgL, setAmmoniaMgL] = useState("");
  const [nitriteMgL, setNitriteMgL] = useState("");
  const [alkalinityMgL, setAlkalinityMgL] = useState("");
  const [waterLevelCm, setWaterLevelCm] = useState("");
  const [notes, setNotes] = useState("");
  const [responsibleName, setResponsibleName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const occupancy = useLiveQuery(
    () => (pondId ? getPondOccupancy(pondId) : Promise.resolve({} as Record<string, number>)),
    [pondId],
  ) ?? {};
  const batches = useLiveQuery(async () => {
    const ids = Object.keys(occupancy);
    if (ids.length === 0) return [];
    const all = await db.fishBatches.where("id").anyOf(ids).toArray();
    return all.sort((a, b) => a.code.localeCompare(b.code, "es"));
  }, [occupancy]) ?? [];

  function toNumberOrNull(value: string): number | null {
    if (value.trim() === "") return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pondId) {
      setError("Selecciona el estanque.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await createWaterQualityRecord({
        pondId,
        batchId: batchId || null,
        date: new Date(date).toISOString(),
        time: time || null,
        temperatureC: toNumberOrNull(temperatureC),
        ph: toNumberOrNull(ph),
        dissolvedOxygenMgL: toNumberOrNull(dissolvedOxygenMgL),
        transparencyCm: toNumberOrNull(transparencyCm),
        ammoniaMgL: toNumberOrNull(ammoniaMgL),
        nitriteMgL: toNumberOrNull(nitriteMgL),
        alkalinityMgL: toNumberOrNull(alkalinityMgL),
        waterLevelCm: toNumberOrNull(waterLevelCm),
        notes: notes.trim() || null,
        responsibleName: responsibleName.trim() || null,
      });
      router.push("/calidad-agua");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar. Intenta de nuevo.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">
        Registrar calidad del agua
      </h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Solo el estanque, la fecha y al menos un parámetro son obligatorios.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Estanque</span>
          <select
            value={pondId}
            onChange={(event) => {
              setPondId(event.target.value);
              setBatchId("");
            }}
            disabled={submitting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">Selecciona un estanque</option>
            {ponds.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
        </label>

        {batches.length > 0 && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Lote (opcional)</span>
            <select
              value={batchId}
              onChange={(event) => setBatchId(event.target.value)}
              disabled={submitting}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="">Sin lote específico</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Fecha</span>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              disabled={submitting}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Hora (opcional)</span>
            <input
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              disabled={submitting}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Temperatura" unit="°C" value={temperatureC} onChange={setTemperatureC} disabled={submitting} />
          <NumberField label="pH" unit="" value={ph} onChange={setPh} disabled={submitting} />
          <NumberField label="Oxígeno disuelto" unit="mg/L" value={dissolvedOxygenMgL} onChange={setDissolvedOxygenMgL} disabled={submitting} />
          <NumberField label="Transparencia" unit="cm" value={transparencyCm} onChange={setTransparencyCm} disabled={submitting} />
          <NumberField label="Amonio" unit="mg/L" value={ammoniaMgL} onChange={setAmmoniaMgL} disabled={submitting} />
          <NumberField label="Nitritos" unit="mg/L" value={nitriteMgL} onChange={setNitriteMgL} disabled={submitting} />
          <NumberField label="Alcalinidad" unit="mg/L" value={alkalinityMgL} onChange={setAlkalinityMgL} disabled={submitting} />
          <NumberField label="Nivel de agua" unit="cm" value={waterLevelCm} onChange={setWaterLevelCm} disabled={submitting} />
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Responsable (opcional)</span>
          <input
            type="text"
            value={responsibleName}
            onChange={(event) => setResponsibleName(event.target.value)}
            disabled={submitting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Observaciones (opcional)</span>
          <input
            type="text"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={submitting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-emerald-700 px-5 py-3 text-base font-medium text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Guardar medición
        </button>
      </form>
    </div>
  );
}

export default function NewWaterQualityPage() {
  return (
    <RequireCapability capability="FIELD_OPS">
      <Suspense fallback={<p className="text-sm text-zinc-500">Cargando…</p>}>
        <NewWaterQualityForm />
      </Suspense>
    </RequireCapability>
  );
}
