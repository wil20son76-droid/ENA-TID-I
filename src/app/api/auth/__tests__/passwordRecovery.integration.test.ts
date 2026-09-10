// Pruebas de integración de la recuperación de contraseña por email
// (§"Recuperación por email") contra PostgreSQL real (piscicultura_test),
// sin mocks de base de datos — mismo criterio que login.integration.test.ts.
// Solo se mockea el envío de email (src/lib/server/email.ts): no hay
// proveedor real configurado en este entorno de test, así que se
// intercepta para capturar el enlace de recuperación tal como se lo
// mandaríamos a la persona, exactamente como lo haría un proveedor real.
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/server/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

const sendEmailMock = vi.fn().mockResolvedValue({ sent: true });
vi.mock("@/lib/server/email", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

import { POST as forgotPasswordHandler } from "../forgot-password/route";
import { POST as resetPasswordHandler } from "../reset-password/route";
import { POST as loginHandler } from "../login/route";

function forgotRequest(body: unknown) {
  return new Request("http://localhost/api/auth/forgot-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function resetRequest(body: unknown) {
  return new Request("http://localhost/api/auth/reset-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
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

/** Extrae el token crudo del enlace "?resetToken=..." capturado en el email mockeado. */
function extractTokenFromLastEmail(): string {
  const lastCall = sendEmailMock.mock.calls.at(-1);
  const message = lastCall?.[0] as { text: string } | undefined;
  if (!message) throw new Error("sendEmail no fue llamado");
  const match = message.text.match(/resetToken=([^\s]+)/);
  if (!match) throw new Error("No se encontró el token en el email capturado");
  return match[1];
}

async function createUser(overrides: Partial<{ email: string; active: boolean }> = {}) {
  const username = `reset-test-${randomUUID().slice(0, 8)}`;
  const email = overrides.email ?? `${username}@example.com`;
  const password = "ClaveVieja1234!";
  const user = await prisma.user.create({
    data: {
      username,
      email,
      name: "Usuario de prueba",
      passwordHash: hashPassword(password),
      role: "WORKER",
      active: overrides.active ?? true,
    },
  });
  return { user, username, email, password };
}

beforeEach(async () => {
  await prisma.passwordResetToken.deleteMany();
  await prisma.user.deleteMany();
  sendEmailMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /api/auth/forgot-password", () => {
  it("genera un token y envía el enlace cuando el email existe y está activo", async () => {
    const { email, user } = await createUser();

    const response = await forgotPasswordHandler(forgotRequest({ email }));
    expect(response.status).toBe(200);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    const tokens = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].usedAt).toBeNull();
  });

  it("responde con el mismo mensaje y estado 200 para un email que no existe (no revela nada)", async () => {
    const { email } = await createUser();

    const existing = await forgotPasswordHandler(forgotRequest({ email }));
    const nonExisting = await forgotPasswordHandler(
      forgotRequest({ email: `no-existe-${randomUUID().slice(0, 8)}@example.com` }),
    );

    expect(existing.status).toBe(200);
    expect(nonExisting.status).toBe(200);
    expect((await existing.json()).message).toBe((await nonExisting.json()).message);
    // Solo se envió un email real (el de la cuenta que sí existe).
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("no genera token ni envía email para una cuenta inactiva, pero responde igual con 200", async () => {
    const { email } = await createUser({ active: false });

    const response = await forgotPasswordHandler(forgotRequest({ email }));
    expect(response.status).toBe(200);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("rechaza un email con formato inválido con 400", async () => {
    const response = await forgotPasswordHandler(forgotRequest({ email: "no-es-un-email" }));
    expect(response.status).toBe(400);
  });

  it("bloquea con 429 tras demasiadas solicitudes seguidas para el mismo email (rate limit)", async () => {
    const { email } = await createUser();

    let lastStatus = 0;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await forgotPasswordHandler(forgotRequest({ email }));
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe("POST /api/auth/reset-password", () => {
  it("con un token válido, cambia la contraseña y permite iniciar sesión con la nueva", async () => {
    const { email, username } = await createUser();
    await forgotPasswordHandler(forgotRequest({ email }));
    const token = extractTokenFromLastEmail();

    const response = await resetPasswordHandler(resetRequest({ token, newPassword: "ClaveNueva5678!" }));
    expect(response.status).toBe(200);

    const loginOld = await loginHandler(loginRequest({ username, password: "ClaveVieja1234!" }));
    expect(loginOld.status).toBe(401);

    const loginNew = await loginHandler(loginRequest({ username, password: "ClaveNueva5678!" }));
    expect(loginNew.status).toBe(200);
  });

  it("revoca las sesiones anteriores (tokenVersion incrementa) al restablecer la contraseña", async () => {
    const { email, user } = await createUser();
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    await forgotPasswordHandler(forgotRequest({ email }));
    const token = extractTokenFromLastEmail();
    await resetPasswordHandler(resetRequest({ token, newPassword: "ClaveNueva5678!" }));

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);
  });

  it("invalida el token tras usarlo: un segundo intento con el mismo token se rechaza", async () => {
    const { email } = await createUser();
    await forgotPasswordHandler(forgotRequest({ email }));
    const token = extractTokenFromLastEmail();

    const first = await resetPasswordHandler(resetRequest({ token, newPassword: "ClaveNueva5678!" }));
    expect(first.status).toBe(200);

    const second = await resetPasswordHandler(resetRequest({ token, newPassword: "OtraClave9999!" }));
    expect(second.status).toBe(400);
  });

  it("rechaza un token expirado", async () => {
    const { email, user } = await createUser();
    await forgotPasswordHandler(forgotRequest({ email }));
    const token = extractTokenFromLastEmail();

    // Se fuerza la expiración directamente en la base (ya pasó su ventana
    // de 30 minutos) en vez de mockear Date.now — más simple y más fiel a
    // lo que realmente comprueba el servidor (expiresAt contra "ahora").
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const response = await resetPasswordHandler(resetRequest({ token, newPassword: "ClaveNueva5678!" }));
    expect(response.status).toBe(400);
  });

  it("rechaza un token que nunca existió, con el mismo mensaje genérico", async () => {
    const response = await resetPasswordHandler(
      resetRequest({ token: "token-inventado-que-nunca-existio-1234567890", newPassword: "ClaveNueva5678!" }),
    );
    expect(response.status).toBe(400);
  });

  it("rechaza una contraseña nueva demasiado corta con 400", async () => {
    const { email } = await createUser();
    await forgotPasswordHandler(forgotRequest({ email }));
    const token = extractTokenFromLastEmail();

    const response = await resetPasswordHandler(resetRequest({ token, newPassword: "corta" }));
    expect(response.status).toBe(400);
  });

  it("deja mustChangePassword en false tras un reset por email (la persona eligió su propia contraseña)", async () => {
    const { email, user } = await createUser();
    await prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: true } });

    await forgotPasswordHandler(forgotRequest({ email }));
    const token = extractTokenFromLastEmail();
    await resetPasswordHandler(resetRequest({ token, newPassword: "ClaveNueva5678!" }));

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.mustChangePassword).toBe(false);
    expect(verifyPassword("ClaveNueva5678!", after.passwordHash)).toBe(true);
  });
});
