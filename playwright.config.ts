import { defineConfig, devices } from "@playwright/test";

// El requisito crítico de esta suite (IMPLEMENTATION_PLAN.md §11, §65 del
// encargo) es probar el escenario offline contra el comportamiento REAL de
// producción, no contra `next dev`: el cliente de desarrollo de Turbopack
// depende de un WebSocket vivo para completar la hidratación y nunca llega
// a montar la app si la red se corta antes de que esa conexión exista, lo
// que produciría un falso negativo. Por eso el servidor de pruebas es
// siempre un build de producción (`next build && next start`).
//
// Corre contra una base de datos de pruebas dedicada (nunca la de
// desarrollo) — igual que los tests de integración de Vitest.
const TEST_PORT = 3100;
const TEST_DATABASE_URL =
  process.env.PLAYWRIGHT_DATABASE_URL ??
  (process.env.DATABASE_URL
    ? process.env.DATABASE_URL.replace(/\/([^/?]+)(\?|$)/, "/$1_test$2")
    : "postgresql://postgres:postgres@localhost:5432/piscicultura_test?schema=public");

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${TEST_PORT}`,
    trace: "retain-on-failure",
    launchOptions: {
      // El entorno ya trae Chromium preinstalado; se evita que Playwright
      // intente descargar su propia copia del navegador.
      executablePath: "/opt/pw-browsers/chromium",
    },
  },
  webServer: {
    command: `npm run build && npm run start -- -p ${TEST_PORT}`,
    url: `http://localhost:${TEST_PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
    },
  },
  projects: [
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
