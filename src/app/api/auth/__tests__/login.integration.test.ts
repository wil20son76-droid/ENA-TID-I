// Pruebas de integración de /api/auth/login y /api/auth/refresh (Fase 7)
// contra PostgreSQL real (piscicultura_test), sin mocks — mismo criterio
// que el resto de la suite de sync.
import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/server/prisma";
import { hashPassword } from "@/lib/auth/password";
import { POST as loginHandler } from "../login/route";
import { POST as refreshHandler } from "../refresh/route";

function loginRequest(body: unknown) {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function refreshRequest(token?: string) {
  return new Request("http://localhost/api/auth/refresh", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

async function createUser(overrides: Partial<{ role: "ADMIN" | "MANAGER" | "WORKER" | "READ_ONLY"; active: boolean }> = {}) {
  const username = `login-test-${randomUUID().slice(0, 8)}`;
  const password = "Clave1234!";
  const user = await prisma.user.create({
    data: {
      username,
      name: "Usuario de prueba",
      passwordHash: hashPassword(password),
      role: overrides.role ?? "ADMIN",
      active: overrides.active ?? true,
    },
  });
  return { user, username, password };
}

beforeEach(async () => {
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /api/auth/login", () => {
  it("inicia sesión con usuario y contraseña correctos y devuelve un token", async () => {
    const { username, password } = await createUser({ role: "ADMIN" });
    const response = await loginHandler(loginRequest({ username, password }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(typeof body.token).toBe("string");
    expect(body.user.username).toBe(username);
    expect(body.user.role).toBe("ADMIN");
    expect(response.headers.get("set-cookie")).toMatch(/session=/);
  });

  it("rechaza una contraseña incorrecta con el mismo mensaje que un usuario inexistente", async () => {
    const { username } = await createUser();

    const wrongPassword = await loginHandler(loginRequest({ username, password: "incorrecta" }));
    const noSuchUser = await loginHandler(loginRequest({ username: "no-existe-nunca", password: "cualquiera" }));

    expect(wrongPassword.status).toBe(401);
    expect(noSuchUser.status).toBe(401);
    expect((await wrongPassword.json()).error).toBe((await noSuchUser.json()).error);
  });

  it("rechaza un usuario inactivo aunque la contraseña sea correcta", async () => {
    const { username, password } = await createUser({ active: false });
    const response = await loginHandler(loginRequest({ username, password }));
    expect(response.status).toBe(401);
  });

  it("bloquea con 429 tras demasiados intentos fallidos seguidos (rate limit)", async () => {
    const { username } = await createUser();

    let lastStatus = 0;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await loginHandler(loginRequest({ username, password: "incorrecta" }));
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });

  it("rechaza una solicitud sin usuario/contraseña con 400", async () => {
    const response = await loginHandler(loginRequest({}));
    expect(response.status).toBe(400);
  });
});

describe("POST /api/auth/refresh", () => {
  it("renueva un token válido y devuelve el perfil actualizado", async () => {
    // No se compara con el token original byte a byte: un JWT firmado con
    // los mismos claims (sub/role/tokenVersion) dentro del mismo segundo
    // (iat con granularidad de segundo) es legítimamente idéntico — lo
    // que importa es que la renovación responde 200 con un token
    // vigente, no que cambie el string.
    const { username, password } = await createUser({ role: "MANAGER" });
    const loginResponse = await loginHandler(loginRequest({ username, password }));
    const { token } = await loginResponse.json();

    const refreshResponse = await refreshHandler(refreshRequest(token));
    expect(refreshResponse.status).toBe(200);
    const body = await refreshResponse.json();
    expect(typeof body.token).toBe("string");
    expect(body.user.role).toBe("MANAGER");
    expect(body.expiresInSeconds).toBeGreaterThan(0);
  });

  it("rechaza refrescar sin token", async () => {
    const response = await refreshHandler(refreshRequest());
    expect(response.status).toBe(401);
  });

  it("rechaza refrescar con un token de un usuario ya desactivado", async () => {
    const { user, username, password } = await createUser();
    const loginResponse = await loginHandler(loginRequest({ username, password }));
    const { token } = await loginResponse.json();

    await prisma.user.update({ where: { id: user.id }, data: { active: false } });

    const response = await refreshHandler(refreshRequest(token));
    expect(response.status).toBe(401);
  });
});
