#!/usr/bin/env bash
# Backup de PostgreSQL (Fase 7, §"Backups"). Vuelca la base completa con
# pg_dump en formato "custom" (-Fc: comprimido, restaurable con
# pg_restore, permite restauración selectiva de tablas) a
# backups/<timestamp>.dump. Ver BACKUP_RESTORE.md para la estrategia
# completa (frecuencia recomendada, retención, restauración paso a paso,
# y qué pasa con los datos que un dispositivo todavía no sincronizó).
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL no está definida." >&2
  exit 1
fi

# `DATABASE_URL` sigue la convención de este proyecto (`.env.example`),
# con `?schema=public` — un parámetro que solo entiende Prisma, no
# libpq: `pg_dump`/`pg_restore` fallan con "invalid URI query parameter:
# schema" si se les pasa tal cual (confirmado ejecutando este script de
# verdad, no solo revisándolo — ver BACKUP_RESTORE.md). Se quita ese
# parámetro (y solo ese) antes de invocar cualquier herramienta de
# Postgres; el resto de la cadena de conexión —incluidos otros
# parámetros reales como sslmode, si Railway los añadiera— se conserva
# intacto.
PG_URL="$(printf '%s' "${DATABASE_URL}" | sed -E 's/([?&])schema=[^&]*&?/\1/; s/[?&]$//')"

mkdir -p backups
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT="backups/piscicultura-${TIMESTAMP}.dump"

pg_dump --format=custom --file="${OUTPUT}" "${PG_URL}"

echo "Backup guardado en ${OUTPUT}"
echo "Restaurar con: pg_restore --clean --if-exists --dbname=\"\$DATABASE_URL\" ${OUTPUT}"
echo "(si tu DATABASE_URL trae \"?schema=public\", quítalo para pg_restore igual que se hizo aquí para pg_dump — ver BACKUP_RESTORE.md)"
