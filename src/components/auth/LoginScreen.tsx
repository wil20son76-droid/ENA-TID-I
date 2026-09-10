"use client";

// Pantalla de login (Fase 7). Es la ÚNICA parte de la app que exige red
// (§"regla crítica de autenticación"): tras un login exitoso, el
// dispositivo guarda la sesión localmente y no vuelve a mostrar esta
// pantalla mientras esa sesión exista, sin importar cuánto tiempo pase
// offline. Nunca se renderiza dentro de AppShell (sin nav, sin
// indicador de sync) — es la puerta de entrada, no una página más.
//
// También aloja el flujo de recuperación de contraseña (§"Recuperación
// por email") en dos modos adicionales, "forgot" y "reset" — sin rutas
// nuevas de Next.js: AuthGate envuelve TODA la app (ver layout.tsx) y
// muestra esta pantalla para cualquier URL mientras no haya sesión, así
// que el enlace de recuperación por email apunta a "/?resetToken=..." en
// la raíz — el modo "reset" se detecta leyendo ese parámetro de la URL,
// nunca hace falta una ruta dedicada.
import { useState } from "react";

import { loginRequest, requestPasswordReset, resetPasswordWithToken } from "@/lib/auth/authApi";
import type { ClientSession } from "@/lib/auth/session";
import { Logo } from "@/components/brand/Logo";

const inputClass =
  "rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900";

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <Logo className="mx-auto mb-4 h-16 w-auto" />
        {children}
      </div>
    </div>
  );
}

function LoginForm({ onSuccess, onForgot }: { onSuccess: (session: ClientSession) => void; onForgot: () => void }) {
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
        mustChangePassword: result.user.mustChangePassword,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <h1 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">ENA TID’I</h1>
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
            className={inputClass}
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
          {submitting ? "Iniciando sesión…" : "Iniciar sesión"}
        </button>

        <button type="button" onClick={onForgot} className="text-center text-sm text-emerald-700 underline dark:text-emerald-400">
          ¿Olvidaste tu contraseña?
        </button>
      </form>
    </>
  );
}

function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const message = await requestPasswordReset(email);
      setResult(message);
    } catch (err) {
      // Solo llega aquí por un error de red/servidor real (400/429) — el
      // servidor nunca responde distinto por "el correo no existe" (ver
      // /api/auth/forgot-password): eso se muestra con el mismo mensaje
      // genérico de éxito de todas formas.
      setError(err instanceof Error ? err.message : "No se pudo procesar la solicitud.");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <>
        <h1 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Revisa tu correo</h1>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">{result}</p>
        <button type="button" onClick={onBack} className="text-sm text-emerald-700 underline dark:text-emerald-400">
          Volver a iniciar sesión
        </button>
      </>
    );
  }

  return (
    <>
      <h1 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Recuperar contraseña</h1>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        Escribe el correo asociado a tu cuenta. Si existe, te enviamos un enlace para elegir una
        contraseña nueva — requiere conexión.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Correo</span>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={submitting}
            required
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
          {submitting ? "Enviando…" : "Enviar enlace de recuperación"}
        </button>

        <button type="button" onClick={onBack} className="text-center text-sm text-zinc-500 underline dark:text-zinc-400">
          Volver a iniciar sesión
        </button>
      </form>
    </>
  );
}

function ResetPasswordForm({ token }: { token: string }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Las dos contraseñas no coinciden.");
      return;
    }
    setSubmitting(true);
    try {
      await resetPasswordWithToken(token, newPassword);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo restablecer la contraseña.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <>
        <h1 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Contraseña actualizada</h1>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          Ya puedes iniciar sesión con tu nueva contraseña.
        </p>
        <button
          type="button"
          // Recarga completa (no navegación de cliente, mismo patrón que
          // logout() en SessionContext.tsx): limpia "?resetToken=..." de
          // la URL y fuerza a AuthGate a montar de cero — el token ya se
          // consumió en el servidor (un solo uso), así que no debe quedar
          // reutilizable ni en el historial del navegador de esta pestaña.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          onClick={() => window.location.assign("/")}
          className="text-sm text-emerald-700 underline dark:text-emerald-400"
        >
          Ir a iniciar sesión
        </button>
      </>
    );
  }

  return (
    <>
      <h1 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Elige una contraseña nueva</h1>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        Este enlace es de un solo uso y expira a los 30 minutos de haberlo pedido.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
          <span className="text-zinc-600 dark:text-zinc-400">Confirmar contraseña</span>
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
          {submitting ? "Guardando…" : "Guardar contraseña nueva"}
        </button>
      </form>
    </>
  );
}

export function LoginScreen({ onSuccess }: { onSuccess: (session: ClientSession) => void }) {
  // Lectura perezosa única (nunca en un efecto): LoginScreen solo se
  // monta ya en cliente, después del "mounted" gate de AuthGate — mismo
  // razonamiento que justifica leer localStorage directo en session.ts.
  const [resetToken] = useState(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("resetToken");
  });
  const [mode, setMode] = useState<"login" | "forgot">("login");

  if (resetToken) {
    return (
      <CardShell>
        <ResetPasswordForm token={resetToken} />
      </CardShell>
    );
  }

  return (
    <CardShell>
      {mode === "login" ? (
        <LoginForm onSuccess={onSuccess} onForgot={() => setMode("forgot")} />
      ) : (
        <ForgotPasswordForm onBack={() => setMode("login")} />
      )}
    </CardShell>
  );
}
