// Escenario offline de calidad del agua y tareas (Fase 4, §40-§41 del
// encargo). Mismo enfoque que dailyOperations.spec.ts (Fase 3): build de
// producción real + Postgres de pruebas real, sin mocks. Reproduce el
// "criterio de éxito" de Fase 4: registrar calidad del agua y crear
// tareas 100% offline, cerrar/reabrir la app sin conexión y comprobar que
// todo sigue ahí, ver una alerta de oxígeno bajo generada localmente sin
// conexión, reconectar y verificar Postgres sin duplicados.
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

function tomorrowIsoDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

test.describe.serial("Calidad del agua y tareas offline (Fase 4)", () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async () => {
    await queryDb(
      'TRUNCATE "sync_operations", "sale_lines", "sales", "harvests", "expenses", "purchase_lines", ' +
        '"purchases", "customers", "suppliers", "farm_settings", "tasks", "water_quality_records", "feeding_records", ' +
        '"mortality_records", "samplings", "feed_inventory_movements", "feeds", ' +
        '"fish_transfers", "stockings", "fish_batches", "ponds", "species", "users"',
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

  test("1. online: crear especie Pacú (O2 mínimo 5 mg/L), estanque E01, sembrar un lote; sincronizar", async ({
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
      "/calidad-agua",
      "/calidad-agua/nueva",
      "/tareas",
      "/tareas/nueva",
      "/calendario",
    ]) {
      await page.goto(`${baseURL}${path}`, { waitUntil: "networkidle" });
    }

    await page.goto(`${baseURL}/especies`, { waitUntil: "networkidle" });
    await page.getByLabel("Nueva especie").fill("Pacú");
    await page.getByRole("button", { name: "+ Detalles opcionales" }).click();
    await page.getByLabel(/Oxígeno disuelto mínimo/).fill("5");
    await page.getByRole("button", { name: "Agregar" }).click();
    await expect(page.getByText("Pacú", { exact: true })).toBeVisible();

    await page.goto(`${baseURL}/estanques/nuevo`, { waitUntil: "networkidle" });
    await page.getByLabel("Código").fill("E01");
    await page.getByLabel("Nombre").fill("Estanque Norte");
    await page.getByRole("button", { name: "Guardar estanque" }).click();
    await expect(page).toHaveURL(/\/estanques\/[0-9a-f-]+$/);

    // Un lote de Pacú sembrado en E01 — evaluateWaterQuality necesita
    // saber qué especies están presentes en el estanque (§5 del encargo)
    // para poder evaluar una medición contra un rango real.
    await page.goto(`${baseURL}/lotes/nuevo`, { waitUntil: "networkidle" });
    await page.getByLabel("Especie").selectOption({ label: "Pacú" });
    await page.getByLabel("Estanque de siembra").selectOption({ label: "E01 — Estanque Norte" });
    await page.getByLabel("Cantidad").fill("1000");
    await page.getByLabel("Peso prom. inicial (g)").fill("15");
    await page.getByRole("button", { name: "Sembrar lote" }).click();
    await expect(page).toHaveURL(/\/lotes\/[0-9a-f-]+$/);

    await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
    await waitForBadge(page, /Sincronizado/);

    const species = await queryDb('SELECT "commonName" FROM "species"');
    expect(species.map((s) => s.commonName)).toEqual(["Pacú"]);
    const ponds = await queryDb('SELECT code FROM "ponds"');
    expect(ponds.map((p) => p.code)).toEqual(["E01"]);
    const batches = await queryDb('SELECT code FROM "fish_batches"');
    expect(batches).toHaveLength(1);
  });

  test("2. offline: registrar calidad del agua (28°C/7,2/5,5 mg/L) y dos tareas", async () => {
    await context.setOffline(true);

    await page.goto("/calidad-agua/nueva", { waitUntil: "load" });
    await page.getByLabel("Estanque").selectOption({ label: "E01 — Estanque Norte" });
    await page.getByLabel("Temperatura (°C)").fill("28");
    await page.getByLabel("pH").fill("7.2");
    await page.getByLabel("Oxígeno disuelto (mg/L)").fill("5.5");
    await page.getByRole("button", { name: "Guardar medición" }).click();
    await expect(page).toHaveURL(/\/calidad-agua$/);
    await expect(page.getByText(/28.*°C/).first()).toBeVisible();

    await page.goto("/tareas/nueva", { waitUntil: "load" });
    await page.getByLabel("Título").fill("Revisar E01");
    await page.getByRole("button", { name: "Guardar tarea" }).click();
    await expect(page).toHaveURL(/\/tareas$/);

    await page.goto("/tareas/nueva", { waitUntil: "load" });
    await page.getByLabel("Título").fill("Muestrear Pacú");
    await page.getByLabel("Fecha").fill(tomorrowIsoDate());
    await page.getByRole("button", { name: "Guardar tarea" }).click();
    await expect(page).toHaveURL(/\/tareas$/);

    await page.goto("/", { waitUntil: "load" });
    await waitForBadge(page, /Sin conexión — \d+ cambios? pendientes?/);

    // Nada de esto llegó todavía al servidor.
    const records = await queryDb('SELECT id FROM "water_quality_records"');
    expect(records).toHaveLength(0);
    const tasks = await queryDb('SELECT id FROM "tasks"');
    expect(tasks).toHaveLength(0);
  });

  test("3. offline: cerrar y reabrir la app — medición y ambas tareas siguen visibles", async () => {
    await page.close();
    page = await context.newPage();

    await page.goto("/calidad-agua", { waitUntil: "load" });
    await expect(page.getByText(/28.*°C/).first()).toBeVisible();
    await expect(page.getByText(/pH 7\.2/).first()).toBeVisible();

    await page.goto("/tareas", { waitUntil: "load" });
    await expect(page.getByText("Revisar E01")).toBeVisible(); // sección "Hoy"
    await expect(page.getByText("Muestrear Pacú")).toBeVisible(); // sección "Próximas"
  });

  test("4. offline: una nueva medición con O2 = 3 mg/L (< mínimo 5 de Pacú) genera una alerta inmediata, sin conexión", async () => {
    await page.goto("/calidad-agua/nueva", { waitUntil: "load" });
    await page.getByLabel("Estanque").selectOption({ label: "E01 — Estanque Norte" });
    await page.getByLabel("Oxígeno disuelto (mg/L)").fill("3");
    await page.getByRole("button", { name: "Guardar medición" }).click();
    await expect(page).toHaveURL(/\/calidad-agua$/);

    // La alerta se calcula 100% local (evaluateWaterQuality), sin ninguna
    // llamada de red — el contexto del navegador sigue offline aquí.
    await expect(page.getByText(/Oxígeno disuelto bajo para Pacú/)).toBeVisible();
    await expect(page.getByText(/❗ Crítico/)).toBeVisible(); // 3 < 5 * 0.8

    // También visible en el dashboard.
    await page.goto("/", { waitUntil: "load" });
    await expect(page.getByText("Alertas de agua")).toBeVisible();
  });

  test("5. offline: completar 'Revisar E01'", async () => {
    await page.goto("/tareas", { waitUntil: "load" });
    const row = page.locator("li", { hasText: "Revisar E01" });
    await row.getByRole("button", { name: "Completar tarea" }).click();

    // Al completarse, la tarea deja la sección "Hoy" y pasa a
    // "Completadas" (colapsada por defecto) — nunca queda en las dos
    // secciones a la vez.
    await expect(page.locator("li", { hasText: "Revisar E01" })).toHaveCount(0);

    await page.getByRole("button", { name: /Completadas/ }).click(); // abre la sección
    const completedRow = page.locator("li", { hasText: "Revisar E01" });
    await expect(completedRow).toBeVisible();
    await expect(completedRow.getByText("Revisar E01")).toHaveClass(/line-through/);
  });

  test("6. reconectar, sincronizar y verificar Postgres sin duplicados en un segundo intento", async () => {
    await context.setOffline(false);
    await page.goto("/", { waitUntil: "load" });
    await page.getByRole("button", { name: "Sincronizar ahora" }).click();
    await waitForBadge(page, /Sincronizado/, 20_000);

    const records = await queryDb<{ ph: string | null }>(
      'SELECT ph FROM "water_quality_records" ORDER BY "createdAt"',
    );
    expect(records).toHaveLength(2); // la de 28°C/7.2/5.5 y la de O2=3

    const tasks = await queryDb<{ title: string; status: string }>(
      'SELECT title, status FROM "tasks" ORDER BY "dueDate"',
    );
    expect(tasks).toHaveLength(2);
    const revisar = tasks.find((t) => t.title === "Revisar E01");
    expect(revisar?.status).toBe("COMPLETED");
    const muestrear = tasks.find((t) => t.title === "Muestrear Pacú");
    expect(muestrear?.status).toBe("PENDING");

    // Reintentar el mismo sync: los operationId ya procesados no duplican nada.
    await page.getByRole("button", { name: "Sincronizar ahora" }).click();
    await waitForBadge(page, /Sincronizado/, 20_000);

    const recordsAfterSecondSync = await queryDb('SELECT id FROM "water_quality_records"');
    expect(recordsAfterSecondSync).toHaveLength(2);
    const tasksAfterSecondSync = await queryDb('SELECT id FROM "tasks"');
    expect(tasksAfterSecondSync).toHaveLength(2);
  });
});
