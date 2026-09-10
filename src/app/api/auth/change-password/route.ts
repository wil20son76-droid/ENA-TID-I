// PATCH /api/auth/change-password — cambio de la propia contraseña estando
// autenticado. Es el endpoint que usa la pantalla obligatoria tras un
// reset por ADMIN (§"Reset por ADMIN": mustChangePassword=true), pero no
// depende de ese estado — sirve igual para un cambio voluntario.
//
// A diferencia de PATCH /api/users/:id (que solo ADMIN puede usar para
// cambiar la contraseña de OTRO usuario), este endpoint siempre actúa
// sobre el propio usuario autenticado (ninguna capacidad especial
// requerida, cualquier rol puede cambiar su propia contraseña) y exige la
// contraseña ACTUAL como confirmación — defensa adicional si el
// dispositivo quedó desbloqueado y con sesión abierta.
//
// Emite un token NUEVO en la respuesta: cambiar la contraseña incrementa
// tokenVersion (revoca cualquier otra sesión de este usuario, en
// cualquier dispositivo — igual que "Cerrar sesiones" desde /usuarios),
// así que sin un token nuevo este mismo dispositivo quedaría
// inmediatamente desconectado justo después de cambiarla.
import { NextResponse } from "next/server";

import { prisma } from "@/lib/server/prisma";
import { logger } from "@/lib/server/logger";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { signSessionToken, SESSION_TTL_SECONDS } from "@/lib/auth/jwt";
import { authenticateRequest } from "@/lib/auth/serverAuth";
import { changePasswordRequestSchema } from "@/lib/validation/auth";

export async function PATCH(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = changePasswordRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Solicitud inválida." },
      { status: 400 },
    );
  }
  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: auth.user.id } });
  if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
    return NextResponse.json({ error: "La contraseña actual no es correcta." }, { status: 401 });
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: hashPassword(newPassword),
      mustChangePassword: false,
      tokenVersion: { increment: 1 },
    },
  });

  const token = signSessionToken({
    sub: updated.id,
    username: updated.username,
    name: updated.name,
    role: updated.role,
    tokenVersion: updated.tokenVersion,
  });

  logger.info("Contraseña propia actualizada", { username: updated.username });

  return NextResponse.json({
    token,
    expiresInSeconds: SESSION_TTL_SECONDS,
    user: {
      id: updated.id,
      username: updated.username,
      name: updated.name,
      role: updated.role,
      mustChangePassword: updated.mustChangePassword,
    },
  });
}
