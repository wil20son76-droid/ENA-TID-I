"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Logo } from "@/components/brand/Logo";
import { SyncStatusBadge } from "@/components/sync/SyncStatusBadge";
import { useSessionContext } from "@/lib/auth/SessionContext";
import { hasCapability, ROLE_LABEL } from "@/lib/auth/permissions";
import { QuickRegisterButton } from "./QuickRegisterButton";

const NAV_ITEMS = [
  { href: "/", label: "Inicio", icon: "🏠" },
  { href: "/especies", label: "Especies", icon: "🐟" },
  { href: "/lotes", label: "Lotes", icon: "📦" },
  { href: "/estanques", label: "Estanques", icon: "🌊" },
  { href: "/alimentacion", label: "Alimentación", icon: "🍽️" },
  { href: "/mortalidad", label: "Mortalidad", icon: "💀" },
  { href: "/calidad-agua", label: "Agua", icon: "💧" },
  { href: "/tareas", label: "Tareas", icon: "✅" },
  { href: "/economia", label: "Economía", icon: "💰" },
  { href: "/informes", label: "Informes", icon: "📊" },
] as const;

/** Solo ADMIN (capacidad MANAGE_USERS) — nunca se muestra a los demás roles. */
const ADMIN_NAV_ITEM = { href: "/usuarios", label: "Usuarios", icon: "👤" } as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      // min-w fijo (no flex-1) a propósito: con 10-11 accesos, un reparto
      // proporcional del ancho fuerza cada etiqueta a un espacio menor al
      // que su texto necesita — el navegador nunca encoge un ítem de flex
      // por debajo del ancho de su contenido (min-width:auto por
      // defecto), así que el contenedor entero terminaba más ancho que
      // el viewport en pantallas de 360-412px (medido: 490px de ancho
      // real en un viewport de 360px). Un ancho mínimo fijo y cómodo por
      // ítem, con scroll horizontal CONTENIDO en la propia barra (nunca
      // en la página — mismo criterio que las tablas de /informes), es
      // la solución: cada destino sigue a un toque, nunca recortado.
      className={`flex min-w-[4.5rem] flex-shrink-0 flex-col items-center gap-0.5 rounded-lg px-1 py-2 text-xs font-medium transition-colors ${
        active
          ? "text-emerald-700 dark:text-emerald-400"
          : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      }`}
      aria-current={active ? "page" : undefined}
    >
      <span className="text-xl leading-none" aria-hidden="true">
        {icon}
      </span>
      {label}
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { session, logout } = useSessionContext();
  const navItems = hasCapability(session.role, "MANAGE_USERS") ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS;

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/95 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur print:hidden dark:border-zinc-800 dark:bg-zinc-950/95">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Logo className="h-8 w-auto flex-shrink-0" />
              <h1 className="truncate text-lg font-semibold">Mi Piscicultura</h1>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span>
                {session.name} · {ROLE_LABEL[session.role]}
              </span>
              <button
                type="button"
                onClick={logout}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-zinc-300 px-3 font-medium text-zinc-600 transition-colors hover:border-red-400 hover:text-red-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-red-400"
              >
                Cerrar sesión
              </button>
            </div>
          </div>
          <SyncStatusBadge />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4 print:pb-0 print:pt-0">
        {children}
      </main>

      <QuickRegisterButton />

      <nav
        className="fixed inset-x-0 bottom-0 z-10 border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur print:hidden dark:border-zinc-800 dark:bg-zinc-950/95"
        aria-label="Navegación principal"
      >
        <div className="mx-auto flex w-full max-w-3xl overflow-x-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={isActive(pathname, item.href)}
            />
          ))}
        </div>
      </nav>
    </div>
  );
}
