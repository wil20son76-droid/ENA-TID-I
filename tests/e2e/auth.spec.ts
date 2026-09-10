// Roles, sesión offline y revocación (Fase 7) contra un build de
// producción real + Postgres de pruebas real, sin mocks. Cada rol usa su
// propio contexto de navegador (su propio localStorage/IndexedDB) — un
// dispositivo distinto por persona, como en la realidad — y todos parten
// de un catálogo ya sincronizado por un Encargado/Administrador.
import { type Browser, type BrowserContext, type Page, chromium, expect, test } from "@playwright/test";
import { Client } from "pg";

import { loginViaUi, seedTestUser } from "./helpers/testAuth";

const ADMIN_USER = { username: "e2e-auth-admin", password: "Test1234!", name: "Admin E2E", role: "ADMIN" as const };
const WORKER_USER = { username: "e2e-auth-worker", password: "Test1234!", name: "Trabajador E2E", role: "WORKER" as const };
const READONLY_USER = {
  username: "e2e-auth-readonly",
  password: "Test1234!",
  name: "Solo Lectura E2E",
  role: "READ_ONLY" as const,
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

async function waitForBadge(page: Page, pattern: RegExp, timeout = 20_000) {
  await expect(page.locator("span.font-medium").first()).toHaveText(pattern, { timeout });
}

async function waitForServiceWorkerControl(page: Page, timeout = 15_000) {
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, { timeout });
}

const ROUTES_TO_WARM = [
  "/especies",
  "/estanques",
  "/estanques/nuevo",
  "/lotes",
  "/lotes/nuevo",
  "/mortalidad",
  "/mortalidad/nueva",
  "/informes",
  "/informes/produccion",
  "/usuarios",
];

/** Abre un contexto/página nueva (un "dispositivo" distinto), la deja lista y logueada. */
async function newLoggedInDevice(
  browser: Browser,
  baseURL: string,
  credentials: { username: string; password: string },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
  await waitForServiceWorkerControl(page);
  await loginViaUi(page, credentials);
  for (const path of ROUTES_TO_WARM) {
    await page.goto(`${baseURL}${path}`, { waitUntil: "networkidle" });
  }
  await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
  await waitForBadge(page, /Sincronizado/, 20_000);
  return { context, page };
}

