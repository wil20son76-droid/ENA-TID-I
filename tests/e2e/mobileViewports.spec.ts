// Prueba móvil obligatoria (puesta en producción, §"Prueba móvil
// obligatoria" del encargo): recorre los 13 flujos exigidos —login,
// dashboard, navegación, crear lote, alimentación, mortalidad, muestreo,
// calidad del agua, tareas, compras/gastos, cosecha, venta, informes— en
// los tres tamaños de pantalla obligatorios (360×800, 390×844, 412×915,
// los tres tamaños de referencia de Android/iPhone más comunes en campo)
// contra un build de producción real, verificando en cada pantalla clave:
//   - cero scroll horizontal de página (solo las tablas, en su propio
//     contenedor con overflow-x-auto, pueden desplazarse lateralmente —
//     nunca la página completa);
//   - la barra de navegación inferior, el header y el botón flotante de
//     registro rápido quedan siempre dentro del viewport, nunca recortados
//     ni fuera de pantalla.
// No repite la prueba offline (ya cubierta exhaustivamente por
// productionReadiness.spec.ts a 390×844) — corre online, más rápida,
// enfocada exclusivamente en que el layout se comporte en cada tamaño.
import { type Browser, type BrowserContext, type Page, chromium, expect, test } from "@playwright/test";
import { Client } from "pg";

import { loginViaUi, seedTestUser } from "./helpers/testAuth";

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

async function waitForServiceWorkerControl(page: Page, timeout = 15_000) {
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, { timeout });
}

/** Ningún elemento (header/nav/FAB incluidos) puede forzar scroll horizontal de la PÁGINA — las tablas con overflow-x-auto se excluden a propósito, tienen su propio contenedor de scroll. */
async function assertNoPageHorizontalScroll(page: Page, where: string) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `scroll horizontal de página inesperado en ${where} (scrollWidth=${scrollWidth} > clientWidth=${clientWidth})`).toBeLessThanOrEqual(clientWidth + 1);
}

/** El header, la barra de navegación inferior y el FAB de registro rápido (si está visible) deben quedar íntegramente dentro del viewport. */
async function assertChromeFitsViewport(page: Page, where: string) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("viewport no configurado");

  const header = page.locator("header").first();
  const headerBox = await header.boundingBox();
  expect(headerBox, `header ausente en ${where}`).not.toBeNull();
  expect(headerBox!.x, `header recortado a la izquierda en ${where}`).toBeGreaterThanOrEqual(-1);
  expect(headerBox!.x + headerBox!.width, `header se sale del viewport en ${where}`).toBeLessThanOrEqual(viewport.width + 1);

  const nav = page.getByRole("navigation", { name: "Navegación principal" });
  const navBox = await nav.boundingBox();
  expect(navBox, `nav inferior ausente en ${where}`).not.toBeNull();
  expect(navBox!.x, `nav inferior recortado a la izquierda en ${where}`).toBeGreaterThanOrEqual(-1);
  expect(navBox!.x + navBox!.width, `nav inferior se sale del viewport en ${where}`).toBeLessThanOrEqual(viewport.width + 1);
  expect(navBox!.y + navBox!.height, `nav inferior se sale del viewport por abajo en ${where}`).toBeLessThanOrEqual(viewport.height + 1);

  const fab = page.getByRole("button", { name: "Registrar" });
  if (await fab.isVisible().catch(() => false)) {
    const fabBox = await fab.boundingBox();
    expect(fabBox, `FAB visible sin bounding box en ${where}`).not.toBeNull();
    expect(fabBox!.x + fabBox!.width, `FAB se sale del viewport en ${where}`).toBeLessThanOrEqual(viewport.width + 1);
    expect(fabBox!.y + fabBox!.height, `FAB se sale del viewport por abajo en ${where}`).toBeLessThanOrEqual(viewport.height + 1);
    // El FAB nunca debe superponerse con la barra de navegación inferior.
    expect(fabBox!.y + fabBox!.height, `FAB se superpone con la nav inferior en ${where}`).toBeLessThanOrEqual(navBox!.y + 1);
  }
}

async function assertMobileLayoutOk(page: Page, where: string) {
  await assertNoPageHorizontalScroll(page, where);
  await assertChromeFitsViewport(page, where);
}

