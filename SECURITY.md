# SECURITY.md

Seguridad de esta aplicación (Fase 7, §"Seguridad" del encargo). Complementa
`ARCHITECTURE.md` (dónde vive cada pieza) y `OFFLINE_SYNC.md` (mecánica de
sincronización). Este documento cubre: modelo de autenticación y su
**limitación offline explícita** (requisito crítico del encargo), roles y
permisos, protección de API/rutas, secretos, cabeceras HTTP, logs, y
dependencias.

## 1. Regla crítica: autenticación sin romper offline-first

El requisito no negociable de esta fase es que **la autenticación nunca
exija red para seguir usando la app**. Un trabajador de campo debe poder:
autenticar su dispositivo una vez (con conexión), ir al campo, perder
Internet, cerrar la PWA, volver a abrirla y seguir registrando datos
autorizados — sin que nada le pida loguearse de nuevo solo por el paso del
tiempo o la falta de señal.

### 1.1 Cómo se controla la autorización offline

- Al iniciar sesión (`POST /api/auth/login`, con red), el servidor firma un
  JWT (HS256, ver §2) con una vigencia de **30 días**
  (`SESSION_TTL_SECONDS`, `src/lib/auth/jwt.ts`) y lo guarda en dos sitios:
  `localStorage` (clave `"piscicultura:session"`, leído de forma síncrona
  por `AuthGate` — mismo patrón que `deviceId.ts`) y una cookie `httpOnly`
  (usada solo por `middleware.ts`, nunca leída por JavaScript del cliente).
- **`AuthGate`** (`src/components/auth/AuthGate.tsx`), que envuelve toda la
  app en `layout.tsx`, decide si mostrar el login o la app leyendo
  `localStorage` **directamente, sin ninguna llamada de red y sin mirar si
  el token ya expiró**. Mientras exista una sesión guardada, la persona
  entra a la app de inmediato, offline o no — el JWT nunca se valida ni se
  verifica su expiración en el cliente antes de dejar pasar.
- Toda **escritura** (crear/editar un registro) sigue guardándose primero en
  IndexedDB, exactamente igual que en las fases 1-6 — la sesión no cambia
  en nada el camino crítico de guardado offline.
- La sesión **sí se valida de verdad**, pero solo en el único punto donde
  hay red por definición: cuando el dispositivo sincroniza
  (`POST /api/sync/push`, `GET /api/sync/pull`). Ahí el servidor
  (`authenticateRequest`, `src/lib/auth/serverAuth.ts`) verifica la firma,
  la expiración, que el usuario siga activo, y que su `tokenVersion` no
  cambió desde el login (§1.2). Si el token es válido, sincroniza; si no,
  el dato **nunca se pierde** — queda pendiente en el outbox local (mismo
  mecanismo de `OFFLINE_SYNC.md` §4) hasta que la persona vuelva a iniciar
  sesión.
- Renovación silenciosa (`SessionContext.tsx`): mientras haya conexión, el
  dispositivo pide un token nuevo cada 6 horas y al recuperar conexión
  (`POST /api/auth/refresh`) — así una sesión activa casi nunca llega a
  expirar en un dispositivo que se conecta con cierta frecuencia, sin que
  la persona note nada. Un token ya expirado **no** se renueva (por
  diseño): la expiración tiene que significar algo.

### 1.2 Limitaciones de seguridad de este diseño (explícitas, aceptadas)

1. **Un token robado/filtrado sigue siendo válido offline hasta 30 días o
   hasta su próximo intento de sync**, lo que pase primero. No hay forma de
   invalidarlo a distancia en un dispositivo sin conexión — es inherente a
   "offline-first debe seguir funcionando sin red": revocar algo que el
   dispositivo no puede consultar es imposible por definición. La
   mitigación es que el radio de daño real está acotado a lo que ese rol
   puede escribir (§3) y a que, en cuanto ese dispositivo vuelva a tener
   señal e intente sincronizar, la revocación (§1.3) lo bloquea de
   inmediato para cualquier escritura nueva.
