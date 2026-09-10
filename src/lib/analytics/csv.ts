// Exportación CSV (Fase 6). Genera el CSV en memoria a partir de filas ya
// calculadas por reports.ts/comparison.ts — este módulo nunca calcula
// nada, solo serializa. `downloadCsv` es la única función que toca el DOM
// (crea un Blob + un enlace temporal), separada a propósito de `toCsv`
// (pura, testeable sin `document`/`Blob`).

export interface CsvColumn<T> {
  key: string;
  label: string;
  value: (row: T) => string | number | null;
}

function escapeCsvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  // RFC 4180: si el valor contiene coma, comilla o salto de línea, se
  // envuelve entre comillas dobles y cada comilla interna se duplica.
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Serializa filas a CSV (con BOM UTF-8, para que Excel abra bien los
 * acentos en español) — pura, sin efectos secundarios, testeable en
 * Node/Vitest sin ningún API de navegador.
 */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCsvCell(c.label)).join(",");
  const lines = rows.map((row) => columns.map((c) => escapeCsvCell(c.value(row))).join(","));
  return ["﻿" + header, ...lines].join("\r\n");
}

/**
 * Dispara la descarga de un CSV ya serializado — offline por diseño
 * (Blob + URL.createObjectURL, sin ninguna llamada de red). Solo debe
 * llamarse desde un manejador de evento en el navegador.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
