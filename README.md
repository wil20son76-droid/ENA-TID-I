# Mi Piscicultura

Sistema de gestión piscícola **offline-first**: funciona íntegramente sin
conexión a Internet y sincroniza solo cuando la hay. Ver
[`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) para la arquitectura
completa y [`ARCHITECTURE.md`](./ARCHITECTURE.md) /
[`OFFLINE_SYNC.md`](./OFFLINE_SYNC.md) para el detalle técnico del modo
offline y la sincronización.

Estado actual: **Fase 3 — operación diaria**. Sobre la base técnica
offline/sync (Fase 1) y el núcleo productivo (Fase 2: Especies,
Estanques, Lotes, Siembras, Traslados) se añadió la operación del
día a día: catálogo de alimentos, inventario de alimento (ledger de
movimientos, nunca un stock mutable), registro de alimentación,
mortalidad integrada en el ledger de peces, muestreos con peso
estimado, biomasa, supervivencia, crecimiento y FCR operacional —
todo offline-first, con validación de balances y resolución de
conflictos multi-dispositivo tanto para peces como para alimento. El
resto del dominio (calidad de agua, cosechas, ventas, rentabilidad...)
se documenta en el plan y se construye en fases posteriores — ver
[`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) y las secciones
["Modelo de producción piscícola" (Fase 2)](./OFFLINE_SYNC.md#8-modelo-de-producción-piscícola-fase-2)
y ["Operación diaria" (Fase 3)](./OFFLINE_SYNC.md#9-operación-diaria-alimento-mortalidad-y-muestreos-fase-3)
de `OFFLINE_SYNC.md`.

## Stack

| Capa | Tecnología |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack), TypeScript, Tailwind CSS v4 |
| Datos locales | IndexedDB vía Dexie.js |
| Servidor | API Routes de Next.js, Prisma 7 (driver adapter `@prisma/adapter-pg`) |
| Base de datos | PostgreSQL |
| PWA | Manifest nativo de Next.js + service worker propio (`public/sw.js`) |
| Tests | Vitest (unitarios/integración), Playwright (E2E offline) |
| Hosting previsto | Railway |

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
#    en .env; nunca corre en producción por accidente.
npm run db:seed

# 5. Levantar el servidor de desarrollo
npm run dev
```

Abre <http://localhost:3000>.

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
| `npm run test:e2e` | Tests E2E offline (Playwright; compila y levanta un build de producción automáticamente): escenario base (`tests/e2e/offline.spec.ts`), producción piscícola (`tests/e2e/production.spec.ts`) y operación diaria (`tests/e2e/dailyOperations.spec.ts`) |
| `npm run db:migrate` | Aplica migraciones de Prisma (desarrollo) |
| `npm run db:migrate:deploy` | Aplica migraciones ya creadas (producción/CI) |
| `npm run db:generate` | Regenera el cliente de Prisma |
| `npm run db:seed` | Siembra datos de demostración (si `SEED_DEMO_DATA=true`) |

## Variables de entorno

Ver [`.env.example`](./.env.example). Como mínimo:

- `DATABASE_URL`: cadena de conexión a PostgreSQL. En Railway la provee
  automáticamente el plugin de PostgreSQL del proyecto.
- `SEED_DEMO_DATA`: `"true"` para permitir `npm run db:seed`.

Nunca subas un `.env` con credenciales reales; `.env.example` es la única
plantilla versionada.

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
# y comprobar en Postgres que no hay duplicados).
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

1. Crea un proyecto en Railway con un plugin de PostgreSQL.
2. Añade este repositorio como servicio; Railway detecta Next.js
   automáticamente.
3. Railway provee `DATABASE_URL` automáticamente al servicio conectado a
   su PostgreSQL — no hace falta configurarla a mano.
4. Configura el comando de build para que también aplique migraciones
   antes de compilar, por ejemplo:
   ```
   npm run db:migrate:deploy && npm run build
   ```
5. El comando de arranque por defecto (`npm run start`) sirve la app.

No se requiere ningún paso manual adicional en cada despliegue: build y
migraciones corren automáticamente en el pipeline de Railway.

## Estructura del proyecto

```
prisma/              Esquema, migraciones y seed de Prisma
src/
  app/                Rutas (App Router): páginas y API routes
    estanques/        Listado, alta y ficha de estanque (con pestañas
                       de producción/alimentación/mortalidad/muestreos)
    lotes/             Listado, alta (lote+siembra) y ficha de lote
    alimentacion/      Resumen diario, registro rápido de alimentación
    alimentos/         Catálogo de alimentos + stock inicial
    mortalidad/        Resumen y registro rápido de mortalidad
    muestreos/         Registro rápido de muestreo
  components/         Componentes de UI (layout, sync, pwa, estanques)
  hooks/              Hooks de React (estado de sincronización)
  lib/
    db/               Capa Dexie/IndexedDB (schema, repositorios)
    domain/           Funciones puras de dominio (ledger de peces y de
                       alimento, biomasa, peso estimado, crecimiento,
                       FCR, código de lote, geometría de estanque,
                       formato numérico) — sin dependencias de Dexie ni
                       de Prisma, usadas por igual desde el cliente y
                       el servidor
    server/           Cliente Prisma (servidor)
    sync/             Motor de sincronización cliente + protocolo
    validation/       Esquemas Zod compartidos cliente/servidor
    labels.ts         Textos en español de enums de dominio
  test/               Configuración de Vitest
tests/e2e/            Tests Playwright: escenario offline base,
                       producción piscícola y operación diaria
```

## Documentación

- [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) — arquitectura completa, modelo de datos, fases, riesgos.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — cómo está construido lo que ya existe.
- [`OFFLINE_SYNC.md`](./OFFLINE_SYNC.md) — offline y sincronización en detalle, con diagramas.
