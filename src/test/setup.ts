// Configuración global de Vitest. happy-dom aporta `window`/`localStorage`
// pero no implementa IndexedDB, así que se inyecta con fake-indexeddb para
// poder probar la capa Dexie (src/lib/db) en Node sin un navegador real.
import "fake-indexeddb/auto";

import { config } from "dotenv";

config();

// Los tests de integración de las rutas /api/sync/* (src/app/api/sync/**)
// pegan contra una base de datos Postgres real, pero NUNCA la de
// desarrollo: se deriva "<db>_test" a partir de DATABASE_URL para no
// mezclar datos de prueba con los del entorno de desarrollo local.
if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(
    /\/([^/?]+)(\?|$)/,
    "/$1_test$2",
  );
}
