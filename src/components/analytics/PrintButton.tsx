"use client";

// Vista imprimible / guardar como PDF (Fase 6): `window.print()` es
// nativo del navegador — funciona sin red y sin ninguna librería de PDF.
// El propio diálogo de impresión del sistema ofrece "Guardar como PDF".
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-600 transition-colors hover:border-emerald-600 hover:text-emerald-700 print:hidden dark:border-zinc-700 dark:text-zinc-300"
    >
      Imprimir / Guardar PDF
    </button>
  );
}
