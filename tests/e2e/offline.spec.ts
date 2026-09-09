// Escenario offline obligatorio (IMPLEMENTATION_PLAN.md §11; §65/§80 del
// encargo original). Corre contra un build de producción real (ver
// playwright.config.ts) y contra una base de datos Postgres de pruebas
// real — no hay mocks de IndexedDB, de fetch ni de la base de datos.
//
// Todos los pasos comparten un único contexto/página de principio a fin
// (test.describe.serial + beforeAll) a propósito: simulan un mismo
// dispositivo a lo largo de todo el flujo online → offline → online, tal
// como lo viviría una persona en el campo, en vez de partir de un
// navegador nuevo en cada paso.
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

async function waitForBadge(page: Page, pattern: RegExp, timeout = 15_000) {
  await expect(page.locator("span.font-medium").first()).toHaveText(pattern, { timeout });
}

/**
 * Espera a que el service worker tome control de la página. Hasta que eso
 * pase, sus peticiones no se sirven desde el caché del SW: navegar a una
 * ruta offline antes de esto fallaría aunque la ruta ya se hubiera
 * visitado, porque esa primera visita no estuvo bajo control del SW.
 */
async function waitForServiceWorkerControl(page: Page, timeout = 15_000) {
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, {
    timeout,
  });
}

test.describe.serial("Escenario offline obligatorio", () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async () => {
    // Base de datos de pruebas limpia antes de correr el escenario completo.
    // Orden seguro por llaves foráneas: desde Fase 2, fish_transfers /
    // stockings / fish_batches referencian species y ponds.
    await queryDb(
      'TRUNCATE "sync_operations", "fish_transfers", "stockings", "fish_batches", "ponds", "species"',
    );

    browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
    context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context.close();
    await browser.close();
  });

  test("1. abrir con conexión y sincronizar una especie creada online", async ({ baseURL }) => {
    await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
    await waitForServiceWorkerControl(page);

    // El service worker recién tomó control de esta carga: revisita cada
    // ruta que se necesitará offline más adelante para que quede en su
    // caché (el requisito real es "ya usaste la app estando online",
    // §60 del encargo — no un precacheo automático de todo el sitio).
    await page.goto(`${baseURL}/especies`, { waitUntil: "networkidle" });
    await page.goto(`${baseURL}/estanques`, { waitUntil: "networkidle" });
    await page.goto(`${baseURL}/especies`, { waitUntil: "networkidle" });

    await page.getByLabel("Nueva especie").fill("Pacú");
    await page.getByRole("button", { name: "Agregar" }).click();
    await expect(page.getByText("Pacú", { exact: true })).toBeVisible();

    await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
    await waitForBadge(page, /Sincronizado/);

    const rows = await queryDb('SELECT "commonName" FROM "species"');
    expect(rows.map((r) => r.commonName)).toContain("Pacú");
  });

  test("2. desconectar y seguir registrando datos sin conexión", async () => {
    await context.setOffline(true);

    await page.goto("/especies", { waitUntil: "load" });
    await page.getByLabel("Nueva especie").fill("Tilapia");
    await page.getByRole("button", { name: "Agregar" }).click();
    await page.getByLabel("Nueva especie").fill("Tambaquí");
    await page.getByRole("button", { name: "Agregar" }).click();

    await expect(page.getByText("Tilapia", { exact: true })).toBeVisible();
    await expect(page.getByText("Tambaquí", { exact: true })).toBeVisible();

    await page.goto("/", { waitUntil: "load" });
    await waitForBadge(page, /Sin conexión/);

    // Todavía no debe existir nada de esto en el servidor: se guardó solo
    // localmente, sin depender de la red.
    const rows = await queryDb('SELECT "commonName" FROM "species"');
    expect(rows.map((r) => r.commonName)).not.toContain("Tilapia");
    expect(rows.map((r) => r.commonName)).not.toContain("Tambaquí");
  });

  test("3. cerrar y reabrir la app sin conexión: los datos siguen ahí", async () => {
    await page.reload({ waitUntil: "load" });

    await page.goto("/especies", { waitUntil: "load" });
    await expect(page.getByText("Pacú", { exact: true })).toBeVisible();
    await expect(page.getByText("Tilapia", { exact: true })).toBeVisible();
    await expect(page.getByText("Tambaquí", { exact: true })).toBeVisible();
  });

  test("4. modificar un registro sin conexión (desactivar especie)", async () => {
    const row = page.locator("li", { hasText: "Tambaquí" });
    await row.getByRole("button", { name: "Desactivar" }).click();
    await expect(page.getByText("Tambaquí", { exact: true })).not.toBeVisible();

    await page.goto("/", { waitUntil: "load" });
    await waitForBadge(page, /Sin conexión — \d+ cambios? pendientes?/);
  });

  test("5. recuperar conexión y sincronizar sin duplicar nada", async () => {
    await context.setOffline(false);
    await page.getByRole("button", { name: "Sincronizar ahora" }).click();
    await waitForBadge(page, /Sincronizado/, 20_000);

    const rows = await queryDb('SELECT "commonName", active FROM "species" ORDER BY "commonName"');
    const byName = new Map(rows.map((r) => [r.commonName, r.active]));

    expect(rows).toHaveLength(3);
    expect(byName.get("Pacú")).toBe(true);
    expect(byName.get("Tilapia")).toBe(true);
    expect(byName.get("Tambaquí")).toBe(false); // se desactivó offline

    // Sincronizar de nuevo (reintento manual) no debe crear filas extra:
    // el operationId de cada cambio ya fue procesado la primera vez.
    await page.getByRole("button", { name: "Sincronizar ahora" }).click();
    await waitForBadge(page, /Sincronizado/, 20_000);

    const rowsAfterSecondSync = await queryDb('SELECT "id" FROM "species"');
    expect(rowsAfterSecondSync).toHaveLength(3);
  });

  test("6. un error temporal del servidor no pierde el dato y se recupera solo", async () => {
    // Simula el servidor caído sin depender de cortar la red del todo:
    // intercepta específicamente el endpoint de push.
    await page.route("**/api/sync/push", (route) => route.abort("failed"));

    await page.goto("/estanques/nuevo", { waitUntil: "load" });
    await page.getByLabel("Código").fill("E01");
    await page.getByLabel("Nombre").fill("Estanque Norte");
    await page.getByRole("button", { name: "Guardar estanque" }).click();
    await expect(page).toHaveURL(/\/estanques\/[0-9a-f-]+$/);

    await page.goto("/", { waitUntil: "load" });
    await page.getByRole("button", { name: "Sincronizar ahora" }).click();
    await waitForBadge(page, /Error de sincronización|1 cambio pendiente/, 20_000);

    let rows = await queryDb('SELECT "code" FROM "ponds"');
    expect(rows).toHaveLength(0); // todavía no llegó al servidor

    // "Se restaura el servidor": se quita la intercepción y se reintenta.
    await page.unroute("**/api/sync/push");
    await page.getByRole("button", { name: "Sincronizar ahora" }).click();
    await waitForBadge(page, /Sincronizado/, 20_000);

    rows = await queryDb('SELECT "code" FROM "ponds"');
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe("E01");
  });
});
