// Service worker de la aplicación — escrito a mano, sin librerías (ver
// IMPLEMENTATION_PLAN.md §7 para la justificación: @serwist/next inyecta un
// hook de webpack en next.config, incompatible con Turbopack, que Next.js 16
// usa por defecto tanto en `next dev` como en `next build`).
//
// ⚠️ HISTORIAL — bug crítico corregido (offline real en teléfono, no
// reproducible con `page.setOffline()` sobre una página ya cargada): la
// versión anterior de este archivo NO precacheaba nada en `install` — el
// comentario original decía "el caché se llena orgánicamente con lo que
// la persona ya visitó". Eso es FALSO para los chunks JS/CSS/fuentes del
// PRIMER load: ese primer documento (y sus <script>/<link> referenciados)
// se piden ANTES de que `navigator.serviceWorker.register()` corra (ver
// ServiceWorkerRegister.tsx — se registra en un useEffect, después de
// hidratar) y por tanto ANTES de que este service worker exista — nunca
// pasan por su manejador `fetch`, nunca quedan en caché. Diagnóstico real
// (bloqueando TODA red, incluidas las peticiones que el propio service
// worker dispara — `context.setOffline()` de Playwright NO alcanza a
// interceptar esas peticiones en este Chromium, por eso los E2E previos
// nunca lo detectaron): tras cerrar la PWA instalada y reabrirla sin
// conexión, el documento "/" sí se servía desde caché (cacheado en una
// visita posterior), pero SUS <script src="/_next/static/chunks/...">
// fallaban con net::ERR_FAILED — ninguno había sido cacheado jamás — y la
// app se quedaba congelada en "Cargando…" (el estado inicial de
// AuthGate.tsx antes de hidratar) para siempre.
//
// La corrección: precachear explícitamente en `install` el documento HTML
// de cada ruta navegable conocida (ROUTES_TO_PRECACHE) junto con TODOS los
// chunks JS/CSS/fuentes que esas páginas referencian — sin depender de que
// la persona los visite antes de quedarse sin conexión. Ver
// precacheAppShell() más abajo.
//
// Qué se cachea y por qué:
//   0. Al instalar: el documento de cada ruta de ROUTES_TO_PRECACHE +
//      todos los assets /_next/static/** que esos documentos referencian
//      (precacheAppShell) — garantiza que la app pueda arrancar y navegar
//      por sus funciones principales offline incluso si nunca se
//      visitaron antes con conexión.
//   1. /_next/static/**  → cache-first. Son archivos con hash de contenido:
//      para un build dado, nunca cambian, así que cachearlos agresivamente
//      no tiene riesgo de servir algo obsoleto.
//   2. Navegaciones de documento (abrir/recargar una URL) → network-first
//      con fallback a caché. Se prioriza contenido fresco; si no hay red,
//      se sirve la última versión cacheada del "app shell" en vez de la
//      pantalla de error del navegador (§61: nunca bloquear por falta de
//      conexión).
//   3. Peticiones RSC del router de Next (navegación cliente entre rutas)
//      → SIEMPRE directo a la red, nunca se cachean ni se sirven desde
//      caché (ver bug documentado más abajo, junto a isRSCRequest).
//   4. Otras peticiones GET del mismo origen (manifest, íconos, fuentes)
//      → stale-while-revalidate normal: responde con lo cacheado al
//      instante y actualiza el caché en segundo plano.
//   5. /api/** (incluida toda la sincronización) → NUNCA se intercepta.
//      Siempre va directo a la red. Cachear estas respuestas rompería la
//      frescura de los datos y la lógica de reintentos del motor de sync,
//      que ya maneja sus propios fallos de red (ver src/lib/sync/engine.ts).
//   6. Peticiones que no son GET (POST/PUT/DELETE) → nunca se interceptan.
const CACHE_VERSION = "v2";
const CACHE_NAME = `piscicultura-shell-${CACHE_VERSION}`;

// Todas las rutas navegables ESTÁTICAS del App Router (ver `npm run
// build`: marcadas "○"). Las rutas dinámicas (/estanques/[id],
// /lotes/[id], /racion-recomendada/[pondId]) se excluyen a propósito: no
// hay forma de conocer sus ids en build time, así que siguen cacheándose
// de forma orgánica la primera vez que se visitan online (igual criterio
// que antes) — una ficha nunca visitada offline es una limitación
// aceptable, no una regresión (la app nunca inventa datos que no tiene).
const ROUTES_TO_PRECACHE = [
  "/",
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
  "/racion-recomendada",
  "/racion-recomendada/configuracion",
  "/informes",
  "/informes/produccion",
  "/informes/alimentacion",
  "/informes/mortalidad",
  "/informes/agua",
  "/informes/inventario",
  "/informes/economia",
  "/informes/ventas",
  "/informes/cosechas",
  "/informes/comparacion",
  "/economia",
  "/proveedores",
  "/clientes",
  "/compras",
  "/compras/nueva",
  "/cosechas",
  "/cosechas/nueva",
  "/gastos",
  "/gastos/nuevo",
  "/ventas",
  "/ventas/nueva",
  "/usuarios",
  "/calendario",
  "/manifest.webmanifest",
];

