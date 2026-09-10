// Informes y analítica offline (Fase 6, "Tests obligatorios" del encargo).
// Mismo enfoque sin mocks que economics.spec.ts: build de producción real +
// Postgres de pruebas real. Reproduce EXACTAMENTE los dos ejemplos
// obligatorios del encargo (supervivencia agregada 86,36 % y precio medio
// ponderado 29 Bs/kg) desde datos reales registrados en la UI, verifica que
// los informes son 100% funcionales sin conexión, que sobreviven a un
// cierre/reapertura offline, y que sincronizar (incluso dos veces seguidas)
// nunca cambia ni duplica los KPIs ya mostrados — los informes se calculan
// siempre desde Dexie local, nunca desde la API.
import { readFileSync } from "node:fs";
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
 * Registra una venta con una sola línea, igual que hace el formulario
 * real. El código de lote real es "PREFIJO-AÑO-SECUENCIA-SUFIJO"
 * (generateBatchCode) y el sufijo depende del deviceId aleatorio de la
 * sesión, así que se selecciona por posición en la lista (ordenada por
 * código) en vez de por texto exacto — igual criterio que
 * economics.spec.ts para "Lote"/"Lote de origen".
 */
async function registerSale(page: Page, batchIndex: number, weightKg: string, pricePerKg: string) {
  await page.goto("/ventas/nueva", { waitUntil: "load" });
  await page.getByLabel("Lote de origen").selectOption({ index: batchIndex });
  await page.getByLabel("Kg vendidos").fill(weightKg);
  await page.getByLabel("Precio/kg").fill(pricePerKg);
  await page.getByRole("button", { name: "Guardar venta" }).click();
  await expect(page).toHaveURL(/\/ventas$/);
}

