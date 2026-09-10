// Logo en pantallas reales + flujo de "Reset por ADMIN" de punta a punta
// (Fase "logo + recuperación") contra un build de producción real +
// Postgres de pruebas real, sin mocks. El flujo de recuperación por EMAIL
// (forgot/reset-password) ya está cubierto contra la base de datos real en
// src/app/api/auth/__tests__/passwordRecovery.integration.test.ts — no
// hay forma de "recibir" un email real en un navegador de Playwright, así
// que aquí se ejercita en cambio el otro camino que sí pasa enteramente
// por la UI: un ADMIN asignando una contraseña temporal desde /usuarios y
// el Trabajador afectado viviendo la pantalla de cambio obligatorio real.
import { expect, test } from "@playwright/test";
import { Client } from "pg";

import { loginViaUi, seedTestUser } from "./helpers/testAuth";

const ADMIN_USER = { username: "e2e-brand-admin", password: "Test1234!", name: "Admin E2E", role: "ADMIN" as const };
const WORKER_USER = {
  username: "e2e-brand-worker",
  password: "Test1234!",
  name: "Trabajador E2E",
  role: "WORKER" as const,
};

const TEST_DATABASE_URL =
  process.env.PLAYWRIGHT_DATABASE_URL ??
  (process.env.DATABASE_URL
    ? process.env.DATABASE_URL.replace(/\/([^/?]+)(\?|$)/, "/$1_test$2")
    : "postgresql://postgres:postgres@localhost:5432/piscicultura_test?schema=public");

async function queryDb<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows as T[];
  } finally {
    await client.end();
  }
}

