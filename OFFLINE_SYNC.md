# OFFLINE_SYNC.md

Cómo funciona, en detalle, el modo offline-first y la sincronización de
esta aplicación. Complementa `IMPLEMENTATION_PLAN.md` §5-§6 (el diseño) y
`ARCHITECTURE.md` (dónde vive cada pieza en el código).

## 1. Escritura offline

Ninguna pantalla espera nunca a la red para guardar algo. El flujo es
siempre el mismo, sea cual sea la entidad:

```mermaid
sequenceDiagram
    participant UI as Página (ej. /especies)
    participant Repo as Repositorio (src/lib/db/repositories)
    participant Dexie as IndexedDB (Dexie)

    UI->>Repo: createSpecies({ commonName: "Pacú" })
    activate Repo
    Note over Repo: genera id (UUID v4),<br/>deviceId, timestamps, version=1
    Repo->>Dexie: transacción rw (species + syncQueue)
    activate Dexie
    Dexie->>Dexie: species.add(registro)
    Dexie->>Dexie: syncQueue.add({ operationId, entityType,<br/>entityId, operation: "CREATE", payload, status: "pending" })
    Dexie-->>Repo: transacción confirmada (ambas escrituras o ninguna)
    deactivate Dexie
    Repo-->>UI: registro creado
    deactivate Repo
    Note over UI: useLiveQuery ya refleja el cambio;<br/>no hubo ninguna llamada de red
```

Las tres operaciones (crear, actualizar, eliminar lógicamente) comparten
esta misma garantía en `src/lib/db/repositories/base.ts`: la escritura de
dominio y su entrada en `syncQueue` ocurren en **una sola transacción
Dexie**. Si el navegador se cierra a mitad de camino, Dexie asegura que se
aplicó todo o nada — nunca queda un dato guardado sin su operación de
sincronización pendiente.

## 2. Push (enviar cambios locales al servidor)

```mermaid
sequenceDiagram
    participant Engine as Motor de sync (engine.ts)
    participant API as POST /api/sync/push
    participant Prisma as Prisma (transacción)
    participant PG as PostgreSQL

    Engine->>Engine: recolecta operaciones "pending"/"error"<br/>listas para reintentar (respeta backoff)
    Engine->>Dexie: marca esas operaciones como "syncing"
    Engine->>API: { deviceId, operations: [...] }
    activate API
    API->>API: valida cada operación con Zod
    loop por cada operación
        API->>Prisma: ¿existe SyncOperation con este operationId?
        alt ya existe
            Prisma-->>API: sí → "duplicate" (no se reaplica)
        else no existe
            API->>Prisma: transacción: aplicar CREATE/UPDATE/DELETE<br/>+ crear SyncOperation(operationId, status)
            Prisma->>PG: escribe
            PG-->>Prisma: ok
            Prisma-->>API: "applied" (o "conflict", ver §5)
        end
    end
    API-->>Engine: { results: [{ id, status }], serverTime }
    deactivate API
    Engine->>Dexie: "applied"/"duplicate" → synced;<br/>"conflict"/"error" → error (con mensaje)
    Engine->>Dexie: purga las operaciones "synced"
```

## 3. Pull (traer cambios del servidor)

```mermaid
sequenceDiagram
    participant Engine as Motor de sync (engine.ts)
    participant API as GET /api/sync/pull
    participant PG as PostgreSQL
    participant Dexie as IndexedDB

    Engine->>Dexie: lee syncMeta.lastSyncedAt (cursor)
    Engine->>API: GET /api/sync/pull?since=<cursor>
    activate API
    Note over API: serverTime = ahora, ANTES de leer —<br/>así una escritura que llega a mitad de la<br/>consulta se pide de nuevo la próxima vez,<br/>en vez de darse por incluida por error
    API->>PG: SELECT ... WHERE "updatedAt" > since
    PG-->>API: filas de species y ponds
    API-->>Engine: { species, ponds, serverTime }
    deactivate API
    Engine->>Dexie: transacción: put() directo en species/ponds<br/>(SIN pasar por syncQueue)
    Engine->>Dexie: syncMeta.lastSyncedAt = serverTime
```

**Por qué el pull no pasa por `syncQueue`**: si un registro que acaba de
llegar del servidor se volviera a encolar como si fuera un cambio local,
el dispositivo se lo reenviaría al servidor en el próximo push —
generando tráfico inútil como mínimo, y en el peor caso un bucle. `put()`
directo sobre las tablas de Dexie evita esto por construcción.