/**
 * Precachea el documento de cada ruta de ROUTES_TO_PRECACHE y, leyendo su
 * HTML, todos los <script src="/_next/static/...">/<link href="/_next/
 * static/...css/woff2..."> que referencia — sin depender de ningún
 * manifiesto interno de Next/Turbopack (que no es estable entre
 * versiones): el propio HTML servido YA lista exactamente lo que esa
 * página necesita para hidratar, así que se lee de ahí directamente.
 *
 * Nunca falla como conjunto por un fallo puntual: cada ruta/asset se
 * intenta de forma independiente (Promise.all de funciones que atrapan su
 * propio error) — un timeout o 404 aislado no debe dejar el resto de la
 * app sin precachear. Si la instalación del service worker ocurre sin
 * conexión (poco común: requiere que el JS ya se haya descargado una vez
 * para poder registrar el SW), simplemente no avanza esta ronda; el
 * navegador reintenta instalar en el siguiente registro con red.
 *
 * Los DOCUMENTOS de cada ruta se precachean leyendo ROUTES_TO_PRECACHE
 * directamente (necesarios para que networkFirst pueda responder una
 * navegación real offline). Los ASSETS (JS/CSS/fuentes) NO se descubren
 * leyendo ese HTML: un componente cargado con `next/dynamic(...,
 * { ssr: false })` (ServiceWorkerRegisterLoader.tsx) nunca aparece como
 * `<script src>` en NINGÚN documento — Next lo pide con un `import()`
 * dinámico ya en el navegador, así que leer el HTML jamás lo
 * encontraría (bug real, reproducido: esa laguna dejaba el chunk del
 * propio registro del service worker sin cachear, y su fallo al
 * cargarlo offline tumbaba la página entera con el límite de error de
 * Next). En su lugar se usa /sw-precache-manifest.json — generado por
 * scripts/generateSwPrecacheManifest.mjs después de cada build,
 * enumerando TODO lo que hay bajo .next/static/ — que es la única fuente
 * que cubre tanto los chunks referenciados en el HTML como los que solo
 * un `import()` en tiempo de ejecución llega a pedir.
 */
