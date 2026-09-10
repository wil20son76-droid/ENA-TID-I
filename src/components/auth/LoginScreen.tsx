"use client";

// Pantalla de login (Fase 7). Es la ÚNICA parte de la app que exige red
// (§"regla crítica de autenticación"): tras un login exitoso, el
// dispositivo guarda la sesión localmente y no vuelve a mostrar esta
// pantalla mientras esa sesión exista, sin importar cuánto tiempo pase
// offline. Nunca se renderiza dentro de AppShell (sin nav, sin
// indicador de sync) — es la puerta de entrada, no una página más.
import { useState } from "react";

import { loginRequest } from "@/lib/auth/authApi";
import type { ClientSession } from "@/lib/auth/session";

export function LoginScreen({ onSuccess }: { onSuccess: (session: ClientSession) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await loginRequest(username, password);
      onSuccess({
        token: result.token,
        userId: result.user.id,
        username: result.user.username,
        name: result.user.name,
        role: result.user.role,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Mi Piscicultura</h1>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          Inicia sesión para continuar. Necesitas conexión solo esta vez — después podrás seguir
          registrando datos sin Internet hasta tu próximo inicio de sesión.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Usuario</span>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={submitting}
              required
              className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Contraseña</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
              required
              className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-emerald-700 px-5 py-3 text-base font-medium text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Iniciando sesión…" : "Iniciar sesión"}
          </button>
        </form>
      </div>
    </div>
  );
}
