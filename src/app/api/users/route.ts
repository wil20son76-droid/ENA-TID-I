// GET/POST /api/users — gestión de cuentas (Fase 7, §"Roles básicos").
// Solo ADMIN (capacidad MANAGE_USERS). Deliberadamente NO pasa por
// Dexie/syncQueue: los usuarios se gestionan siempre en línea, contra
// esta tabla directamente — ver la nota en prisma/schema.prisma (modelo
// User) y SECURITY.md para el porqué.
import { NextResponse } from "next/server";

import { prisma } from "@/lib/server/prisma";
import { logger } from "@/lib/server/logger";
import { hashPassword } from "@/lib/auth/password";
import { requireCapability } from "@/lib/auth/serverAuth";
import { createUserRequestSchema } from "@/lib/validation/auth";

function serializeUser(user: {
  id: string;
  username: string;
  name: string;
  role: string;
  active: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
}) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
  };
}

export async function GET(request: Request) {
  const auth = await requireCapability(request, "MANAGE_USERS");
  if (!auth.ok) return auth.response;

  const users = await prisma.user.findMany({ orderBy: { username: "asc" } });
  return NextResponse.json({ users: users.map(serializeUser) });
}

export async function POST(request: Request) {
  const auth = await requireCapability(request, "MANAGE_USERS");
  if (!auth.ok) return auth.response;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = createUserRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Solicitud inválida", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { username, name, password, role } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return NextResponse.json({ error: "Ya existe un usuario con ese nombre." }, { status: 409 });
  }

  const user = await prisma.user.create({
    data: { username, name, passwordHash: hashPassword(password), role, active: true },
  });

  logger.info("Usuario creado", { username: user.username, role: user.role, createdBy: auth.user.username });

  return NextResponse.json({ user: serializeUser(user) }, { status: 201 });
}
