#!/usr/bin/env bash
# ============================================================================
# restore.sh — restore PostgreSQL RigDaily dari file .dump (format -Fc)
#
# PERINTAH INTI:
#   pg_restore --clean --if-exists -d "$DATABASE_URL" <file.dump>
#
# PERINGATAN: --clean MENGHAPUS objek yang ada di DB tujuan lalu memuat ulang
# dari dump. Ini DESTRUKTIF. Script meminta konfirmasi eksplisit.
#
# PEMAKAIAN:
#   infra/scripts/restore.sh /opt/rigdaily/backups/2026-09-10.dump --yes
#   infra/scripts/restore.sh <file> --dry-run     # hanya pratinjau isi dump
#
# Restore dijalankan lewat container db (pg_restore versi sama dengan server).
# ============================================================================
set -euo pipefail

log() { printf '%s [restore] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { printf '%s [restore] FATAL: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; exit 1; }

# --- Argumen ---------------------------------------------------------------
DUMP_FILE="${1:-}"
CONFIRM_FLAG="${2:-}"

[ -n "$DUMP_FILE" ] || die "pemakaian: $0 <file.dump> [--yes|--dry-run]"
[ -f "$DUMP_FILE" ] || die "file tidak ditemukan: $DUMP_FILE"
[ -s "$DUMP_FILE" ] || die "file kosong: $DUMP_FILE"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
COMPOSE_FILE="$APP_DIR/docker-compose.prod.yml"
[ -f "$COMPOSE_FILE" ] || die "tidak menemukan $COMPOSE_FILE."

if [ -z "${DATABASE_URL:-}" ] && [ -f "$APP_DIR/.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "$APP_DIR/.env"; set +a
fi

DB_USER="${POSTGRES_USER:-rigdaily}"
DB_NAME="${POSTGRES_DB:-rigdaily}"

# --- Verifikasi file -------------------------------------------------------
head -c 5 "$DUMP_FILE" | grep -q 'PGDMP' || die "file bukan dump custom-format (header != PGDMP)."
SIZE="$(stat -c%s "$DUMP_FILE")"
log "file dump valid: $DUMP_FILE ($(numfmt --to=iec "$SIZE" 2>/dev/null || echo "${SIZE}B"))"

# --- Mode dry-run ----------------------------------------------------------
if [ "$CONFIRM_FLAG" = "--dry-run" ]; then
  log "dry-run: daftar objek dalam dump (tidak menulis ke DB):"
  docker compose -f "$COMPOSE_FILE" exec -T db \
    pg_restore --list < "$DUMP_FILE"
  exit 0
fi

# --- Konfirmasi ------------------------------------------------------------
if [ "$CONFIRM_FLAG" != "--yes" ]; then
  echo "------------------------------------------------------------"
  echo " PERINGATAN: restore akan MENGHAPUS (--clean) objek di:"
  echo "   database : $DB_NAME"
  echo "   user     : $DB_USER"
  echo "   source   : $DUMP_FILE"
  echo "------------------------------------------------------------"
  printf "Ketik nama database '%s' untuk melanjutkan: " "$DB_NAME"
  read -r ANSWER
  [ "$ANSWER" = "$DB_NAME" ] || die "konfirmasi salah — dibatalkan."
fi

# --- Backup pengaman sebelum restore (opsional tapi disarankan) ------------
if [ "${SKIP_PRE_RESTORE_BACKUP:-false}" != "true" ]; then
  PRE="/opt/rigdaily/backups/pre-restore-$(date +%Y%m%d-%H%M%S).dump"
  log "membuat backup pengaman sebelum restore -> $PRE"
  mkdir -p "$(dirname "$PRE")"
  if docker compose -f "$COMPOSE_FILE" exec -T db \
        pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges -Fc > "$PRE"; then
    log "backup pengaman OK."
  else
    die "backup pengaman gagal — restore DIBATALKAN demi keamanan."
  fi
fi

# --- Restore ---------------------------------------------------------------
# Pipe file ke stdin container; DATABASE_URL dipakai bila ada, jika tidak
# fallback ke -U/-d dari POSTGRES_USER/DB.
log "menjalankan pg_restore --clean --if-exists ..."
RESTORE_TARGET="${DATABASE_URL:-postgresql://$DB_USER@db:5432/$DB_NAME}"

if docker compose -f "$COMPOSE_FILE" exec -T db \
      pg_restore --clean --if-exists --no-owner --no-privileges \
                 -d "$RESTORE_TARGET" < "$DUMP_FILE"; then
  log "restore SELESAI tanpa error."
else
  # pg_restore bisa mengembalikan non-zero untuk warning non-fatal (mis. role
  # tidak ada dengan --no-owner). Laporkan tapi jangan klaim sukses.
  rc=$?
  die "pg_restore keluar dengan kode $rc. Periksa log di atas (beberapa warning
  dapat diabaikan, tapi bila ada 'error:' data mungkin tidak lengkap)."
fi

# --- Petunjuk pasca-restore ------------------------------------------------
echo "------------------------------------------------------------"
echo " RESTORE SELESAI"
echo "  selanjutnya:"
echo "   1) docker compose -f $COMPOSE_FILE restart web"
echo "   2) curl -fsS https://<domain>/api/health   # harapkan {\"status\":\"ok\"}"
echo "   3) login & spot-check 1 DDR"
echo "------------------------------------------------------------"
