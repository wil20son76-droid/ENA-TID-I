// Helper de autenticación compartido por los E2E de todas las fases
// (Fase 7 hizo el login obligatorio para usar la app — regla crítica del
// encargo: autenticar una vez, seguir offline después). Reproduce el
// MISMO formato de hash que src/lib/auth/password.ts (scrypt con salt
// aleatorio, "scrypt:<saltHex>:<hashHex>") para poder sembrar
// directamente una fila en "users" antes de que la app pueda loguearse
// — Playwright resuelve sus specs con su propio compilador TS, sin los
// alias "@/" del proyecto, así que esta suite se mantiene deliberadamente
// independiente del bundler de Next.js en vez de importar el módulo real.
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { expect, type Page } from "@playwright/test";

const SCRYPT_KEY_LENGTH = 64;

function hashPasswordForSeed(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export type TestUserRole = "ADMIN" | "MANAGER" | "WORKER" | "READ_ONLY";

export interface SeedUserOptions {
  username: string;
  password: string;
  name: string;
  role: TestUserRole;
}

/**
 * Inserta un usuario directamente en "users" — el equivalente de prueba
 * al paso manual `npm run auth:create-admin` que un operador real
 * ejecutaría una vez tras desplegar (§"Autenticación inicial" de la
 * Fase 7): es un dato de seguridad, nunca se crea a través de la UI/outbox
 * offline. `queryDb` es el mismo helper `pg` que cada spec ya usa para
 * TRUNCATE/lecturas.
 */
export async function seedTestUser(
  queryDb: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>,
  options: SeedUserOptions,
): Promise<void> {
  await queryDb(
    'INSERT INTO "users" (id, username, name, "passwordHash", role, active, "tokenVersion", "createdAt", "updatedAt") ' +
      "VALUES ($1, $2, $3, $4, $5, true, 1, now(), now())",
    [randomUUID(), options.username, options.name, hashPasswordForSeed(options.password), options.role],
  );
}

/**
 * Inicia sesión a través de la UI real (AuthGate/LoginScreen) — nunca
 * fabrica un token: ejercita el flujo completo tal como lo usaría un
 * trabajador de campo. No navega a ninguna URL de login específica
 * porque no existe: AuthGate muestra el formulario embebido en cualquier
 * ruta cuando no hay sesión local, así que basta con estar en cualquier
 * página de la app.
 */
export async function loginViaUi(
  page: Page,
  credentials: { username: string; password: string },
): Promise<void> {
  await page.getByLabel("Usuario").fill(credentials.username);
  await page.getByLabel("Contraseña").fill(credentials.password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  // Señal inequívoca de que AuthGate ya renderiza AppShell (el botón de
  // logout no existe en la pantalla de login, así que a diferencia del
  // título "ENA TID'I" — presente en ambas pantallas — este sí distingue
  // de forma confiable "ya adentro" de "todavía en el login").
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible({ timeout: 15_000 });
}
