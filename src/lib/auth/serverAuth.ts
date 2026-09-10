// Autenticación/autorización del lado servidor (Fase 7, §"Protección de
// API y rutas" / §"Validación de permisos también en servidor"). Esta es
// la barrera de seguridad REAL — cualquier gating del lado cliente
// (ocultar un botón, deshabilitar un formulario) es solo UX, nunca
// suficiente por sí solo (§59 del criterio histórico del proyecto: nunca
// confiar solo en el cliente).
import { NextResponse } from "next/server";

import { prisma } from "@/lib/server/prisma";
import { verifySessionToken, type SessionTokenPayload, type UserRole } from "./jwt";
import { hasCapability, type Capability } from "./permissions";

export interface AuthenticatedUser {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  tokenVersion: number;
}

export type AuthFailureReason =
  | "MISSING_TOKEN"
  | "INVALID_TOKEN"
  | "EXPIRED_TOKEN"
  | "REVOKED"
  | "INACTIVE_USER";

export type AuthResult =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; status: 401; reason: AuthFailureReason; error: string };

function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

/**
 * Verifica el JWT y, además, revalida contra la base de datos que el
 * usuario sigue activo y que su `tokenVersion` no cambió desde el login
 * (mecanismo de revocación — ver User.tokenVersion en schema.prisma).
 * Esta consulta ya es necesaria de todas formas para /api/sync/*, así que
 * no añade una llamada extra "solo para auth".
 */
export async function authenticateRequest(request: Request): Promise<AuthResult> {
  const token = extractBearerToken(request);
  if (!token) {
    return { ok: false, status: 401, reason: "MISSING_TOKEN", error: "Falta el encabezado Authorization." };
  }

  const result = verifySessionToken(token);
  if (!result.valid) {
    return result.expired
      ? {
          ok: false,
          status: 401,
          reason: "EXPIRED_TOKEN",
          error: "La sesión expiró. Inicia sesión de nuevo para sincronizar.",
        }
      : { ok: false, status: 401, reason: "INVALID_TOKEN", error: "Token inválido." };
  }

  const payload: SessionTokenPayload = result.payload;
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.active) {
    return { ok: false, status: 401, reason: "INACTIVE_USER", error: "Usuario inactivo o inexistente." };
  }
  if (user.tokenVersion !== payload.tokenVersion) {
    return {
      ok: false,
      status: 401,
      reason: "REVOKED",
      error: "La sesión fue revocada. Inicia sesión de nuevo.",
    };
  }

  return {
    ok: true,
    user: { id: user.id, username: user.username, name: user.name, role: user.role, tokenVersion: user.tokenVersion },
  };
}

export type RequireCapabilityResult =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; response: NextResponse };

/** Azúcar sobre `authenticateRequest` para rutas que exigen una capacidad concreta (p. ej. MANAGE_USERS en /api/users). */
export async function requireCapability(
  request: Request,
  capability: Capability,
): Promise<RequireCapabilityResult> {
  const auth = await authenticateRequest(request);
  if (!auth.ok) {
    return { ok: false, response: NextResponse.json({ error: auth.error }, { status: auth.status }) };
  }
  if (!hasCapability(auth.user.role, capability)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No tienes permiso para esta acción." },
        { status: 403 },
      ),
    };
  }
  return { ok: true, user: auth.user };
}
