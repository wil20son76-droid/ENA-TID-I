# Mi Piscicultura

Sistema de gestión piscícola **offline-first**: funciona íntegramente sin
conexión a Internet y sincroniza solo cuando la hay. Ver
[`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) para la arquitectura
completa y [`ARCHITECTURE.md`](./ARCHITECTURE.md) /
[`OFFLINE_SYNC.md`](./OFFLINE_SYNC.md) para el detalle técnico del modo
offline y la sincronización.

Estado actual: **Fase 6 — analítica e informes**. Sobre la base técnica
offline/sync (Fase 1), el núcleo productivo (Fase 2: Especies,
Estanques, Lotes, Siembras, Traslados), la operación diaria (Fase 3:
alimento, alimentación, mortalidad, muestreos), el hardening de
consistencia de sincronización (Fase 3.5), calidad del agua/alertas/
planificación (Fase 4) y economía y cierre productivo (Fase 5:
proveedores, clientes, compras, gastos, cosechas, ventas, economía de
lote — ver [`ECONOMICS.md`](./ECONOMICS.md)), se añadió una capa de
analítica e informes (`/informes/**`): dashboard avanzado, ocho
informes especializados (producción, mortalidad, alimentación,
inventario, calidad del agua, cosechas, ventas y economía),
comparación por lote/especie, gráficos SVG propios (sin librería),
exportación CSV y vista imprimible/PDF (`window.print()` nativo) — todo
calculado en una capa `analytics` pura (nunca en componentes de React),
100% funcional sin conexión y sin ninguna fuente de verdad nueva: cada
KPI se deriva de los mismos ledgers de las fases 2-5, con razón de
sumas (nunca promedio de promedios) en toda agregación entre lotes. Ver
[`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) junto con las
secciones
["Modelo de producción piscícola" (Fase 2)](./OFFLINE_SYNC.md#8-modelo-de-producción-piscícola-fase-2),
["Operación diaria" (Fase 3)](./OFFLINE_SYNC.md#9-operación-diaria-alimento-mortalidad-y-muestreos-fase-3),
["Calidad del agua, alertas y planificación" (Fase 4)](./OFFLINE_SYNC.md#11-calidad-del-agua-alertas-y-planificación-fase-4),
["Economía y cierre productivo" (Fase 5)](./OFFLINE_SYNC.md#12-economía-y-cierre-productivo-fase-5)
y ["Analítica e informes" (Fase 6)](./OFFLINE_SYNC.md#13-analítica-e-informes-fase-6)
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
| `npm run test:e2e` | Tests E2E offline (Playwright; compila y levanta un build de producción automáticamente): escenario base (`tests/e2e/offline.spec.ts`), producción piscícola (`tests/e2e/production.spec.ts`), operación diaria (`tests/e2e/dailyOperations.spec.ts`), calidad del agua + tareas (`tests/e2e/waterQualityAndTasks.spec.ts`), economía y cierre productivo (`tests/e2e/economics.spec.ts`) y analítica e informes (`tests/e2e/analytics.spec.ts`) |
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
# KPIs cambien ni se dupliquen).
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
  components/         Componentes de UI (layout, sync, pwa, estanques)
    charts/           Gráficos SVG propios (línea, barras) — sin librería
    analytics/         Barra de filtros, botones de exportar CSV/imprimir, KpiCard
  hooks/              Hooks de React (estado de sincronización)
  lib/
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
    server/           Cliente Prisma (servidor)
    sync/             Motor de sincronización cliente + protocolo
    validation/       Esquemas Zod compartidos cliente/servidor
    labels.ts         Textos en español de enums de dominio
  test/               Configuración de Vitest
tests/e2e/            Tests Playwright: escenario offline base,
                       producción piscícola, operación diaria,
                       calidad del agua + tareas, economía y cierre
                       productivo, y analítica e informes
```

## Documentación

- [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) — arquitectura completa, modelo de datos, fases, riesgos.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — cómo está construido lo que ya existe.
- [`OFFLINE_SYNC.md`](./OFFLINE_SYNC.md) — offline y sincronización en detalle, con diagramas.
- [`ECONOMICS.md`](./ECONOMICS.md) — política contable de la Fase 5: compra vs gasto, costo de inventario de alimento, economía de un lote, márgenes, limitaciones.
- [`OFFLINE_SYNC.md` §13](./OFFLINE_SYNC.md#13-analítica-e-informes-fase-6) — capa de analítica de la Fase 6: por qué no hay fuentes de verdad nuevas, razón de sumas vs promedio de promedios (con los dos ejemplos obligatorios), filtros de período vs estado, y el escenario offline verificado.
