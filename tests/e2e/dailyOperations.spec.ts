// Escenario offline de operación diaria (Fase 3, §56 del encargo).
// Mismo enfoque sin mocks que production.spec.ts (Fase 2): build de
// producción real + Postgres de pruebas real. Reproduce exactamente el
// "criterio de éxito" del encargo: alimentación + mortalidad + muestreo
// 100% offline sobre un lote de 1000 peces, cerrar/reabrir la app sin
// conexión y comprobar que todo sigue ahí, reconectar y verificar que
// Postgres queda consistente sin duplicados.
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

test.describe.serial("Operación diaria offline (Fase 3)", () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let batchDetailUrl: string;

  test.beforeAll(async () => {
    await queryDb(
      'TRUNCATE "sync_operations", "sale_lines", "sales", "harvests", "expenses", "purchase_lines", ' +
        '"purchases", "customers", "suppliers", "farm_settings", "tasks", "water_quality_records", ' +
        '"feeding_records", "mortality_records", "samplings", ' +
        '"feed_inventory_movements", "feeds", "fish_transfers", "stockings", "fish_batches", "ponds", "species", "users"',
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

  test("1. online: crear especie, estanque, alimento con stock y lote; sincronizar", async ({ baseURL }) => {
    await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
    await waitForServiceWorkerControl(page);
    await loginViaUi(page, TEST_USER);

    // Visita cada ruta que se necesitará offline más adelante (mismo
    // requisito que offline.spec.ts/production.spec.ts).
    for (const path of [
      "/especies",
      "/estanques",
      "/estanques/nuevo",
      "/alimentos",
      "/lotes",
      "/lotes/nuevo",
      "/alimentacion",
      "/alimentacion/nueva",
      "/mortalidad",
      "/mortalidad/nueva",
      "/muestreos/nuevo",
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

    await page.goto(`${baseURL}/alimentos`, { waitUntil: "networkidle" });
    await page.getByLabel("Nuevo alimento").fill("Crecimiento 32%");
    await page.getByLabel(/Stock inicial/).fill("500");
    await page.getByRole("button", { name: "Agregar" }).click();
    await expect(page.getByText("Crecimiento 32%")).toBeVisible();

    await page.goto(`${baseURL}/lotes/nuevo`, { waitUntil: "networkidle" });
    await page.getByLabel("Especie").selectOption({ label: "Pacú" });
    await page.getByLabel("Estanque de siembra").selectOption({ label: "E01 — Estanque Norte" });
    await page.getByLabel("Cantidad").fill("1000");
    await page.getByLabel("Peso prom. inicial (g)").fill("15");
    await page.getByRole("button", { name: "Sembrar lote" }).click();
    await expect(page).toHaveURL(/\/lotes\/[0-9a-f-]+$/);
    batchDetailUrl = page.url();

    await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
    await waitForBadge(page, /Sincronizado/);

    const batches = await queryDb('SELECT code FROM "fish_batches"');
    expect(batches).toHaveLength(1);
    const feeds = await queryDb('SELECT name FROM "feeds"');
    expect(feeds.map((f) => f.name)).toEqual(["Crecimiento 32%"]);
  });

  test("2. offline: alimentación 18kg, mortalidad 3 peces, muestreo 30/15.3kg", async () => {
    await context.setOffline(true);

    await page.goto("/alimentacion/nueva", { waitUntil: "load" });
    await page.getByLabel("Estanque").selectOption({ label: "E01 — Estanque Norte" });
    await page.getByLabel("Lote").selectOption({ index: 1 });
    await page.getByLabel("Alimento").selectOption({ label: "Crecimiento 32%" });
    await page.getByLabel("Cantidad (kg)").fill("18");
    await page.getByRole("button", { name: "Guardar alimentación" }).click();
    await expect(page).toHaveURL(/\/alimentacion$/);

    await page.goto("/mortalidad/nueva", { waitUntil: "load" });
    await page.getByLabel("Estanque").selectOption({ label: "E01 — Estanque Norte" });
    await page.getByLabel("Lote").selectOption({ index: 1 });
    await page.getByLabel("Cantidad").fill("3");
    await page.getByRole("button", { name: "Guardar mortalidad" }).click();
    await expect(page).toHaveURL(/\/mortalidad$/);

    await page.goto("/muestreos/nuevo", { waitUntil: "load" });
    await page.getByLabel("Estanque").selectOption({ label: "E01 — Estanque Norte" });
    await page.getByLabel("Lote").selectOption({ index: 1 });
    await page.getByLabel("Número de peces").fill("30");
    await page.getByLabel("Peso total (kg)").fill("15.3");
    await expect(page.getByText("Peso promedio:")).toContainText("510");
    await page.getByRole("button", { name: "Guardar muestreo" }).click();
    await expect(page).toHaveURL(/\/lotes\/[0-9a-f-]+$/);

    await page.goto("/", { waitUntil: "load" });
    await waitForBadge(page, /Sin conexión — \d+ cambios? pendientes?/);

    // Nada de esto llegó todavía al servidor.
    const feedings = await queryDb('SELECT id FROM "feeding_records"');
    expect(feedings).toHaveLength(0);
  });

  test("3. offline: la ficha del lote muestra 997 peces, 510 g, ~508.5 kg y 482 kg de stock", async () => {
    await page.goto(batchDetailUrl, { waitUntil: "load" });
    await expect(async () => {
      const text = await page.locator("main").innerText();
      expect(text).toContain("997"); // 1000 - 3 mortalidad
      expect(text).toContain("510 g"); // peso del muestreo
      expect(text).toMatch(/508,5\s*kg/); // 997 x 510g / 1000 ~ 508.47 -> redondeado
    }).toPass({ timeout: 5_000 });

    await page.goto("/alimentos", { waitUntil: "load" });
    await expect(page.getByText(/Stock:\s*482,0\s*kg/)).toBeVisible();
  });

  test("4. cerrar y reabrir la app sin conexión: todos los datos siguen ahí", async () => {
    await page.close();
    page = await context.newPage();

    await page.goto(batchDetailUrl, { waitUntil: "load" });
    await expect(async () => {
      const text = await page.locator("main").innerText();
      expect(text).toContain("997");
      expect(text).toContain("510 g");
    }).toPass({ timeout: 5_000 });

    await page.goto("/alimentos", { waitUntil: "load" });
    await expect(page.getByText(/Stock:\s*482,0\s*kg/)).toBeVisible();
  });

  test("5. offline: segunda alimentación de 22kg -> stock esperado 460 kg", async () => {
    await page.goto("/alimentacion/nueva", { waitUntil: "load" });
    await page.getByLabel("Estanque").selectOption({ label: "E01 — Estanque Norte" });
    await page.getByLabel("Lote").selectOption({ index: 1 });
    await page.getByLabel("Alimento").selectOption({ label: "Crecimiento 32%" });
    await page.getByLabel("Cantidad (kg)").fill("22");
    await page.getByRole("button", { name: "Guardar alimentación" }).click();
    await expect(page).toHaveURL(/\/alimentacion$/);

    await page.goto("/alimentos", { waitUntil: "load" });
    await expect(page.getByText(/Stock:\s*460,0\s*kg/)).toBeVisible();
  });

  test("6. reconectar, sincronizar y verificar Postgres sin duplicados en un segundo intento", async () => {
    await context.setOffline(false);
    await page.goto("/", { waitUntil: "load" });
    await page.getByRole("button", { name: "Sincronizar ahora" }).click();
    await waitForBadge(page, /Sincronizado/, 20_000);

    const feedings = await queryDb<{ quantityKg: string }>(
      'SELECT "quantityKg" FROM "feeding_records" ORDER BY "quantityKg"',
    );
    expect(feedings).toHaveLength(2);
    expect(feedings.map((f) => Number(f.quantityKg))).toEqual([18, 22]);

    const mortalities = await queryDb<{ quantity: number }>('SELECT quantity FROM "mortality_records"');
    expect(mortalities).toHaveLength(1);
    expect(mortalities[0].quantity).toBe(3);

    const samplings = await queryDb('SELECT id FROM "samplings"');
    expect(samplings).toHaveLength(1);

    const movements = await queryDb<{ movementType: string; quantityKg: string }>(
      'SELECT "movementType", "quantityKg" FROM "feed_inventory_movements" ORDER BY "quantityKg"',
    );
    // INITIAL_STOCK 500 + CONSUMPTION 18 + CONSUMPTION 22 = 3 movimientos.
    expect(movements).toHaveLength(3);
    const stock = movements.reduce(
      (sum, m) => (m.movementType === "CONSUMPTION" ? sum - Number(m.quantityKg) : sum + Number(m.quantityKg)),
      0,
    );
    expect(stock).toBe(460);

    // Sincronizar de nuevo: los mismos operationId ya procesados, nada se
    // duplica.
    await page.getByRole("button", { name: "Sincronizar ahora" }).click();
    await waitForBadge(page, /Sincronizado/, 20_000);

    const feedingsAfterSecondSync = await queryDb('SELECT id FROM "feeding_records"');
    expect(feedingsAfterSecondSync).toHaveLength(2);
    const mortalitiesAfterSecondSync = await queryDb('SELECT id FROM "mortality_records"');
    expect(mortalitiesAfterSecondSync).toHaveLength(1);
    const movementsAfterSecondSync = await queryDb('SELECT id FROM "feed_inventory_movements"');
    expect(movementsAfterSecondSync).toHaveLength(3);
  });
});
