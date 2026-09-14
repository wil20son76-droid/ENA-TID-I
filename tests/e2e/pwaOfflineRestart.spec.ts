// Bug crítico reportado en producción (teléfono real): la PWA no
// arrancaba offline después de cerrarla completamente y reabrirla. Este
// spec reproduce EXACTAMENTE ese escenario — no el que ya cubrían los
// demás E2E offline (`context.setOffline()` sobre una página que ya
// terminó de cargar mientras estaba online).
//
// Dos diferencias deliberadas frente al resto de la suite, ambas
// necesarias para reproducir el bug real (verificado empíricamente
// durante el diagnóstico):
//
//   1. `chromium.launchPersistentContext(userDataDir, ...)`, cerrando y
//      reabriendo el MISMO perfil en disco — no basta con cerrar la
//      `page` y abrir una nueva en el mismo `context` (lo que hacen los
//      demás specs): eso nunca destruye el estado en memoria del
//      service worker/router de Next, así que nunca reproduce un
//      arranque realmente "en frío". Un `context.newContext()` efímero
//      tampoco sirve — borra IndexedDB/Cache Storage al cerrarse, cuando
//      lo que hay que probar es que SÍ sobreviven a cerrar la PWA.
//   2. `context.route("**/*", route => route.abort())` en vez de
//      `context.setOffline(true)`/`{ offline: true }` — verificado en la
//      práctica: `setOffline` NO bloquea de forma fiable las peticiones
//      que el propio service worker dispara desde su contexto de
//      ejecución en este Chromium, así que una prueba con `setOffline`
//      puede "pasar" en verde mientras el service worker sigue golpeando
//      el servidor real en segundo plano — exactamente el falso positivo
//      que dejó pasar este bug en el resto de la suite.
import { type BrowserContext, type Page, chromium, expect, test } from "@playwright/test";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";

const TEST_USER = { username: "e2e-pwa-restart", password: "Test1234!", name: "PWA Restart", role: "ADMIN" as const };

const TEST_DATABASE_URL =
  process.env.PLAYWRIGHT_DATABASE_URL ??
  (process.env.DATABASE_URL
    ? process.env.DATABASE_URL.replace(/\/([^/?]+)(\?|$)/, "/$1_test$2")
    : "postgresql://postgres:postgres@localhost:5432/piscicultura_test?schema=public");

async function queryDb<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}

