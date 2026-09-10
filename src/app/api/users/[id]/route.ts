// PATCH /api/users/:id — editar nombre/rol/estado/contraseña o revocar
// sesiones activas (Fase 7). Solo ADMIN. Cambiar la contraseña o pedir
// `revokeSessions: true` incrementa `tokenVersion`: la próxima vez que
// CUALQUIER dispositivo con una sesión de este usuario intente
// sincronizar, su token queda invalidado y debe volver a iniciar sesión
// (ver serverAuth.ts y SECURITY.md — la revocación nunca es instantánea
// para un dispositivo sin conexión, es la naturaleza misma de
// offline-first).
import { NextResponse } from "next/server";

import { prisma } from "@/lib/server/prisma";
import { logger } from "@/lib/server/logger";
import { hashPassword } from "@/lib/auth/password";
import { requireCapability } from "@/lib/auth/serverAuth";
import { updateUserRequestSchema } from "@/lib/validation/auth";

function serializeUser(user: {
  id: string;
  username: string;
  email: string | null;
  name: string;
  role: string;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
}) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    role: user.role,
    active: user.active,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
  };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, "MANAGE_USERS");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = updateUserRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Solicitud inválida", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const current = await prisma.user.findUnique({ where: { id } });
  if (!current) {
    return NextResponse.json({ error: "Usuario no encontrado." }, { status: 404 });
  }

  const { name, email, role, active, password, revokeSessions } = parsed.data;
  if (email) {
    const existingEmail = await prisma.user.findFirst({ where: { email, id: { not: id } } });
    if (existingEmail) {
      return NextResponse.json({ error: "Ya existe un usuario con ese correo." }, { status: 409 });
    }
  }
  const bumpTokenVersion = Boolean(password) || revokeSessions === true;

  const updated = await prisma.user.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(role !== undefined ? { role } : {}),
      ...(active !== undefined ? { active } : {}),
      ...(password !== undefined
        ? {
            passwordHash: hashPassword(password),
            // Restablecer la contraseña de OTRO usuario desde aquí solo
            // puede hacerlo ADMIN (§"Reset por ADMIN") — nunca es el
            // propio usuario cambiando su contraseña voluntariamente (eso
            // es PATCH /api/auth/change-password). Por eso toda contraseña
            // fijada por esta ruta se trata siempre como temporal: fuerza
            // el cambio obligatorio en el próximo login online.
            mustChangePassword: true,
          }
        : {}),
      ...(bumpTokenVersion ? { tokenVersion: { increment: 1 } } : {}),
    },
  });

  logger.info("Usuario actualizado", {
    username: updated.username,
    updatedBy: auth.user.username,
    revokedSessions: bumpTokenVersion,
    passwordReset: Boolean(password),
  });

  return NextResponse.json({ user: serializeUser(updated) });
}
