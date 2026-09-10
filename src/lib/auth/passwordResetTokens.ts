// Tokens de recuperación de contraseña (§"Recuperación por email"). Mismo
// criterio de dependencias que password.ts/jwt.ts: solo `node:crypto`, sin
// librería externa.
//
// El token que viaja en el enlace de email es aleatorio de alta entropía
// (32 bytes = 256 bits) — solo su HASH SHA-256 se guarda en
// PasswordResetToken.tokenHash (ver prisma/schema.prisma). Un hash rápido
// (no scrypt) es correcto aquí: a diferencia de una contraseña elegida por
// una persona (espacio de búsqueda pequeño, hay que encarecer cada
// intento), este token ya tiene 256 bits de entropía propia — nadie puede
// "adivinarlo" fuerza bruta contra el hash sin antes tener el valor
// original, así que no hace falta una función cara como scrypt.
import { createHash, randomBytes } from "node:crypto";

export const RESET_TOKEN_TTL_MS = 30 * 60_000; // 30 minutos

export function generateResetToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