Es además **incremental**: nunca se descarga la base completa, solo lo
que cambió desde el cursor guardado (§58 del encargo: rendimiento).

## 4. Reintentos y backoff

```mermaid
flowchart TD
    A[runSync invocado] --> B{navigator.onLine?}
    B -- no --> C["connectivity = offline<br/>(no se intenta red)"]
    B -- sí --> D[recolectar operaciones elegibles]
    D --> E{"¿el intento anterior<br/>fue hace ≥ backoff(retryCount)?"}
    E -- "no, y sin forzar" --> F[se deja para la próxima vez]
    E -- "sí, o force:true" --> G[incluir en el lote a enviar]
    G --> H[push]
    H -- éxito --> I[status = synced,<br/>retryCount sin cambios]
    H -- fallo --> J["status = error,<br/>retryCount += 1,<br/>lastError = mensaje"]
    J --> K["próximo intento no antes de<br/>min(5s × 2^retryCount, 5 min)"]
```

- Cada operación se intenta **como máximo una vez por llamada a
  `runSync`** — nunca hay un bucle interno que reintente hasta tener
  éxito. Los reintentos vienen de que algo vuelve a llamar a `runSync`
  más tarde: el intervalo periódico (cada 60 s), el evento `online` del
  navegador, o el botón "Sincronizar ahora" (que además fuerza a ignorar
  el backoff con `force: true`). Esto evita que un fallo persistente de
  red pueda causar un bucle infinito.
- El dato **nunca se pierde** por un fallo de sincronización: sigue en
  IndexedDB, visible y editable, con su badge en 🟠/🔴 indicando que
  falta enviarlo.

## 5. Idempotencia

El requisito crítico: reenviar la misma operación (por un corte de
conexión a mitad de la respuesta, por ejemplo) nunca debe duplicar su
efecto.

```mermaid
sequenceDiagram
    participant Cliente
    participant API as /api/sync/push
    participant PG as PostgreSQL

    Cliente->>API: operación (operationId = "abc123")
    API->>PG: ¿existe SyncOperation("abc123")? No
    API->>PG: aplica CREATE + guarda SyncOperation("abc123", "applied")
    API-->>Cliente: { status: "applied" }
    Note over Cliente: la respuesta se pierde en el camino<br/>(corte de red antes de recibirla)
    Cliente->>API: reenvía la MISMA operación (mismo operationId)
    API->>PG: ¿existe SyncOperation("abc123")? Sí
    API-->>Cliente: { status: "duplicate" } (no se vuelve a aplicar)
```

`operationId` es, en el cliente, el mismo `id` de la entrada en
`syncQueue` — estable mientras esa operación no se haya confirmado
sincronizada, sin importar cuántas veces se reintente. En el servidor,
`SyncOperation.operationId` tiene una restricción `UNIQUE`: si dos
solicitudes con el mismo `operationId` llegaran en paralelo, la base de
datos rechaza la segunda inserción por la restricción única — no hay
ninguna ventana de carrera donde ambas puedan aplicarse. Verificado con
un test real (no solo unitario): la misma operación de creación enviada
tres veces contra un PostgreSQL real deja exactamente una fila (ver
`src/app/api/sync/__tests__/sync.integration.test.ts` y
`tests/e2e/offline.spec.ts`, paso 5).

## 6. Conflictos

Estrategia: **last-write-wins por número de versión**, nunca por
timestamp (los relojes de dispositivos no son confiables).

```mermaid
sequenceDiagram
    participant Servidor as Estado en PostgreSQL
    participant A as Dispositivo A
    participant B as Dispositivo B

    Note over Servidor: Species("Pacú"), version = 1
    A->>Servidor: UPDATE version=2 (agrega nombre científico)
    Servidor-->>A: applied (servidor ahora en version=2)
    Note over B: B editó el mismo registro offline,<br/>todavía basado en version=1
    B->>Servidor: UPDATE version=1 (cambia el nombre común)
    Servidor->>Servidor: version del payload (1) <= version actual (2)
    Servidor-->>B: conflict (NO se sobrescribe)
    Note over B: la operación de B queda en "error" con un<br/>mensaje explicativo, visible para revisión manual —<br/>nunca se pierde en silencio
```

Este mecanismo solo importa para entidades con campos editables
(`Species`, `Pond` en esta fase). Los movimientos productivos/económicos
del dominio completo (alimentación, mortalidad, ventas...) se diseñan
como registros *append-only* (§8/§77 del encargo): al no editarse nunca,
prácticamente no generan conflictos de contenido — ver
`IMPLEMENTATION_PLAN.md` §4.1 y §6.4.