2. **La revocación ("cerrar sesión" de un usuario desde `/usuarios`, o
   cambiarle la contraseña) solo surte efecto la próxima vez que ese
   dispositivo intenta sincronizar**, nunca al instante. Mientras tanto, el
   dispositivo revocado sigue funcionando con total normalidad — sigue
   viendo y registrando datos localmente — hasta que un `push`/`pull` real
   llegue al servidor y sea rechazado (`REVOKED`, `serverAuth.ts`). Es la
   contrapartida directa de nunca exigir red para seguir trabajando: no
   existe un canal para "avisarle" a un dispositivo offline que perdió su
   acceso.
3. **`AuthGate` nunca comprueba la expiración del JWT en el cliente.** Un
   token técnicamente ya vencido (pasados los 30 días, sin haberse podido
   renovar por falta de red prolongada) sigue dejando entrar a la app y
   registrar datos localmente — el dato nunca se pierde, solo queda
   pendiente de sincronizar. El servidor sí lo rechaza en el siguiente
   intento de sync (`EXPIRED_TOKEN`), mostrando "La sesión expiró. Inicia
   sesión de nuevo para sincronizar." (visible en `SyncStatusBadge`, nunca
   un error técnico crudo).
4. **`User` es la única entidad del dominio que NO es offline-first a
   propósito** (`schema.prisma`, comentario junto al modelo `User`): nunca
   pasa por Dexie ni por el outbox de sincronización, se gestiona
   exclusivamente online vía `/api/users` (§3.3). Es una decisión
   deliberada, no una limitación accidental: mezclar una entidad
   sensible a la seguridad en el mismo modelo eventualmente-consistente
   que los datos productivos habría abierto la puerta a un "usuario
   fantasma" creado offline en un dispositivo que nadie más reconoce.
5. **Este es el modelo de amenaza aceptado para esta fase**: un
   dispositivo físico perdido/robado con la sesión activa puede seguir
   registrando datos falsos hasta que alguien lo revoque y ese
   dispositivo vuelva a tener señal — no hay ningún mecanismo de
   "borrado remoto" ni de expiración forzada instantánea. Mitigación
   recomendada operativamente (no técnica): revocar la sesión desde
   `/usuarios` en cuanto se detecte un dispositivo perdido, y tratar el
   PIN/contraseña del propio teléfono como la primera línea de defensa
   física.

## 2. Diseño de la sesión (JWT)

- **Algoritmo**: HS256 (HMAC-SHA256), firmado a mano con `node:crypto`
  (`createHmac`, `timingSafeEqual` para la comparación — nunca un `===` de
  strings, que puede filtrar información por temporización) —
  `src/lib/auth/jwt.ts`. No se usa `jose`/`jsonwebtoken`: mismo criterio de
  "cero dependencias innecesarias" que el resto del proyecto (gráficos SVG
  propios, `window.print()` nativo). No es criptografía inventada: HS256 es
  el estándar RFC 7519, solo se prescinde del envoltorio de una librería.
- **Payload**: `sub` (userId), `username`, `name`, `role`, `tokenVersion`,
  `iat`, `exp`. Nunca incluye la contraseña ni su hash.
- **`AUTH_SECRET`**: obligatorio, sin valor por defecto — la app se niega a
  firmar o verificar cualquier sesión si falta o mide menos de 16
  caracteres (`getSecret()`, lanza error en vez de usar un secreto trivial
  implícito). Ver §4 para cómo se gestiona en cada entorno.
- **Contraseñas**: `scrypt` de `node:crypto` (no bcrypt/argon2, mismo
  criterio de dependencias mínimas), formato de almacenamiento
  `"scrypt:<saltHex>:<hashHex>"` — salt aleatorio de 16 bytes por
  contraseña (nunca reutilizado), clave derivada de 64 bytes, comparación
  en tiempo constante (`src/lib/auth/password.ts`).
