"use client";

import type { PondGeometryState } from "@/lib/domain/pondGeometry";

type GeometryPatch = Partial<
  Pick<PondGeometryState, "lengthM" | "widthM" | "averageDepthM" | "areaM2" | "estimatedVolumeM3">
>;

interface NumberFieldProps {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  suffix?: string;
}

function NumberField({ label, value, onChange, suffix }: NumberFieldProps) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          step="any"
          value={value ?? ""}
          onChange={(event) => {
            const raw = event.target.value;
            onChange(raw === "" ? null : Number(raw));
          }}
          className="w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
        />
        {suffix && <span className="text-xs text-zinc-500">{suffix}</span>}
      </div>
    </label>
  );
}

interface DerivedFieldProps {
  label: string;
  value: number | null;
  source: "CALCULATED" | "MANUAL";
  onChange: (value: number | null) => void;
  onReset: () => void;
}

function DerivedField({ label, value, source, onChange, onReset }: DerivedFieldProps) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
        {source === "MANUAL" ? (
          <span className="flex items-center gap-1 text-xs">
            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              Manual
            </span>
            <button
              type="button"
              onClick={onReset}
              className="text-emerald-700 underline dark:text-emerald-400"
            >
              Recalcular
            </button>
          </span>
        ) : (
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            Calculada
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          step="any"
          value={value ?? ""}
          onChange={(event) => {
            const raw = event.target.value;
            onChange(raw === "" ? null : Number(raw));
          }}
          className="w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>
    </div>
  );
}

/**
 * Campos de largo/ancho/profundidad + área/volumen derivados o manuales.
 * El padre es dueño del estado (ver src/lib/domain/pondGeometry.ts): este
 * componente solo pinta los campos y avisa de cada cambio.
 */
export function PondGeometryFields({
  geometry,
  onFieldChange,
  onResetArea,
  onResetVolume,
}: {
  geometry: PondGeometryState;
  onFieldChange: (patch: GeometryPatch) => void;
  onResetArea: () => void;
  onResetVolume: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <NumberField
          label="Largo"
          value={geometry.lengthM}
          onChange={(lengthM) => onFieldChange({ lengthM })}
          suffix="m"
        />
        <NumberField
          label="Ancho"
          value={geometry.widthM}
          onChange={(widthM) => onFieldChange({ widthM })}
          suffix="m"
        />
        <NumberField
          label="Profundidad"
          value={geometry.averageDepthM}
          onChange={(averageDepthM) => onFieldChange({ averageDepthM })}
          suffix="m"
        />
      </div>

      <DerivedField
        label="Área (m²)"
        value={geometry.areaM2}
        source={geometry.areaSource}
        onChange={(areaM2) => onFieldChange({ areaM2 })}
        onReset={onResetArea}
      />

      <DerivedField
        label="Volumen estimado (m³)"
        value={geometry.estimatedVolumeM3}
        source={geometry.volumeSource}
        onChange={(estimatedVolumeM3) => onFieldChange({ estimatedVolumeM3 })}
        onReset={onResetVolume}
      />

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        El área y el volumen se calculan solos a partir de las medidas. Si el
        estanque no es rectangular, edítalos directamente: pasan a modo
        &quot;Manual&quot; y ya no se recalculan hasta que toques
        &quot;Recalcular&quot;.
      </p>
    </div>
  );
}
