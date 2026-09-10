"use client";

// Cambio de contraseña obligatorio tras un reset por ADMIN (§"Reset por
// ADMIN"). AuthGate la muestra en vez de la app real mientras
// `session.mustChangePassword` sea true — la persona ya inició sesión con
// la contraseña temporal (con red), pero no puede usar el resto de la app
// hasta fijar una contraseña propia.
//
// Exige conexión, igual que el login mismo: es la continuación directa de
// ese login (§"Offline": "la recuperación de contraseña requiere
// conexión"). Si el dispositivo pierde la red justo en este paso, el
// envío falla con un error claro y se puede reintentar en cuanto vuelva —
// nunca se pierde ni se corrompe nada porque esta pantalla no toca datos
// productivos (Dexie no interviene aquí).
import { useState } from "react";

import { changePassword } from "@/lib/auth/authApi";
import type { ClientSession } from "@/lib/auth/session";

const inputClass =
  "rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900";

export function ForceChangePasswordScreen({
  session,
  onChanged,
  onLogout,
}: {
  session: ClientSession;
  onChanged: (next: ClientSession) => void;
  onLogout: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("Las dos contraseñas nuevas no coinciden.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await changePassword(session.token, currentPassword, newPassword);
      onChanged({
        token: result.token,
        userId: result.user.id,
        username: result.user.username,
        name: result.user.name,
        role: result.user.role,
        mustChangePassword: false,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar la contraseña.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Debes cambiar tu contraseña
        </h1>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          Un administrador te asignó una contraseña temporal. Elige una contraseña nueva propia
          para seguir usando la app — requiere conexión, igual que el inicio de sesión.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Contraseña temporal actual</span>
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              disabled={submitting}
              required
              className={inputClass}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Contraseña nueva (mínimo 8 caracteres)</span>
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              disabled={submitting}
              required
              minLength={8}
              className={inputClass}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Confirmar contraseña nueva</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              disabled={submitting}
              required
              minLength={8}
              className={inputClass}
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
            {submitting ? "Guardando…" : "Cambiar contraseña"}
          </button>

          <button
            type="button"
            onClick={onLogout}
            className="text-center text-sm text-zinc-500 underline dark:text-zinc-400"
          >
            Cerrar sesión
          </button>
        </form>
      </div>
    </div>
  );
}
