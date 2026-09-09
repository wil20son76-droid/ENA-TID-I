import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["node_modules/**", "tests/e2e/**"],
    // Los tests de integración de /api/sync/* comparten una única base de
    // datos Postgres real (piscicultura_test). Si los archivos de test
    // corrieran en paralelo, dos suites limpiando/leyendo esas mismas
    // tablas a la vez producirían fallos intermitentes por interferencia,
    // no por ningún bug real. Se corren en serie a propósito.
    fileParallelism: false,
  },
});