- **`tokenVersion`** (`User.tokenVersion`, entero, default 1): copiado al
  payload del JWT en el momento del login. El servidor compara ese valor
  contra el actual en la base en cada request autenticado
  (`authenticateRequest`) — si no coincide, la sesión quedó revocada.
  Se incrementa al cambiar la contraseña de un usuario o al pulsar "Cerrar
  sesiones" en `/usuarios` (`PATCH /api/users/[id]`, `revokeSessions: true`).

## 3. Roles y permisos

### 3.1 Modelo de capacidades, no una jerarquía lineal

`src/lib/auth/permissions.ts` — deliberadamente **no** es "cada rol
incluye todo lo del rol de abajo". `READ_ONLY` no es "menos" que `WORKER`:
es un eje ortogonal (cero capacidades de escritura), no un escalón
inferior en una escalera. Cuatro capacidades (`READ`, `FIELD_OPS`,
`MANAGE_CATALOG`, `MANAGE_ECONOMY`, `MANAGE_USERS`) se combinan por rol:

| Rol | Capacidades | Qué significa en la práctica |
|---|---|---|
| **Administrador** | todas | Además de todo lo de Encargado, gestiona usuarios (`/usuarios`) |
| **Encargado** (`MANAGER`) | `READ`, `FIELD_OPS`, `MANAGE_CATALOG`, `MANAGE_ECONOMY` | Todo el dominio productivo y económico, no gestiona usuarios |
| **Trabajador** (`WORKER`) | `READ`, `FIELD_OPS` | Solo operación diaria de campo: alimentación, mortalidad, muestreos, calidad del agua, tareas |
| **Solo lectura** (`READ_ONLY`) | `READ` | Ve todo (dashboard, informes), no puede registrar ni editar nada |

Cada `entityType` del protocolo de sincronización mapea a **exactamente
una** capacidad (`ENTITY_CAPABILITY`, `permissions.ts`) — un `entityType`
desconocido nunca se autoriza por defecto (*fail-closed*,
`capabilityForEntityType` devuelve `null`, y `canWriteEntity` lo trata como
denegado).

### 3.2 La barrera real es el servidor, nunca la UI

`RequireCapability` (componente cliente) oculta formularios/páginas que el
rol actual no puede usar, y `QuickRegisterButton` solo ofrece las acciones
que el rol puede realmente enviar — **ambos son solo UX**, nunca la
barrera de seguridad. La validación que de verdad importa ocurre en
`POST /api/sync/push` (`src/app/api/sync/push/route.ts`): cada operación
del lote se verifica individualmente con `canWriteEntity(role, entityType)`
**antes** de tocar la base de datos — un intento no autorizado nunca se
registra como si fuera un error de datos, se rechaza con
`"No tienes permiso para esta operación (rol: X)."` y queda registrado
(`logger.warn`) para auditoría. Verificado con pruebas de integración
reales contra Postgres, no solo unitarias de la matriz de permisos (ver
`src/app/api/sync/__tests__/authAndPermissions.integration.test.ts` y
`tests/e2e/auth.spec.ts`).

### 3.3 `User` es online-only, deliberadamente fuera del protocolo de sync

Gestión de usuarios vía `/api/users` (REST simple, no el protocolo de
push/pull) — admin-only en ambos endpoints (`GET`/`POST /api/users`,
`PATCH /api/users/[id]`), protegidos con `requireCapability(request,
"MANAGE_USERS")`. Nunca se sincroniza offline: crear/editar un usuario
exige conexión real, a propósito (§1.2, punto 4).

## 4. Secretos y variables de entorno

- **Nunca hay secretos en el frontend.** `AUTH_SECRET` solo se lee en
  código de servidor (`src/lib/auth/jwt.ts`, importado únicamente desde
  API routes) — nunca llega al bundle de cliente. El JWT que sí vive en
  `localStorage` es una prueba de identidad temporal (30 días, revocable),
  no un secreto: perderlo no expone `AUTH_SECRET` ni ninguna contraseña.
