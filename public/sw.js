// Service worker de la aplicación — escrito a mano, sin librerías (ver
// IMPLEMENTATION_PLAN.md §7 para la justificación: @serwist/next inyecta un
// hook de webpack en next.config, incompatible con Turbopack, que Next.js 16
// usa por defecto tanto en `next dev` como en `next build`).
//
// Qué se cachea y por qué (nunca cachear a ciegas):
//   1. /_next/static/**  → cache-first. Son archivos con hash de contenido:
//      para un build dado, nunca cambian, así que cachearlos agresivamente
//      no tiene riesgo de servir algo obsoleto.
//   2. Navegaciones de documento (abrir/recargar una URL) → network-first
//      con fallback a caché. Se prioriza contenido fresco; si no hay red,
//      se sirve la última versión cacheada del "app shell" en vez de la
//      pantalla de error del navegador (§61: nunca bloquear por falta de
//      conexión).
//   3. Otras peticiones GET del mismo origen (manifest, íconos, fuentes)
//      → stale-while-revalidate: responde con lo cacheado al instante y
//      actualiza el caché en segundo plano.
//   4. /api/** (incluida toda la sincronización) → NUNCA se intercepta.
//      Siempre va directo a la red. Cachear estas respuestas rompería la
//      frescura de los datos y la lógica de reintentos del motor de sync,
//      que ya maneja sus propios fallos de red (ver src/lib/sync/engine.ts).
//   5. Peticiones que no son GET (POST/PUT/DELETE) → nunca se interceptan.
//
// No hay una lista fija de precacheo: al ser un service worker de mano (sin
// paso de build que conozca los nombres de archivo con hash de cada
// versión), el caché del app shell se llena orgánicamente con lo que la
// persona ya visitó estando online — suficiente para que la app siga
// funcionando offline después del primer uso.

const CACHE_VERSION = "v1";
const CACHE_NAME = `piscicultura-shell-${CACHE_VERSION}`;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("piscicultura-shell-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

function isNextStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/");
}

function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);

  return cached ?? (await networkFetch) ?? Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isApiRequest(url)) return;

  if (isNextStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