test.describe.serial("Informes y analítica offline (Fase 6)", () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async () => {
    await queryDb(
      'TRUNCATE "sync_operations", "sale_lines", "sales", "harvests", "expenses", "purchase_lines", ' +
        '"purchases", "customers", "suppliers", "farm_settings", "tasks", "water_quality_records", ' +
        '"feeding_records", "mortality_records", "samplings", "feed_inventory_movements", "feeds", ' +
        '"fish_transfers", "stockings", "fish_batches", "ponds", "species", "password_reset_tokens", "users"',
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

  test("1. online: crear especie, estanque y dos lotes (1000 y 100 peces); sincronizar", async ({ baseURL }) => {
    await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
    await waitForServiceWorkerControl(page);
    await loginViaUi(page, TEST_USER);

    // Visita cada ruta que se necesitará offline más adelante (mismo
    // requisito que production.spec.ts/economics.spec.ts): sin esto el
    // service worker no tiene las páginas de informes en caché.
    for (const path of [
      "/especies",
      "/estanques",
      "/estanques/nuevo",
      "/lotes",
      "/lotes/nuevo",
      "/mortalidad",
      "/mortalidad/nueva",
      "/ventas",
      "/ventas/nueva",
      "/informes",
      "/informes/produccion",
      "/informes/mortalidad",
      "/informes/alimentacion",
      "/informes/inventario",
      "/informes/agua",
      "/informes/cosechas",
      "/informes/ventas",
      "/informes/economia",
      "/informes/comparacion",
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

    // Ejemplo obligatorio del encargo de supervivencia: Lote A 1000
    // sembrados, Lote B 100 sembrados.
    await page.goto(`${baseURL}/lotes/nuevo`, { waitUntil: "networkidle" });
    await page.getByLabel("Especie").selectOption({ label: "Pacú" });
    await page.getByLabel("Estanque de siembra").selectOption({ label: "E01 — Estanque Norte" });
    await page.getByLabel("Cantidad").fill("1000");
    await page.getByLabel("Peso prom. inicial (g)").fill("15");
    await page.getByRole("button", { name: "Sembrar lote" }).click();
    await expect(page).toHaveURL(/\/lotes\/[0-9a-f-]+$/);

    await page.goto(`${baseURL}/lotes/nuevo`, { waitUntil: "networkidle" });
    await page.getByLabel("Especie").selectOption({ label: "Pacú" });
    await page.getByLabel("Estanque de siembra").selectOption({ label: "E01 — Estanque Norte" });
    await page.getByLabel("Cantidad").fill("100");
    await page.getByLabel("Peso prom. inicial (g)").fill("15");
    await page.getByRole("button", { name: "Sembrar lote" }).click();
    await expect(page).toHaveURL(/\/lotes\/[0-9a-f-]+$/);

    await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
    await waitForBadge(page, /Sincronizado/);

    const batches = await queryDb<{ code: string }>('SELECT code FROM "fish_batches" ORDER BY code');
    expect(batches).toHaveLength(2);
  });

  test("2. offline: mortalidad 100 (lote A) y 50 (lote B) -> supervivencia agregada 86,36 %, nunca 70 %", async () => {
    await context.setOffline(true);

    // La primera opción de la lista (ordenada por código) es siempre
    // "LOTE-0001" (Lote A, sembrado con 1000). El estanque solo tiene
    // estos dos lotes, así que "index: 1" tras elegir el estanque
    // selecciona el primer lote real de la lista (después de "Selecciona
    // un lote"). Se registra la mortalidad de cada lote por separado
    // reabriendo el formulario y variando el índice del lote.
    await page.goto("/mortalidad/nueva", { waitUntil: "load" });
    await page.getByLabel("Estanque").selectOption({ label: "E01 — Estanque Norte" });
    await page.getByLabel("Lote").selectOption({ index: 1 });
    await page.getByLabel("Cantidad").fill("100");
    await page.getByRole("button", { name: "Guardar mortalidad" }).click();
    await expect(page).toHaveURL(/\/mortalidad$/);

    await page.goto("/mortalidad/nueva", { waitUntil: "load" });
    await page.getByLabel("Estanque").selectOption({ label: "E01 — Estanque Norte" });
    await page.getByLabel("Lote").selectOption({ index: 2 });
    await page.getByLabel("Cantidad").fill("50");
    await page.getByRole("button", { name: "Guardar mortalidad" }).click();
    await expect(page).toHaveURL(/\/mortalidad$/);

    await page.goto("/", { waitUntil: "load" });
    await waitForBadge(page, /Sin conexión — \d+ cambios? pendientes?/);

    await page.goto("/informes/produccion", { waitUntil: "load" });
    // 950/1100 = 86,36 % (formatPercent redondea a 1 decimal: "86,4 %"),
    // nunca el promedio simple de los % por lote ((90+50)/2 = 70 %).
    await expect(page.getByText("86,4 %", { exact: true })).toBeVisible();
    await expect(page.getByText("70,0 %", { exact: true })).not.toBeVisible();
  });

  test("3. offline: venta 100kg×20 + 900kg×30 -> precio medio ponderado 29,00 Bs/kg, nunca 25", async () => {
    // index 1 = primer lote de la lista (secuencia "-001-", el de 1000
    // peces sembrado primero) — ver nota en registerSale().
    await registerSale(page, 1, "100", "20");
    await registerSale(page, 1, "900", "30");

    await page.goto("/informes/ventas", { waitUntil: "load" });
    await expect(page.getByText("29,00 Bs", { exact: true })).toBeVisible();
    await expect(page.getByText("25,00 Bs", { exact: true })).not.toBeVisible();
  });

  test("4. offline: dashboard de informes muestra los KPIs sin conexión ni llamadas a la API", async () => {
    await page.goto("/informes", { waitUntil: "load" });
    await expect(page.getByText("86,4 %", { exact: true })).toBeVisible(); // supervivencia
    await expect(page.getByText("29,00 Bs", { exact: true })).toBeVisible(); // precio medio/kg
    // Ingresos y Ganancia coinciden en valor (no hay gastos registrados en
    // este escenario), así que se ubica el KPI por su tarjeta para no
    // ambigüar con dos coincidencias exactas del mismo texto.
    const ingresosCard = page.locator("div.rounded-xl", { has: page.getByText("Ingresos", { exact: true }) });
    await expect(ingresosCard.getByText("29.000,00 Bs", { exact: true })).toBeVisible();
  });

  test("5. offline: exportar CSV de producción funciona sin conexión (Blob local, sin red)", async () => {
    await page.goto("/informes/produccion", { waitUntil: "load" });
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Exportar CSV" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("produccion.csv");

    const path = await download.path();
    expect(path).not.toBeNull();
    const content = readFileSync(path!, "utf-8");
    expect(content).toContain("Lote,Especie,Sembrados");
    // Filas POR LOTE (no agregado): 900/1000=90,00 % y 50/100=50,00 %.
    expect(content).toContain("900,90.00");
    expect(content).toContain("50,50.00");
  });

  test("5b. offline: CSV de comparación por especie exporta la supervivencia agregada 86.36 (razón de sumas, no la fila de un lote)", async () => {
    await page.goto("/informes/comparacion", { waitUntil: "load" });
    const downloadPromise = page.waitForEvent("download");
    // El botón "Exportar CSV" de la sección "Por especie" es el segundo de
    // la página (el primero exporta la comparación por lote).
    await page.getByRole("button", { name: "Exportar CSV" }).nth(1).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("comparacion-especies.csv");

    const path = await download.path();
    expect(path).not.toBeNull();
    const content = readFileSync(path!, "utf-8");
    expect(content).toContain("86.36"); // Σ(950)/Σ(1100), nunca el promedio de 90 y 50
  });

  test("6. offline: botón imprimir/PDF no rompe la página (window.print nativo, sin librería)", async () => {
    await page.evaluate(() => {
      (window as unknown as { __printCalls: number }).__printCalls = 0;
      window.print = () => {
        (window as unknown as { __printCalls: number }).__printCalls += 1;
      };
    });
    await page.getByRole("button", { name: "Imprimir / Guardar PDF" }).click();
    const printCalls = await page.evaluate(() => (window as unknown as { __printCalls: number }).__printCalls);
    expect(printCalls).toBe(1);
  });

  test("7. cerrar y reabrir la app sin conexión: los informes muestran exactamente los mismos KPIs", async () => {
    await page.close();
    page = await context.newPage();

    await page.goto("/informes/produccion", { waitUntil: "load" });
    await expect(page.getByText("86,4 %", { exact: true })).toBeVisible();

    await page.goto("/informes/ventas", { waitUntil: "load" });
    await expect(page.getByText("29,00 Bs", { exact: true })).toBeVisible();
  });

  test("8. reconectar, sincronizar (incluso dos veces) y verificar Postgres + KPIs sin duplicar", async () => {
    await context.setOffline(false);
    await page.goto("/", { waitUntil: "load" });
    await page.getByRole("button", { name: "Sincronizar ahora" }).click();
    await waitForBadge(page, /Sincronizado/, 20_000);

    const mortalities = await queryDb('SELECT id FROM "mortality_records"');
    expect(mortalities).toHaveLength(2);
    const sales = await queryDb<{ totalAmount: string }>('SELECT "totalAmount" FROM "sales" ORDER BY "totalAmount"');
    expect(sales).toHaveLength(2);
    expect(sales.map((s) => Number(s.totalAmount))).toEqual([2000, 27000]);

    // Los informes siguen mostrando los mismos KPIs justo después de
    // sincronizar — se calculan de Dexie local, nunca de la API.
    await page.goto("/informes/produccion", { waitUntil: "load" });
    await expect(page.getByText("86,4 %", { exact: true })).toBeVisible();
    await page.goto("/informes/ventas", { waitUntil: "load" });
    await expect(page.getByText("29,00 Bs", { exact: true })).toBeVisible();

    // Sincronizar de nuevo: los mismos operationId ya procesados, nada se
    // duplica en el servidor ni cambia en los informes.
    await page.goto("/", { waitUntil: "load" });
    await page.getByRole("button", { name: "Sincronizar ahora" }).click();
    await waitForBadge(page, /Sincronizado/, 20_000);

    expect(await queryDb('SELECT id FROM "mortality_records"')).toHaveLength(2);
    expect(await queryDb('SELECT id FROM "sales"')).toHaveLength(2);
    expect(await queryDb('SELECT id FROM "sale_lines"')).toHaveLength(2);

    await page.goto("/informes/produccion", { waitUntil: "load" });
    await expect(page.getByText("86,4 %", { exact: true })).toBeVisible();
    await page.goto("/informes/ventas", { waitUntil: "load" });
    await expect(page.getByText("29,00 Bs", { exact: true })).toBeVisible();
  });
});