- **`AUTH_SECRET`**: obligatorio en todo entorno (dev, test, producción),
  sin valor por defecto — ver §2. En Railway se define como variable de
  entorno del servicio (nunca committeada); generación recomendada
  `openssl rand -base64 48`. Cambiarlo invalida **todas** las sesiones
  activas de inmediato (todo JWT existente deja de verificar su firma) —
  solo se cambia deliberadamente, avisando a los usuarios.
- **`DATABASE_URL`**: provista automáticamente por el plugin de PostgreSQL
  de Railway; en local, apunta a una instancia propia. Nunca se
  hardcodea una cadena de conexión en el código.
- **`ADMIN_USERNAME`/`ADMIN_NAME`/`ADMIN_PASSWORD`**: solo para el bootstrap
  manual de un único momento (`npm run auth:create-admin`, ver
  `DEPLOYMENT.md` §4) — nunca quedan puestas de forma permanente en el
  entorno del servicio, y nunca hay un admin sembrado automáticamente por
  `npm run db:seed` (los datos de demostración nunca incluyen credenciales).
- `.env.example` es la única plantilla versionada; `.env` real está en
  `.gitignore` desde la Fase 1.

## 5. Protección de API y rutas

- **`middleware.ts`**: primera línea de defensa barata para
  `/api/sync/*` y `/api/users*` — rechaza con 401 cualquier solicitud sin
  encabezado `Authorization` antes de que llegue al route handler. Es una
  capa adicional, **nunca** un sustituto de la validación real (que
  siempre vuelve a ocurrir en el propio handler vía `authenticateRequest`,
  con consulta a la base de datos incluida — verifica también
  `tokenVersion` y `active`, cosas que el middleware no puede saber sin
  tocar Postgres).