## 7. Qué pasa si el servidor está caído (no el dispositivo)

Desde el punto de vista del cliente es indistinguible de estar offline:
`fetch()` falla, la operación queda en `error` con backoff, y el dato
sigue intacto en IndexedDB. En cuanto el servidor vuelve a responder, el
siguiente intento (automático o manual) la sincroniza con normalidad —
sin ninguna acción especial de recuperación. Verificado en
`tests/e2e/offline.spec.ts` (paso 6), interceptando y luego liberando las
solicitudes a `/api/sync/push` para simular una caída y recuperación
reales del servidor.

## 8. Modelo de producción piscícola (Fase 2)

La Fase 2 añade Lotes (`FishBatch`), Siembras (`Stocking`) y Traslados
(`FishTransfer`) sobre la misma arquitectura offline-first de las
secciones anteriores. El principio nuevo que gobierna todo este modelo:
**nunca existe un campo mutable que diga "cuántos peces hay en tal
estanque ahora"**. Ese número siempre se calcula, nunca se guarda.

### 8.1 Ledger append-only, no un contador

`Stocking` y `FishTransfer` son tablas *append-only*: se crean, nunca se
editan ni se les cambia el estanque. Un lote (`FishBatch`) no tiene
`currentPondId` ni `currentQuantity` — solo guarda sus datos de alta
(especie, siembra inicial, biomasa inicial). Dónde está el lote *ahora*
se deriva combinando su historial completo de siembras y traslados:

```mermaid
flowchart LR
    S["Stocking\n(E01: +1000)"] --> L["getBatchDistribution(lote)"]
    T1["FishTransfer\n(E01→E02: 400)"] --> L
    T2["FishTransfer\n(E01→E03: 200)"] --> L
    L --> D["{ E01: 400, E02: 400, E03: 200 }"]
```

Esto es exactamente lo que exige un traslado **parcial**: un mismo lote
puede terminar repartido entre varios estanques a la vez, así que
"estanque actual del lote" no es una pregunta con una sola respuesta —
por eso nunca se modeló como un campo único.

Las funciones que hacen este cálculo viven en `src/lib/domain/batchLedger.ts`
— puras, sin dependencias de Dexie ni de Prisma — y se usan **idénticas**
en tres sitios: la UI cliente (contra Dexie), `_lib/applyOperation.ts` en
el servidor (contra el estado ya aplicado en la transacción Prisma, para
validar un traslado entrante) y los tests. Una sola implementación del
ledger, nunca dos lógicas de negocio que puedan divergir:

- `getBatchPondBalance(stockings, transfers, batchId, pondId)` — peces de
  un lote en un estanque concreto, ahora mismo.
- `getBatchDistribution(stockings, transfers, batchId)` — el lote
  repartido entre todos los estanques donde tiene peces.
- `getBatchTotalBalance(stockings, transfers, batchId)` — total del lote
  (invariante frente a traslados: solo cambia si se registra una nueva
  siembra o, en fases futuras, una cosecha/mortalidad).
- `getPondOccupancy(stockings, transfers, pondId)` — a la inversa: qué
  lotes hay en un estanque dado, un estanque puede alojar varios.

Diseñado para extenderse sin romper la API interna: cuando la Fase 3
añada mortalidad o cosecha, esas tablas append-only se sumarán al mismo
cálculo de balance (`disponible = siembras − traslados_salida +
traslados_entrada − mortalidad − cosecha`) sin cambiar la firma de estas
funciones ni el modelo de `FishBatch`.

### 8.2 Validación de balance: nunca sacar más de lo disponible

Un traslado nunca puede sacar del origen más peces de los que hay. Se
valida en dos capas, porque el cliente nunca es la fuente de verdad:

1. **Cliente** (`src/lib/db/repositories/fishTransferRepository.ts`):
   antes de escribir en Dexie, calcula el balance actual del estanque de
   origen con `getBatchPondBalance` y rechaza la operación (sin tocar la
   base local, sin encolarla) si `cantidad > disponible`. Esto es lo que
   hace posible el preview "Disponibles en origen / Trasladar / Quedarán"
   de `/lotes/[id]` — calculado en el cliente, sin ningún round-trip de
   red.
