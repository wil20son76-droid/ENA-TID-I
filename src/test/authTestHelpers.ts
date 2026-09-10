// Helper compartido por los tests de integración de /api/sync/* y
// /api/auth/* (Fase 7): crea un usuario de prueba real en la base de
// datos de pruebas y produce un token Bearer válido para los helpers
// locales pushRequest/pullRequest de cada suite. Por defecto crea un
// ADMIN porque la mayoría de estas suites (heredadas de las Fases 1-6)
// ejercitan todo el dominio — catálogos, operación diaria y economía —
// sin que el rol sea lo que se está probando; los tests específicos de
// rol/permisos viven en auth.integration.test.ts.
import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/server/prisma";
import { hashPassword } from "@/lib/auth/password";
import { signSessionToken } from "@/lib/auth/jwt";
import type { UserRole } from "@/lib/auth/permissions";

export async function createTestUser(role: UserRole = "ADMIN") {
  const username = `test-${role.toLowerCase()}-${randomUUID().slice(0, 8)}`;
  const user = await prisma.user.create({
    data: {
      username,
      name: "Usuario de prueba",
      passwordHash: hashPassword("Test1234!"),
      role,
      active: true,
    },
  });
  const token = signSessionToken({
    sub: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    tokenVersion: user.tokenVersion,
  });
  return { user, token };
}

export function authHeader(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}
