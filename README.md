# Mi Piscicultura

Sistema de gestión piscícola **offline-first**: funciona íntegramente sin
conexión a Internet y sincroniza solo cuando la hay. Ver
[`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) para la arquitectura
completa y [`ARCHITECTURE.md`](./ARCHITECTURE.md) /
[`OFFLINE_SYNC.md`](./OFFLINE_SYNC.md) para el detalle técnico del modo
offline y la sincronización.

Estado actual: **Fase 1 — base técnica y offline/sync**. Solo están
implementadas las entidades mínimas necesarias para demostrar la
arquitectura de extremo a extremo (Especies, Estanques); el resto del
dominio piscícola se documenta en el plan y se construye en fases
posteriores.

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

# 4. (Opcional) sembrar datos de demostración
#    Requiere SEED_DEMO_DATA="true" en .env
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
| `npm run test:e2e` | Test E2E del escenario offline obligatorio (Playwright; compila y levanta un build de producción automáticamente) |
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

# E2E del escenario offline obligatorio: crear online, desconectar,
# seguir registrando datos, cerrar/reabrir sin conexión, modificar un
# registro offline, reconectar y sincronizar sin duplicar, y recuperarse
# de un fallo temporal del servidor sin perder datos.
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
  components/         Componentes de UI (layout, sync, pwa)
  hooks/              Hooks de React (estado de sincronización)
  lib/
    db/               Capa Dexie/IndexedDB (schema, repositorios)
    server/           Cliente Prisma (servidor)
    sync/             Motor de sincronización cliente + protocolo
    validation/       Esquemas Zod compartidos cliente/servidor
  test/               Configuración de Vitest
tests/e2e/            Tests Playwright (escenario offline)
```

## Documentación

- [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) — arquitectura completa, modelo de datos, fases, riesgos.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — cómo está construido lo que ya existe.
- [`OFFLINE_SYNC.md`](./OFFLINE_SYNC.md) — offline y sincronización en detalle, con diagramas.