2. **Servidor** (`src/app/api/sync/_lib/applyOperation.ts`): vuelve a
   calcular el balance, esta vez contra el estado real ya confirmado en
   Postgres, dentro de la misma transacción que va a insertar el
   traslado. Un dispositivo desactualizado (que offline no vio los
   traslados que otro dispositivo ya sincronizó) puede enviar una
   operación que el cliente creyó válida y que el servidor debe rechazar
   igual — ver §8.3.

### 8.3 Conflictos multi-dispositivo: bloqueo real, nunca perder ni inventar datos

Este es un tipo de conflicto distinto del *last-write-wins* de §6 (que
es para campos editables como el nombre de una especie). Aquí dos
dispositivos, cada uno offline del otro, pueden creer — con datos
igualmente válidos en el momento en que los vieron — que ambos pueden
trasladar más peces de los que en conjunto hay disponibles.

```mermaid
sequenceDiagram
    participant A as Dispositivo A (offline)
    participant B as Dispositivo B (offline)
    participant API as POST /api/sync/push
    participant PG as PostgreSQL

    Note over A,B: E01 tiene 600 peces del lote.<br/>Ambos, sin verse entre sí, crean un<br/>traslado de 400 peces desde E01.
    par Llegan casi al mismo tiempo
        A->>API: traslado A (400 desde E01)
        B->>API: traslado B (400 desde E01)
    end
    API->>PG: SELECT pg_advisory_xact_lock(hashtext(batchId))
    Note over PG: el segundo request que llega<br/>espera aquí hasta que el primero<br/>termine su transacción
    API->>PG: (para el primero) balance actual = 600 ≥ 400 → aplica
    PG-->>API: traslado A: "applied"
    API->>PG: (para el segundo, ya con el lock libre)<br/>balance actual = 200 < 400 → rechaza
    PG-->>API: traslado B: "conflict" (no se inserta nada)
```

- El candado es un **advisory lock de Postgres**
  (`pg_advisory_xact_lock(hashtext(batchId)::bigint)`), tomado al
  principio de la transacción que procesa un `FishTransfer` y liberado
  automáticamente al hacer commit o rollback. Serializa, por lote, las
  operaciones de traslado concurrentes — dos requests HTTP simultáneos
  para el mismo lote nunca pueden los dos leer el mismo balance "antes"
  del traslado del otro.
- El resultado del que pierde la carrera es `status: "conflict"`, **no**
  un error genérico ni un éxito silencioso: la operación queda registrada
  como conflicto, nunca se inserta la fila de `FishTransfer`, y en el
  dispositivo que la generó queda visible en estado `error` (mismo
  mecanismo del §4) — nadie pierde el traslado en silencio, pero tampoco
  se inventa una cantidad negativa para que "encaje". La persona
  responsable ve que ese traslado necesita revisión manual (por ejemplo,
  reducir la cantidad o cancelarlo) en cuanto vuelve a mirar el
  dispositivo.
- Verificado con una prueba de concurrencia real, no simulada en
  secuencia: dos invocaciones HTTP al mismo route handler lanzadas con
  `Promise.all` contra el mismo lote, mismo estanque de origen, cantidad
  que en conjunto excede lo disponible — el resultado es siempre exactamente
  una `"applied"` y una `"conflict"`, nunca las dos aplicadas ni las dos
  rechazadas, corrido varias veces para descartar flakiness (ver
  `src/app/api/sync/__tests__/fishTransfer.integration.test.ts`).

### 8.4 Código de lote: único, generado offline, sin depender del servidor

Un lote necesita un código legible (`PAC-2026-001-9B1C`) sin poder
coordinarse con el servidor para obtener un consecutivo global — dos
dispositivos offline creando lotes de Pacú el mismo año no pueden
"pedir turno". La solución (`src/lib/domain/batchCode.ts`) es un
esquema híbrido: prefijo de la especie (3 letras, sin acentos) + año +
secuencia local (por dispositivo, incremental) + sufijo corto derivado
del `deviceId`. La secuencia local hace que el código sea legible y casi
consecutivo dentro de un mismo dispositivo; el sufijo del dispositivo
garantiza que dos dispositivos nunca puedan generar el mismo código
aunque coincida especie, año y secuencia — sin sacrificar la capacidad
de crear lotes completamente offline, que era el requisito no
negociable.

## 9. Operación diaria: alimento, mortalidad y muestreos (Fase 3)

### 9.1 Ledger de inventario de alimento

