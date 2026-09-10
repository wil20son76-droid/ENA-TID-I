// Prueba final offline obligatoria (Fase 7, §"Prueba final offline
// obligatoria" del encargo) contra un build de producción real + Postgres
// de pruebas real, sin mocks — reproduce los 20 pasos exactos del
// encargo con un solo dispositivo/sesión de principio a fin:
//
//   1-2.  login online + sincronizar
//   3-5.  desconectar, cerrar la PWA, reabrirla offline
//   6-13. registrar alimentación, mortalidad, muestreo, calidad del
//         agua, tarea, gasto, cosecha y venta — TODO sin conexión
//   14.   consultar informes (sin red)
//   15-17. cerrar, reabrir offline de nuevo, confirmar que todo persiste
//   18-20. reconectar, sincronizar, repetir sincronización
//
// Resultado exigido: ningún dato perdido, ningún duplicado, ningún
// balance negativo, KPIs iguales antes/después de sincronizar — cada uno
// de estos cuatro criterios tiene una aserción explícita más abajo.
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
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, { timeout });
}

const ALL_ROUTES = [
  "/especies",
  "/estanques",
  "/estanques/nuevo",
  "/lotes",
  "/lotes/nuevo",
  "/alimentos",
  "/alimentacion",
  "/alimentacion/nueva",
  "/mortalidad",
  "/mortalidad/nueva",
  "/muestreos/nuevo",
  "/calidad-agua",
  "/calidad-agua/nueva",
  "/tareas",
  "/tareas/nueva",
  "/gastos",
  "/gastos/nuevo",
  "/cosechas",
  "/cosechas/nueva",
  "/ventas",
  "/ventas/nueva",
  "/economia",
  "/informes",
  "/informes/produccion",
];

