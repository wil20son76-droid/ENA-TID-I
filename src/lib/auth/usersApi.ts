// Cliente HTTP hacia /api/users — deliberadamente separado de
// src/lib/sync/client.ts: la gestión de usuarios NUNCA pasa por el
// outbox/Dexie (ver la nota en prisma/schema.prisma, modelo User), así
// que este módulo habla directo contra la API, sin pasar por
// syncQueueRepository. Solo funciona con conexión — ver SECURITY.md.
import { getSession } from "./session";
import type { UserRole } from "./permissions";

export interface AdminUser {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

function authHeaders(): Record<string, string> {
  const session = getSession();
  return session ? { authorization: `Bearer ${session.token}` } : {};
}

async function parseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export async function listUsers(): Promise<AdminUser[]> {
  const response = await fetch("/api/users", { headers: authHeaders() });
  if (!response.ok) {
    throw new Error(await parseError(response, "No se pudo cargar la lista de usuarios."));
  }
  const body = (await response.json()) as { users: AdminUser[] };
  return body.users;
}

export interface CreateUserInput {
  username: string;
  name: string;
  password: string;
  role: UserRole;
}

export async function createUser(input: CreateUserInput): Promise<AdminUser> {
  const response = await fetch("/api/users", {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await parseError(response, "No se pudo crear el usuario."));
  }
  const body = (await response.json()) as { user: AdminUser };
  return body.user;
}

export interface UpdateUserInput {
  name?: string;
  role?: UserRole;
  active?: boolean;
  password?: string;
  revokeSessions?: boolean;
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<AdminUser> {
  const response = await fetch(`/api/users/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await parseError(response, "No se pudo actualizar el usuario."));
  }
  const body = (await response.json()) as { user: AdminUser };
  return body.user;
}
