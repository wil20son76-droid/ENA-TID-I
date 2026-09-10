// Pruebas de integración de PATCH /api/auth/change-password (Fase "logo +
// recuperación") contra PostgreSQL real, sin mocks — mismo criterio que el
// resto de la suite de auth.
import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/server/prisma";
import { hashPassword } from "@/lib/auth/password";
import { signSessionToken } from "@/lib/auth/jwt";
import { PATCH as changePasswordHandler } from "../change-password/route";
import { POST as loginHandler } from "../login/route";

function changeRequest(token: string | undefined, body: unknown) {
  return new Request("http://localhost/api/auth/change-password", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function loginRequest(body: unknown) {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createUser(overrides: Partial<{ mustChangePassword: boolean }> = {}) {
  const username = `change-pw-test-${randomUUID().slice(0, 8)}`;
  const password = "ClaveTemporal1!";
  const user = await prisma.user.create({
    data: {
      username,
      name: "Usuario de prueba",
      passwordHash: hashPassword(password),
      role: "WORKER",
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

describe("PATCH /api/auth/change-password", () => {
  it("cambia la contraseña con la contraseña actual correcta y devuelve un token nuevo", async () => {
    const { token, username } = await createUser({ mustChangePassword: true });

    const response = await changePasswordHandler(
      changeRequest(token, { currentPassword: "ClaveTemporal1!", newPassword: "ClaveDefinitiva2!" }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(typeof body.token).toBe("string");
    expect(body.user.mustChangePassword).toBe(false);

    const loginResponse = await loginHandler(loginRequest({ username, password: "ClaveDefinitiva2!" }));
    expect(loginResponse.status).toBe(200);
  });

  it("rechaza con 401 si la contraseña actual es incorrecta", async () => {
    const { token } = await createUser();
    const response = await changePasswordHandler(
      changeRequest(token, { currentPassword: "incorrecta", newPassword: "ClaveDefinitiva2!" }),
    );
    expect(response.status).toBe(401);
  });

  it("rechaza sin token de sesión con 401", async () => {
    const response = await changePasswordHandler(
      changeRequest(undefined, { currentPassword: "x", newPassword: "ClaveDefinitiva2!" }),
    );
    expect(response.status).toBe(401);
  });

  it("apaga mustChangePassword tras un cambio exitoso", async () => {
    const { token, user } = await createUser({ mustChangePassword: true });
    await changePasswordHandler(
      changeRequest(token, { currentPassword: "ClaveTemporal1!", newPassword: "ClaveDefinitiva2!" }),
    );
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.mustChangePassword).toBe(false);
  });

  it("revoca el token anterior: usarlo de nuevo tras el cambio falla", async () => {
    const { token } = await createUser();
    await changePasswordHandler(
      changeRequest(token, { currentPassword: "ClaveTemporal1!", newPassword: "ClaveDefinitiva2!" }),
    );

    // El MISMO token original (tokenVersion vieja) ya no debe servir para
    // un segundo cambio — mismo mecanismo de revocación que "Cerrar
    // sesiones" desde /usuarios.
    const secondAttempt = await changePasswordHandler(
      changeRequest(token, { currentPassword: "ClaveDefinitiva2!", newPassword: "OtraClave3!" }),
    );
    expect(secondAttempt.status).toBe(401);
  });

  it("rechaza una contraseña nueva demasiado corta con 400", async () => {
    const { token } = await createUser();
    const response = await changePasswordHandler(
      changeRequest(token, { currentPassword: "ClaveTemporal1!", newPassword: "corta" }),
    );
    expect(response.status).toBe(400);
  });
});
