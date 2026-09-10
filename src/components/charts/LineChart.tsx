"use client";

// Gráfico de línea mínimo, sin dependencias externas (Fase 6): SVG plano
// escalado a un `viewBox`, para no arriesgar una librería de gráficos
// incompatible con Turbopack/offline (mismo criterio que el service
// worker escrito a mano — ver IMPLEMENTATION_PLAN.md §7). Puramente
// presentacional: recibe puntos YA calculados por
// `src/lib/analytics/reports.ts`, nunca calcula nada él mismo.

export interface ChartPoint {
  label: string;
  value: number;
}

interface LineChartProps {
  data: readonly ChartPoint[];
  ariaLabel: string;
  valueFormatter?: (value: number) => string;
  height?: number;
}

const WIDTH = 600;

export function LineChart({ data, ariaLabel, valueFormatter, height = 180 }: LineChartProps) {
  if (data.length === 0) {
    return (
      <p className="flex h-[120px] items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
        Sin datos para graficar en este período.
      </p>
    );
  }

  const padding = { top: 12, right: 12, bottom: 24, left: 12 };
  const innerWidth = WIDTH - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const values = data.map((d) => d.value);
  const maxValue = Math.max(...values, 0);
  const minValue = Math.min(...values, 0);
  const range = maxValue - minValue || 1;

  const points = data.map((d, index) => {
    const x = padding.left + (data.length === 1 ? innerWidth / 2 : (index / (data.length - 1)) * innerWidth);
    const y = padding.top + innerHeight - ((d.value - minValue) / range) * innerHeight;
    return { x, y, ...d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const format = valueFormatter ?? ((v: number) => v.toLocaleString("es"));

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${WIDTH} ${height}`}
      className="w-full text-emerald-600 dark:text-emerald-400"
      preserveAspectRatio="xMidYMid meet"
    >
      <title>{ariaLabel}</title>
      <line
        x1={padding.left}
        y1={padding.top + innerHeight}
        x2={WIDTH - padding.right}
        y2={padding.top + innerHeight}
        className="stroke-zinc-300 dark:stroke-zinc-700"
        strokeWidth={1}
      />
      <path d={linePath} fill="none" stroke="currentColor" strokeWidth={2} />
      {points.map((p) => (
        <circle key={p.label} cx={p.x} cy={p.y} r={3} fill="currentColor">
          <title>{`${p.label}: ${format(p.value)}`}</title>
        </circle>
      ))}
      {points.map(
        (p, index) =>
          (index === 0 || index === points.length - 1 || points.length <= 6) && (
            <text
              key={`label-${p.label}`}
              x={p.x}
              y={height - 6}
              textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}
              className="fill-zinc-500 text-[10px] dark:fill-zinc-400"
            >
              {p.label}
            </text>
          ),
      )}
    </svg>
  );
}