test.describe.serial("Prueba final offline obligatoria (Fase 7)", () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async () => {
    await queryDb(
      'TRUNCATE "sync_operations", "sale_lines", "sales", "harvests", "expenses", "purchase_lines", ' +
        '"purchases", "customers", "suppliers", "farm_settings", "tasks", "water_quality_records", ' +
        '"feeding_records", "mortality_records", "samplings", "feed_inventory_movements", "feeds", ' +
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

  // --- Pasos 1-2: login online + sincronizar ---
  test("1-2. online: login, precachear rutas, sembrar un lote de 1000 peces con alimento en stock; sincronizar", async ({
    baseURL,
  }) => {
    await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
    await waitForServiceWorkerControl(page);
    await loginViaUi(page, TEST_USER);

    for (const path of ALL_ROUTES) {
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

    await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
    await waitForBadge(page, /Sincronizado/);

    expect(await queryDb('SELECT id FROM "species"')).toHaveLength(1);
    expect(await queryDb('SELECT id FROM "ponds"')).toHaveLength(1);
    expect(await queryDb('SELECT id FROM "feeds"')).toHaveLength(1);
    expect(await queryDb('SELECT id FROM "fish_batches"')).toHaveLength(1);
  });

  // --- Pasos 3-5: desconectar, cerrar la PWA, reabrirla offline ---
  test("3-5. desconectar, cerrar la PWA y reabrirla offline: la sesión sigue activa sin pedir login", async () => {
    await context.setOffline(true);
    await page.close();
    page = await context.newPage();

    await page.goto("/especies", { waitUntil: "load" });
    // Regla crítica del encargo: la sesión ya autenticada sigue
    // funcionando offline sin pedir login de nuevo.
    await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
    await expect(page.getByText("Pacú", { exact: true })).toBeVisible();
  });

  // --- Pasos 6-13: registrar las 8 operaciones, 100% offline ---
  test("6. offline: registrar alimentación (18 kg)", async () => {
    await page.goto("/alimentacion/nueva", { waitUntil: "load" });
    await page.getByLabel("Estanque").selectOption({ label: "E01 — Estanque Norte" });
    await page.getByLabel("Lote").selectOption({ index: 1 });
    await page.getByLabel("Alimento").selectOption({ label: "Crecimiento 32%" });
    await page.getByLabel("Cantidad (kg)").fill("18");
    await page.getByRole("button", { name: "Guardar alimentación" }).click();
    await expect(page).toHaveURL(/\/alimentacion$/);
  });

  test("7. offline: registrar mortalidad (10 peces)", async () => {
    await page.goto("/mortalidad/nueva", { waitUntil: "load" });
    await page.getByLabel("Estanque").selectOption({ label: "E01 — Estanque Norte" });
    await page.getByLabel("Lote").selectOption({ index: 1 });
    await page.getByLabel("Cantidad").fill("10");
    await page.getByRole("button", { name: "Guardar mortalidad" }).click();
    await expect(page).toHaveURL(/\/mortalidad$/);
  });

  test("8. offline: registrar muestreo (30 peces / 15,3 kg)", async () => {
    await page.goto("/muestreos/nuevo", { waitUntil: "load" });
    await page.getByLabel("Estanque").selectOption({ label: "E01 — Estanque Norte" });
    await page.getByLabel("Lote").selectOption({ index: 1 });
    await page.getByLabel("Número de peces").fill("30");
    await page.getByLabel("Peso total (kg)").fill("15.3");
    await page.getByRole("button", { name: "Guardar muestreo" }).click();
    await expect(page).toHaveURL(/\/lotes\/[0-9a-f-]+$/);
  });

  test("9. offline: registrar calidad del agua (28°C / 7,2 / 5,5 mg/L)", async () => {
    await page.goto("/calidad-agua/nueva", { waitUntil: "load" });
    await page.getByLabel("Estanque").selectOption({ label: "E01 — Estanque Norte" });
    await page.getByLabel("Temperatura (°C)").fill("28");
    await page.getByLabel("pH").fill("7.2");
    await page.getByLabel("Oxígeno disuelto (mg/L)").fill("5.5");
    await page.getByRole("button", { name: "Guardar medición" }).click();
    await expect(page).toHaveURL(/\/calidad-agua$/);
  });

  test("10. offline: registrar tarea ('Revisar aireador')", async () => {
    await page.goto("/tareas/nueva", { waitUntil: "load" });
    await page.getByLabel("Título").fill("Revisar aireador");
    await page.getByRole("button", { name: "Guardar tarea" }).click();
    await expect(page).toHaveURL(/\/tareas$/);
    await expect(page.getByText("Revisar aireador", { exact: true })).toBeVisible();
  });

  test("11. offline: registrar gasto (500 Bs, mantenimiento)", async () => {
    await page.goto("/gastos/nuevo", { waitUntil: "load" });
    await page.getByLabel("Descripción").fill("Mantenimiento de aireador");
    await page.getByLabel("Importe").fill("500");
    await page.getByRole("button", { name: "Guardar gasto" }).click();
    await expect(page).toHaveURL(/\/gastos$/);
    await expect(page.getByText("500,00 Bs", { exact: true })).toBeVisible();
  });

  test("12. offline: registrar cosecha parcial (200 peces / 300 kg)", async () => {
    await page.goto("/cosechas/nueva", { waitUntil: "load" });
    await page.getByLabel("Estanque").selectOption({ label: "E01 — Estanque Norte" });
    await page.getByLabel("Lote").selectOption({ index: 1 });
    await page.getByLabel("Peces cosechados").fill("200");
    await page.getByLabel("Peso total (kg)").fill("300");
    await page.getByRole("button", { name: "Guardar cosecha" }).click({ force: true });
    await expect(page).toHaveURL(/\/cosechas$/);
  });

  test("13. offline: registrar venta externa (100 kg × 25 Bs/kg)", async () => {
    await page.goto("/ventas/nueva", { waitUntil: "load" });
    await page.getByLabel("Lote de origen").selectOption({ index: 1 });
    await page.getByLabel("Kg vendidos").fill("100");
    await page.getByLabel("Precio/kg").fill("25");
    await page.getByRole("button", { name: "Guardar venta" }).click();
    await expect(page).toHaveURL(/\/ventas$/);
    await expect(page.getByText("2.500,00 Bs", { exact: true })).toBeVisible();
  });

  // --- Paso 14: consultar informes, sin red ---
  test("14. offline: los informes calculan los KPIs correctos sin conexión — 790 vivos, supervivencia 99,0 %", async () => {
    await page.goto("/informes/produccion", { waitUntil: "load" });
    // 1000 sembrados - 10 muertos - 200 cosechados = 790 vivos actuales
    // (la cosecha nunca cuenta como mortalidad — §19/§34 de Fase 5).
    await expect(page.getByText("790", { exact: true }).first()).toBeVisible();
    // Supervivencia = (1000-10)/1000 × 100 = 99,0 % (redondeo de pantalla).
    await expect(page.getByText("99,0 %", { exact: true }).first()).toBeVisible();
  });

  // --- Pasos 15-17: cerrar, reabrir offline de nuevo, confirmar persistencia ---
  test("15-17. cerrar y reabrir offline de nuevo: absolutamente todo lo registrado sigue ahí", async () => {
    await page.close();
    page = await context.newPage();

    await page.goto("/informes/produccion", { waitUntil: "load" });
    await expect(page.getByText("790", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("99,0 %", { exact: true }).first()).toBeVisible();

    await page.goto("/alimentacion", { waitUntil: "load" });
    await expect(page.getByText(/18[.,]?0?\s*kg/).first()).toBeVisible();

    await page.goto("/tareas", { waitUntil: "load" });
    await expect(page.getByText("Revisar aireador", { exact: true })).toBeVisible();

    await page.goto("/gastos", { waitUntil: "load" });
    await expect(page.getByText("500,00 Bs", { exact: true })).toBeVisible();

    await page.goto("/ventas", { waitUntil: "load" });
    await expect(page.getByText("2.500,00 Bs", { exact: true })).toBeVisible();
  });

  // --- Pasos 18-20: reconectar, sincronizar, repetir sincronización ---
  test("18-19. reconectar y sincronizar: nada se pierde, Postgres queda consistente y los KPIs no cambian", async () => {
    await context.setOffline(false);
    await page.goto("/", { waitUntil: "load" });
    await page.getByRole("button", { name: "Sincronizar ahora" }).click();
    await waitForBadge(page, /Sincronizado/, 20_000);

    // Ningún dato perdido: cada operación registrada offline llegó al servidor.
    expect(await queryDb('SELECT id FROM "feeding_records"')).toHaveLength(1);
    expect(await queryDb('SELECT id FROM "mortality_records"')).toHaveLength(1);
    expect(await queryDb('SELECT id FROM "samplings"')).toHaveLength(1);
    expect(await queryDb('SELECT id FROM "water_quality_records"')).toHaveLength(1);
    expect(await queryDb('SELECT id FROM "tasks"')).toHaveLength(1);
    expect(await queryDb('SELECT id FROM "expenses"')).toHaveLength(1);
    expect(await queryDb('SELECT id FROM "harvests"')).toHaveLength(1);
    expect(await queryDb('SELECT id FROM "sales"')).toHaveLength(1);
    expect(await queryDb('SELECT id FROM "sale_lines"')).toHaveLength(1);

    // Ningún balance negativo: el saldo de peces del lote en Postgres,
    // recalculado desde cero a partir del propio ledger (siembra - muerte
    // - cosecha), nunca es negativo — y coincide con lo que ya vieron los
    // informes offline (790).
    const [{ initialQuantity }] = await queryDb<{ initialQuantity: number }>(
      'SELECT "initialQuantity" FROM "fish_batches" LIMIT 1',
    );
    const [{ quantity: mortalityQty }] = await queryDb<{ quantity: number }>(
      'SELECT quantity FROM "mortality_records" LIMIT 1',
    );
    const [{ quantityFish: harvestedQty }] = await queryDb<{ quantityFish: number }>(
      'SELECT "quantityFish" FROM "harvests" LIMIT 1',
    );
    const currentBalance = initialQuantity - mortalityQty - harvestedQty;
    expect(currentBalance).toBe(790);
    expect(currentBalance).toBeGreaterThanOrEqual(0);

    // KPIs iguales antes/después de sincronizar: los informes se calculan
    // siempre de Dexie local, nunca de la API — deben mostrar EXACTAMENTE
    // lo mismo que mostraban offline en el paso 14.
    await page.goto("/informes/produccion", { waitUntil: "load" });
    await expect(page.getByText("790", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("99,0 %", { exact: true }).first()).toBeVisible();
  });

  test("20. repetir la sincronización: ningún duplicado en Postgres ni cambio en los KPIs", async () => {
    await page.goto("/", { waitUntil: "load" });
    await page.getByRole("button", { name: "Sincronizar ahora" }).click();
    await waitForBadge(page, /Sincronizado/, 20_000);

    expect(await queryDb('SELECT id FROM "species"')).toHaveLength(1);
    expect(await queryDb('SELECT id FROM "ponds"')).toHaveLength(1);
    expect(await queryDb('SELECT id FROM "fish_batches"')).toHaveLength(1);
    expect(await queryDb('SELECT id FROM "feeding_records"')).toHaveLength(1);
    expect(await queryDb('SELECT id FROM "mortality_records"')).toHaveLength(1);
    expect(await queryDb('SELECT id FROM "samplings"')).toHaveLength(1);
    expect(await queryDb('SELECT id FROM "water_quality_records"')).toHaveLength(1);
    expect(await queryDb('SELECT id FROM "tasks"')).toHaveLength(1);
    expect(await queryDb('SELECT id FROM "expenses"')).toHaveLength(1);
    expect(await queryDb('SELECT id FROM "harvests"')).toHaveLength(1);
    expect(await queryDb('SELECT id FROM "sales"')).toHaveLength(1);
    expect(await queryDb('SELECT id FROM "sale_lines"')).toHaveLength(1);
    // Ningún error de sincronización quedó pendiente tras el segundo intento.
    expect(await queryDb('SELECT id FROM "sync_operations" WHERE status = \'error\'')).toHaveLength(0);

    await page.goto("/informes/produccion", { waitUntil: "load" });
    await expect(page.getByText("790", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("99,0 %", { exact: true }).first()).toBeVisible();
  });
});
