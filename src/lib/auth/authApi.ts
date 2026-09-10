// Cliente HTTP delgado hacia /api/auth/* — mismo criterio que
// src/lib/sync/client.ts: solo sabe hablar el protocolo, sin lógica de
// estado (eso vive en SessionContext.tsx/AuthGate.tsx).
import type { UserRole } from "./permissions";

export interface AuthApiUser {
  id: string;
  username: string;
  name: string;
  role: UserRole;
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
