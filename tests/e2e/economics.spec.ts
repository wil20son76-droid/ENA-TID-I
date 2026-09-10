// Escenario offline de economía y cierre productivo (Fase 5, §68 del
// encargo). Mismo enfoque sin mocks que production.spec.ts/
// dailyOperations.spec.ts: build de producción real + Postgres de pruebas
// real. Reproduce el escenario exacto del encargo: compra de alimento,
// cosecha parcial, cliente nuevo, venta contra esa cosecha y gasto directo
// de lote — todo 100% offline, cerrar/reabrir sin conexión, reconectar y
// verificar Postgres sin duplicados en un segundo intento de sincronización.
import { type Browser, type BrowserContext, type Page, chromium, expect, test } from "@playwright/test";
import { Client } from "pg";

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

test.describe.serial("Economía y cierre productivo offline (Fase 5)", () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let batchDetailUrl: string;

  test.beforeAll(async () => {
    await queryDb(
      'TRUNCATE "sync_operations", "sale_lines", "sales", "harvests", "expenses", "purchase_lines", ' +
        '"purchases", "customers", "suppliers", "farm_settings", "tasks", "water_quality_records", ' +
        '"feeding_records", "mortality_records", "samplings", "feed_inventory_movements", "feeds", ' +
        '"fish_transfers", "stockings", "fish_batches", "ponds", "species"',
    );

    browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
    context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context.close();
    await browser.close();
  });

  test("1. online: crear especie, estanque, alimento con stock y lote de 1000 peces; sincronizar", async ({
    baseURL,
  }) => {
    await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
    await waitForServiceWorkerControl(page);

    // Visita cada ruta que se necesitará offline más adelante (mismo
    // requisito que production.spec.ts/dailyOperations.spec.ts).
    for (const path of [
      "/especies",
      "/estanques",
      "/estanques/nuevo",
      "/alimentos",
      "/lotes",
      "/lotes/nuevo",
      "/proveedores",
      "/clientes",
      "/compras",
      "/compras/nueva",
      "/gastos",
      "/gastos/nuevo",
      "/cosechas",
      "/cosechas/nueva",
      "/ventas",
      "/ventas/nueva",
      "/economia",
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

    const feeds = await queryDb('SELECT name FROM "feeds"');
    expect(feeds.map((f) => f.name)).toEqual(["Crecimiento 32%"]);
  });

  test("2. offline: compra de 500kg de alimento -> stock 1000kg", async () => {
    await context.setOffline(true);

    await page.goto("/compras/nueva", { waitUntil: "load" });
    await page.getByLabel("Alimento del catálogo").selectOption({ label: "Crecimiento 32%" });
    await page.getByRole("button", { name: "Kg directo" }).click();
    await page.getByLabel("Kg totales").fill("500");
    await page.getByLabel("Precio/kg").fill("7.6");
    await page.getByRole("button", { name: "Guardar compra" }).click();
    await expect(page).toHaveURL(/\/compras$/);

    await page.goto("/alimentos", { waitUntil: "load" });
    await expect(page.getByText(/Stock:\s*1\.?000,0\s*kg/)).toBeVisible();

    await page.goto("/", { waitUntil: "load" });
    await waitForBadge(page, /Sin conexión — \d+ cambios? pendientes?/);

    const purchases = await queryDb('SELECT id FROM "purchases"');
    expect(purchases).toHaveLength(0); // nada llegó todavía al servidor
  });

  test("3. offline: cosecha parcial de 200 peces/300kg -> quedan 800 peces en el lote", async () => {
    await page.goto("/cosechas/nueva", { waitUntil: "load" });
    await page.getByLabel("Estanque").selectOption({ label: "E01 — Estanque Norte" });
    await page.getByLabel("Lote").selectOption({ index: 1 });
    await page.getByLabel("Peces cosechados").fill("200");
    await page.getByLabel("Peso total (kg)").fill("300");
    await page.getByRole("button", { name: "Guardar cosecha" }).click({ force: true });
    await expect(page).toHaveURL(/\/cosechas$/);

    await page.goto(batchDetailUrl, { waitUntil: "load" });
    await expect(async () => {
      const text = await page.locator("main").innerText();
      expect(text).toContain("800"); // 1000 - 200 cosechados
    }).toPass({ timeout: 5_000 });
  });

  test("4. offline: crear cliente 'Restaurante X'", async () => {
    await page.goto("/clientes", { waitUntil: "load" });
    await page.getByLabel("Nuevo cliente").fill("Restaurante X");
    await page.getByRole("button", { name: "Agregar" }).click();
    await expect(page.getByText("Restaurante X")).toBeVisible();
  });

  test("5. offline: venta de 200kg x 32 Bs/kg contra la cosecha -> total 6.400,00 Bs", async () => {
    await page.goto("/ventas/nueva", { waitUntil: "load" });
    await page.getByLabel("Cliente (opcional)").selectOption({ label: "Restaurante X" });
    await page.getByLabel("Lote de origen").selectOption({ index: 1 });
    await page.getByLabel("Cosecha (opcional)").selectOption({ index: 1 });
    await page.getByLabel("Kg vendidos").fill("200");
    await page.getByLabel("Precio/kg").fill("32");
    await expect(page.getByText(/Total:/)).toContainText("6.400,00");
    await page.getByRole("button", { name: "Guardar venta" }).click();
    await expect(page).toHaveURL(/\/ventas$/);

    await expect(page.getByText("6.400,00 Bs", { exact: true })).toBeVisible();
  });

  test("6. offline: gasto directo de 1.000 Bs al lote", async () => {
    await page.goto("/gastos/nuevo", { waitUntil: "load" });
    await page.getByLabel("Descripción").fill("Reparación de aireador");
    await page.getByLabel("Importe").fill("1000");
    await page.getByLabel("Lote (opcional)").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Guardar gasto" }).click();
    await expect(page).toHaveURL(/\/gastos$/);
    await expect(page.getByText("1.000,00 Bs", { exact: true })).toBeVisible();

    await page.goto(batchDetailUrl, { waitUntil: "load" });
    await expect(async () => {
      const text = await page.locator("main").innerText();
      expect(text).toContain("Rentabilidad provisional"); // el lote sigue con peces vivos (§41)
    }).toPass({ timeout: 5_000 });
  });

  test("7. cerrar y reabrir la app sin conexión: compra, cosecha, cliente, venta y gasto siguen ahí", async () => {
    await page.close();
    page = await context.newPage();

    await page.goto("/alimentos", { waitUntil: "load" });
    await expect(page.getByText(/Stock:\s*1\.?000,0\s*kg/)).toBeVisible();

    await page.goto(batchDetailUrl, { waitUntil: "load" });
    await expect(async () => {
      const text = await page.locator("main").innerText();
      expect(text).toContain("800");
    }).toPass({ timeout: 5_000 });

    await page.goto("/clientes", { waitUntil: "load" });
    await expect(page.getByText("Restaurante X")).toBeVisible();

    await page.goto("/ventas", { waitUntil: "load" });
    await expect(page.getByText("6.400,00 Bs", { exact: true })).toBeVisible();

    await page.goto("/gastos", { waitUntil: "load" });
    await expect(page.getByText("1.000,00 Bs", { exact: true })).toBeVisible();
  });

  test("8. reconectar, sincronizar y verificar Postgres sin duplicados en un segundo intento", async () => {
    await context.setOffline(false);
    await page.goto("/", { waitUntil: "load" });
    await page.getByRole("button", { name: "Sincronizar ahora" }).click();
    await waitForBadge(page, /Sincronizado/, 20_000);

    const purchases = await queryDb('SELECT id, "totalAmount" FROM "purchases"');
    expect(purchases).toHaveLength(1);
    expect(Number(purchases[0].totalAmount)).toBeCloseTo(3800, 5);

    const purchaseLines = await queryDb('SELECT id FROM "purchase_lines"');
    expect(purchaseLines).toHaveLength(1);

    const movements = await queryDb<{ movementType: string; quantityKg: string }>(
      'SELECT "movementType", "quantityKg" FROM "feed_inventory_movements"',
    );
    const stock = movements.reduce((sum, m) => sum + Number(m.quantityKg), 0);
    expect(stock).toBe(1000); // 500 inicial + 500 comprado

    const harvests = await queryDb<{ quantityFish: number; totalWeightKg: string }>(
      'SELECT "quantityFish", "totalWeightKg" FROM "harvests"',
    );
    expect(harvests).toHaveLength(1);
    expect(harvests[0].quantityFish).toBe(200);
    expect(Number(harvests[0].totalWeightKg)).toBe(300);

    const customers = await queryDb('SELECT name FROM "customers"');
    expect(customers.map((c) => c.name)).toEqual(["Restaurante X"]);

    const sales = await queryDb<{ totalAmount: string }>('SELECT "totalAmount" FROM "sales"');
    expect(sales).toHaveLength(1);
    expect(Number(sales[0].totalAmount)).toBe(6400);

    const saleLines = await queryDb('SELECT id FROM "sale_lines"');
    expect(saleLines).toHaveLength(1);

    const expenses = await queryDb<{ totalAmount: string }>('SELECT "totalAmount" FROM "expenses"');
    expect(expenses).toHaveLength(1);
    expect(Number(expenses[0].totalAmount)).toBe(1000);

    // Sincronizar de nuevo: los mismos operationId ya procesados, nada se duplica.
    await page.getByRole("button", { name: "Sincronizar ahora" }).click();
    await waitForBadge(page, /Sincronizado/, 20_000);

    expect(await queryDb('SELECT id FROM "purchases"')).toHaveLength(1);
    expect(await queryDb('SELECT id FROM "purchase_lines"')).toHaveLength(1);
    expect(await queryDb('SELECT id FROM "harvests"')).toHaveLength(1);
    expect(await queryDb('SELECT id FROM "sales"')).toHaveLength(1);
    expect(await queryDb('SELECT id FROM "sale_lines"')).toHaveLength(1);
    expect(await queryDb('SELECT id FROM "expenses"')).toHaveLength(1);
    expect(await queryDb('SELECT "quantityKg" FROM "feed_inventory_movements"')).toHaveLength(2);
  });
});
