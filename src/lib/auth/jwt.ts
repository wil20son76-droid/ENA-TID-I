// Sesión firmada (Fase 7, IMPLEMENTATION_PLAN.md §5.6): un JWT HS256
// firmado a mano con `node:crypto` (HMAC-SHA256 + comparación en tiempo
// constante), sin librería externa (`jose`/`jsonwebtoken`) — mismo
// criterio de dependencias mínimas que `password.ts`. No es "inventar
// criptografía": el algoritmo es el estándar HS256 de JWT (RFC 7519),
// solo se prescinde del envoltorio de una librería para verificar/firmar
// tres campos.
//
// Regla crítica del encargo: la autenticación NO puede exigir red en cada
// apertura de la app. Por eso la sesión tiene una duración larga (30
// días) y se renueva en silencio mientras haya conexión
// (`/api/auth/refresh`) — nunca se fuerza un nuevo login solo porque el
// dispositivo estuvo offline un tiempo. Ver SECURITY.md para las
// limitaciones exactas de este diseño (revocación no inmediata, etc.).
import { createHmac, timingSafeEqual } from "node:crypto";

export type UserRole = "ADMIN" | "MANAGER" | "WORKER" | "READ_ONLY";

export interface SessionTokenPayload {
  /** userId. */
  sub: string;
  username: string;
  name: string;
  role: UserRole;
  /** Copia de `User.tokenVersion` en el momento del login — ver serverAuth.ts para la revocación. */
  tokenVersion: number;
  iat: number;
  exp: number;
}

/** 30 días (§5.6 del plan): suficiente para que un trabajador de campo nunca tenga que reloguearse por estar offline varios días. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

/**
 * `AUTH_SECRET` es obligatorio y se valida al arrancar cualquier flujo de
 * auth (nunca un secreto por defecto hardcodeado — ver SECURITY.md). Se
 * exige un mínimo de longitud como comprobación básica de que no es un
 * valor trivial ("changeme", vacío, etc.).
 */
function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "AUTH_SECRET no está configurado (o es demasiado corto/inseguro). Define una variable de entorno AUTH_SECRET de al menos 16 caracteres — ver .env.example y SECURITY.md.",
    );
  }
  return secret;
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function signSessionToken(
  payload: Omit<SessionTokenPayload, "iat" | "exp">,
  ttlSeconds: number = SESSION_TTL_SECONDS,
): string {
  const secret = getSecret();
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: SessionTokenPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(fullPayload));
  const signature = sign(`${header}.${body}`, secret);
  return `${header}.${body}.${signature}`;
}

export type VerifySessionTokenResult =
  | { valid: true; expired: false; payload: SessionTokenPayload }
  | { valid: false; expired: true; payload: SessionTokenPayload }
  | { valid: false; expired: false; payload: null };

/**
 * Verifica firma + expiración. Distingue "expirado" (firma válida, pero
 * `exp` ya pasó — útil para mostrar "tu sesión expiró, inicia sesión de
 * nuevo" en vez de un genérico "token inválido") de "inválido" (firma
 * incorrecta, formato corrupto, manipulado, o `AUTH_SECRET` no
 * configurado).
 */
export function verifySessionToken(token: string): VerifySessionTokenResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false, expired: false, payload: null };
  const [header, body, signature] = parts;

  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return { valid: false, expired: false, payload: null };
  }

  let signatureBuffer: Buffer;
  let expectedBuffer: Buffer;
  try {
    signatureBuffer = Buffer.from(signature, "base64url");
    expectedBuffer = Buffer.from(sign(`${header}.${body}`, secret), "base64url");
  } catch {
    return { valid: false, expired: false, payload: null };
  }
  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return { valid: false, expired: false, payload: null };
  }

  let payload: SessionTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(body)) as SessionTokenPayload;
  } catch {
    return { valid: false, expired: false, payload: null };
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) {
    return { valid: false, expired: true, payload };
  }

  return { valid: true, expired: false, payload };
}
