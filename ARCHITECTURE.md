# ARCHITECTURE.md

Este documento describe **cómo está construido lo que ya existe** (Fases
1, 2 y 3). Para la arquitectura objetivo completa del proyecto (todas las
fases, modelo de datos completo, riesgos) ver [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md).
Para el detalle específico de offline/sincronización, con diagramas, ver
[`OFFLINE_SYNC.md`](./OFFLINE_SYNC.md) — su §8 documenta el modelo de
lotes/siembras/traslados (Fase 2) y su §9 el de alimento/mortalidad/
muestreos (Fase 3).

## 1. Visión general

```mermaid
flowchart LR
    subgraph Navegador["Navegador / PWA instalada"]
        UI["Páginas React\n(src/app/**)"]
        REPO["Repositorios\n(src/lib/db/repositories)"]
        DEXIE[("IndexedDB\nvía Dexie (src/lib/db/schema.ts)")]
        ENGINE["Motor de sync\n(src/lib/sync/engine.ts)"]
        SW["Service worker\n(public/sw.js)"]

        UI --> REPO --> DEXIE
        DEXIE -.outbox pendiente.-> ENGINE
        SW -.cachea assets/rutas.-> UI
    end

    subgraph Servidor["Servidor (Next.js API Routes)"]
        PUSH["POST /api/sync/push\n(idempotente)"]
        PULL["GET /api/sync/pull\n(incremental)"]
        PRISMA["Prisma 7\n(@prisma/adapter-pg)"]
        PG[("PostgreSQL")]

        PUSH --> PRISMA
        PULL --> PRISMA
        PRISMA --> PG
    end

    ENGINE <-- "solo si hay conexión" --> PUSH
    ENGINE <-- "solo si hay conexión" --> PULL
```

Principio rector: **toda pantalla lee y escribe primero contra IndexedDB**.
La red solo entra en juego en segundo plano, a través del motor de
sincronización, y su ausencia nunca bloquea ni degrada la experiencia
(ver §5 y §6 de `IMPLEMENTATION_PLAN.md`).

## 2. Capas y responsabilidades

### `src/lib/domain/` — dominio puro (Fases 2 y 3)

Funciones puras, sin dependencias de Dexie ni de Prisma, importadas por
igual desde el cliente (repositorios) y el servidor
(`_lib/applyOperation.ts`) para que la regla de negocio sea exactamente
una, nunca dos implementaciones que puedan divergir:

- `batchLedger.ts`: cálculo de dónde está un lote (`getBatchPondBalance`,
  `getBatchDistribution`, `getBatchTotalBalance`, `getPondOccupancy`) a
  partir de siembras, traslados **y mortalidad** — nunca de un campo
  mutable. También `getSurvivalPercent`/`getMortalityPercent`. Ver
  `OFFLINE_SYNC.md` §8.1 y §9.5.
- `biomass.ts`: `calculateBiomassKg(cantidad, pesoPromedioG)`.
- `batchCode.ts`: código de lote único generable offline (especie + año +
  secuencia local + sufijo de dispositivo). Ver `OFFLINE_SYNC.md` §8.4.
- `pondGeometry.ts`: estado calculado-vs-manual de área/volumen de un
  estanque a partir de largo/ancho/profundidad, sin sobrescribir un valor
  manual sin avisar.
- `feedLedger.ts` (Fase 3): signo único de cada tipo de movimiento de
  inventario de alimento y stock derivado del ledger — nunca un
  `Feed.stockKg`. Ver `OFFLINE_SYNC.md` §9.1.
- `sampling.ts` (Fase 3): peso promedio de un muestreo y peso estimado
  por lote+estanque (último muestreo, o el peso de siembra si no hay
  ninguno), con agregado ponderado cuando el lote está repartido. Ver
  `OFFLINE_SYNC.md` §9.5.
- `growth.ts` / `fcr.ts` (Fase 3): crecimiento diario y FCR operacional
  entre dos muestreos, ambos con "datos insuficientes" explícito en vez
  de `Infinity`/`NaN`. Ver `OFFLINE_SYNC.md` §9.6.
- `ration.ts` (Fase 3): calculadora de ración diaria recomendada — nunca
  crea movimientos de inventario por sí sola.
- `format.ts` (Fase 3): redondeo y formato numérico centralizados (kg,
  g, %, conteo) en locale es.