function hashPasswordForSeed(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

async function seedUser(): Promise<void> {
  await queryDb(
    'INSERT INTO "users" (id, username, name, "passwordHash", role, active, "tokenVersion", "createdAt", "updatedAt") ' +
      "VALUES ($1, $2, $3, $4, $5, true, 1, now(), now())",
    [randomUUID(), TEST_USER.username, TEST_USER.name, hashPasswordForSeed(TEST_USER.password), TEST_USER.role],
  );
}

/** Descarta el aviso "Instala la app" si `beforeinstallprompt` disparó y
 * quedó tapando algún botón — ver nota en el primer test. Seguro de
 * llamar aunque no esté visible. */
async function dismissInstallPromptIfVisible(page: Page): Promise<void> {
  const dismissButton = page.getByRole("button", { name: "Ahora no" });
  if (await dismissButton.isVisible().catch(() => false)) {
    await dismissButton.click();
  }
}

// Rutas principales de la barra inferior (§"Navegación offline" del
// encargo) — se navega haciendo clic en el link, nunca con page.goto:
// un page.goto directo "precachearía" la ruta por sí solo y ocultaría
// exactamente el tipo de fallo que este spec busca detectar.
const MAIN_NAV: Array<[label: string, pathSuffix: string]> = [
  ["Estanques", "/estanques"],
  ["Lotes", "/lotes"],
  ["Alimentación", "/alimentacion"],
  ["Mortalidad", "/mortalidad"],
  ["Ración", "/racion-recomendada"],
  ["Agua", "/calidad-agua"],
  ["Tareas", "/tareas"],
  ["Informes", "/informes"],
  ["Inicio", "/"],
];

const NETWORK_ERROR_PATTERN =
  /ERR_INTERNET_DISCONNECTED|ERR_FAILED|This site can.t be reached|No hay conexión a Internet|no internet/i;

test.describe.serial("PWA: arranque offline tras cerrar e instalar (bug crítico de producción)", () => {
  let userDataDir: string;
  let ctx: BrowserContext;
  let page: Page;
  let pondDetailUrl: string;

  test.beforeAll(async () => {
    await queryDb(
      'TRUNCATE "sync_operations", "sale_lines", "sales", "harvests", "expenses", "purchase_lines", ' +
        '"purchases", "customers", "suppliers", "farm_settings", "tasks", "water_quality_records", ' +
        '"feeding_records", "mortality_records", "samplings", ' +
        '"feed_inventory_movements", "feeds", "fish_transfers", "stockings", "fish_batches", "ponds", "feeding_recommendations", "species", "password_reset_tokens", "users"',
    );
    await seedUser();
    userDataDir = mkdtempSync(path.join(tmpdir(), "pwa-restart-"));
  });

  test.afterAll(async () => {
    await ctx?.close().catch(() => undefined);
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test("1-6. online: instalar (primera visita), iniciar sesión, sincronizar, y confirmar que el service worker controla la página", async ({
    baseURL,
  }) => {
    ctx = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      executablePath: "/opt/pw-browsers/chromium",
      viewport: { width: 390, height: 844 },
    });
    page = await ctx.newPage();

    await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });

    await page.getByLabel("Usuario").fill(TEST_USER.username);
    await page.getByLabel("Contraseña").fill(TEST_USER.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible({ timeout: 15_000 });

    // `launchPersistentContext` (perfil real en disco, necesario para
    // reproducir de verdad "cerrar e instalar") dispara
    // "beforeinstallprompt" de forma mucho más consistente que un
    // contexto efímero — el aviso de instalación queda fijo cerca del
    // borde inferior y tapa botones de formularios más abajo en esta
    // prueba si no se descarta primero.
    await dismissInstallPromptIfVisible(page);

    // Crea el mínimo de catálogo (especie/estanque/lote/alimento) para
    // poder registrar una alimentación offline más adelante (paso 13).
    // Cada `page.goto` remonta el layout raíz (y con él, InstallPrompt) —
    // hay que volver a descartar el aviso en cada una.
    await page.goto(`${baseURL}/especies`, { waitUntil: "networkidle" });
    await dismissInstallPromptIfVisible(page);
    await page.getByLabel("Nueva especie").fill("Pacú");
    await page.getByRole("button", { name: "Agregar" }).click();
    await expect(page.getByText("Pacú", { exact: true })).toBeVisible();

    await page.goto(`${baseURL}/estanques/nuevo`, { waitUntil: "networkidle" });
    await dismissInstallPromptIfVisible(page);
    await page.getByLabel("Código").fill("E01");
    await page.getByLabel("Nombre").fill("Estanque Norte");
    await page.getByRole("button", { name: "Guardar estanque" }).click();
    await expect(page).toHaveURL(/\/estanques\/[0-9a-f-]+$/);
    pondDetailUrl = page.url();

    await page.goto(`${baseURL}/alimentos`, { waitUntil: "networkidle" });
    await dismissInstallPromptIfVisible(page);
    await page.getByLabel("Nuevo alimento").fill("Crecimiento 32%");
    await page.getByLabel(/Stock inicial/).fill("500");
    await page.getByRole("button", { name: "Agregar" }).click();
    await expect(page.getByText("Crecimiento 32%")).toBeVisible();

    await page.goto(`${baseURL}/lotes/nuevo`, { waitUntil: "networkidle" });
    await dismissInstallPromptIfVisible(page);
    await page.getByLabel("Especie").selectOption({ label: "Pacú" });
    await page.getByLabel("Estanque de siembra").selectOption({ label: "E01 — Estanque Norte" });
    await page.getByLabel("Cantidad").fill("1000");
    await page.getByLabel("Peso prom. inicial (g)").fill("15");
    await page.getByRole("button", { name: "Sembrar lote" }).click();
    await expect(page).toHaveURL(/\/lotes\/[0-9a-f-]+$/);

    // Visita la ficha del estanque y su acceso a "Registrar muestreo" UNA
    // vez, sin enviar el formulario — comportamiento realista (quien
    // acaba de sembrar un lote suele mirar la ficha del estanque), y
    // necesario para que el router de Next cachee el flight de esa URL
    // con `?pondId=` concreto: es un parámetro de consulta, no una ruta
    // dinámica de build (ver ROUTES_TO_PRECACHE en sw.js), así que solo
    // queda disponible offline si de verdad se visitó antes.
    await page.goto(pondDetailUrl, { waitUntil: "networkidle" });
    await dismissInstallPromptIfVisible(page);
    await page.getByRole("link", { name: "Registrar muestreo" }).click();
    await expect(page).toHaveURL(/\/muestreos\/nuevo/);
    await dismissInstallPromptIfVisible(page);

    // Un usuario real no visita cada pantalla — vuelve al dashboard y
    // sincroniza (§"Objetivo obligatorio" pasos 3-4), nada más.
    await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
    await dismissInstallPromptIfVisible(page);
    await expect(page.locator("span.font-medium").first()).toHaveText(/Sincronizado/, { timeout: 20_000 });

    const controller = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null);
    expect(controller, "el service worker debe CONTROLAR la página, no solo estar registrado").toContain("/sw.js");

    const registration = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return { active: reg?.active?.state ?? null, scope: reg?.scope ?? null };
    });
    expect(registration.active).toBe("activated");

    await ctx.close();
  });

  test("7-11. cerrar completamente la PWA y reabrirla SIN CONEXIÓN: el dashboard carga con los datos locales", async ({
    baseURL,
  }) => {
    ctx = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      executablePath: "/opt/pw-browsers/chromium",
      viewport: { width: 390, height: 844 },
    });
    // Bloquea TODA la red del contexto, service worker incluido — ver
    // cabecera del archivo para por qué esto (y no setOffline) es lo que
    // realmente reproduce "sin conexión" en este Chromium.
    await ctx.route("**/*", (route) => route.abort("internetdisconnected"));

    page = await ctx.newPage();
    const brokenAppRequests: string[] = [];
    page.on("requestfailed", (req) => {
      // Las llamadas a /api/** SÍ deben fallar offline (nunca se cachean,
      // por diseño — ver sw.js). Las peticiones RSC (`_rsc=<nonce>`, el
      // "flight" del router de Next para navegación/prefetch de cliente)
      // TAMBIÉN deben fallar offline por diseño (ver isRSCRequest en
      // sw.js: nunca se cachean por ser inseguras de servir con la forma
      // equivocada) — Next las maneja solo, cayendo a navegación completa
      // si hace falta, así que un fallo aislado de una de estas (p. ej.
      // el prefetch automático de los enlaces de la barra inferior) no
      // rompe nada visible y no cuenta como una petición rota del app
      // shell.
      if (!req.url().includes("/api/") && !req.url().includes("_rsc=")) {
        brokenAppRequests.push(`${req.resourceType()} ${req.url()}`);
      }
    });

    await page.goto(`${baseURL}/`, { waitUntil: "load", timeout: 20_000 });
    await dismissInstallPromptIfVisible(page);

    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText, "la app arrancó pero mostró una pantalla de error de red").not.toMatch(NETWORK_ERROR_PATTERN);

    await expect(page.getByRole("heading", { name: "Resumen" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Funciona sin conexión")).toBeVisible();

    expect(
      brokenAppRequests,
      `recursos del app shell (no /api) que fallaron al reabrir offline: ${brokenAppRequests.join(", ")}`,
    ).toEqual([]);
  });

  test("9-12. navegar por las funciones principales offline: nunca la página de error del navegador", async () => {
    for (const [label, pathSuffix] of MAIN_NAV) {
      await page.getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${pathSuffix.replace("/", "\\/")}$`));

      const bodyText = await page.evaluate(() => document.body.innerText);
      expect(bodyText, `navegar a "${label}" (${pathSuffix}) offline mostró un error de red`).not.toMatch(
        NETWORK_ERROR_PATTERN,
      );
    }

    // Muestreo (formulario alcanzado normalmente desde la ficha del
    // estanque, no desde la barra inferior) — también listado
    // explícitamente en el encargo. Se llega por CLIC (Estanques -> E01),
    // nunca con page.goto directo a la URL dinámica: esa ficha concreta
    // solo queda disponible offline porque el router de Next ya la
    // resolvió una vez del lado del cliente en el paso 1 (online) — igual
    // que le pasaría a cualquier estanque que la persona sí abrió antes
    // de perder conexión. Una recarga DURA a una URL dinámica nunca antes
    // visitada como documento completo queda fuera de alcance a
    // propósito (ver ROUTES_TO_PRECACHE en sw.js: solo cubre rutas
    // estáticas conocidas en build time).
    await page.getByRole("link", { name: "Estanques", exact: true }).click();
    await expect(page).toHaveURL(/\/estanques$/);
    await page.getByRole("link", { name: /E01 — Estanque Norte/ }).click();
    await expect(page).toHaveURL(pondDetailUrl);
    let bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText).not.toMatch(NETWORK_ERROR_PATTERN);
    await page.getByRole("link", { name: "Registrar muestreo" }).click();
    await expect(page).toHaveURL(/\/muestreos\/nuevo/);
    bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText).not.toMatch(NETWORK_ERROR_PATTERN);
  });

  test("13. registrar una alimentación offline persiste en Dexie", async () => {
    await page.goto("/alimentacion/nueva", { waitUntil: "load" });
    await dismissInstallPromptIfVisible(page);
    await page.getByLabel("Estanque").selectOption({ label: "E01 — Estanque Norte" });
    await page.getByLabel("Lote").selectOption({ index: 1 });
    await page.getByLabel("Alimento").selectOption({ label: "Crecimiento 32%" });
    await page.getByLabel("Cantidad (kg)").fill("18");
    await page.getByRole("button", { name: "Guardar alimentación" }).click();
    await expect(page).toHaveURL(/\/alimentacion$/);

    const feedingCount = await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      return dbs.length; // solo confirma que IndexedDB respondió sin red
    });
    expect(feedingCount).toBeGreaterThan(0);

    await page.goto("/alimentos", { waitUntil: "load" });
    await expect(page.getByText(/Stock:\s*482,0\s*kg/)).toBeVisible();
  });

  test("14-16. cerrar y reabrir la app OTRA VEZ, todavía sin conexión: la alimentación registrada sigue ahí", async ({
    baseURL,
  }) => {
    await ctx.close();

    ctx = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      executablePath: "/opt/pw-browsers/chromium",
      viewport: { width: 390, height: 844 },
    });
    await ctx.route("**/*", (route) => route.abort("internetdisconnected"));
    page = await ctx.newPage();

    await page.goto(`${baseURL}/`, { waitUntil: "load", timeout: 20_000 });
    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText).not.toMatch(NETWORK_ERROR_PATTERN);
    await expect(page.getByRole("heading", { name: "Resumen" })).toBeVisible({ timeout: 10_000 });

    await page.goto("/alimentos", { waitUntil: "load" });
    await expect(page.getByText(/Stock:\s*482,0\s*kg/)).toBeVisible();
  });
});
