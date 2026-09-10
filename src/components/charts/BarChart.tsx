"use client";

// Gráfico de barras mínimo, mismo criterio que LineChart.tsx: SVG plano,
// sin dependencias externas, puramente presentacional.

export interface ChartPoint {
  label: string;
  value: number;
}

interface BarChartProps {
  data: readonly ChartPoint[];
  ariaLabel: string;
  valueFormatter?: (value: number) => string;
  height?: number;
}

const WIDTH = 600;

export function BarChart({ data, ariaLabel, valueFormatter, height = 180 }: BarChartProps) {
  if (data.length === 0) {
    return (
      <p className="flex h-[120px] items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
        Sin datos para graficar en este período.
      </p>
    );
  }

  const padding = { top: 16, right: 12, bottom: 28, left: 12 };
  const innerWidth = WIDTH - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const format = valueFormatter ?? ((v: number) => v.toLocaleString("es"));

  const gap = 6;
  const barWidth = Math.max(4, innerWidth / data.length - gap);

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
      {data.map((d, index) => {
        const barHeight = (d.value / maxValue) * innerHeight;
        const x = padding.left + index * (barWidth + gap);
        const y = padding.top + innerHeight - barHeight;
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={barWidth} height={Math.max(0, barHeight)} fill="currentColor" rx={2}>
              <title>{`${d.label}: ${format(d.value)}`}</title>
            </rect>
            {data.length <= 12 && (
              <text
                x={x + barWidth / 2}
                y={height - 8}
                textAnchor="middle"
                className="fill-zinc-500 text-[9px] dark:fill-zinc-400"
              >
                {d.label.length > 10 ? `${d.label.slice(0, 9)}…` : d.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