- `productionSummary.ts` (Fase 3): combina lo anterior en un resumen de
  producción por lote (peces actuales, supervivencia/mortalidad %,
  biomasa calculada por estanque, nunca cantidad total × un único
  peso).

### `src/lib/db/` — datos locales

- `schema.ts`: define `AppDatabase extends Dexie` con las tablas
  `species`, `ponds`, `fishBatches`, `stockings`, `fishTransfers`,
  `feeds`, `feedInventoryMovements`, `feedingRecords`,
  `mortalityRecords`, `samplings`, `syncQueue`, `syncMeta`, versionadas
  explícitamente (`this.version(1).stores(...)` … `this.version(3).stores(...)`).
  Cualquier cambio de esquema agrega una nueva versión, nunca modifica
  la existente, para no perder datos de dispositivos que llevaban tiempo
  sin sincronizar — cada salto de versión se probó explícitamente contra
  una base con datos de la versión anterior ya presentes
  (`schemaUpgrade.test.ts`).
- `types.ts`: tipos de dominio (`SpeciesRecord`, `PondRecord`,
  `FishBatchRecord`, `StockingRecord`, `FishTransferRecord`,
  `FeedRecord`, `FeedInventoryMovementRecord`, `FeedingRecordRecord`,
  `MortalityRecordRecord`, `SamplingRecord`, ...), independientes del
  cliente Prisma generado — el navegador nunca importa código orientado
  a Node. También define `EventAuditFields` (campos de auditoría
  reducidos de los eventos append-only), reexportado desde
  `repositories/base.ts` para no romper el resto del código.
- `deviceId.ts` / `uuid.ts`: identificador de instalación persistente
  (`localStorage`) y generación de UUID v4 en el dispositivo para toda
  entidad nueva.
- `repositories/base.ts`: capa de acceso a datos común. `createRecord`,
  `updateRecord` y `softDeleteRecord` envuelven **en una sola transacción
  Dexie** la escritura del registro de dominio y la entrada
  correspondiente en `syncQueue` — nunca queda un cambio guardado sin su
  operación de sincronización encolada, ni viceversa. `createEventRecord`
  es la variante para entidades *append-only* (`Stocking`,
  `FishTransfer`): sin `version`, sin actualización posible.
- `repositories/speciesRepository.ts` / `pondRepository.ts`: API
  específica de cada entidad sobre esa base común. `pondRepository`
  integra `applyPondGeometryPatch` para el modo calculado/manual de
  área y volumen.
- `repositories/fishBatchRepository.ts`: `createFishBatchWithStocking`
  crea el lote **y** su siembra inicial en una única transacción Dexie —
  nunca queda un lote a medias si falla una parte (§8.1 del encargo de
  Fase 2).
- `repositories/fishTransferRepository.ts`: `createFishTransfer` valida
  el balance disponible contra `getBatchPondBalance` **antes** de
  escribir — ver `OFFLINE_SYNC.md` §8.2.
- `repositories/ledgerQueries.ts`: consultas de solo lectura sobre el
  ledger para la UI (`getBatchDistribution`, `getBatchHistory`,
  `getPondOccupancy`, `getPondHistory`, y desde la Fase 3
  `getBatchProductionSummary`: peso/biomasa/supervivencia estimados).
- `repositories/feedRepository.ts` (Fase 3): `createFeed` crea el
  alimento y, si se indica, su `FeedInventoryMovement` `INITIAL_STOCK`
  en una transacción — mismo patrón que `createFishBatchWithStocking`.
- `repositories/feedingRepository.ts` (Fase 3):
  `createFeedingWithConsumption` crea `FeedingRecord` +
  `FeedInventoryMovement` `CONSUMPTION` vinculados
  (`sourceType: "FEEDING"`) en una transacción, validando el stock
  disponible antes de escribir.
- `repositories/mortalityRepository.ts` (Fase 3): `createMortality`
  valida el balance del estanque (mismo criterio que los traslados)
  antes de escribir.
- `repositories/samplingRepository.ts` (Fase 3): `createSampling`
  calcula `averageWeightG` automáticamente y valida que el lote tenga
  registro en el estanque seleccionado.
- `repositories/syncQueueRepository.ts`: lectura/escritura de la cola de
  sincronización y de `syncMeta` (cursor `lastSyncedAt`), usado solo por
  el motor de sync, nunca por la UI directamente.

