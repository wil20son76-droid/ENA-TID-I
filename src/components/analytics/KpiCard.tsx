// Tarjeta de KPI reutilizada en todos los informes (Fase 6) — mismo
// estilo visual que las `StatCard` del dashboard operativo (`/`), aquí
// sin enlace porque los informes ya están en su propia página.
export function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {hint && <span className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>}
    </div>
  );
}
