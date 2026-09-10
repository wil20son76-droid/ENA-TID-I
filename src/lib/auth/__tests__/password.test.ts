import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "../password";

describe("password", () => {
  it("verifica correctamente una contraseña recién hasheada", () => {
    const hash = hashPassword("Correcta123!");
    expect(verifyPassword("Correcta123!", hash)).toBe(true);
  });

  it("rechaza una contraseña incorrecta", () => {
    const hash = hashPassword("Correcta123!");
    expect(verifyPassword("Incorrecta123!", hash)).toBe(false);
  });

  it("dos hashes de la misma contraseña son distintos (salt aleatorio)", () => {
    const a = hashPassword("MismaClave1!");
    const b = hashPassword("MismaClave1!");
    expect(a).not.toBe(b);
    expect(verifyPassword("MismaClave1!", a)).toBe(true);
    expect(verifyPassword("MismaClave1!", b)).toBe(true);
  });

  it("nunca lanza con un hash almacenado corrupto o de formato desconocido", () => {
    expect(verifyPassword("cualquiera", "no-es-un-hash-valido")).toBe(false);
    expect(verifyPassword("cualquiera", "scrypt:no-hex:tampoco-hex")).toBe(false);
    expect(verifyPassword("cualquiera", "bcrypt:algo:algo")).toBe(false);
    expect(verifyPassword("cualquiera", "")).toBe(false);
  });
});