### `src/lib/sync/` — sincronización cliente

- `client.ts`: llamadas HTTP delgadas a `/api/sync/push` y
  `/api/sync/pull`. Sin lógica de reintentos.
- `status.ts`: store observable minimalista (`getSyncStatus`,
  `subscribeSyncStatus`, `setSyncStatus`) consumido con
  `useSyncExternalStore` desde React.
- `engine.ts`: orquesta un ciclo de sincronización (`runSync`) — ver
  `OFFLINE_SYNC.md` para el flujo completo — y expone `startSyncEngine()`
  para conectar los disparadores automáticos (apertura de la app, evento
  `online`, intervalo periódico).

### `src/lib/validation/sync.ts` — validación compartida

Esquemas Zod para el protocolo de sincronización, usados tanto en el
cliente (antes de construir el payload) como en el servidor (`/api/sync/push`
nunca confía en que el cliente ya validó). Un mismo esquema, dos usos.

### `src/lib/server/prisma.ts` — cliente de base de datos

Singleton de `PrismaClient` con el driver adapter `@prisma/adapter-pg`
(requerido por Prisma 7 para PostgreSQL — ver la nota de arquitectura en
`IMPLEMENTATION_PLAN.md` §4.4.1). Solo se importa desde código de
servidor (API routes).

### `src/app/api/sync/` — API de sincronización

- `push/route.ts`: valida con Zod, aplica cada operación en una
  transacción Prisma, y usa `operationId` (único en `SyncOperation`) como
  clave de idempotencia — ver `OFFLINE_SYNC.md` §3.
- `pull/route.ts`: entrega cambios posteriores a `?since=`, calculando su
  propio cursor (`serverTime`) antes de leer, para que el cliente nunca
  dé por sincronizado un cambio que llegó a mitad de la consulta.
  Entrega `fishBatches`/`stockings`/`fishTransfers` (Fase 2) y
  `feeds`/`feedInventoryMovements`/`feedingRecords`/`mortalityRecords`/
  `samplings` (Fase 3); las entidades append-only se filtran por
  `createdAt`, no `updatedAt` — nunca se actualizan.
- `_lib/applyOperation.ts`: aplica CREATE/UPDATE/DELETE con resolución de
  conflictos last-write-wins por número de versión para `Species`/`Pond`/
  `FishBatch`/`Feed`. Para `FishTransfer` y `MortalityRecord` aplica
  además la validación de balance de peces con bloqueo de concurrencia
  (`pg_advisory_xact_lock` por `batchId`) descrita en `OFFLINE_SYNC.md`
  §8.3; para `FeedInventoryMovement` de tipo salida (`CONSUMPTION`,
  `ADJUSTMENT_OUT`, `LOSS`) aplica el mismo mecanismo con un lock por
  `feedId` (§9.4). Un movimiento/registro que dejaría un balance
  negativo vuelve `status: "conflict"` en vez de aplicarse.

### `src/app/` — UI

- `layout.tsx`: shell raíz (español, metadata, `SyncProvider` +
  `ServiceWorkerRegister` + `InstallPrompt` montados una vez).
- `page.tsx`: dashboard con conteos en vivo (`useLiveQuery` sobre Dexie):
  estanques/lotes activos, peces vivos y biomasa estimados (vía
  `getBatchProductionSummary`), mortalidad hoy/acumulada, alimento hoy/
  este mes, stock total de alimento y alimentos bajo mínimo.
  Deliberadamente sin analítica compleja todavía (§35 del encargo de
  Fase 3).
- `especies/page.tsx`: alta/edición completas (incluidos los campos
  productivos opcionales — peso objetivo, ciclo, temperatura/pH/
  oxígeno, FCR y mortalidad esperados) + lista en vivo, pensado para
  completarse en segundos desde un teléfono (§75 del encargo de Fase 1).
- `estanques/page.tsx` + `estanques/nuevo/page.tsx` + `estanques/[id]/page.tsx`:
  listado con superficie/volumen/lotes (derivado de `getPondOccupancy`,
  nunca guardado); alta con geometría calculada-vs-manual
  (`PondGeometryFields`); ficha con pestañas Resumen/Producción/
  Alimentación/Mortalidad/Muestreos/Historial, peces y biomasa
  estimados del estanque, y accesos directos a los tres registros
  rápidos con el estanque preseleccionado.
