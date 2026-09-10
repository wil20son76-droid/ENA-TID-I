"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useSessionContext } from "@/lib/auth/SessionContext";
import { canWriteEntity } from "@/lib/auth/permissions";

const OPTIONS = [
  { href: "/alimentacion/nueva", label: "Alimentación", icon: "🍽️", entityType: "RegisterFeeding" },
  { href: "/mortalidad/nueva", label: "Mortalidad", icon: "💀", entityType: "MortalityRecord" },
  { href: "/muestreos/nuevo", label: "Muestreo", icon: "📏", entityType: "Sampling" },
  { href: "/calidad-agua/nueva", label: "Calidad del agua", icon: "💧", entityType: "WaterQualityRecord" },
  // Fase 5 (§48 del encargo): cosecha y gasto son registros simples de un
  // solo evento, igual criterio que el resto de esta lista — compra y
  // venta NO se agregan aquí porque son de varias líneas/campos y
  // saturarían este menú rápido (§48: "no forzar compras/ventas
  // complejas en un menú rápido si empeora la UX").
  { href: "/cosechas/nueva", label: "Cosecha", icon: "🎣", entityType: "Harvest" },
  { href: "/gastos/nuevo", label: "Gasto", icon: "💸", entityType: "Expense" },
] as const;

/** Separado del grupo de registros de producción (§28 del encargo de
 * Fase 4: "Separar + Nueva tarea si la UX queda más clara") — una tarea
 * no es un registro de producción, es una acción a futuro. */
const TASK_OPTION = { href: "/tareas/nueva", label: "Nueva tarea", icon: "📝", entityType: "Task" } as const;

/**
 * Botón "+ Registrar" global (§38 del encargo de Fase 3): presente en
 * cualquier pantalla principal, no solo dentro de la ficha de un
 * estanque/lote concreto — por eso vive en AppShell en vez de en cada
 * página. Las páginas de destino piden el estanque/lote manualmente
 * cuando no llegan preseleccionados.
 */
/**
 * Fase 7 (§"Roles básicos"): solo se listan las acciones que el rol
 * actual puede realmente enviar — el servidor las rechazaría igual
 * (ver /api/sync/push), pero mostrarlas deshabilitadas o dejar que
 * fallen tras el hecho es peor UX que no ofrecerlas. Un "Solo lectura"
 * ve este botón vacío (ninguna opción) en vez de un montón de acciones
 * que siempre fallarían.
 */
export function QuickRegisterButton() {
  const [open, setOpen] = useState(false);
  const { session } = useSessionContext();
  const pathname = usePathname();

  const options = OPTIONS.filter((option) => canWriteEntity(session.role, option.entityType));
  const canCreateTask = canWriteEntity(session.role, TASK_OPTION.entityType);

  // /usuarios (Fase 7): gestión de cuentas, no un registro de campo — el
  // FAB no aporta nada ahí y, en pantallas móviles angostas, su posición
  // fija (esquina inferior derecha) puede quedar sobre las acciones de la
  // última fila de esa tabla.
  if (pathname === "/usuarios") return null;
  if (options.length === 0 && !canCreateTask) return null;

  return (
    <div className="fixed bottom-20 right-4 z-20 flex flex-col items-end gap-2 print:hidden">
      {open && (
        <div className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          {options.map((option) => (
            <Link
              key={option.href}
              href={option.href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <span aria-hidden="true">{option.icon}</span>
              {option.label}
            </Link>
          ))}
          {canCreateTask && (
            <>
              <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
              <Link
                href={TASK_OPTION.href}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <span aria-hidden="true">{TASK_OPTION.icon}</span>
                {TASK_OPTION.label}
              </Link>
            </>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Cerrar registro rápido" : "Registrar"}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-700 text-2xl leading-none text-white shadow-lg transition-transform hover:bg-emerald-800 active:scale-95"
      >
        {open ? "×" : "+"}
      </button>
    </div>
  );
}
