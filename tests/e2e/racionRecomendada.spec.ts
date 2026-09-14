// Escenario offline de "Ración recomendada" (nueva función). Mismo
// enfoque sin mocks que dailyOperations.spec.ts: build de producción real
// + Postgres de pruebas real. Reproduce los escenarios mínimos pedidos:
// 1.000 peces x 500g -> 500 kg biomasa -> 3% -> 15 kg/día -> 3 raciones de
// 5 kg; el ajuste manual persiste offline al cerrar/reabrir la app; y ni
// la recomendación ni el ajuste manual descuentan inventario — solo un
// FeedingRecord/RegisterFeeding real lo haría, y aquí nunca se registra
// ninguno.
import { type Browser, type BrowserContext, type Page, chromium, expect, test } from "@playwright/test";
import { Client } from "pg";

import { loginViaUi, seedTestUser } from "./helpers/testAuth";

const TEST_USER = { username: "e2e-admin", password: "Test1234!", name: "Encargado E2E", role: "ADMIN" as const };

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

async function waitForBadge(page: Page, pattern: RegExp, timeout = 20_000) {
  await expect(page.locator("span.font-medium").first()).toHaveText(pattern, { timeout });
}

async function waitForServiceWorkerControl(page: Page, timeout = 15_000) {
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, {
    timeout,
  });
}