Mismo principio que el ledger de peces: `Feed` **nunca** tiene un
campo `stockKg`. El stock se deriva siempre de `FeedInventoryMovement`
(append-only), con `quantityKg` guardado siempre positivo y el signo
decidido por `movementType` en una única función,
`getFeedMovementSignedQuantity` (`src/lib/domain/feedLedger.ts`):
entradas (`PURCHASE`, `INITIAL_STOCK`, `ADJUSTMENT_IN`, `RETURN`) suman;
salidas (`CONSUMPTION`, `ADJUSTMENT_OUT`, `LOSS`) restan. `getFeedStock`
sencillamente suma esos movimientos — ninguna pantalla reimplementa la
regla del signo.

### 9.2 FeedingRecord ↔ FeedInventoryMovement

Registrar alimentación crea **dos** filas ligadas en una sola
transacción local (`createFeedingWithConsumption`,
`src/lib/db/repositories/feedingRepository.ts`): el `FeedingRecord`
(el evento descriptivo — quién, cuándo, cuánto, en qué estanque/lote) y
un `FeedInventoryMovement` tipo `CONSUMPTION` con
`sourceType: "FEEDING"` y `sourceId` apuntando al `FeedingRecord`. Esa
vinculación es la que responde "¿por qué bajó el stock?" sin tener que
adivinar.

La garantía de "nunca descuenta dos veces" viene de dos capas
independientes, no de una sola:

1. **Idempotencia general del outbox** (§5): cada una de las dos
   operaciones tiene su propio `operationId` fijo, generado una sola
   vez al crear los registros en Dexie. Reenviar el mismo push tres
   veces (por ejemplo, tras un corte de red a mitad de la respuesta)
   nunca reaplica su efecto — es exactamente el mismo mecanismo que ya
   garantiza esto para cualquier entidad desde la Fase 1.
2. **Restricción única en el servidor** (defensa adicional,
   `prisma/schema.prisma`): `FeedInventoryMovement` tiene
   `@@unique([sourceType, sourceId])`. Si por cualquier motivo dos
   movimientos distintos intentaran vincularse al mismo
   `FeedingRecord`, Postgres rechazaría el segundo. En la práctica,
   con la capa 1 ya cerrando el caso normal, esta restricción actúa
   como red de seguridad ante un futuro bug, no como el mecanismo
   principal.

### 9.3 Validación de stock: cliente y servidor

Antes de escribir, el cliente calcula el stock disponible con
`getFeedStock` sobre los movimientos ya en Dexie y rechaza el registro
si `cantidad > disponible`, sin tocar la base local
(`No hay suficiente alimento disponible. Stock actual: X kg.`). El
servidor repite la validación contra el estado real de Postgres dentro
de la transacción que va a insertar el movimiento — mismo criterio que
los traslados de peces en Fase 2.

### 9.4 Conflictos multi-dispositivo de inventario

Idéntico patrón al de traslados de peces (§8.3), aplicado a alimento:
un advisory lock de Postgres por `feedId`
(`pg_advisory_xact_lock(hashtext(feedId)::bigint)`) serializa los
movimientos de SALIDA concurrentes del mismo alimento —las de ENTRADA
nunca pueden dejar el stock negativo, así que no necesitan lock. Dos
consumos concurrentes que en conjunto superarían el stock disponible
nunca terminan ambos aplicados: uno gana la carrera (`"applied"`), el
otro pierde (`"conflict"`, no se inserta nada, el dato sigue en el
outbox del dispositivo que lo generó para revisión). Verificado con un
test de concurrencia real —dos invocaciones HTTP en paralelo, no
secuenciales— en
`src/app/api/sync/__tests__/dailyOperations.integration.test.ts`.

Mortalidad usa el mismo mecanismo pero reutilizando el lock por
`batchId` que ya existía para traslados: un registro de mortalidad es,
para el ledger de peces, una salida más del estanque donde ocurrió
(§8.1), así que comparte candado y validación de balance con
`FishTransfer`.

### 9.5 Peso estimado, biomasa y supervivencia

El peso promedio de un lote **nunca** se guarda como un valor mutable.
`getEstimatedWeightForPond` (`src/lib/domain/sampling.ts`) toma el
muestreo más reciente de la combinación exacta `batchId`+`pondId`; si
todavía no hay ninguno, cae al peso inicial de la siembra del lote. Un
muestreo en un estanque **no** sustituye el peso estimado de otro
estanque donde está el mismo lote — cada componente de la biomasa se
calcula con su propio peso antes de sumarse
(`getBatchProductionSummary`, `src/lib/domain/productionSummary.ts`):
nunca `cantidad total del lote × un único peso`.

