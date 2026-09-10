"use client";

// Botón de exportación CSV compartido (Fase 6). Nunca calcula nada: solo
// serializa filas ya construidas por la capa analytics y dispara la
// descarga — funciona 100% offline (Blob local, sin red).
import { downloadCsv, toCsv, type CsvColumn } from "@/lib/analytics/csv";

export interface CsvExportButtonProps<T> {
  rows: readonly T[];
  columns: readonly CsvColumn<T>[];
  filename: string;
  label?: string;
}

export function CsvExportButton<T>({ rows, columns, filename, label = "Exportar CSV" }: CsvExportButtonProps<T>) {
  return (
    <button
      type="button"
      onClick={() => downloadCsv(filename, toCsv(rows, columns))}
      disabled={rows.length === 0}
      className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-600 transition-colors hover:border-emerald-600 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 print:hidden dark:border-zinc-700 dark:text-zinc-300"
    >
      {label}
    </button>
  );
}
