# Mi Piscicultura

Sistema de gestión piscícola **offline-first**: funciona íntegramente sin
conexión a Internet y sincroniza solo cuando la hay. Ver
[`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) para la arquitectura
completa y [`ARCHITECTURE.md`](./ARCHITECTURE.md) /
[`OFFLINE_SYNC.md`](./OFFLINE_SYNC.md) para el detalle técnico del modo
offline y la sincronización.

Estado actual: **Fase 7 — hardening final y producción**. Sobre la base
técnica offline/sync (Fase 1), el núcleo productivo (Fase 2: Especies,
Estanques, Lotes, Siembras, Traslados), la operación diaria (Fase 3:
alimento, alimentación, mortalidad, muestreos), el hardening de
consistencia de sincronización (Fase 3.5), calidad del agua/alertas/
planificación (Fase 4), economía y cierre productivo (Fase 5:
proveedores, clientes, compras, gastos, cosechas, ventas, economía de
lote — ver [`ECONOMICS.md`](./ECONOMICS.md)) y analítica e informes
(Fase 6: dashboard avanzado, ocho informes especializados, comparación
por lote/especie, exportación CSV y vista imprimible), esta fase añade
**autenticación, roles y todo lo necesario para un uso real en
producción**: login con cuatro roles (Administrador/Encargado/
Trabajador/Solo lectura) sobre un modelo de capacidades — nunca una
jerarquía lineal —, sesión persistente que **nunca exige red para
seguir trabajando offline** tras el primer login (regla crítica del
encargo, ver [`SECURITY.md`](./SECURITY.md)), protección de API y
validación de permisos en servidor (nunca solo en el cliente),
preparación completa para Railway con migraciones automáticas en cada
despliegue (ver [`DEPLOYMENT.md`](./DEPLOYMENT.md)), estrategia de
backup de PostgreSQL (ver [`BACKUP_RESTORE.md`](./BACKUP_RESTORE.md)),
cabeceras de seguridad HTTP, revisión de índices de PostgreSQL y un
hardening real del motor de sincronización (un hallazgo de pérdida
silenciosa de datos encontrado y corregido durante esta misma fase). Ver
[`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) junto con las
secciones
["Modelo de producción piscícola" (Fase 2)](./OFFLINE_SYNC.md#8-modelo-de-producción-piscícola-fase-2),
["Operación diaria" (Fase 3)](./OFFLINE_SYNC.md#9-operación-diaria-alimento-mortalidad-y-muestreos-fase-3),
["Calidad del agua, alertas y planificación" (Fase 4)](./OFFLINE_SYNC.md#11-calidad-del-agua-alertas-y-planificación-fase-4),
["Economía y cierre productivo" (Fase 5)](./OFFLINE_SYNC.md#12-economía-y-cierre-productivo-fase-5),
["Analítica e informes" (Fase 6)](./OFFLINE_SYNC.md#13-analítica-e-informes-fase-6)
y ["Autenticación offline y hardening de sincronización" (Fase 7)](./OFFLINE_SYNC.md#14-autenticación-offline-y-hardening-de-sincronización-fase-7)
de `OFFLINE_SYNC.md`.

## Stack

| Capa | Tecnología |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack), TypeScript, Tailwind CSS v4 |
| Datos locales | IndexedDB vía Dexie.js |
| Servidor | API Routes de Next.js, Prisma 7 (driver adapter `@prisma/adapter-pg`) |
| Base de datos | PostgreSQL |
| Autenticación | JWT HS256 propio (`node:crypto`) + `scrypt` para contraseñas — sin librería externa |
| PWA | Manifest nativo de Next.js + service worker propio (`public/sw.js`) |
| Tests | Vitest (unitarios/integración), Playwright (E2E offline) |
| Hosting | Railway |

Las versiones exactas y por qué se eligió cada una están documentadas en
[`IMPLEMENTATION_PLAN.md` §3.3](./IMPLEMENTATION_PLAN.md#33-matriz-de-versiones-verificada-antes-de-instalar).

## Requisitos previos

- Node.js 20.9+ (probado con Node 22)
- PostgreSQL accesible (local o remoto) — 14+; se probó contra 16
- npm

## Puesta en marcha local

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Edita DATABASE_URL en .env para que apunte a tu PostgreSQL

# 3. Aplicar el esquema a la base de datos
npm run db:migrate

# 4. (Opcional) sembrar datos de demostración: especies, estanques
#    E01-E04, un lote de ejemplo (PAC-2026-001, 1000 peces en E01) y
#    tres alimentos con stock inicial. Requiere SEED_DEMO_DATA="true"
#    en .env; nunca corre en producción por accidente. NUNCA incluye
#    ningún usuario ni contraseña (ver siguiente paso).
npm run db:seed

# 5. Crear el primer usuario administrador (obligatorio para poder
#    iniciar sesión — nunca hay un admin sembrado automáticamente).
ADMIN_USERNAME="admin" ADMIN_NAME="Tu Nombre" ADMIN_PASSWORD="una-clave-fuerte" \
  npm run auth:create-admin

# 6. Levantar el servidor de desarrollo
npm run dev
```

Abre <http://localhost:3000> e inicia sesión con el usuario creado en el
paso 5. Ver [`SECURITY.md`](./SECURITY.md) para el modelo de
autenticación/roles completo y [`DEPLOYMENT.md`](./DEPLOYMENT.md) para el
mismo paso en producción.

> **Nota sobre el modo offline en desarrollo**: `next dev` (Turbopack)
> depende de una conexión WebSocket viva al servidor de desarrollo para
> completar la hidratación de la app. Si cortas la red mientras usas
> `next dev`, la aplicación puede quedarse sin hidratar y parecer rota —
> es una limitación del modo desarrollo, no un fallo de la app. Para
> probar el comportamiento offline de verdad, usa un build de producción
> (`npm run build && npm run start`), que es lo que efectivamente corre en
> Railway.

## Scripts disponibles

| Script | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo (Turbopack) |
| `npm run build` | Build de producción |
| `npm run start` | Sirve el build de producción |
| `npm run lint` | ESLint |
| `npm run typecheck` | Comprobación de tipos (`tsc --noEmit`) |
| `npm run test` | Tests unitarios y de integración (Vitest) |
| `npm run test:watch` | Vitest en modo watch |
| `npm run test:e2e` | Tests E2E offline (Playwright; compila y levanta un build de producción automáticamente): escenario base (`tests/e2e/offline.spec.ts`), producción piscícola (`tests/e2e/production.spec.ts`), operación diaria (`tests/e2e/dailyOperations.spec.ts`), calidad del agua + tareas (`tests/e2e/waterQualityAndTasks.spec.ts`), economía y cierre productivo (`tests/e2e/economics.spec.ts`), analítica e informes (`tests/e2e/analytics.spec.ts`), roles y sesión offline (`tests/e2e/auth.spec.ts`) y la prueba final offline obligatoria de Fase 7 (`tests/e2e/productionReadiness.spec.ts`) |
| `npm run db:migrate` | Aplica migraciones de Prisma (desarrollo) |
| `npm run db:migrate:deploy` | Aplica migraciones ya creadas (producción/CI) |
| `npm run db:generate` | Regenera el cliente de Prisma |
| `npm run db:seed` | Siembra datos de demostración (si `SEED_DEMO_DATA=true`) |
| `npm run auth:create-admin` | Crea/recupera el usuario `ADMIN` (`ADMIN_USERNAME`/`ADMIN_NAME`/`ADMIN_PASSWORD`, ver [`SECURITY.md`](./SECURITY.md)) |
| `npm run db:backup` | Backup de PostgreSQL con `pg_dump` (ver [`BACKUP_RESTORE.md`](./BACKUP_RESTORE.md)) |
| `npm run start:migrate` | `prisma migrate deploy && next start` — comando de arranque en Railway |

## Variables de entorno

Ver [`.env.example`](./.env.example). Como mínimo:

- `DATABASE_URL`: cadena de conexión a PostgreSQL. En Railway la provee
  automáticamente el plugin de PostgreSQL del proyecto.
- `AUTH_SECRET`: **obligatoria**, sin valor por defecto — secreto de
  firma de las sesiones JWT (mínimo 16 caracteres; en la práctica genera
  uno largo con `openssl rand -base64 48`). La app se niega a firmar o
  verificar sesiones sin esto. Ver [`SECURITY.md`](./SECURITY.md) §2/§4.
- `SEED_DEMO_DATA`: `"true"` para permitir `npm run db:seed` (nunca
  siembra usuarios ni contraseñas).
- `ADMIN_USERNAME`/`ADMIN_NAME`/`ADMIN_PASSWORD`: solo para
  `npm run auth:create-admin` (bootstrap manual del primer admin), nunca
  se dejan puestas en el entorno de forma permanente.
- `APP_PUBLIC_URL`/`EMAIL_WEBHOOK_URL`/`EMAIL_WEBHOOK_API_KEY`/`EMAIL_FROM`:
  recuperación de contraseña por email — ver
  [`SECURITY.md` §"Recuperación de contraseña"](./SECURITY.md).

Nunca subas un `.env` con credenciales reales; `.env.example` es la única
plantilla versionada. Nunca hay secretos en el frontend — ver
[`SECURITY.md`](./SECURITY.md) §4.

## Marca (logo)

`src/components/brand/Logo.tsx` es el único punto de uso del logo en el
cliente; `src/lib/server/brandAssets.ts` es su equivalente del lado
servidor. Ambos leen el mismo archivo maestro: **`public/brand/logo.png`**
(PNG, fondo transparente). Para activar el logo definitivo, basta con
colocar ese archivo ahí y desplegar — favicon, íconos PWA (192×192,
512×512, variante maskable con zona de seguridad), login, encabezado e
informes imprimibles lo leen automáticamente, sin tocar código. Sin el
archivo (estado por defecto de este repositorio), todo cae al placeholder
"P" ya existente — cero comportamiento roto mientras tanto.

## Base de datos local (IndexedDB) y sincronización

Toda pantalla lee y escribe primero contra IndexedDB (vía Dexie.js) —
nunca contra la red. Los cambios se encolan en una cola de sincronización
local (`syncQueue`) y se envían al servidor cuando hay conexión, de forma
idempotente (reenviar la misma operación nunca la duplica). El detalle
completo, con diagramas, está en [`OFFLINE_SYNC.md`](./OFFLINE_SYNC.md).

## PWA

La app es instalable (manifest + service worker) y sigue funcionando tras
cerrarla y reabrirla sin conexión, una vez que se usó estando online al
menos una vez. Ver [`IMPLEMENTATION_PLAN.md` §7](./IMPLEMENTATION_PLAN.md#7-pwa)
para qué se cachea exactamente y por qué.

## Pruebas

```bash
# Unitarias y de integración (repositorios Dexie, motor de sync,
# idempotencia de /api/sync/push, cursor de /api/sync/pull)
npm run test

# E2E offline: escenario base (crear online, desconectar, seguir
# registrando datos, cerrar/reabrir sin conexión, modificar un registro
# offline, reconectar y sincronizar sin duplicar, y recuperarse de un
# fallo temporal del servidor) + producción piscícola (lote + siembra +
# traslado parcial 100% offline, verificar distribución sin red,
# reconectar sin duplicados, traslado inválido rechazado) + operación
# diaria (alimentación + mortalidad + muestreo 100% offline sobre un
# lote de 1000 peces, cerrar/reabrir sin conexión y verificar que la
# ficha sigue mostrando los mismos peces/peso/biomasa/stock, reconectar
# y comprobar en Postgres que no hay duplicados) + calidad del agua y
# tareas (medición + dos tareas 100% offline, cerrar/reabrir sin
# conexión, una alerta de oxígeno bajo generada localmente sin
# conexión, completar una tarea offline, reconectar y comprobar en
# Postgres que no hay duplicados) + economía y cierre productivo
# (compra de alimento + cosecha parcial + cliente nuevo + venta contra
# esa cosecha + gasto directo de lote, 100% offline, cerrar/reabrir sin
# conexión, reconectar y comprobar en Postgres que no hay duplicados) +
# analítica e informes (dos lotes con mortalidad y ventas reales,
# supervivencia agregada 86,4% y precio medio 29 Bs/kg verificados en la
# UI real, exportación CSV y botón de impresión sin conexión,
# cerrar/reabrir sin red y reconectar/sincronizar dos veces sin que los
# KPIs cambien ni se dupliquen) + roles y sesión offline (Fase 7: tres
# dispositivos/roles distintos, revocación de sesión que bloquea el
# PRÓXIMO sync sin expulsar a nadie de la app offline) + prueba final
# offline obligatoria (Fase 7: login online, sincronizar, desconectar,
# cerrar/reabrir la PWA offline, registrar las ocho operaciones de campo
# —alimentación, mortalidad, muestreo, calidad del agua, tarea, gasto,
# cosecha, venta—, consultar informes offline, cerrar/reabrir de nuevo,
# reconectar y sincronizar dos veces sin pérdida ni duplicados) + logo de
# marca y recuperación de contraseña (login con el logo cableado, manifest
# e íconos PWA responden 200, y un ADMIN restableciendo la contraseña de
# un Trabajador de punta a punta: pantalla de cambio obligatorio, login
# bloqueado hasta cambiarla, contraseña nueva persistida de verdad).
npm run test:e2e
```

Los tests de integración de `/api/sync/*` y el E2E usan una base de datos
Postgres de pruebas separada (se deriva automáticamente como
`<tu_base_de_datos>_test` a partir de `DATABASE_URL`), nunca la de
desarrollo. Créala una vez y aplícale las migraciones:

```bash
createdb piscicultura_test   # o el nombre que corresponda según tu DATABASE_URL
DATABASE_URL="postgresql://.../piscicultura_test?schema=public" npx prisma migrate deploy
```

## Despliegue en Railway

`railway.json` ya define build (`npm run build`), arranque
(`npm run start:migrate` = `prisma migrate deploy && next start`) y
healthcheck (`GET /api/health`) — **no se requiere ningún paso manual
adicional en cada despliegue**: build, migraciones y arranque corren
automáticamente en el pipeline de Railway, sin dependencias externas
adicionales. Guía completa, paso a paso, con las variables de entorno
exactas y el bootstrap del primer usuario administrador, en
[`DEPLOYMENT.md`](./DEPLOYMENT.md).

## Estructura del proyecto

```
prisma/              Esquema, migraciones y seed de Prisma
scripts/             auth:create-admin (bootstrap del primer admin), db:backup
middleware.ts        Protección barata de /api/sync/* y /api/users* (Fase 7)
src/
  app/                Rutas (App Router): páginas y API routes
    estanques/        Listado, alta y ficha de estanque (con pestañas
                       de producción/alimentación/mortalidad/
                       muestreos/calidad del agua)
    lotes/             Listado, alta (lote+siembra) y ficha de lote
    alimentacion/      Resumen diario, registro rápido de alimentación
    alimentos/         Catálogo de alimentos + stock inicial
    mortalidad/        Resumen y registro rápido de mortalidad
    muestreos/         Registro rápido de muestreo
    calidad-agua/      Últimas mediciones, alertas activas, registro
    tareas/            Hoy/Próximas/Vencidas/Completadas, crear/completar
    calendario/        Agenda + vista mensual simple
    proveedores/       Alta/listado/desactivación de proveedores
    clientes/          Alta/listado/desactivación de clientes
    compras/           Listado + registro de compras (alimento, alevines...)
    gastos/            Listado + registro de gastos (con/sin lote/estanque)
    cosechas/          Listado + registro de cosechas
    ventas/            Listado + registro de ventas (contra cosecha o externas)
    economia/          Resumen económico general de la finca
    informes/          Dashboard avanzado + informes especializados
                       (producción, mortalidad, alimentación,
                       inventario, calidad del agua, cosechas, ventas,
                       economía) y comparación por lote/especie
    usuarios/          Alta/listado/desactivación de usuarios, revocación
                       de sesiones y "Restablecer contraseña" (solo Admin)
    icon.tsx           Favicon (convención de Next.js) — lee el logo maestro
    apple-icon.tsx     Apple touch icon — ídem, sin transparencia
    icons/[size]/      Íconos PWA 192/512/512-maskable (manifest.ts)
    api/auth/          login, refresh, forgot-password, reset-password,
                       change-password (Fase 7 + recuperación de contraseña)
    api/users/         CRUD admin-only de usuarios (incl. reset de
                       contraseña) — nunca por el protocolo de
                       sincronización (Fase 7)
    api/health/        Healthcheck público para Railway (Fase 7)
  components/         Componentes de UI (layout, sync, pwa, estanques)
    auth/              AuthGate, LoginScreen (incl. recuperación),
                       ForceChangePasswordScreen, RequireCapability
    brand/             Logo.tsx — único punto de uso del logo en cliente
    charts/           Gráficos SVG propios (línea, barras) — sin librería
    analytics/         Barra de filtros, exportar CSV/imprimir (con logo
                       en el encabezado de impresión), KpiCard
  hooks/              Hooks de React (estado de sincronización)
  lib/
    auth/             Autenticación/permisos (Fase 7): password, JWT,
                       modelo de capacidades, rate limit, sesión de
                       cliente, contexto de sesión — ver ARCHITECTURE.md
    db/               Capa Dexie/IndexedDB (schema, repositorios)
    domain/           Funciones puras de dominio (ledger de peces y de
                       alimento, biomasa, peso estimado, crecimiento,
                       FCR, código de lote, geometría de estanque,
                       formato numérico, alertas de calidad del agua,
                       clasificación de tareas, costo de inventario de
                       alimento, economía de lote, dinero) — sin
                       dependencias de Dexie ni de Prisma, usadas por
                       igual desde el cliente y el servidor
    analytics/        Capa de informes (Fase 6): agregación ponderada,
                       filtros, informes por dominio, comparación por
                       lote/especie, exportación CSV — funciones puras,
                       nunca dentro de un componente de React
    server/           Cliente Prisma (servidor), logger estructurado,
                       email.ts (envío desacoplado del proveedor),
                       brandAssets.ts (lee el logo maestro para íconos)
    sync/             Motor de sincronización cliente + protocolo
    validation/       Esquemas Zod compartidos cliente/servidor
    labels.ts         Textos en español de enums de dominio
  test/               Configuración de Vitest
tests/e2e/            Tests Playwright: escenario offline base,
                       producción piscícola, operación diaria,
                       calidad del agua + tareas, economía y cierre
                       productivo, analítica e informes, roles y sesión
                       offline, y la prueba final offline obligatoria
                       (Fase 7)
```

## Documentación

- [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) — arquitectura completa, modelo de datos, fases, riesgos.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — cómo está construido lo que ya existe.
- [`OFFLINE_SYNC.md`](./OFFLINE_SYNC.md) — offline y sincronización en detalle, con diagramas.
- [`ECONOMICS.md`](./ECONOMICS.md) — política contable de la Fase 5: compra vs gasto, costo de inventario de alimento, economía de un lote, márgenes, limitaciones.
- [`OFFLINE_SYNC.md` §13](./OFFLINE_SYNC.md#13-analítica-e-informes-fase-6) — capa de analítica de la Fase 6: por qué no hay fuentes de verdad nuevas, razón de sumas vs promedio de promedios (con los dos ejemplos obligatorios), filtros de período vs estado, y el escenario offline verificado.
- [`SECURITY.md`](./SECURITY.md) — modelo de seguridad completo de la Fase 7: autenticación offline y sus limitaciones explícitas, roles/permisos, CSP, secretos, logs, dependencias.
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — despliegue en Railway paso a paso: build, arranque, migraciones automáticas, variables de entorno, bootstrap del primer administrador.
- [`BACKUP_RESTORE.md`](./BACKUP_RESTORE.md) — estrategia de backup de PostgreSQL, frecuencia, restauración, y qué pasa con los datos que un dispositivo todavía no sincronizó.
