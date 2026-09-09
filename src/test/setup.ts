// Configuración global de Vitest. happy-dom aporta `window`/`localStorage`
// pero no implementa IndexedDB, así que se inyecta con fake-indexeddb para
// poder probar la capa Dexie (src/lib/db) en Node sin un navegador real.
import "fake-indexeddb/auto";
