#!/bin/sh
# ──────────────────────────────────────────────────────────────────────────────
# backup.sh — резервное копирование SQLite БД transport_crm.db
#
# Запускается из Docker-сервиса «backup» (alpine + sqlite3).
# Переменные окружения:
#   KEEP_DAYS  — сколько дней хранить бэкапы (по умолчанию: 7)
#
# Ручной запуск (разово):
#   docker compose exec backup db-backup
#
# Или без Docker:
#   DB_PATH=/path/to/transport_crm.db BACKUP_DIR=/path/to/backups sh backup.sh
# ──────────────────────────────────────────────────────────────────────────────

set -e

DB_PATH="${DB_PATH:-/data/transport_crm.db}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${KEEP_DAYS:-7}"

LOG_PREFIX="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] backup.sh:"

mkdir -p "$BACKUP_DIR"

# Проверяем наличие БД
if [ ! -f "$DB_PATH" ]; then
  echo "$LOG_PREFIX ПРЕДУПРЕЖДЕНИЕ — БД не найдена: $DB_PATH"
  exit 0
fi

TIMESTAMP=$(date -u +%Y%m%d_%H%M%S)
DEST="$BACKUP_DIR/transport_crm_${TIMESTAMP}.db"

# sqlite3 .backup — безопасный горячий бэкап (работает при открытых соединениях)
sqlite3 "$DB_PATH" ".backup $DEST"

SIZE=$(du -h "$DEST" | cut -f1)
echo "$LOG_PREFIX OK — создан $DEST ($SIZE)"

# Ротация: удалить файлы старше KEEP_DAYS дней
DELETED=$(find "$BACKUP_DIR" -name "transport_crm_*.db" -mtime "+${KEEP_DAYS}" -print)
if [ -n "$DELETED" ]; then
  find "$BACKUP_DIR" -name "transport_crm_*.db" -mtime "+${KEEP_DAYS}" -delete
  echo "$LOG_PREFIX Ротация: удалены файлы старше ${KEEP_DAYS} дней:"
  echo "$DELETED" | while read -r f; do echo "    $f"; done
else
  echo "$LOG_PREFIX Ротация: нечего удалять (бэкапов старше ${KEEP_DAYS} дней нет)"
fi
