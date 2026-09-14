// Se ejecuta automáticamente después de `next build` (ver "postbuild" en
// package.json). Genera public/sw-precache-manifest.json: la lista
// COMPLETA de archivos bajo .next/static/ para este build — cada archivo
// con hash de contenido, de un build a otro nunca cambia de nombre si su
// contenido no cambió, así que listar TODO lo que existe es seguro y
// barato (no hay riesgo de servir algo obsoleto, igual criterio que la
// estrategia cache-first de public/sw.js para /_next/static/**).
//
// Por qué hace falta esto en vez de confiar en que el service worker
// descubra los chunks al vuelo (lo que hacía la versión anterior de
// sw.js, y el motivo del bug offline real: ver el historial al inicio de
// sw.js): un componente cargado con `next/dynamic(..., { ssr: false })`
// (ServiceWorkerRegisterLoader.tsx, por ejemplo) nunca aparece como
// `<script src="...">` en el HTML servido de NINGUNA página — Next lo
// pide con un `import()` dinámico ya en el navegador. Ese chunk jamás
// puede descubrirse leyendo el HTML de las rutas conocidas (lo que sí
// hace public/sw.js con el resto), así que la única forma robusta de no
// dejarlo fuera es enumerar literalmente todo lo que el build produjo.
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const staticDir = path.join(repoRoot, ".next", "static");
const outputFile = path.join(repoRoot, "public", "sw-precache-manifest.json");

function listFilesRecursive(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...listFilesRecursive(fullPath));
    } else if (stat.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function main() {
  const files = listFilesRecursive(staticDir);
  const assets = files
    .map((fullPath) => "/_next/static/" + path.relative(staticDir, fullPath).split(path.sep).join("/"))
    // Los sourcemaps (.map) no hace falta precachearlos: nunca los pide
    // el navegador en producción, solo herramientas de depuración.
    .filter((assetUrl) => !assetUrl.endsWith(".map"))
    .sort();

  mkdirSync(path.dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, JSON.stringify({ assets }, null, 2) + "\n");
  console.log(`sw-precache-manifest.json: ${assets.length} archivos listados desde ${staticDir}`);
}

main();
