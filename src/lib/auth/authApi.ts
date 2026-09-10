// Cliente HTTP delgado hacia /api/auth/* — mismo criterio que
// src/lib/sync/client.ts: solo sabe hablar el protocolo, sin lógica de
// estado (eso vive en SessionContext.tsx/AuthGate.tsx).
import type { UserRole } from "./permissions";

export interface AuthApiUser {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  mustChangePassword?: boolean;
}

export interface AuthApiResult {
  token: string;
  expiresInSeconds: number;
  user: AuthApiUser;
}

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export async function loginRequest(username: string, password: string): Promise<AuthApiResult> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, `No se pudo iniciar sesión (HTTP ${response.status}).`));
  }
  return (await response.json()) as AuthApiResult;
}

export async function refreshRequest(token: string): Promise<AuthApiResult> {
  const response = await fetch("/api/auth/refresh", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, `No se pudo renovar la sesión (HTTP ${response.status}).`));
  }
  return (await response.json()) as AuthApiResult;
}

// --- Recuperación de contraseña (§"Recuperación por email") ---------------
// Las tres funciones de aquí abajo exigen red por definición: forgot/reset
// son el único punto de entrada sin sesión todavía, y change-password usa
// el token recién obtenido en el login con contraseña temporal (que en sí
// mismo ya exigió red). Ver SECURITY.md para la limitación offline
// documentada de todo este flujo.

/** Siempre resuelve con el mismo mensaje genérico — nunca revela si el correo existe (ver la ruta del servidor). */
export async function requestPasswordReset(email: string): Promise<string> {
  const response = await fetch("/api/auth/forgot-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, `No se pudo procesar la solicitud (HTTP ${response.status}).`));
  }
  const body = (await response.json()) as { message: string };
  return body.message;
}

export async function resetPasswordWithToken(token: string, newPassword: string): Promise<string> {
  const response = await fetch("/api/auth/reset-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, newPassword }),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, `No se pudo restablecer la contraseña (HTTP ${response.status}).`));
  }
  const body = (await response.json()) as { message: string };
  return body.message;
}

export async function changePassword(
  sessionToken: string,
  currentPassword: string,
  newPassword: string,
): Promise<AuthApiResult> {
  const response = await fetch("/api/auth/change-password", {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, `No se pudo cambiar la contraseña (HTTP ${response.status}).`));
  }
  return (await response.json()) as AuthApiResult;
}
