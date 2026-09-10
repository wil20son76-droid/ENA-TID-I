// POST /api/auth/refresh — renovación silenciosa de la sesión mientras
// haya conexión (§"Regla crítica de autenticación": nunca forzar un
// nuevo login solo porque pasó tiempo). El motor de sync llama a este
// endpoint periódicamente cuando hay red y el token vigente todavía es
// válido (ver src/lib/sync/engine.ts) — un token ya expirado NUNCA se
// puede refrescar por esta vía: en ese caso hace falta un login real, a
// propósito (si se pudiera refrescar un token expirado sin volver a pedir
// contraseña, la "expiración" de 30 días no significaría nada).
import { NextResponse } from "next/server";

import { logger } from "@/lib/server/logger";
import { authenticateRequest } from "@/lib/auth/serverAuth";
import { signSessionToken, SESSION_TTL_SECONDS } from "@/lib/auth/jwt";

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const token = signSessionToken({
    sub: auth.user.id,
    username: auth.user.username,
    name: auth.user.name,
    role: auth.user.role,
    tokenVersion: auth.user.tokenVersion,
  });

  logger.info("Sesión renovada", { username: auth.user.username });

  const response = NextResponse.json({
    token,
    expiresInSeconds: SESSION_TTL_SECONDS,
    user: { id: auth.user.id, username: auth.user.username, name: auth.user.name, role: auth.user.role },
  });
  response.cookies.set("session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}
