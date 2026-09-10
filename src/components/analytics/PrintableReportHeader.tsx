// Encabezado con logo, SOLO visible al imprimir/exportar a PDF
// (§"informes imprimibles/PDF"). AppShell oculta su propio header al
// imprimir (`print:hidden`, ver AppShell.tsx) porque trae controles de
// sesión/nav que no pintan en un informe — este componente es lo que
// reemplaza esa identidad visual en la hoja impresa, junto con el título
// del informe y la fecha de generación.
import { Logo } from "@/components/brand/Logo";

export function PrintableReportHeader({ title }: { title: string }) {
  return (
    <div className="mb-4 hidden items-center justify-between border-b border-zinc-300 pb-2 print:flex">
      <div className="flex items-center gap-2">
        <Logo className="h-10 w-auto" />
        <div>
          <p className="text-sm font-semibold text-zinc-900">ENA TID’I</p>
          <p className="text-xs text-zinc-500">{title}</p>
        </div>
      </div>
      <p className="text-xs text-zinc-500">
        {new Intl.DateTimeFormat("es", { dateStyle: "long", timeStyle: "short" }).format(new Date())}
      </p>
    </div>
  );
}