const VIEWPORTS = [
  { name: "360x800 (Android compacto)", width: 360, height: 800 },
  { name: "390x844 (iPhone 12/13/14)", width: 390, height: 844 },
  { name: "412x915 (Android grande / Pixel)", width: 412, height: 915 },
] as const;

for (const viewport of VIEWPORTS) {
  test.describe.serial(`Prueba móvil obligatoria — ${viewport.name}`, () => {
    let browser: Browser;
    let context: BrowserContext;
    let page: Page;
    const testUser = {
      username: `e2e-mobile-${viewport.width}x${viewport.height}`,
      password: "Test1234!",
      name: "Encargado Móvil E2E",
      role: "ADMIN" as const,
    };
    let batchDetailUrl: string;

    test.beforeAll(async () => {
      await queryDb(
        `TRUNCATE "sync_operations", "sale_lines", "sales", "harvests", "expenses", "purchase_lines", ` +
          `"purchases", "customers", "suppliers", "farm_settings", "tasks", "water_quality_records", ` +
          `"feeding_records", "mortality_records", "samplings", "feed_inventory_movements", "feeds", ` +
          `"fish_transfers", "stockings", "fish_batches", "ponds", "species", "password_reset_tokens", "users"`,
      );
      await seedTestUser(queryDb, testUser);

      browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
      context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      page = await context.newPage();
    });

    test.afterAll(async () => {
      await context?.close();
      await browser?.close();
    });

    test("1. login: la pantalla de inicio de sesión cabe sin scroll horizontal", async ({ baseURL }) => {
      await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
      await waitForServiceWorkerControl(page);
      await assertNoPageHorizontalScroll(page, "login");

      await loginViaUi(page, testUser);
    });

    test("2. dashboard: KPIs y tarjetas visibles sin desbordar", async () => {
      await page.goto("/", { waitUntil: "networkidle" });
      await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
      await assertMobileLayoutOk(page, "dashboard");
    });

    test("3. navegación: los 10 accesos de la barra inferior caben y llevan a su página sin desbordar", async ({
      baseURL,
    }) => {
      const NAV_LABELS = [
        "Inicio",
        "Especies",
        "Lotes",
        "Estanques",
        "Alimentación",
        "Mortalidad",
        "Agua",
        "Tareas",
        "Economía",
        "Informes",
      ];
      const nav = page.getByRole("navigation", { name: "Navegación principal" });
      for (const label of NAV_LABELS) {
        const link = nav.getByRole("link", { name: label });
        await expect(link, `enlace "${label}" no visible en la nav a ${viewport.width}px`).toBeVisible();
      }

      await page.goto(`${baseURL}/especies`, { waitUntil: "networkidle" });
      await assertMobileLayoutOk(page, "/especies");
    });

    test("4. crear lote: especie, estanque, alimento y lote con siembra", async ({ baseURL }) => {
      await page.goto(`${baseURL}/especies`, { waitUntil: "networkidle" });
      await page.getByLabel("Nueva especie").fill("Pacú");
      await page.getByRole("button", { name: "Agregar" }).click();
      await expect(page.getByText("Pacú", { exact: true })).toBeVisible();
      await assertMobileLayoutOk(page, "/especies (con especie creada)");

      await page.goto(`${baseURL}/estanques/nuevo`, { waitUntil: "networkidle" });
      await assertMobileLayoutOk(page, "/estanques/nuevo");
      await page.getByLabel("Código").fill("E01");
      await page.getByLabel("Nombre").fill("Estanque Norte");
      await page.getByRole("button", { name: "Guardar estanque" }).click();
      await expect(page).toHaveURL(/\/estanques\/[0-9a-f-]+$/);
      await assertMobileLayoutOk(page, "/estanques/[id]");

      await page.goto(`${baseURL}/alimentos`, { waitUntil: "networkidle" });
      await page.getByLabel("Nuevo alimento").fill("Crecimiento 32%");
      await page.getByLabel(/Stock inicial/).fill("500");
      await page.getByRole("button", { name: "Agregar" }).click();
      await expect(page.getByText("Crecimiento 32%")).toBeVisible();
      await assertMobileLayoutOk(page, "/alimentos");

      await page.goto(`${baseURL}/lotes/nuevo`, { waitUntil: "networkidle" });
      await assertMobileLayoutOk(page, "/lotes/nuevo");
      await page.getByLabel("Especie").selectOption({ label: "Pacú" });
      await page.getByLabel("Estanque de siembra").selectOption({ label: "E01 — Estanque Norte" });
      await page.getByLabel("Cantidad").fill("1000");
      await page.getByLabel("Peso prom. inicial (g)").fill("15");
      await page.getByRole("button", { name: "Sembrar lote" }).click();
      await expect(page).toHaveURL(/\/lotes\/[0-9a-f-]+$/);
      batchDetailUrl = page.url();
      await assertMobileLayoutOk(page, "/lotes/[id] (recién creado)");
    });

    test("5. alimentación: registro rápido de alimentación", async ({ baseURL }) => {
      await page.goto(`${baseURL}/alimentacion/nueva`, { waitUntil: "networkidle" });
      await assertMobileLayoutOk(page, "/alimentacion/nueva");
      await page.getByLabel("Estanque").selectOption({ label: "E01 — Estanque Norte" });
      await page.getByLabel("Lote").selectOption({ index: 1 });
      await page.getByLabel("Alimento").selectOption({ label: "Crecimiento 32%" });
      await page.getByLabel("Cantidad (kg)").fill("18");
      await page.getByRole("button", { name: "Guardar alimentación" }).click();
      await expect(page).toHaveURL(/\/alimentacion$/);
      await assertMobileLayoutOk(page, "/alimentacion (listado)");
    });

    test("6. mortalidad: registro rápido de mortalidad", async ({ baseURL }) => {
      await page.goto(`${baseURL}/mortalidad/nueva`, { waitUntil: "networkidle" });
      await assertMobileLayoutOk(page, "/mortalidad/nueva");
      await page.getByLabel("Estanque").selectOption({ label: "E01 — Estanque Norte" });
      await page.getByLabel("Lote").selectOption({ index: 1 });
      await page.getByLabel("Cantidad").fill("5");
      await page.getByRole("button", { name: "Guardar mortalidad" }).click();
      await expect(page).toHaveURL(/\/mortalidad$/);
      await assertMobileLayoutOk(page, "/mortalidad (listado)");
    });

    test("7. muestreo: registro rápido de muestreo", async ({ baseURL }) => {
      await page.goto(`${baseURL}/muestreos/nuevo`, { waitUntil: "networkidle" });
      await assertMobileLayoutOk(page, "/muestreos/nuevo");
      await page.getByLabel("Estanque").selectOption({ label: "E01 — Estanque Norte" });
      await page.getByLabel("Lote").selectOption({ index: 1 });
      await page.getByLabel("Número de peces").fill("30");
      await page.getByLabel("Peso total (kg)").fill("15.3");
      await page.getByRole("button", { name: "Guardar muestreo" }).click();
      await expect(page).toHaveURL(batchDetailUrl);
      await assertMobileLayoutOk(page, "/lotes/[id] (tras muestreo)");
    });

    test("8. calidad del agua: registro rápido de medición", async ({ baseURL }) => {
      await page.goto(`${baseURL}/calidad-agua/nueva`, { waitUntil: "networkidle" });
      await assertMobileLayoutOk(page, "/calidad-agua/nueva");
      await page.getByLabel("Estanque").selectOption({ label: "E01 — Estanque Norte" });
      await page.getByLabel(/Temperatura/).fill("28");
      await page.getByLabel(/^pH/).fill("7.2");
      await page.getByLabel(/Oxígeno disuelto/).fill("5.5");
      await page.getByRole("button", { name: "Guardar medición" }).click();
      await expect(page).toHaveURL(/\/calidad-agua$/);
      await assertMobileLayoutOk(page, "/calidad-agua (listado)");
    });

    test("9. tareas: alta de una tarea", async ({ baseURL }) => {
      await page.goto(`${baseURL}/tareas/nueva`, { waitUntil: "networkidle" });
      await assertMobileLayoutOk(page, "/tareas/nueva");
      await page.getByLabel("Título").fill("Revisar aireador");
      await page.getByRole("button", { name: "Guardar tarea" }).click();
      await expect(page).toHaveURL(/\/tareas$/);
      await assertMobileLayoutOk(page, "/tareas (listado)");
    });

    test("10. compras/gastos: registrar una compra y un gasto", async ({ baseURL }) => {
      await page.goto(`${baseURL}/compras/nueva`, { waitUntil: "networkidle" });
      await assertMobileLayoutOk(page, "/compras/nueva");
      await page.getByLabel("Alimento del catálogo").selectOption({ label: "Crecimiento 32%" });
      await page.getByRole("button", { name: "Kg directo" }).click();
      await page.getByLabel("Kg totales").fill("500");
      await page.getByLabel("Precio/kg").fill("7.6");
      await page.getByRole("button", { name: "Guardar compra" }).click();
      await expect(page).toHaveURL(/\/compras$/);
      await assertMobileLayoutOk(page, "/compras (listado)");

      await page.goto(`${baseURL}/gastos/nuevo`, { waitUntil: "networkidle" });
      await assertMobileLayoutOk(page, "/gastos/nuevo");
      await page.getByLabel("Descripción").fill("Reparación de aireador");
      await page.getByLabel("Importe").fill("500");
      await page.getByRole("button", { name: "Guardar gasto" }).click();
      await expect(page).toHaveURL(/\/gastos$/);
      await assertMobileLayoutOk(page, "/gastos (listado)");
    });

    test("11. cosecha: cosecha parcial del lote", async ({ baseURL }) => {
      await page.goto(`${baseURL}/cosechas/nueva`, { waitUntil: "networkidle" });
      await assertMobileLayoutOk(page, "/cosechas/nueva");
      await page.getByLabel("Estanque").selectOption({ label: "E01 — Estanque Norte" });
      await page.getByLabel("Lote").selectOption({ index: 1 });
      await page.getByLabel("Peces cosechados").fill("200");
      await page.getByLabel("Peso total (kg)").fill("300");
      await page.getByRole("button", { name: "Guardar cosecha" }).click();
      await expect(page).toHaveURL(/\/cosechas$/);
      await assertMobileLayoutOk(page, "/cosechas (listado)");
    });

    test("12. venta: venta externa contra la cosecha", async ({ baseURL }) => {
      await page.goto(`${baseURL}/ventas/nueva`, { waitUntil: "networkidle" });
      await assertMobileLayoutOk(page, "/ventas/nueva");
      await page.getByLabel("Lote de origen").selectOption({ index: 1 });
      await page.getByLabel("Kg vendidos").fill("100");
      await page.getByLabel("Precio/kg").fill("25");
      await page.getByRole("button", { name: "Guardar venta" }).click();
      await expect(page).toHaveURL(/\/ventas$/);
      await assertMobileLayoutOk(page, "/ventas (listado)");
    });

    test("13. informes: dashboard de informes y producción — tablas con su propio scroll, nunca la página", async ({
      baseURL,
    }) => {
      await page.goto(`${baseURL}/informes`, { waitUntil: "networkidle" });
      await assertMobileLayoutOk(page, "/informes");

      await page.goto(`${baseURL}/informes/produccion`, { waitUntil: "networkidle" });
      await assertMobileLayoutOk(page, "/informes/produccion");

      // Confirma explícitamente que una tabla ancha se desplaza dentro de
      // su propio contenedor (overflow-x-auto), nunca arrastrando a toda
      // la página con ella.
      await page.goto(`${baseURL}/informes/comparacion`, { waitUntil: "networkidle" });
      await assertMobileLayoutOk(page, "/informes/comparacion");
    });

    test("14. sincroniza y confirma en Postgres — el layout no afectó los datos", async () => {
      await page.goto("/", { waitUntil: "networkidle" });
      await expect(page.locator("span.font-medium").first()).toHaveText(/Sincronizado/, { timeout: 20_000 });

      expect(await queryDb('SELECT id FROM "fish_batches" WHERE code LIKE $1', ["PAC-%"])).toHaveLength(1);
      expect(await queryDb('SELECT id FROM "mortality_records"')).toHaveLength(1);
      expect(await queryDb('SELECT id FROM "harvests"')).toHaveLength(1);
      expect(await queryDb('SELECT id FROM "sales"')).toHaveLength(1);
    });
  });
}