test.describe.serial("Ración recomendada offline", () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let pondDetailUrl: string;

  test.beforeAll(async () => {
    await queryDb(
      'TRUNCATE "sync_operations", "sale_lines", "sales", "harvests", "expenses", "purchase_lines", ' +
        '"purchases", "customers", "suppliers", "farm_settings", "tasks", "water_quality_records", ' +
        '"feeding_records", "mortality_records", "samplings", ' +
        '"feed_inventory_movements", "feeds", "fish_transfers", "stockings", "fish_batches", "ponds", "feeding_recommendations", "species", "password_reset_tokens", "users"',
    );
    await seedTestUser(queryDb, TEST_USER);

    browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
    context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context.close();
    await browser.close();
  });

  test("1. online: especie, estanque, recomendación configurada y lote de 1.000 peces x 500g; sincronizar", async ({
    baseURL,
  }) => {
    await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
    await waitForServiceWorkerControl(page);
    await loginViaUi(page, TEST_USER);

    for (const path of [
      "/especies",
      "/estanques",
      "/estanques/nuevo",
      "/lotes",
      "/lotes/nuevo",
      "/racion-recomendada",
      "/racion-recomendada/configuracion",
    ]) {
      await page.goto(`${baseURL}${path}`, { waitUntil: "networkidle" });
    }

    await page.goto(`${baseURL}/especies`, { waitUntil: "networkidle" });
    await page.getByLabel("Nueva especie").fill("Pacú");
    await page.getByRole("button", { name: "Agregar" }).click();
    await expect(page.getByText("Pacú", { exact: true })).toBeVisible();

    await page.goto(`${baseURL}/estanques/nuevo`, { waitUntil: "networkidle" });
    await page.getByLabel("Código").fill("E01");
    await page.getByLabel("Nombre").fill("Estanque Norte");
    await page.getByRole("button", { name: "Guardar estanque" }).click();
    await expect(page).toHaveURL(/\/estanques\/[0-9a-f-]+$/);
    pondDetailUrl = page.url();

    await page.goto(`${baseURL}/racion-recomendada/configuracion`, { waitUntil: "networkidle" });
    await page.getByLabel("Especie").selectOption({ label: "Pacú" });
    await page.getByLabel("Peso mín. (g)").fill("200");
    await page.getByLabel("Peso máx. (g)").fill("1000");
    await page.getByLabel("% de alimentación").fill("3");
    await page.getByLabel("Raciones/día").fill("3");
    await page.getByRole("button", { name: "Agregar" }).click();
    await expect(page.getByText(/200–1000 g · 3% · 3 raciones\/día/)).toBeVisible();

    await page.goto(`${baseURL}/lotes/nuevo`, { waitUntil: "networkidle" });
    await page.getByLabel("Especie").selectOption({ label: "Pacú" });
    await page.getByLabel("Estanque de siembra").selectOption({ label: "E01 — Estanque Norte" });
    await page.getByLabel("Cantidad").fill("1000");
    await page.getByLabel("Peso prom. inicial (g)").fill("500");
    await page.getByRole("button", { name: "Sembrar lote" }).click();
    await expect(page).toHaveURL(/\/lotes\/[0-9a-f-]+$/);

    await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
    await waitForBadge(page, /Sincronizado/);

    const recommendations = await queryDb('SELECT "feedPercent" FROM "feeding_recommendations"');
    expect(recommendations).toHaveLength(1);
    expect(Number(recommendations[0].feedPercent)).toBe(3);
  });

  test("2. la tarjeta del estanque muestra 500 kg de biomasa, 15 kg/día y 3 raciones de 5 kg", async () => {
    await page.goto("/racion-recomendada", { waitUntil: "load" });
    const card = page.locator("li", { hasText: "E01 — Estanque Norte" });
    await expect(card).toContainText("1000");
    await expect(card).toContainText("500 g");
    await expect(card.getByText(/500,0\s*kg/)).toBeVisible();
    await expect(card.getByText(/15,0\s*kg\/día/)).toBeVisible();
    await expect(card.getByText(/3 raciones de 5,0\s*kg/)).toBeVisible();

    // Visita la ficha de ración del estanque UNA vez mientras aún hay
    // conexión (comportamiento realista: quien ve la tarjeta normalmente
    // entra a mirarla antes de decidir modificarla) — `/racion-
    // recomendada/[pondId]` es una ruta dinámica (id de estanque
    // desconocido en build time), así que solo el service worker la deja
    // disponible offline si el router de Next ya la resolvió antes de
    // perder conexión, igual criterio que cualquier otra ficha dinámica
    // de la app (estanques/lotes).
    //
    // `force: true`: el FAB fijo "Registrar" (QuickRegisterButton, ver
    // AppShell.tsx) puede quedar superpuesto sobre el link "Modificar" de
    // la tarjeta según la posición de scroll — un solapamiento visual
    // ajeno a esta prueba (nada que ver con offline/service worker) que
    // hacía el click intermitente. El elemento resuelto SÍ es el link
    // correcto, solo se evita el chequeo de "no tapado" de Playwright.
    await page.getByRole("link", { name: "Modificar" }).click({ force: true });
    await expect(page).toHaveURL(/\/racion-recomendada\/[0-9a-f-]+$/, { timeout: 15_000 });
    await expect(page.getByText(/Recomendado \(calculado\)/)).toBeVisible({ timeout: 15_000 });
  });

  test("3. offline: modificar la ración a 13,5 kg / 3 raciones — no toca inventario", async () => {
    // `context.setOffline(true)` NO bloquea de forma fiable las
    // peticiones que el propio service worker dispara desde su contexto
    // de ejecución en este Chromium (verificado en la práctica —
    // reproducido en pwaOfflineRestart.spec.ts): eso deja pasar
    // navegaciones que en un dispositivo real sí fallarían, y de forma
    // intermitente (según si esa petición concreta corre por el camino
    // que sí intercepta o no) — el mismo click a veces navega y a veces
    // se queda colgado. `context.route()` sí intercepta cualquier
    // petición atribuida a este contexto, service worker incluido.
    await context.route("**/*", (route) => route.abort("internetdisconnected"));

    await page.goto("/racion-recomendada", { waitUntil: "load" });
    await page.getByRole("link", { name: "Modificar" }).click({ force: true });
    await expect(page).toHaveURL(/\/racion-recomendada\/[0-9a-f-]+$/, { timeout: 15_000 });

    await expect(page.getByText(/Recomendado \(calculado\)/)).toBeVisible({ timeout: 15_000 });
    await page.getByLabel(/Ración diaria configurada/).fill("13.5");
    await page.getByLabel(/Número de raciones al día/).fill("3");
    await page.getByRole("button", { name: "Guardar" }).click();

    await expect(page.getByText(/Ración configurada \(ajuste manual\)/)).toBeVisible();
    await expect(page.getByText(/13,5\s*kg\/día/)).toBeVisible();

    await page.goto("/", { waitUntil: "load" });
    await waitForBadge(page, /Sin conexión — \d+ cambios? pendientes?/);

    // Nada de esto llegó todavía al servidor, y ni la recomendación ni el
    // ajuste manual crean movimientos de inventario ni alimentaciones.
    const movements = await queryDb('SELECT id FROM "feed_inventory_movements"');
    expect(movements).toHaveLength(0);
    const feedings = await queryDb('SELECT id FROM "feeding_records"');
    expect(feedings).toHaveLength(0);
  });

  test("4. cerrar y reabrir la app sin conexión: el ajuste manual sigue ahí", async () => {
    const rationUrl = page.url();
    await page.close();
    page = await context.newPage();

    await page.goto(pondDetailUrl, { waitUntil: "load" });
    // Mismo solapamiento del FAB "Registrar" que en el link "Modificar"
    // de arriba — ver esa nota.
    await page.getByRole("link", { name: "Ración recomendada" }).click({ force: true });
    await expect(page.getByText(/Ración configurada \(ajuste manual\)/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/13,5\s*kg\/día/)).toBeVisible({ timeout: 15_000 });
    void rationUrl;
  });

  test("5. reconectar y sincronizar: Postgres guarda el ajuste manual y sigue sin movimientos de inventario", async () => {
    await context.unroute("**/*");
    await page.goto("/", { waitUntil: "load" });
    await page.getByRole("button", { name: "Sincronizar ahora" }).click();
    await waitForBadge(page, /Sincronizado/, 20_000);

    const ponds = await queryDb<{ manualDailyRationKg: string; manualFeedingsPerDay: number }>(
      'SELECT "manualDailyRationKg", "manualFeedingsPerDay" FROM "ponds" WHERE code = $1',
      ["E01"],
    );
    expect(ponds).toHaveLength(1);
    expect(Number(ponds[0].manualDailyRationKg)).toBe(13.5);
    expect(ponds[0].manualFeedingsPerDay).toBe(3);

    // El inventario de alimento SOLO cambia al registrar una alimentación
    // real (FeedingRecord/RegisterFeeding) — ninguna se registró aquí.
    const movements = await queryDb('SELECT id FROM "feed_inventory_movements"');
    expect(movements).toHaveLength(0);
    const feedings = await queryDb('SELECT id FROM "feeding_records"');
    expect(feedings).toHaveLength(0);
  });
});
