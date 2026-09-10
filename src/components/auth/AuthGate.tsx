"use client";

// Puerta de acceso de toda la app (Fase 7, §"regla crítica de
// autenticación"). Decide, SOLO a partir de localStorage (nunca de una
// llamada de red), si se muestra la pantalla de login o la app real:
//
//   1. Lee la sesión local directamente en el render, una vez montado
//      (nunca dentro de un efecto con setState — mismo patrón
//      `useSyncExternalStore`/"mounted" que SyncStatusBadge.tsx, para
//      evitar tanto el discordancia de hidratación servidor/cliente como
//      la regla de lint react-hooks/set-state-in-effect).
//   2. Sin sesión -> <LoginScreen>. Único punto donde la app exige red.
//   3. Con sesión (aunque el dispositivo lleve días offline, aunque el
//      token esté técnicamente cerca de expirar) -> se entra directo a
//      la app. La validez real del token solo la exige el servidor al
//      sincronizar (ver src/lib/sync/client.ts) — nunca se bloquea la
//      lectura/escritura local por esto.
import { useState, useSyncExternalStore } from "react";

import { SessionProvider } from "@/lib/auth/SessionContext";
import { getSession, setSession, type ClientSession } from "@/lib/auth/session";
import { LoginScreen } from "./LoginScreen";

const subscribeNever = () => () => undefined;
function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const mounted = useMounted();
  // Solo se usa para reflejar un login que ACABA de ocurrir en este mismo
  // montaje (evento de usuario, no un efecto) — el resto del tiempo la
  // sesión se lee directo de localStorage en cada render.
  const [justLoggedIn, setJustLoggedIn] = useState<ClientSession | null>(null);

  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Cargando…</p>
      </div>
    );
  }

  const session = justLoggedIn ?? getSession();

  if (!session) {
    return (
      <LoginScreen
        onSuccess={(next) => {
          setSession(next);
          setJustLoggedIn(next);
        }}
      />
    );
  }

  return <SessionProvider session={session}>{children}</SessionProvider>;
}