- `lotes/page.tsx` + `lotes/nuevo/page.tsx` + `lotes/[id]/page.tsx`:
  listado con ubicación derivada (`getBatchDistribution`); alta
  transaccional de lote + siembra inicial con preview de biomasa; ficha
  con distribución actual, "Traslado rápido" (preview Disponibles/
  Trasladar/Quedarán, `OFFLINE_SYNC.md` §8.2), supervivencia/
  mortalidad %, peso y biomasa estimados, alimento acumulado,
  crecimiento diario y FCR estimado (§9.5-§9.6), e historial combinado
  de los 5 tipos de evento.
- `alimentos/page.tsx` (Fase 3): catálogo de alimentos con stock
  inicial opcional al crear.
- `alimentacion/page.tsx` + `alimentacion/nueva/page.tsx` (Fase 3):
  resumen de hoy por estanque/alimento e historial; registro rápido que
  solo muestra los lotes presentes en el estanque elegido y el stock
  disponible del alimento antes de guardar.
- `mortalidad/page.tsx` + `mortalidad/nueva/page.tsx` (Fase 3): hoy/
  semana/acumulada por estanque e historial; registro rápido con
  preview de cuántos quedarán.
- `muestreos/nuevo/page.tsx` (Fase 3): registro rápido con preview del
  peso promedio calculado.
- `manifest.ts`, `icons/[size]/route.tsx`: metadatos de PWA (ver
  `IMPLEMENTATION_PLAN.md` §7).

### `src/components/`

- `layout/AppShell.tsx`: header con el badge de sincronización +
  navegación inferior mobile-first (Inicio, Especies, Lotes, Estanques,
  Alimentación, Mortalidad).
- `layout/QuickRegisterButton.tsx` (Fase 3): botón "+ Registrar"
  flotante presente en cualquier pantalla (§38 del encargo), con acceso
  directo a los tres registros rápidos (Alimentación/Mortalidad/
  Muestreo) sin depender de estar dentro de una ficha concreta.
- `sync/SyncStatusBadge.tsx`: indicador 🟢/🟠/🔴/⚫ + botón "Sincronizar ahora".
- `sync/SyncProvider.tsx`: arranca el motor de sync una vez para toda la app.
- `pwa/ServiceWorkerRegister.tsx`, `pwa/InstallPrompt.tsx`: registro del service worker y aviso discreto de instalación.
- `ponds/PondGeometryFields.tsx`: campos de largo/ancho/profundidad →
  área/volumen calculados o manuales, con "Recalcular" explícito —
  nunca sobrescribe un valor manual en silencio.

## 3. Modelo de datos actual

`prisma/schema.prisma` (Fases 1, 2 y 3):

- **`Species`** — catálogo de especies productivo: nombre, peso objetivo,
  ciclo estimado, rangos de temperatura/pH/oxígeno, FCR y mortalidad
  esperados.
- **`Pond`** — estanques: código, nombre, geometría (largo/ancho/
  profundidad → área/volumen, cada uno `CALCULATED` o `MANUAL`), estado
  (`PondStatus`), activo/inactivo (soft-delete).
- **`FishBatch`** — lote productivo: especie, siembra inicial (fecha,
  cantidad, peso promedio, biomasa), costo de alevines, estado
  (`BatchStatus`). **Nunca** guarda un estanque ni una cantidad "actual"
  — ver `OFFLINE_SYNC.md` §8.1.
- **`Stocking`** — evento de siembra (append-only): lote, estanque,
  fecha, cantidad, peso/biomasa. Es la única forma de que un lote entre
  a un estanque por primera vez.
- **`FishTransfer`** — evento de traslado (append-only): lote, estanque
  de origen y de destino, fecha, cantidad. Soporta traslados parciales
  (un lote puede repartirse entre varios estanques) y queda validado
  contra el balance disponible — ver `OFFLINE_SYNC.md` §8.2-§8.3.
- **`Feed`** — catálogo de alimentos: nombre, marca, % proteína, tamaño
  de pellet, costo por defecto, stock mínimo. Mutable, igual criterio
  que `Species`/`Pond`.
