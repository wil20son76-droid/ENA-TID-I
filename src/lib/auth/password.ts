// Hash de contraseñas (Fase 7). Se usa `scrypt` de `node:crypto` — ya
// incluido en Node, sin depender de una librería externa nueva (bcrypt,
// argon2...), mismo criterio que el resto del proyecto de evitar
// dependencias innecesarias (gráficos SVG propios en vez de una librería,
// `window.print()` nativo en vez de un generador de PDF, etc.). `scrypt`
// es una función de derivación de clave diseñada para contraseñas
// (computacionalmente cara a propósito, resistente a fuerza bruta por
// hardware), no un hash genérico como SHA-256.
//
// Formato de almacenamiento: "scrypt:<saltHex>:<hashHex>" — el salt va
// junto al hash (nunca se reutiliza uno fijo) para que dos contraseñas
// iguales de dos usuarios distintos nunca produzcan el mismo hash
// almacenado.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_KEY_LENGTH = 64;
const SALT_LENGTH_BYTES = 16;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH_BYTES);
  const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

/**
 * Compara en tiempo constante (`timingSafeEqual`) para no filtrar por
 * temporización cuánto coincide un intento de contraseña incorrecto — un
 * `===` normal sobre strings sí puede filtrar esa información.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, saltHex, hashHex] = parts;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (expected.length !== SCRYPT_KEY_LENGTH) return false;
  const actual = scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  return timingSafeEqual(actual, expected);
}
