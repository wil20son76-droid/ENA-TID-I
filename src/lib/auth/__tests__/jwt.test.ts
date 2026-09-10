import { beforeEach, describe, expect, it } from "vitest";

import { signSessionToken, verifySessionToken } from "../jwt";

const BASE_PAYLOAD = {
  sub: "user-1",
  username: "admin",
  name: "Admin",
  role: "ADMIN" as const,
  tokenVersion: 1,
};

describe("jwt", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "clave-de-pruebas-suficientemente-larga";
  });

  it("firma y verifica un token válido", () => {
    const token = signSessionToken(BASE_PAYLOAD);
    const result = verifySessionToken(token);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.sub).toBe("user-1");
      expect(result.payload.role).toBe("ADMIN");
      expect(result.payload.tokenVersion).toBe(1);
    }
  });

  it("marca un token expirado como expired:true, no como inválido genérico", () => {
    const token = signSessionToken(BASE_PAYLOAD, -1); // ya expiró hace 1 segundo
    const result = verifySessionToken(token);
    expect(result.valid).toBe(false);
    expect(result.expired).toBe(true);
    expect(result.payload?.sub).toBe("user-1"); // el payload sigue siendo legible aunque haya expirado
  });

  it("rechaza un token manipulado (payload alterado sin volver a firmar)", () => {
    const token = signSessionToken(BASE_PAYLOAD);
    const [header, body, signature] = token.split(".");
    const tamperedPayload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    tamperedPayload.role = "ADMIN_HACKED";
    const tamperedBody = Buffer.from(JSON.stringify(tamperedPayload)).toString("base64url");
    const tampered = `${header}.${tamperedBody}.${signature}`;

    const result = verifySessionToken(tampered);
    expect(result.valid).toBe(false);
    expect(result.expired).toBe(false);
    expect(result.payload).toBeNull();
  });

  it("rechaza un token con formato inválido sin lanzar", () => {
    expect(() => verifySessionToken("no-es-un-jwt")).not.toThrow();
    expect(verifySessionToken("no-es-un-jwt").valid).toBe(false);
    expect(verifySessionToken("").valid).toBe(false);
  });

  it("un token firmado con otro secreto nunca verifica (nunca hay secreto por defecto)", () => {
    const token = signSessionToken(BASE_PAYLOAD);
    process.env.AUTH_SECRET = "otra-clave-completamente-distinta-y-larga";
    expect(verifySessionToken(token).valid).toBe(false);
  });

  it("signSessionToken lanza si AUTH_SECRET no está configurado o es muy corto", () => {
    delete process.env.AUTH_SECRET;
    expect(() => signSessionToken(BASE_PAYLOAD)).toThrow();
    process.env.AUTH_SECRET = "corto";
    expect(() => signSessionToken(BASE_PAYLOAD)).toThrow();
  });
});