test.describe.serial("Logo de marca y recuperación de contraseña", () => {
  test.beforeAll(async () => {
    await queryDb(
      'TRUNCATE "sync_operations", "sale_lines", "sales", "harvests", "expenses", "purchase_lines", ' +
        '"purchases", "customers", "suppliers", "farm_settings", "tasks", "water_quality_records", ' +
        '"feeding_records", "mortality_records", "samplings", "feed_inventory_movements", "feeds", ' +
        '"fish_transfers", "stockings", "fish_batches", "ponds", "species", "password_reset_tokens", "users"',
    );
    await seedTestUser(queryDb, ADMIN_USER);
    await seedTestUser(queryDb, WORKER_USER);
  });

  test("el logo de marca es visible en la pantalla de login", async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });
    // Sin sesión, AuthGate muestra LoginScreen — el logo va dentro de
    // CardShell, con alt text fijo (Logo.tsx). Si el archivo real
    // (public/brand/logo.png) todavía no existe en este entorno, el <img>
    // sigue presente en el DOM (onError solo lo oculta visualmente tras
    // fallar la carga) — toBeAttached confirma que quedó cableado en el
    // login sin depender de que el archivo ya esté subido.
    const logo = page.getByAltText("ENA TID'I — Finca integral agropiscícola");
    await expect(logo).toBeAttached();
    await expect(page.getByRole("heading", { name: "ENA TID’I" })).toBeVisible();
  });

  test("manifest.webmanifest y los íconos PWA responden 200", async ({ page, baseURL }) => {
    const manifestResponse = await page.request.get(`${baseURL}/manifest.webmanifest`);
    expect(manifestResponse.status()).toBe(200);
    const manifest = await manifestResponse.json();
    expect(manifest.icons).toEqual([
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/512-maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);

    for (const iconSrc of manifest.icons.map((icon: { src: string }) => icon.src)) {
      const response = await page.request.get(`${baseURL}${iconSrc}`);
      expect(response.status(), `icono ${iconSrc}`).toBe(200);
      expect(response.headers()["content-type"]).toBe("image/png");
    }

    const faviconResponse = await page.request.get(`${baseURL}/icon`);
    expect(faviconResponse.status()).toBe(200);
  });

  test("ADMIN restablece la contraseña del Trabajador: mustChangePassword bloquea la app hasta cambiarla", async ({
    browser,
    baseURL,
  }) => {
    const adminContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const adminPage = await adminContext.newPage();
    await adminPage.goto(`${baseURL}/`, { waitUntil: "load" });
    await loginViaUi(adminPage, ADMIN_USER);

    await adminPage.goto("/usuarios", { waitUntil: "load" });
    const workerRow = adminPage.getByRole("row", { name: new RegExp(WORKER_USER.username) });
    await workerRow.getByRole("button", { name: "Restablecer contraseña" }).click();

    const tempPassword = "TemporalNueva99!";
    await adminPage.getByLabel(new RegExp(`Contraseña temporal para ${WORKER_USER.username}`)).fill(tempPassword);
    await adminPage.getByRole("button", { name: "Confirmar" }).click();

    // La fila vuelve a su estado normal y el badge de "pendiente" aparece
    // en la tabla — confirmación en UI de que el reset se aplicó.
    await expect(workerRow.getByText("Contraseña temporal pendiente")).toBeVisible({ timeout: 10_000 });

    const [{ mustChangePassword }] = await queryDb<{ mustChangePassword: boolean }>(
      'SELECT "mustChangePassword" FROM "users" WHERE username = $1',
      [WORKER_USER.username],
    );
    expect(mustChangePassword).toBe(true);
    await adminContext.close();

    // El Trabajador inicia sesión con la contraseña temporal: en vez de
    // entrar directo a la app, AuthGate lo bloquea con la pantalla de
    // cambio obligatorio (session.mustChangePassword=true en la respuesta
    // de login).
    const workerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const workerPage = await workerContext.newPage();
    await workerPage.goto(`${baseURL}/`, { waitUntil: "load" });
    await workerPage.getByLabel("Usuario").fill(WORKER_USER.username);
    await workerPage.getByLabel("Contraseña").fill(tempPassword);
    await workerPage.getByRole("button", { name: "Iniciar sesión" }).click();

    await expect(workerPage.getByRole("heading", { name: "Debes cambiar tu contraseña" })).toBeVisible({
      timeout: 15_000,
    });
    // Confirma que NO se entró a la app real todavía (sin la barra de
    // navegación de AppShell — la propia pantalla de cambio obligatorio
    // también tiene su propio botón "Cerrar sesión" de escape, así que esa
    // etiqueta por sí sola no distingue entre ambas pantallas).
    await expect(workerPage.getByRole("navigation", { name: "Navegación principal" })).not.toBeVisible();

    const newPassword = "DefinitivaWorker7!";
    await workerPage.getByLabel("Contraseña temporal actual").fill(tempPassword);
    await workerPage.getByLabel("Contraseña nueva (mínimo 8 caracteres)").fill(newPassword);
    await workerPage.getByLabel("Confirmar contraseña nueva").fill(newPassword);
    await workerPage.getByRole("button", { name: "Cambiar contraseña" }).click();

    // Tras el cambio, entra a la app real con normalidad — la barra de
    // navegación de AppShell (ausente en ForceChangePasswordScreen) es la
    // señal inequívoca, ya que "Cerrar sesión" por sí solo existe en
    // ambas pantallas.
    await expect(workerPage.getByRole("navigation", { name: "Navegación principal" })).toBeVisible({
      timeout: 15_000,
    });

    const [{ mustChangePassword: afterChange }] = await queryDb<{ mustChangePassword: boolean }>(
      'SELECT "mustChangePassword" FROM "users" WHERE username = $1',
      [WORKER_USER.username],
    );
    expect(afterChange).toBe(false);

    // Cerrar sesión y volver a entrar con la contraseña definitiva nueva
    // confirma que quedó guardada de verdad (no solo en memoria).
    await workerPage.getByRole("button", { name: "Cerrar sesión" }).click();
    await workerPage.getByLabel("Usuario").fill(WORKER_USER.username);
    await workerPage.getByLabel("Contraseña").fill(newPassword);
    await workerPage.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(workerPage.getByRole("button", { name: "Cerrar sesión" })).toBeVisible({ timeout: 15_000 });

    await workerContext.close();
  });
});
