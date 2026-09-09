"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { SyncStatusBadge } from "@/components/sync/SyncStatusBadge";
import { QuickRegisterButton } from "./QuickRegisterButton";

const NAV_ITEMS = [
  { href: "/", label: "Inicio", icon: "🏠" },
  { href: "/especies", label: "Especies", icon: "🐟" },
  { href: "/lotes", label: "Lotes", icon: "📦" },
  { href: "/estanques", label: "Estanques", icon: "🌊" },
  { href: "/alimentacion", label: "Alimentación", icon: "🍽️" },
  { href: "/mortalidad", label: "Mortalidad", icon: "💀" },
] as const;

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
      className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg py-2 text-xs font-medium transition-colors ${
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

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          <h1 className="text-lg font-semibold">Mi Piscicultura</h1>
          <SyncStatusBadge />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-4">{children}</main>

      <QuickRegisterButton />

      <nav
        className="fixed inset-x-0 bottom-0 z-10 border-t border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95"
        aria-label="Navegación principal"
      >
        <div className="mx-auto flex max-w-3xl">
          {NAV_ITEMS.map((item) => (
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
