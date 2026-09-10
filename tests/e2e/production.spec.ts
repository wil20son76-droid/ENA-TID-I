// Escenario offline de producción piscícola (Fase 2, §29-§30 del encargo).
// Mismo enfoque que tests/e2e/offline.spec.ts: build de producción real,
// Postgres de pruebas real, sin mocks. Un único dispositivo/página de
// principio a fin (test.describe.serial + beforeAll) para simular el
// recorrido real: online → offline → cerrar/reabrir offline → online → sync.
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

/**
 * Texto de la sección "Distribución actual" de /lotes/[id], aislado del
 * historial (que repite las mismas cantidades) para evitar ambigüedad de
 * "strict mode" en los selectores de Playwright.
 */
async function distributionSectionText(page: Page): Promise<string> {
  return page
    .locator("section", { has: page.getByRole("heading", { name: "Distribución actual" }) })
    .innerText();
}

test.describe.serial("Producción piscícola offline (Fase 2)", () => {
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

  test("1. online: crear estanque E01 y sincronizar", async ({ baseURL }) => {
    await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
    await waitForServiceWorkerControl(page);
    await loginViaUi(page, TEST_USER);

    // Visita cada ruta que se necesitará offline más adelante para que el
    // service worker la deje en su caché (mismo requisito que offline.spec.ts).
    await page.goto(`${baseURL}/especies`, { waitUntil: "networkidle" });
    await page.goto(`${baseURL}/estanques`, { waitUntil: "networkidle" });
    await page.goto(`${baseURL}/estanques/nuevo`, { waitUntil: "networkidle" });
    await page.goto(`${baseURL}/lotes`, { waitUntil: "networkidle" });
    await page.goto(`${baseURL}/lotes/nuevo`, { waitUntil: "networkidle" });

    await page.goto(`${baseURL}/estanques/nuevo`, { waitUntil: "networkidle" });
    await page.getByLabel("Código").fill("E01");
    await page.getByLabel("Nombre").fill("Estanque Norte");
    await page.getByRole("button", { name: "Guardar estanque" }).click();
    await expect(page).toHaveURL(/\/estanques\/[0-9a-f-]+$/);

    await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
    await waitForBadge(page, /Sincronizado/);

    const rows = await queryDb('SELECT "code" FROM "ponds"');
    expect(rows.map((r) => r.code)).toEqual(["E01"]);
  });

  test("2. offline: especie, estanque E02, lote con siembra en E01 y traslado parcial a E02", async () => {
    await context.setOffline(true);

    // Especie Pacú.
    await page.goto("/especies", { waitUntil: "load" });
    await page.getByLabel("Nueva especie").fill("Pacú");
    await page.getByRole("button", { name: "Agregar" }).click();
    await expect(page.getByText("Pacú", { exact: true })).toBeVisible();

    // Estanque E02.
    await page.goto("/estanques/nuevo", { waitUntil: "load" });
    await page.getByLabel("Código").fill("E02");
    await page.getByLabel("Nombre").fill("Estanque Sur");
    await page.getByRole("button", { name: "Guardar estanque" }).click();
    await expect(page).toHaveURL(/\/estanques\/[0-9a-f-]+$/);

    // Lote + siembra: 1000 peces x 15 g en E01 (§29: biomasa inicial 15 kg).
    await page.goto("/lotes/nuevo", { waitUntil: "load" });
    await page.getByLabel("Especie").selectOption({ label: "Pacú" });
    await page.getByLabel("Estanque de siembra").selectOption({ label: "E01 — Estanque Norte" });
    await page.getByLabel("Cantidad").fill("1000");
    await page.getByLabel("Peso prom. inicial (g)").fill("15");
    await expect(page.getByText("Biomasa inicial:")).toContainText("15");
    await page.getByRole("button", { name: "Sembrar lote" }).click();
    await expect(page).toHaveURL(/\/lotes\/[0-9a-f-]+$/);
    batchDetailUrl = page.url();

    // La ficha del lote llega por navegación de cliente (router.push) justo
    // tras la transacción Dexie que crea el lote + su siembra: el primer
    // render puede ganarle a `useLiveQuery` resolviendo esa consulta async
    // ("Este lote no tiene peces en ningún estanque" momentáneo) — se
    // reintenta con el mismo criterio que el resto de lecturas de esta
    // sección tras un cambio (líneas más abajo), en vez de una lectura
    // única sin reintento.
    await expect(async () => {
      expect(await distributionSectionText(page)).toContain("1000 peces");
    }).toPass({ timeout: 5_000 });

    // Traslado parcial: 400 de 1000 de E01 a E02 -> quedan 600/400.
    await page.getByRole("button", { name: "Trasladar peces" }).click();
    await page.getByLabel("Destino").selectOption({ label: "E02" });
    await page.getByLabel("Cantidad").fill("400");
    await expect(page.getByText(/Disponibles en origen: 1000/)).toBeVisible();
    await page.getByRole("button", { name: "Confirmar traslado" }).click();

    await expect(async () => {
      const text = await distributionSectionText(page);
      expect(text).toContain("E01");
      expect(text).toContain("600 peces");
      expect(text).toContain("E02");
      expect(text).toContain("400 peces");
    }).toPass({ timeout: 5_000 });

    await page.goto("/", { waitUntil: "load" });
    await waitForBadge(page, /Sin conexión — \d+ cambios? pendientes?/);

    // Nada de esto llegó todavía al servidor.
    const batches = await queryDb('SELECT "code" FROM "fish_batches"');
    expect(batches).toHaveLength(0);
  });

  test("3. cerrar y reabrir la app sin conexión: la distribución sigue E01=600 / E02=400", async () => {
    await page.close();
    page = await context.newPage();

    await page.goto(batchDetailUrl, { waitUntil: "load" });
    await expect(async () => {
      const text = await distributionSectionText(page);
      expect(text).toContain("E01");
      expect(text).toContain("600 peces");
      expect(text).toContain("E02");
      expect(text).toContain("400 peces");
    }).toPass({ timeout: 5_000 });
  });

  test("4. reconectar, sincronizar y verificar Postgres sin duplicados en un segundo intento", async () => {
    await context.setOffline(false);
    await page.goto("/", { waitUntil: "load" });
    await page.getByRole("button", { name: "Sincronizar ahora" }).click();
    await waitForBadge(page, /Sincronizado/, 20_000);

    const batches = await queryDb<{ code: string; initialQuantity: number }>(
      'SELECT "code", "initialQuantity" FROM "fish_batches"',
    );
    expect(batches).toHaveLength(1);
    expect(batches[0].code).toMatch(/^PAC-\d{4}-\d{3}-[0-9A-F]{4}$/);
    expect(Number(batches[0].initialQuantity)).toBe(1000);

    const stockings = await queryDb('SELECT quantity FROM "stockings"');
    expect(stockings).toHaveLength(1);
    expect(Number(stockings[0].quantity)).toBe(1000);

    const transfers = await queryDb('SELECT quantity FROM "fish_transfers"');
    expect(transfers).toHaveLength(1);
    expect(Number(transfers[0].quantity)).toBe(400);

    const ponds = await queryDb('SELECT code FROM "ponds" ORDER BY code');
    expect(ponds.map((p) => p.code)).toEqual(["E01", "E02"]);

    // Sincronizar de nuevo (reintento manual): mismos operationId ya
    // procesados, nada se duplica.
    await page.getByRole("button", { name: "Sincronizar ahora" }).click();
    await waitForBadge(page, /Sincronizado/, 20_000);

    const batchesAfterSecondSync = await queryDb('SELECT id FROM "fish_batches"');
    expect(batchesAfterSecondSync).toHaveLength(1);
    const stockingsAfterSecondSync = await queryDb('SELECT id FROM "stockings"');
    expect(stockingsAfterSecondSync).toHaveLength(1);
    const transfersAfterSecondSync = await queryDb('SELECT id FROM "fish_transfers"');
    expect(transfersAfterSecondSync).toHaveLength(1);
  });

  test("5. un traslado que dejaría el origen negativo se rechaza en cliente antes de guardar", async () => {
    await page.goto(batchDetailUrl, { waitUntil: "load" });
    await page.getByRole("button", { name: "Trasladar peces" }).click();
    // Ambos estanques tienen peces en este punto (E01=600, E02=400): se fija
    // el origen explícitamente para no depender del orden por defecto.
    await page.getByLabel("Origen").selectOption({ label: "E01 (600 disp.)" });
    await page.getByLabel("Destino").selectOption({ label: "E02" });
    await page.getByLabel("Cantidad").fill("601"); // E01 solo tiene 600
    await expect(page.getByText(/Quedarán:\s*-1/)).toBeVisible();
    await page.getByRole("button", { name: "Confirmar traslado" }).click();
    await expect(page.getByText("No hay suficientes peces disponibles")).toBeVisible();

    // El estado en Postgres no cambió: el traslado inválido nunca se creó.
    const transfers = await queryDb('SELECT quantity FROM "fish_transfers"');
    expect(transfers).toHaveLength(1);
    expect(Number(transfers[0].quantity)).toBe(400);
  });
});