- **`FeedInventoryMovement`** — evento de movimiento de inventario de
  alimento (append-only): tipo, `quantityKg` siempre positivo (el signo
  lo decide el tipo, ver `OFFLINE_SYNC.md` §9.1), `sourceType`/
  `sourceId` opcionales para vincular un consumo a su `FeedingRecord`
  de origen (`@@unique([sourceType, sourceId])`, §9.2).
- **`FeedingRecord`** — registro de alimentación (append-only): lote,
  estanque, alimento, cantidad, turno/hora opcionales.
- **`MortalityRecord`** — mortalidad (append-only): lote, estanque,
  cantidad, causa. Integrada en el ledger de peces como una salida más
  (§9.5).
- **`Sampling`** — muestreo (append-only): lote, estanque, peces/peso
  muestreados, `averageWeightG` ya calculado.
- **`SyncOperation`** — registro de operaciones de sync procesadas por el
  servidor; `operationId` es la clave de idempotencia.

`Species`, `Pond`, `FishBatch` y `Feed` comparten los mismos campos de
auditoría (`createdAt`, `updatedAt`, `deletedAt`, `version`, `deviceId`,
`createdBy`, `updatedBy`) tanto en Prisma como en Dexie, con los mismos
nombres — el mapeo entre ambos lados es directo, y `version` es la base
de la resolución de conflictos last-write-wins (§6 de `OFFLINE_SYNC.md`).
`Stocking`, `FishTransfer`, `FeedInventoryMovement`, `FeedingRecord`,
`MortalityRecord` y `Sampling`, al ser append-only, no tienen `version`
ni `updatedAt`: nunca se editan, así que no hay nada que resolver por
ese mecanismo — su único conflicto posible es el de balance (§8.3, §9.4).

El modelo de datos completo del dominio piscícola restante (calidad de
agua, cosechas, ventas, rentabilidad...) está documentado en
`IMPLEMENTATION_PLAN.md` §4 y se implementa de forma incremental en las
siguientes fases.

## 4. Decisiones de arquitectura tomadas durante la Fase 1

Estas decisiones surgieron al implementar (no estaban en el plan
original) y quedan documentadas aquí y en `IMPLEMENTATION_PLAN.md` para
que no se repitan las mismas dudas en fases futuras:

1. **Prisma 7 requiere un driver adapter explícito** (`@prisma/adapter-pg`)
   y mueve la URL de conexión de `schema.prisma` a `prisma.config.ts`. Ver
   `IMPLEMENTATION_PLAN.md` §4.4.1.
2. **Sin `@serwist/next`**: inyecta un hook de webpack en `next.config`,
   incompatible con Turbopack (por defecto en Next 16 tanto en `dev` como
   en `build`). Se implementó un service worker propio, documentado línea
   por línea en `public/sw.js`. Ver `IMPLEMENTATION_PLAN.md` §7.
3. **TypeScript 5.9.3, no 7.0.2**: `typescript-eslint` no soporta TS 7.0
   todavía (falla al cargar, no es una precaución). Ver `IMPLEMENTATION_PLAN.md` §3.3.
4. **ESLint 9.39.5, no 10.10.0**: las dependencias anidadas reales de
   `eslint-config-next` (`eslint-plugin-react`, `eslint-plugin-jsx-a11y`,
   `eslint-plugin-import`) todavía no soportan ESLint 10 en la práctica.
   Ver `IMPLEMENTATION_PLAN.md` §3.3.
5. **`navigator.onLine` no es suficiente**: puede seguir reportando
   `true` justo después de un corte de red real. El motor de sync también
   infiere "sin conexión" de que `fetch()` lance `TypeError` (la señal
   real de fallo de red, a diferencia de una respuesta HTTP de error).
6. **El comportamiento offline se verifica contra un build de
   producción**, nunca contra `next dev` — ver la nota en `README.md` y
   en `IMPLEMENTATION_PLAN.md` §11.

## 4.1 Decisiones de arquitectura tomadas durante la Fase 2

1. **El balance de peces por estanque nunca se guarda, siempre se
   calcula** a partir de `Stocking`+`FishTransfer` (ver
   `OFFLINE_SYNC.md` §8.1). Es la única forma de soportar traslados
   parciales sin una fuente de verdad duplicada que pudiera
   desincronizarse del historial real.