Supervivencia % = peces actuales / peces sembrados × 100; mortalidad %
= mortalidad acumulada / peces sembrados × 100 — ambas con `null`
explícito (no división por cero) cuando no hay siembra registrada
(`getSurvivalPercent`/`getMortalityPercent`, `batchLedger.ts`).

### 9.6 Crecimiento y FCR: siempre "estimado", nunca falsa precisión

Crecimiento y FCR (`src/lib/domain/growth.ts`, `fcr.ts`) se calculan
entre los **dos muestreos más recientes** del lote. El alimento
consumido se acota estrictamente a ese intervalo de fechas —nunca se
mezcla alimento de fuera del período—, y el incremento de biomasa usa
la cantidad **actual** del lote multiplicada por la diferencia de peso
entre ambos muestreos (`totalNow × (pesoActual - pesoAnterior) / 1000`),
una simplificación documentada: no reconstruye la cantidad exacta que
había en cada fecha pasada, así que no descuenta con precisión la
biomasa de los peces que murieron a mitad del período. Por eso
`calculateFcr` siempre marca `estimated: true` y la UI siempre rotula
"FCR estimado" — nunca se presenta como un valor contable exacto. Con
menos de dos muestreos comparables, ambos cálculos devuelven
"Datos insuficientes" en vez de un número inventado o `Infinity`/`NaN`.

### 9.7 Orden de sincronización de operaciones dependientes

Un `FeedingRecord` depende de `Feed`, `FishBatch` y `Pond`; los cinco
pueden haberse creado enteramente offline en la misma sesión, en un
orden distinto para cada dispositivo (§42 del encargo de Fase 3). El
outbox (`syncQueue`) no implementa un ordenamiento topológico
explícito — se apoya en dos garantías que ya existían desde la Fase 1:

1. **Orden por `createdAt`**: `collectEligibleOperations` (§4) ordena
   siempre por fecha de creación ascendente. Como la UI solo deja
   elegir una entidad ya existente (el selector de "Alimento" en
   `/alimentacion/nueva` no puede mostrar un alimento que no se haya
   guardado antes), el padre **siempre** tiene un `createdAt` igual o
   anterior al del hijo — nunca posterior.
2. **Autocorrección ante un empate o un envío fuera de orden**: si dos
   operaciones comparten el mismo `createdAt` (posible cuando una
   creación compuesta como lote+siembra encola dos operaciones casi
   simultáneas) y llegan al servidor en el orden equivocado, la
   inserción del hijo falla por una violación de llave foránea real de
   Postgres — el servidor la registra como `"error"` (nunca
   `"conflict"` ni una pérdida silenciosa) y la deja en el outbox local
   para reintentar. En el siguiente ciclo de sincronización el padre ya
   está aplicado, así que el reintento del hijo se aplica sin
   intervención manual. No se necesitó construir un ordenamiento
   topológico explícito: el mecanismo de reintentos con backoff que ya
   existía (§4) es suficiente para autocorregir el caso raro de empate.

### 9.8 Operaciones atómicas locales y en servidor

Toda creación compuesta (lote+siembra en Fase 2; alimento+stock
inicial y alimentación+consumo en Fase 3) se escribe **en una sola
transacción Dexie** que incluye tanto los registros de dominio como
sus entradas de `syncQueue` — nunca dos llamadas independientes a
`createRecord`. Esto garantiza que, si el navegador se cierra a mitad
de camino, nunca queda un `FeedingRecord` sin su
`FeedInventoryMovement` (o viceversa) en el dispositivo.

En el servidor, cada operación de la transacción compuesta sigue
siendo una fila independiente de `SyncOperation` (con su propio
`operationId`), pero cada una se aplica dentro de su propia transacción
Prisma — no hay una única transacción de servidor que abarque las dos
operaciones. Esto es intencional y no compromete la consistencia: la
validación de negocio que importa (que el `FeedInventoryMovement`
CONSUMPTION no deje el stock negativo) ya ocurre dentro de la
transacción de *esa* operación, con su propio advisory lock — no
depende de que el `FeedingRecord` se haya aplicado antes o después. Si
el `FeedingRecord` llega y el `FeedInventoryMovement` falla (o
viceversa), cada uno queda en el estado que le corresponde
(`"applied"`/`"error"`/`"conflict"`) y el reintento del outbox termina
de converger — nunca queda "medio aplicada" una operación compuesta de
forma que el ledger de alimento quede inconsistente, porque el ledger
solo se construye a partir de los `FeedInventoryMovement`
efectivamente aplicados, nunca de los `FeedingRecord`.
