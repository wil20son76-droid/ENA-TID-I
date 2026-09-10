"use client";

// Contexto de sesión ya autenticada (Fase 7). Provee la sesión actual y
// `logout()` a toda la app (usados por AppShell para el nombre/rol
// visible y el botón "Cerrar sesión"). También renueva el token en
// silencio mientras haya conexión (§"regla crítica de autenticación":
// nunca forzar un login nuevo solo por el paso del tiempo) — si la
// renovación falla (sin red real, sesión revocada o expirada), no pasa
// nada visible: el dispositivo sigue trabajando offline con el token que
// ya tenía hasta el próximo intento o un login manual.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { refreshRequest } from "./authApi";
import { clearSession, setSession as persistSession, type ClientSession } from "./session";

const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // cada 6 horas mientras haya conexión

interface SessionContextValue {
  session: ClientSession;
  logout: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSessionContext(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSessionContext debe usarse dentro de <SessionProvider>.");
  }
  return ctx;
}

export function SessionProvider({
  session: initialSession,
  children,
}: {
  session: ClientSession;
  children: React.ReactNode;
}) {
  const [session, setSessionState] = useState(initialSession);
  const tokenRef = useRef(initialSession.token);

  const logout = useCallback(() => {
    clearSession();
    // Recarga completa: AuthGate se vuelve a montar desde cero, lee
    // localStorage (ya vacío) y muestra la pantalla de login. Los datos
    // productivos en Dexie NUNCA se tocan — cerrar sesión no borra nada
    // registrado localmente.
    window.location.reload();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function tryRefresh() {
      if (!navigator.onLine) return;
      try {
        // `tokenRef` (no `session.token` capturado en el cierre) para que
        // cada intento del intervalo use siempre el token más reciente,
        // incluida una renovación exitosa anterior — nunca uno obsoleto.
        const result = await refreshRequest(tokenRef.current);
        if (cancelled) return;
        const next: ClientSession = {
          token: result.token,
          userId: result.user.id,
          username: result.user.username,
          name: result.user.name,
          role: result.user.role,
        };
        tokenRef.current = next.token;
        persistSession(next);
        setSessionState(next);
      } catch {
        // Ver comentario del módulo: nunca bloquea ni fuerza logout.
      }
    }

    void tryRefresh();
    window.addEventListener("online", tryRefresh);
    const intervalId = window.setInterval(tryRefresh, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.removeEventListener("online", tryRefresh);
      window.clearInterval(intervalId);
    };
  }, []);

  return <SessionContext.Provider value={{ session, logout }}>{children}</SessionContext.Provider>;
}
