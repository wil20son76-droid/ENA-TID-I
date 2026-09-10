// POST /api/auth/login — único punto de entrada para obtener una sesión.
// Requiere red (§"Regla crítica de autenticación": la PRIMERA vez, o cada
// vez que la sesión local se pierda/expire/revoque). Devuelve un JWT de
// larga duración (30 días, ver jwt.ts) que el dispositivo guarda en
// localStorage y sigue usando offline sin volver a pedir login — la
// sesión también se fija como cookie httpOnly para que middleware.ts
// pueda proteger la primera carga de una página cuando SÍ hay red.
import { NextResponse } from "next/server";

import { prisma } from "@/lib/server/prisma";
import { logger } from "@/lib/server/logger";
import { verifyPassword } from "@/lib/auth/password";
import { signSessionToken, SESSION_TTL_SECONDS } from "@/lib/auth/jwt";
import { isRateLimited, recordFailedAttempt, resetAttempts } from "@/lib/auth/rateLimit";
import { loginRequestSchema } from "@/lib/validation/auth";

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = loginRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Usuario y contraseña son obligatorios." }, { status: 400 });
  }
  const { username, password } = parsed.data;

  if (isRateLimited(username)) {
    logger.warn("Login bloqueado por límite de intentos", { username });
    return NextResponse.json(
      { error: "Demasiados intentos fallidos. Espera unos minutos e intenta de nuevo." },
      { status: 429 },
    );
  }

  const user = await prisma.user.findUnique({ where: { username } });
  const passwordOk = user ? verifyPassword(password, user.passwordHash) : false;

  if (!user || !user.active || !passwordOk) {
    recordFailedAttempt(username);
    logger.warn("Intento de login fallido", { username, reason: !user ? "no existe" : !user.active ? "inactivo" : "contraseña incorrecta" });
    return NextResponse.json({ error: "Usuario o contraseña incorrectos." }, { status: 401 });
  }

  resetAttempts(username);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const token = signSessionToken({
    sub: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    tokenVersion: user.tokenVersion,
  });

  logger.info("Login exitoso", { username: user.username, role: user.role });

  const response = NextResponse.json({
    token,
    expiresInSeconds: SESSION_TTL_SECONDS,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    },
  });

  // httpOnly: el cliente no necesita leer esta cookie (usa su propia copia
  // del token en localStorage para el encabezado Authorization) — solo
  // existe para que middleware.ts proteja la carga inicial de páginas
  // cuando hay red, sin exponerla a lectura por JavaScript (mitigación de
  // robo de sesión vía XSS, ver SECURITY.md).
  response.cookies.set("session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });

  return response;
}