test.describe.serial("Roles, sesión offline y revocación (Fase 7)", () => {
  let browser: Browser;
  let adminContext: BrowserContext;
  let adminPage: Page;
  let workerContext: BrowserContext;
  let workerPage: Page;
  let readonlyContext: BrowserContext;
  let readonlyPage: Page;

  test.beforeAll(async ({ baseURL }) => {
    await queryDb(
      'TRUNCATE "sync_operations", "sale_lines", "sales", "harvests", "expenses", "purchase_lines", ' +
        '"purchases", "customers", "suppliers", "farm_settings", "tasks", "water_quality_records", ' +
        '"feeding_records", "mortality_records", "samplings", "feed_inventory_movements", "feeds", ' +
        '"fish_transfers", "stockings", "fish_batches", "ponds", "species", "users"',
    );
    await seedTestUser(queryDb, ADMIN_USER);
    await seedTestUser(queryDb, WORKER_USER);
    await seedTestUser(queryDb, READONLY_USER);

    browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
    const admin = await newLoggedInDevice(browser, baseURL!, ADMIN_USER);
    adminContext = admin.context;
    adminPage = admin.page;
  });

  test.afterAll(async () => {
    await adminContext?.close();
    await workerContext?.close();
    await readonlyContext?.close();
    await browser.close();
  });

  test("1. ADMIN (online): crea el catálogo — especie, estanque y lote de 1000 peces; sincroniza", async () => {
    await adminPage.goto("/especies", { waitUntil: "networkidle" });
    await adminPage.getByLabel("Nueva especie").fill("Pacú");
    await adminPage.getByRole("button", { name: "Agregar" }).click();
    await expect(adminPage.getByText("Pacú", { exact: true })).toBeVisible();

    await adminPage.goto("/estanques/nuevo", { waitUntil: "networkidle" });
    await adminPage.getByLabel("Código").fill("E01");
    await adminPage.getByLabel("Nombre").fill("Estanque Norte");
    await adminPage.getByRole("button", { name: "Guardar estanque" }).click();
    await expect(adminPage).toHaveURL(/\/estanques\/[0-9a-f-]+$/);

    await adminPage.goto("/lotes/nuevo", { waitUntil: "networkidle" });
    await adminPage.getByLabel("Especie").selectOption({ label: "Pacú" });
    await adminPage.getByLabel("Estanque de siembra").selectOption({ label: "E01 — Estanque Norte" });
    await adminPage.getByLabel("Cantidad").fill("1000");
    await adminPage.getByLabel("Peso prom. inicial (g)").fill("15");
    await adminPage.getByRole("button", { name: "Sembrar lote" }).click();
    await expect(adminPage).toHaveURL(/\/lotes\/[0-9a-f-]+$/);

    await adminPage.goto("/", { waitUntil: "networkidle" });
    await waitForBadge(adminPage, /Sincronizado/);

    expect(await queryDb('SELECT id FROM "fish_batches"')).toHaveLength(1);
  });

  test("2. TRABAJADOR (otro dispositivo): puede registrar mortalidad (FIELD_OPS), pero NO puede crear una especie (MANAGE_CATALOG)", async ({
    baseURL,
  }) => {
    const worker = await newLoggedInDevice(browser, baseURL!, WORKER_USER);
    workerContext = worker.context;
    workerPage = worker.page;

    // El catálogo del Administrador ya llegó por sync (pull) a este
    // dispositivo distinto — el Trabajador nunca lo creó localmente.
    await workerPage.goto("/especies", { waitUntil: "load" });
    await expect(workerPage.getByText("Pacú", { exact: true })).toBeVisible();

    await workerPage.goto("/mortalidad/nueva", { waitUntil: "load" });
    await workerPage.getByLabel("Estanque").selectOption({ label: "E01 — Estanque Norte" });
    await workerPage.getByLabel("Lote").selectOption({ index: 1 });
    await workerPage.getByLabel("Cantidad").fill("5");
    await workerPage.getByRole("button", { name: "Guardar mortalidad" }).click();
    await expect(workerPage).toHaveURL(/\/mortalidad$/);

    await workerPage.goto("/", { waitUntil: "load" });
    await workerPage.getByRole("button", { name: "Sincronizar ahora" }).click();
    await waitForBadge(workerPage, /Sincronizado/, 20_000);
    expect(await queryDb('SELECT id FROM "mortality_records"')).toHaveLength(1);

    // El botón de registro rápido nunca ofrece "Especies" (no es una de
    // sus opciones en absoluto), y la página de alta de estanque
    // (MANAGE_CATALOG, mismo criterio) muestra el aviso de permiso en vez
    // del formulario.
    await workerPage.goto("/estanques/nuevo", { waitUntil: "load" });
    await expect(workerPage.getByText(/No tienes permiso para esta acción/)).toBeVisible();
    await expect(workerPage.getByLabel("Código")).not.toBeVisible();
  });

  test("3. SOLO LECTURA (otro dispositivo): ve los informes con datos reales, pero no puede registrar nada", async ({
    baseURL,
  }) => {
    const readonly = await newLoggedInDevice(browser, baseURL!, READONLY_USER);
    readonlyContext = readonly.context;
    readonlyPage = readonly.page;

    // Lectura universal: ve el lote y la mortalidad ya sincronizada por
    // otros dispositivos, sin haber escrito nada él mismo.
    await readonlyPage.goto("/informes/produccion", { waitUntil: "load" });
    await expect(readonlyPage.getByText("995", { exact: true }).first()).toBeVisible(); // 1000 - 5 (mortalidad del Trabajador)

    // El botón de registro rápido no ofrece ninguna acción (cero
    // capacidades de escritura).
    await expect(readonlyPage.getByRole("button", { name: "Registrar" })).not.toBeVisible();

    await readonlyPage.goto("/mortalidad/nueva", { waitUntil: "load" });
    await expect(readonlyPage.getByText(/No tienes permiso para esta acción/)).toBeVisible();
  });

  test("4. revocar la sesión del Trabajador desde /usuarios bloquea su PRÓXIMO sync, sin expulsarlo de la app offline", async () => {
    await adminPage.goto("/usuarios", { waitUntil: "load" });
    const [{ tokenVersion: tokenVersionBefore }] = await queryDb<{ tokenVersion: number }>(
      'SELECT "tokenVersion" FROM "users" WHERE username = $1',
      [WORKER_USER.username],
    );

    const workerRow = adminPage.getByRole("row", { name: new RegExp(WORKER_USER.username) });
    await workerRow.getByRole("button", { name: "Cerrar sesiones" }).click();

    // Confirma contra la base de datos (no solo la UI) que la revocación
    // realmente incrementó tokenVersion antes de seguir.
    await expect(async () => {
      const [{ tokenVersion: tokenVersionAfter }] = await queryDb<{ tokenVersion: number }>(
        'SELECT "tokenVersion" FROM "users" WHERE username = $1',
        [WORKER_USER.username],
      );
      expect(tokenVersionAfter).toBe(tokenVersionBefore + 1);
    }).toPass({ timeout: 10_000 });

    // El dispositivo del Trabajador NUNCA se entera por sí solo (sigue
    // offline hasta que intente sincronizar) — sigue mostrando la app con
    // total normalidad, sesión local intacta.
    await workerPage.goto("/mortalidad", { waitUntil: "load" });
    await expect(workerPage.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();

    // Al intentar sincronizar, el servidor rechaza el token revocado — el
    // dato ya registrado localmente no se pierde, solo queda pendiente.
    await workerPage.goto("/mortalidad/nueva", { waitUntil: "load" });
    await workerPage.getByLabel("Estanque").selectOption({ label: "E01 — Estanque Norte" });
    await workerPage.getByLabel("Lote").selectOption({ index: 1 });
    await workerPage.getByLabel("Cantidad").fill("1");
    await workerPage.getByRole("button", { name: "Guardar mortalidad" }).click();
    await expect(workerPage).toHaveURL(/\/mortalidad$/);

    await workerPage.goto("/", { waitUntil: "load" });
    await workerPage.getByRole("button", { name: "Sincronizar ahora" }).click();
    await expect(workerPage.getByText(/sesión fue revocada|sesión expiró/i)).toBeVisible({ timeout: 20_000 });

    // El registro anterior (5) sí se sincronizó antes de la revocación; el
    // último (1) se quedó pendiente en el dispositivo — nunca se pierde.
    expect(await queryDb('SELECT id FROM "mortality_records"')).toHaveLength(1);

    // Un login nuevo (mismo usuario, mismo dispositivo) emite un token con
    // el tokenVersion vigente y desbloquea la sincronización de nuevo.
    await workerPage.getByRole("button", { name: "Cerrar sesión" }).click();
    await workerPage.waitForLoadState("load");
    await loginViaUi(workerPage, WORKER_USER);
    await workerPage.getByRole("button", { name: "Sincronizar ahora" }).click();
    await waitForBadge(workerPage, /Sincronizado/, 20_000);

    expect(await queryDb('SELECT id FROM "mortality_records"')).toHaveLength(2);
  });
});
