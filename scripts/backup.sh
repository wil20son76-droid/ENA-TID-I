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

mkdir -p backups
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT="backups/piscicultura-${TIMESTAMP}.dump"

pg_dump --format=custom --file="${OUTPUT}" "${DATABASE_URL}"

echo "Backup guardado en ${OUTPUT}"
echo "Restaurar con: pg_restore --clean --if-exists --dbname=\"\$DATABASE_URL\" ${OUTPUT}"
