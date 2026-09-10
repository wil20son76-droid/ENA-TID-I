# BACKUP_RESTORE.md

Estrategia de backup y recuperación del PostgreSQL de producción (Fase 7,
§"Backups y estrategia de recuperación"). Complementa `DEPLOYMENT.md`
(cómo se despliega) y `SECURITY.md` (variables sensibles).

## 1. Principio: IndexedDB nunca es un sustituto del backup central

Cada dispositivo tiene su propia copia local en IndexedDB (Dexie), pero
**eso no es un backup** de los datos de la piscicultura — es la copia de
trabajo de una sola persona, en un solo teléfono/navegador, que puede
perderse (dispositivo dañado, robado, app reinstalada, IndexedDB purgada
por el navegador bajo presión de espacio) sin ningún mecanismo de
recuperación centralizado. **El único backup real de la operación completa
es el de PostgreSQL** — es la base de datos consolidada que recibe los
cambios de todos los dispositivos. Todo lo que sigue en este documento se
refiere exclusivamente a PostgreSQL.

## 2. Estrategia de backup

- **Herramienta**: `pg_dump --format=custom` (formato binario comprimido,
  restaurable con `pg_restore`, permite restauración selectiva de tablas
  sin tener que recuperar la base completa) — sin depender de un servicio
  de backup gestionado de terceros, coherente con el criterio de "no
  añadir dependencias externas innecesarias" del proyecto.
- **Script**: `scripts/backup.sh` (`npm run db:backup`) — vuelca
  `DATABASE_URL` completo a `backups/piscicultura-<timestamp-UTC>.dump` y
  registra el comando exacto de restauración en su propia salida. El
  directorio `backups/` está en `.gitignore`: los dumps **nunca** se
  commitean al repositorio (contienen datos reales de producción,
  incluidos hashes de contraseña).
- **Dónde correrlo**: contra la `DATABASE_URL` de producción, desde
  cualquier entorno con acceso de red a esa base y `pg_dump` instalado
  (un shell de Railway, un runner de CI programado, o localmente con la
  variable exportada). Railway no ejecuta este script automáticamente — es
  responsabilidad operativa explícita, documentada aquí para que quede
  claro que **no ocurre solo**.
- **Retención recomendada**: conservar backups diarios de los últimos 7
  días, semanales de las últimas 4 semanas, y mensuales de los últimos 6
  meses (esquema clásico de retención escalonada) — ajustar según el
  volumen real de la operación y el espacio disponible en el destino
  elegido. El script en sí no gestiona retención ni rotación: eso depende
  de dónde se almacenen los dumps (ver §3).
- **Dónde guardar el `.dump`**: fuera del propio servidor de la
  aplicación — un bucket de almacenamiento externo (S3-compatible o
  equivalente), o descargado a una máquina distinta tras cada backup. Un
  backup guardado solo en el mismo disco que la base de datos que respalda
  no protege contra la pérdida del servidor completo.

## 3. Frecuencia recomendada

| Volumen de operación | Frecuencia sugerida |
|---|---|
| Piscicultura pequeña, pocos registros diarios | Diaria |
| Operación con varios dispositivos activos a diario | Diaria, considerar cada 12h si el volumen de ventas/compras es alto |
| Antes de cualquier migración de esquema manual o mantenimiento | Backup puntual adicional, siempre, sin excepción |

No existe una frecuencia "demasiado alta" salvo por costo de
almacenamiento — `pg_dump` no bloquea escrituras de forma prolongada (usa
una transacción consistente de solo lectura), así que correrlo con
frecuencia no degrada el servicio en uso normal.

## 4. Restauración

```bash
# 1. Confirmar CONTRA QUÉ base se va a restaurar — nunca ejecutar esto
#    contra producción sin estar seguro de que es la acción deseada.
export DATABASE_URL="postgresql://usuario:clave@host:5432/basededatos"

# 2. Restaurar desde un dump (reemplaza el contenido de las tablas
#    incluidas en el dump; --clean elimina los objetos existentes antes de
#    recrearlos, --if-exists evita errores si algo ya no existe).
pg_restore --clean --if-exists --dbname="$DATABASE_URL" backups/piscicultura-<timestamp>.dump

# 3. Verificar que el esquema de Prisma sigue alineado (el dump incluye
#    la tabla _prisma_migrations, así que "prisma migrate status" refleja
#    el estado real tras restaurar).
npx prisma migrate status
```

- **Restauración selectiva**: `pg_restore --list backups/<archivo>.dump`
  lista los objetos del dump; `pg_restore --table=<tabla> ...` restaura
  solo una tabla concreta — útil para recuperar una tabla corrompida sin
  tocar el resto de la base.