async function precacheAppShell() {
  const cache = await caches.open(CACHE_NAME);

  await Promise.all(
    ROUTES_TO_PRECACHE.map(async (route) => {
      try {
        const response = await fetch(route, { credentials: "same-origin" });
        if (response.ok) await cache.put(route, response.clone());
      } catch {
        // Sin red durante la instalación: ver docstring de la función.
      }
    }),
  );

  let assetUrls = [];
  try {
    const manifestResponse = await fetch("/sw-precache-manifest.json");
    if (manifestResponse.ok) {
      const manifest = await manifestResponse.json();
      assetUrls = Array.isArray(manifest.assets) ? manifest.assets : [];
    }
  } catch {
    // idem — sin este manifiesto, cacheFirst() sigue cacheando cada
    // asset orgánicamente la primera vez que se pide, como antes.
  }

  await Promise.all(
    assetUrls.map(async (url) => {
      try {
        const response = await fetch(url);
        if (response.ok) await cache.put(url, response.clone());
      } catch {
        // idem.
      }
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheAppShell());
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

/**
 * Peticiones RSC ("flight") del router de Next para navegación cliente
 * entre rutas — se identifican por la cabecera `RSC`.
 *
 * HISTORIAL — bug encontrado y revertido: una versión anterior de este
 * archivo SÍ cacheaba estas respuestas (stale-while-revalidate, con una
 * clave normalizada que quitaba el `_rsc=<nonce>` aleatorio que Next
 * agrega en cada fetch). Eso resultó ser INSEGURO: la respuesta RSC para
 * una MISMA URL de destino no tiene una única forma — su forma depende
 * del estado ACTUAL del árbol de rutas del router (qué segmentos ya están
 * activos en el cliente), que a su vez depende de DESDE QUÉ RUTA se narrow
 * navegando. Servir una respuesta cacheada con la forma equivocada (la de
 * un origen de navegación distinto) hace que el router de Next falle en
 * SILENCIO: no lanza ningún error visible, simplemente la navegación no
 * se completa (la URL/página se queda como estaba). Reproducido en la
 * práctica con /racion-recomendada/[pondId], alcanzable desde dos rutas
 * padre distintas (la lista /racion-recomendada y la ficha de un
 * estanque) — cachear su respuesta RSC bajo una única clave por URL de
 * destino corrompía la navegación desde el origen que no escribió esa
 * entrada.
 *
 * La corrección: las peticiones RSC NUNCA se cachean ni se sirven desde
 * caché — van siempre directas a la red (ver el `fetch` handler más
 * abajo). Sin conexión, el fetch falla y Next.js cae automáticamente a
 * una navegación completa del navegador (confirmado: "Failed to fetch RSC
 * payload for <url>. Falling back to browser navigation.").
 *
 * Pero esa navegación completa de respaldo solo sirve de algo offline si
 * el DOCUMENTO HTML completo de esa URL ya está en caché — y para una
 * ruta dinámica (p. ej. /racion-recomendada/[pondId], /estanques/[id])
 * alcanzada SIEMPRE por navegación de cliente (nunca con un `page.goto`
 * directo ni un recargo), ese documento completo nunca se pide de forma
 * normal, así que networkFirst jamás llega a cachearlo — la app se
 * quedaría sin poder abrir offline una ficha que la persona sí visitó
 * antes. Por eso, en paralelo a dejar pasar la petición RSC tal cual, se
 * dispara en segundo plano (sin bloquear la navegación) un fetch normal
 * (sin cabecera RSC) a esa misma URL para cachear su documento HTML
 * completo — ver cacheDocumentShadow. Esto es seguro: a diferencia de la
 * respuesta RSC, el documento HTML completo de una URL no depende de
 * desde dónde se navega hasta ella.
 */
function isRSCRequest(request) {
  return request.headers.has("RSC");
}

/**
 * Cachea en segundo plano el documento HTML completo (sin cabecera RSC)
 * de la URL a la que apunta una navegación de cliente — ver docstring de
 * isRSCRequest. No bloquea ni afecta la petición RSC original: es un
 * fetch aparte, disparado en paralelo.
 *
 * Evita el fetch redundante si ya existe una entrada cacheada para esa
 * URL (documento u otra), para no duplicar tráfico de red en cada
 * navegación repetida a una misma ficha ya cacheada.
 */
async function cacheDocumentShadow(url) {
  const docUrl = new URL(url.pathname + url.search, url.origin);
  docUrl.searchParams.delete("_rsc");
  const docUrlString = docUrl.toString();

  const cache = await caches.open(CACHE_NAME);
  const existing = await cache.match(docUrlString, { ignoreVary: true });
  if (existing) return;

  try {
    const response = await fetch(docUrlString, { credentials: "same-origin" });
    if (response.ok) await cache.put(docUrlString, response.clone());
  } catch {
    // Sin red: nada que hacer, la próxima navegación online lo reintenta.
  }
}

// `{ ignoreVary: true }` en las tres funciones de abajo: Next.js agrega
// `Vary: rsc, next-router-state-tree, next-router-prefetch,
// next-router-segment-prefetch, Accept-Encoding` a CADA respuesta de
// documento/RSC (verificado con curl contra el build real). El
// comportamiento POR DEFECTO de `Cache.match()` respeta ese Vary: exige
// que la petición de búsqueda tenga los MISMOS valores en esas cabeceras
// que la petición que se guardó originalmente — algo que casi nunca
// ocurre entre un precacheo (sin esas cabeceras) y una navegación real
// (con cabeceras distintas según el estado del router), así que sin esta
// opción el `match()` falla EN SILENCIO incluso para una ruta que sí está
// cacheada. Es seguro ignorarlo aquí: nosotros decidimos manualmente qué
// variante guardar bajo cada clave (nunca dependemos de que el servidor
// negocie la variante correcta vía Vary), así que no hay riesgo de servir
// contenido "equivocado" para el content-negotiation que Vary protege.
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreVary: true });
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
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreVary: true });

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

  if (isRSCRequest(request)) {
    // Nunca cachear ni servir desde caché la respuesta RSC en sí — ver
    // docstring de isRSCRequest. Sin `event.respondWith`, el navegador
    // maneja este fetch de forma nativa (network-only); si falla sin red,
    // Next cae solo a una navegación completa, que el `networkFirst` de
    // arriba sí puede servir desde caché gracias al shadow-cache disparado
    // abajo.
    event.waitUntil(cacheDocumentShadow(url));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
