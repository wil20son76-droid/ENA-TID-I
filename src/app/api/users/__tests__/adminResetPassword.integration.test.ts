// Pruebas de integración de "Reset por ADMIN" (§"Reset por ADMIN") vía
// PATCH /api/users/:id, contra PostgreSQL real — mismo criterio que el
// resto de la suite de auth: sin mocks de base de datos.
import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/server/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { signSessionToken } from "@/lib/auth/jwt";
import type { UserRole } from "@/lib/auth/permissions";
import { PATCH as updateUserHandler } from "../[id]/route";

function patchRequest(token: string | undefined, body: unknown) {
  return new Request("http://localhost/api/users/x", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function createUser(role: UserRole, overrides: Partial<{ mustChangePassword: boolean }> = {}) {
  const username = `admin-reset-test-${randomUUID().slice(0, 8)}`;
  const password = "ClaveOriginal1!";
  const user = await prisma.user.create({
    data: {
      username,
      name: "Usuario de prueba",
      passwordHash: hashPassword(password),
      role,
      active: true,
      mustChangePassword: overrides.mustChangePassword ?? false,
      tokenVersion: 1,
    },
  });
  const token = signSessionToken({
    sub: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    tokenVersion: user.tokenVersion,
  });
  return { user, username, password, token };
}

beforeEach(async () => {
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("PATCH /api/users/:id — reset de contraseña por ADMIN", () => {
  it("ADMIN asigna una contraseña temporal: se guarda, marca mustChangePassword y revoca sesiones", async () => {
    const admin = await createUser("ADMIN");
    const target = await createUser("WORKER");
    const beforeUpdate = await prisma.user.findUniqueOrThrow({ where: { id: target.user.id } });

    const response = await updateUserHandler(
      patchRequest(admin.token, { password: "ClaveTemporalNueva1!" }),
      { params: Promise.resolve({ id: target.user.id }) },
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.user.mustChangePassword).toBe(true);

    const afterUpdate = await prisma.user.findUniqueOrThrow({ where: { id: target.user.id } });
    expect(afterUpdate.mustChangePassword).toBe(true);
    expect(afterUpdate.tokenVersion).toBe(beforeUpdate.tokenVersion + 1);
    expect(verifyPassword("ClaveTemporalNueva1!", afterUpdate.passwordHash)).toBe(true);
    // ADMIN nunca puede leer la contraseña anterior: solo se guarda el
    // hash nuevo, no hay ningún campo en la respuesta que la exponga.
    expect(JSON.stringify(body)).not.toContain(target.password);
  });

  it("rechaza con 403 cuando quien llama no es ADMIN", async () => {
    const worker = await createUser("WORKER");
    const target = await createUser("READ_ONLY");

    const response = await updateUserHandler(
      patchRequest(worker.token, { password: "ClaveTemporalNueva1!" }),
      { params: Promise.resolve({ id: target.user.id }) },
    );
    expect(response.status).toBe(403);

    const afterUpdate = await prisma.user.findUniqueOrThrow({ where: { id: target.user.id } });
    expect(afterUpdate.mustChangePassword).toBe(false);
  });

  it("rechaza sin sesión con 401", async () => {
    const target = await createUser("WORKER");
    const response = await updateUserHandler(
      patchRequest(undefined, { password: "ClaveTemporalNueva1!" }),
      { params: Promise.resolve({ id: target.user.id }) },
    );
    expect(response.status).toBe(401);
  });

  it("editar name/role/active SIN tocar password no marca mustChangePassword", async () => {
    const admin = await createUser("ADMIN");
    const target = await createUser("WORKER");

    await updateUserHandler(patchRequest(admin.token, { name: "Nombre editado" }), {
      params: Promise.resolve({ id: target.user.id }),
    });

    const afterUpdate = await prisma.user.findUniqueOrThrow({ where: { id: target.user.id } });
    expect(afterUpdate.mustChangePassword).toBe(false);
    expect(afterUpdate.name).toBe("Nombre editado");
  });
});