- **Después de restaurar un backup viejo**: cualquier dispositivo que
  sincronizó cambios posteriores a la fecha del backup los reenviará sin
  problema en su próximo `push` — la idempotencia por `operationId` (ver
  `OFFLINE_SYNC.md` §5) hace que reintentar una operación que el backup
  restaurado no tenía todavía sea seguro: se aplica de nuevo sin
  duplicar nada, exactamente como un reintento normal tras un corte de
  red. Es una ventaja directa del diseño offline-first: los dispositivos
  son, en la práctica, una segunda fuente de verdad temporal para
  cualquier dato posterior al backup restaurado, mientras sigan teniendo
  esos cambios pendientes o recientemente sincronizados en su propio
  outbox/historial local.

## 5. Qué ocurre con los datos todavía no sincronizados en los dispositivos

Este es el caso crítico a entender: si el servidor de PostgreSQL se pierde
por completo (o se restaura desde un backup anterior) **mientras algunos
dispositivos tienen cambios pendientes de sincronizar** (outbox local no
vacío, badge 🟠/🔴 en `SyncStatusBadge`):

- **Esos datos NO se pierden** — siguen intactos en IndexedDB del
  dispositivo, exactamente igual que ante cualquier otro fallo de
  conectividad o del servidor (`OFFLINE_SYNC.md` §7). El motor de
  sincronización no depende de que el servidor "recuerde" nada sobre esos
  cambios: el dispositivo simplemente reintenta su outbox local la
  próxima vez que sincroniza, contra el estado que encuentre en ese
  momento (backup restaurado o servidor nuevo).
- **Tras restaurar el servidor (o levantar uno nuevo con el mismo
  esquema)**, cada dispositivo con cambios pendientes los reenvía en su
  próximo `push` con normalidad — sin ninguna acción manual de
  recuperación, sin reconfigurar nada en el dispositivo. Si el backup
  restaurado no tenía todavía una entidad padre que esos cambios
  referencian (por ejemplo, un `FishBatch` creado en otro dispositivo
  después de la fecha del backup pero antes de la pérdida del servidor),
  la operación dependiente queda en error hasta que ese padre también se
  resincronice — el mecanismo de orden y reintento de
  `OFFLINE_SYNC.md` §10.5-§10.6 se autocorrige solo, sin intervención.
- **Lo que SÍ se pierde si el servidor se restaura desde un backup
  antiguo**: cualquier cambio que **ya se había sincronizado con éxito**
  entre la fecha del backup y el momento de la restauración, y que
  **ningún dispositivo conserva localmente** (por ejemplo, porque ese
  dispositivo ya purgó esa entrada de su outbox al confirmarse "synced", y
  no vuelve a re-derivar ese dato desde ningún otro origen — el registro
  en sí, como fila de Dexie, normalmente sí sigue existiendo en el
  dispositivo que lo creó, pero un backup restaurado no tiene forma de
  "pedírselo de vuelta" automáticamente; recuperar ese dato requeriría
  identificar manualmente qué dispositivo todavía lo tiene en su copia
  local y forzar una resincronización, no es un mecanismo automático de
  esta fase). Esto refuerza por qué la frecuencia de backup (§3) importa:
  cuanto más reciente el backup restaurado, menor la ventana de datos que
  dependerían de ese proceso manual.
- **Balance/ledger nunca queda negativo por esta situación**: toda
  validación de balance (peces, stock de alimento, kg disponibles para
  venta) se recalcula siempre desde el historial real en el momento de
  aplicar cada operación (`OFFLINE_SYNC.md` §8.2-§8.3, §9.3-§9.4) — un
  reintento contra un servidor restaurado desde un backup anterior vuelve
  a evaluar esa validación contra el estado que el servidor realmente
  tiene en ese momento, nunca confía en un balance calculado antes de la
  pérdida.

## 6. Prueba de recuperación (simulada)

Como parte de la verificación de esta fase se simuló, contra un entorno
de pruebas real (no en producción): caída del servidor durante un `push`
en curso, una respuesta de red perdida tras un `push` que sí se aplicó en
el servidor, un `push` interrumpido a mitad de lote, y un conflicto
multi-dispositivo (dos dispositivos offline entre sí compitiendo por el
mismo balance). En todos los casos, el resultado fue el mismo: el dato
nunca se pierde ni se duplica, el balance nunca queda negativo, y la
recuperación ocurre sola en el siguiente intento de sincronización, sin
intervención manual — ver `OFFLINE_SYNC.md` §7 y §10.7 para el detalle
técnico de cada mecanismo, y `tests/e2e/offline.spec.ts` (paso 6) para la
prueba automatizada de caída/recuperación del servidor.

## 7. Qué NO cubre esta estrategia

Fuera de alcance de esta fase: backups automáticos programados dentro de
la propia infraestructura de Railway (se documenta el mecanismo y el
script, pero no se configura un cron gestionado — depende de qué
mecanismo de programación esté disponible en el entorno de despliegue
real elegido), replicación en caliente / alta disponibilidad de
PostgreSQL, y backup incremental (cada `pg_dump` es una copia completa).
Si el volumen de datos crece lo suficiente para que un dump completo
diario sea costoso, reevaluar hacia backups incrementales o WAL
archiving — no necesario con el volumen esperado de una piscicultura
individual.