- **`/api/auth/login`**: rate-limitado en memoria por nombre de usuario
  (10 intentos fallidos / 15 minutos, `src/lib/auth/rateLimit.ts`) —
  limitación documentada: es un `Map` en memoria del proceso, no
  distribuido. Aceptable porque Railway despliega esta app como una única
  instancia web (§"No hacer dependencias innecesarias de servicios
  externos" del encargo — no se añadió Redis solo para esto); se reinicia
  con cada redeploy/reinicio del proceso, y no se comparte entre
  instancias si en el futuro hay más de una detrás de un balanceador. Un
  intento con usuario/contraseña incorrectos siempre responde el mismo
  mensaje genérico, para no revelar si el usuario existe.
- **Páginas de la app (`/`, `/especies`, `/economia`...) no están
  protegidas por `middleware.ts` a propósito**: es una PWA fuertemente
  renderizada en cliente — el HTML que Next.js sirve para cualquier ruta
  es el mismo "shell" vacío, sin datos sensibles (todo el contenido real
  se lee de IndexedDB en el navegador, nunca en el HTML servido). La
  protección real de esas rutas es `AuthGate` (cliente, §1.1).
- **Validación de datos**: todo endpoint valida con Zod
  (`src/lib/validation/*`) tanto en cliente como en servidor — el servidor
  nunca confía en que el cliente ya validó (criterio del proyecto desde la
  Fase 1). Los límites físicos de calidad del agua, formatos de
  usuario/contraseña, etc. se repiten como bounds explícitos en el
  esquema del servidor.

## 6. Content-Security-Policy y otras cabeceras HTTP

`next.config.ts` aplica (solo en `NODE_ENV=production`, para no interferir
con el HMR de `next dev`): `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy` (cámara/micrófono/geolocalización deshabilitados),
`Strict-Transport-Security` (Railway sirve siempre HTTPS), y
`Content-Security-Policy`.

**Decisión documentada sobre `script-src 'unsafe-inline'`**: se intentó
primero una CSP estricta con nonce por solicitud, generado en
`middleware.ts` (el patrón recomendado para bloquear scripts inline sin
`unsafe-inline`). En la práctica, el App Router de Next.js 16 con
Turbopack inyecta el payload de RSC (`self.__next_f.push(...)`) en
`<script>` inline **sin aplicarles ese nonce automáticamente** en este
build — verificado empíricamente: con esa CSP estricta, la app se queda
congelada en su HTML inicial (la pantalla "Cargando…" de `AuthGate` para
siempre), porque React nunca llega a hidratar y ningún `useEffect`
—incluido el registro del service worker— se ejecuta jamás. Implementar
nonces correctos requeriría interceptar y reescribir el payload RSC de
cada Server Component a mano, algo fuera de alcance de esta fase — queda
documentado como trabajo de hardening futuro, no oculto.

**Riesgo residual evaluado como bajo**: se verificó (`grep -rn
"dangerouslySetInnerHTML" src`) que la aplicación no usa
`dangerouslySetInnerHTML` en ningún componente ni renderiza HTML/JS de
origen no confiable en ninguna pantalla — no hay una superficie realista
de inyección de script que esta CSP debiera bloquear hoy. `worker-src
'self'` sí queda explícito (no se confía en el fallback de la
especificación a `script-src`), verificado contra el service worker real
de la PWA.

## 7. Logs y manejo de errores de producción

`src/lib/server/logger.ts` — wrapper mínimo sobre `console.*` que emite
una línea JSON por evento (`level`, `message`, `time`, campos
adicionales) — sin librería (Winston/Pino): Railway captura stdout/stderr
directamente. Reglas:

- **Nunca se registra una contraseña, un hash de contraseña, ni un JWT
  completo.** Los intentos de login rechazados registran el nombre de
  usuario (necesario para operar el rate limit y para auditoría), nunca
  la contraseña recibida.
- Los rechazos de permisos en `/api/sync/push` se registran
  (`logger.warn`, con `entityType`/`role`/`operationId`) para poder
  auditar intentos repetidos de un rol sin la capacidad necesaria.
- Ningún endpoint devuelve el stack trace crudo de un error al cliente
  — `logger.error` guarda el stack para diagnóstico en los logs del
  servidor, pero la respuesta HTTP siempre lleva un mensaje genérico o
  específico de negocio, nunca detalles internos de implementación.
- `GET /api/health` (público, sin autenticación — necesario para el
  healthcheck de Railway) hace un `SELECT 1` contra Postgres y devuelve
  `{status: "ok"|"error", time}` — nunca expone la cadena de conexión,
  versión de Postgres, ni ningún detalle interno.

## 8. Exposición de datos económicos y productivos

- Todo dato productivo/económico (precios, márgenes, costos, ventas) solo
  se sirve a través de `/api/sync/pull`, que exige un token válido
  (`authenticateRequest`) — nunca hay un endpoint público que devuelva
  datos de negocio.
- **La lectura no distingue por rol más allá de estar autenticado**: hoy
  cualquier rol autenticado (incluido `READ_ONLY`) puede leer todo el
  dominio vía `pull` — es una decisión deliberada del modelo de
  capacidades (§3.1: `READ` es la única capacidad de `READ_ONLY`, y todos
  los roles la tienen), no una omisión. No hay compartimentación de datos
  por estanque/lote/usuario en esta fase — limitación conocida si en el
  futuro se necesitara un "Trabajador" que solo vea su propio estanque
  asignado.
- Los mensajes de error de sincronización (conflictos de balance/stock,
  errores de permisos) nunca incluyen datos de otro dispositivo o usuario
  más allá de lo estrictamente necesario para explicar el propio
  conflicto (ver `src/lib/sync/conflictMessages.ts`).

## 9. Dependencias y vulnerabilidades conocidas

`npm audit` (revisado al cierre de esta fase) reporta vulnerabilidades
**solo en dependencias de build-time/CLI, nunca en el runtime desplegado**:

- `deepmerge-ts`/`mysql2` (altas): arrastradas transitivamente por el
  soporte de MySQL dentro del propio CLI de `prisma` (paquete de
  desarrollo, nunca se importa en código de servidor ni de cliente) —
  esta aplicación usa exclusivamente PostgreSQL vía `@prisma/adapter-pg` +
  `pg`, que no están afectados. El fix disponible (`npm audit fix
  --force`) bajaría `prisma` a una versión anterior, un cambio de mayor
  con más riesgo que el propio hallazgo (ver `IMPLEMENTATION_PLAN.md` §3.3
  sobre por qué se fijó deliberadamente en 7.10.0) — se deja pendiente de
  una actualización normal de Prisma, no de un downgrade forzado.
- `browserslist` (alta, vía la cadena de Tailwind/PostCSS): corregida sin
  cambios que rompan compatibilidad (`npm audit fix`) durante esta misma
  fase.

Ninguna dependencia de **runtime** (`next`, `react`, `@prisma/client`,
`@prisma/adapter-pg`, `pg`, `dexie`, `zod`) aparece en el reporte. Revisar
`npm audit` de nuevo en cada actualización de dependencias es parte de la
rutina de mantenimiento, no un paso único de esta fase.

## 10. Qué NO cubre esta fase

Fuera de alcance explícito (según el encargo de Fase 7): autenticación
multi-factor, SSO/OAuth con proveedores externos, auditoría granular por
campo modificado (solo se audita `deviceId`/`createdBy`/`updatedBy` a
nivel de registro, como desde la Fase 1), compartimentación de datos por
estanque/lote asignado a un usuario (§8), rotación automática de
`AUTH_SECRET`, y rate limiting distribuido (§5). Ninguna de estas
limitaciones compromete el requisito crítico de esta fase (offline-first
sin romper autenticación) — quedan documentadas como trabajo futuro, no
como huecos ocultos.

## 11. Recuperación de contraseña

Dos caminos independientes para recuperar el acceso, complementarios: por
email (autoservicio, requiere que el usuario tenga `email` cargado) y por
ADMIN (siempre disponible, no depende de que exista un email).

### 11.1 Por email

- **`POST /api/auth/forgot-password`** genera un token aleatorio de 256
  bits (`randomBytes(32)`, `src/lib/auth/passwordResetTokens.ts`) y guarda
  solo su **hash SHA-256** en `PasswordResetToken.tokenHash` — igual que
  las contraseñas nunca se guardan en claro, el valor que viaja en el
  enlace de email tampoco: una filtración de esa tabla no permite
  reconstruir ningún enlace válido. Expira a los 30 minutos
  (`RESET_TOKEN_TTL_MS`).
- **Nunca revela si una cuenta existe**: la respuesta HTTP es
  exactamente la misma (200, mismo mensaje) exista o no un usuario con
  ese email, esté activo o no — solo cambia, de forma invisible para
  quien llama, si se generó un token y se intentó enviar el email.
- **Rate limit** por email introducido (mismo limitador en memoria que
  login, §1.2 de sus limitaciones aplican igual: en memoria del proceso,
  se reinicia con cada despliegue, no es distribuido) — 10 solicitudes
  por 15 minutos para el mismo email, exista o no la cuenta, así que el
  límite en sí tampoco filtra existencia.
- **`POST /api/auth/reset-password`** consume el token: lo invalida
  (`usedAt`) en la misma transacción que actualiza la contraseña, así que
  un segundo intento con el mismo token —incluso dentro de su ventana de
  30 minutos— se rechaza. Revoca todas las sesiones activas
  (`tokenVersion` incrementado) — la recuperación existe precisamente
  porque la contraseña anterior se dio por perdida o comprometida.
  Cualquier motivo de rechazo (token inexistente, ya usado, o expirado)
  responde el mismo mensaje genérico, sin distinguir cuál fue.
- **Envío de email desacoplado del proveedor**
  (`src/lib/server/email.ts`): un webhook HTTP genérico
  (`EMAIL_WEBHOOK_URL`, `EMAIL_WEBHOOK_API_KEY`, `EMAIL_FROM` —
  `.env.example`), nunca un SDK de un proveedor concreto. **Sin
  `EMAIL_WEBHOOK_URL` configurada (el valor por defecto en este
  repositorio, incluido todo desarrollo local), el email nunca se envía
  de verdad: el enlace completo queda solo en el log del servidor.** Es
  intencional para poder probar el flujo de punta a punta sin contratar
  un proveedor todavía, pero es una limitación operativa real en
  producción: sin esa variable configurada, nadie recibe su enlace de
  recuperación y la función queda inutilizable en la práctica, aunque la
  API responda 200 igual (por diseño, para no revelar nada — ver arriba).
  Configurarla es un paso obligatorio del checklist de despliegue real,
  documentado en `DEPLOYMENT.md`.

### 11.2 Por ADMIN

- Desde `/usuarios`, "Restablecer contraseña": ADMIN escribe una
  contraseña temporal para otra cuenta (`PATCH /api/users/:id`, mismo
  endpoint que ya existía para editar usuarios). Fijar `password` por
  esta vía **siempre** marca `mustChangePassword=true` en el mismo
  `update` — a diferencia de `POST /api/auth/reset-password` (la propia
  persona eligiendo su contraseña, no hace falta forzar nada más), aquí
  es ADMIN quien la elige por ella, así que se trata siempre como
  temporal. También revoca las sesiones activas de esa cuenta
  (`tokenVersion` incrementado, mismo mecanismo que "Cerrar sesiones").
- **ADMIN nunca puede leer la contraseña actual de nadie** — no hay
  ningún endpoint ni columna que la exponga (solo `passwordHash`,
  irreversible por diseño de `scrypt`, §2). Restablecer es la única
  operación posible: reemplazar, nunca recuperar.
- **`mustChangePassword`**: `AuthGate` lee este campo en la respuesta del
  login y, si es `true`, bloquea el resto de la app con
  `ForceChangePasswordScreen` — la sesión existe (el login con la
  temporal ya ocurrió, con red) pero no da acceso a ninguna pantalla
  productiva hasta que la persona fije su propia contraseña
  (`PATCH /api/auth/change-password`, que exige la contraseña actual —
  la temporal— como confirmación, y emite un token nuevo para no cerrar
  la sesión del propio dispositivo que acaba de cambiarla).

### 11.3 Limitación offline (documentada a propósito, según el encargo)

**Toda la recuperación de contraseña exige conexión real** — no hay
excepción, y es coherente con el resto del modelo de esta fase (§1: el
login mismo es la única otra operación que también la exige):

- `forgot-password`/`reset-password` son, por definición, el único punto
  de entrada de alguien que **todavía no tiene sesión** — no hay ningún
  dato local (IndexedDB) contra el que resolver esto sin red.
- El cambio obligatorio tras un reset por ADMIN
  (`ForceChangePasswordScreen`) es la continuación directa de un login
  que ya exigió red — si el dispositivo pierde conexión justo en ese
  paso intermedio, el envío falla con un error visible y se puede
  reintentar en cuanto vuelva; nunca se pierde ni corrompe ningún dato
  productivo porque esta pantalla no toca Dexie/outbox en absoluto.
- **Una sesión YA autorizada (`mustChangePassword` en `false` o ausente)
  sigue funcionando sin Internet exactamente igual que siempre** — nada
  de esta fase cambia esa garantía (§1). Una revocación o un cambio de
  contraseña hecho en otro dispositivo (por ADMIN, o por la propia
  persona vía email) solo tiene efecto en un dispositivo ya autorizado y
  offline **cuando ese dispositivo vuelve a conectarse** y el servidor
  valida su `tokenVersion` en su próximo intento de sincronización —
  mismo mecanismo de revocación no instantánea ya documentado en §1.2
  (punto 1) y §1.3, sin ningún caso nuevo introducido aquí.