2. **El código de lote se genera 100% offline** (especie + año +
   secuencia local + sufijo de dispositivo) en vez de pedir un
   consecutivo al servidor — un consecutivo perfecto habría requerido
   coordinación online, incompatible con crear lotes sin red. Ver
   `OFFLINE_SYNC.md` §8.4.
3. **La validación de balance se hace dos veces, cliente y servidor, y
   nunca se confía solo en la del cliente**: un dispositivo offline
   puede tener una vista desactualizada del ledger. El servidor
   serializa con un advisory lock de Postgres por lote
   (`pg_advisory_xact_lock`) para que dos traslados concurrentes del
   mismo lote nunca puedan ambos leer el mismo balance "antes" del otro
   — ver `OFFLINE_SYNC.md` §8.3.
4. **Un traslado en conflicto se marca `"conflict"`, nunca se aplica
   parcialmente ni se inventa una cantidad**: la fila de `FishTransfer`
   simplemente no se inserta, y la operación queda visible como error en
   el dispositivo que la generó para revisión manual.
5. **`FishBatch` + `Stocking`** se crean en una única transacción Dexie
   (`createFishBatchWithStocking`), no con el helper genérico de una
   sola entidad — un lote nunca puede quedar creado sin su siembra
   inicial si algo falla a mitad de camino.

## 4.2 Decisiones de arquitectura tomadas durante la Fase 3

1. **El inventario de alimento sigue el mismo principio de ledger que
   los peces**: `Feed` nunca tiene un `stockKg` mutable; se deriva
   siempre de `FeedInventoryMovement`. El signo de cada movimiento
   (entrada/salida) lo decide una única función
   (`getFeedMovementSignedQuantity`), nunca cada pantalla por su
   cuenta. Ver `OFFLINE_SYNC.md` §9.1.
2. **La mortalidad se integra al ledger de peces como una salida más**,
   con el mismo tratamiento que un traslado saliente — no se creó un
   cálculo de balance paralelo. `getBatchPondBalance` pasó a recibir
   `mortalities` como tercer parámetro explícito en vez de un default
   opcional, para que cada punto de llamada declare a propósito qué
   eventos está considerando.
3. **El peso estimado nunca es un único valor global del lote**: se
   calcula por combinación `batchId`+`pondId` (último muestreo de esa
   combinación exacta, o el peso de siembra si no hay ninguno) y la
   biomasa total se arma sumando el componente de cada estanque —
   nunca `peces totales × un peso`. Ver `OFFLINE_SYNC.md` §9.5.
4. **FCR y crecimiento se marcan siempre como estimados**: el cálculo
   usa la cantidad *actual* del lote para aislar el efecto del cambio
   de peso entre dos muestreos, una simplificación documentada que no
   reconstruye el historial exacto de biomasa en cada fecha pasada. Se
   prefirió esta aproximación simple y honesta, con la etiqueta
   "estimado" siempre visible, a no ofrecer el dato o a presentarlo con
   una falsa precisión. Ver `OFFLINE_SYNC.md` §9.6.
5. **El plan de ración diaria es solo una calculadora**: nunca crea un
   `FeedInventoryMovement` por sí sola. Solo un `FeedingRecord`
   registrado a mano descuenta stock — "planificado" y "real" son
   conceptos deliberadamente separados (§32 del encargo de Fase 3).
6. **`EventAuditFields` se movió de `repositories/base.ts` a
   `db/types.ts`**: al escribir `types.ts` los nuevos `*Record`
   extendiendo esa interfaz directamente (en vez de inlinear sus tres
   campos como se hizo en Fase 2), habría quedado un import circular
   (`types.ts` → `base.ts` → `types.ts`). Se resolvió moviendo la
   definición al módulo de tipos, que es conceptualmente donde
   pertenece, y reexportándola desde `base.ts` para no romper el resto
   del código que ya la importaba de ahí.

## 5. Qué NO está implementado todavía

Deliberadamente fuera de alcance de la Fase 3 (ver `IMPLEMENTATION_PLAN.md`
§9 para el orden de las fases siguientes): compras completas y
proveedores avanzados, gastos generales, ventas, cosechas, rentabilidad
completa, calidad de agua, sensores, IA, reportes PDF avanzados, tareas,
calendario, autenticación, roles de usuario, gráficos avanzados,
notificaciones push, y el aviso interactivo "nueva versión disponible"
del service worker (por ahora se actualiza solo, sin avisar).
