#!/usr/bin/env bash
# ============================================================================
# backup.sh — backup harian PostgreSQL RigDaily (custom-format pg_dump)
#
# - Output: /opt/rigdaily/backups/YYYY-MM-DD.dump   (format -Fc, kompresi)
# - Retensi: BACKUP_RETENTION_DAYS hari (default 14)
# - Verifikasi: file harus ada, ukuran > 1 KB, dan header PGDMP valid.
# - Opsional: ikut mem-backup volume caddy_data (sertifikat TLS) bila ada.
#
# PASANG CRON (sebagai user deploy, mis. rigdaily):
#   crontab -e
#   # tiap hari 02:30 WIB (TZ server Asia/Jakarta)
#   30 2 * * * /opt/rigdaily/infra/scripts/backup.sh >> /opt/rigdaily/logs/backup.log 2>&1
#
# Variabel yang dipakai (dibaca dari env atau .env di /opt/rigdaily):
#   DATABASE_URL              (wajib) koneksi Postgres
#   BACKUP_DIR                (opsional, default /opt/rigdaily/backups)
#   BACKUP_RETENTION_DAYS     (opsional, default 14)
#   BACKUP_CADDY_DATA=true    (opsional) ikut tar volume caddy_data
# ============================================================================
set -euo pipefail

log()  { printf '%s [backup] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die()  { printf '%s [backup] FATAL: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"

# --- Muat .env bila ada (DATABASE_URL dll) ---------------------------------
if [ -z "${DATABASE_URL:-}" ] && [ -f "$APP_DIR/.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "$APP_DIR/.env"; set +a
fi

[ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL kosong. Set di env atau $APP_DIR/.env."

BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date +%F)"                       # YYYY-MM-DD
OUT_FILE="$BACKUP_DIR/$STAMP.dump"

mkdir -p "$BACKUP_DIR"
log "backup dimulai -> $OUT_FILE"

# --- 1. pg_dump (custom format, compressed) --------------------------------
# pg_dump dijalankan DI DALAM container db (tidak perlu install client di host
# dan versi pg_dump selalu sama dengan server). Output ditulis sebagai root
# container -> chown belum perlu karena ditulis ke stdout lalu redirect di host.
COMPOSE_FILE="$APP_DIR/docker-compose.prod.yml"
[ -f "$COMPOSE_FILE" ] || die "tidak menemukan $COMPOSE_FILE."

if ! docker compose -f "$COMPOSE_FILE" exec -T db \
      pg_dump -U "${POSTGRES_USER:-rigdaily}" -d "${POSTGRES_DB:-rigdaily}" \
              --no-owner --no-privileges -Fc > "$OUT_FILE.tmp"; then
  rm -f "$OUT_FILE.tmp"
  die "pg_dump gagal. Cek container db: docker compose -f $COMPOSE_FILE logs db"
fi
mv "$OUT_FILE.tmp" "$OUT_FILE"

# --- 2. Verifikasi ----------------------------------------------------------
[ -s "$OUT_FILE" ] || die "file backup kosong: $OUT_FILE"

SIZE_BYTES="$(stat -c%s "$OUT_FILE")"
if [ "$SIZE_BYTES" -lt 1024 ]; then
  die "file backup terlalu kecil (${SIZE_BYTES} byte) — kemungkinan rusak/DB kosong."
fi
# Header pg_dump custom format adalah 'PGDMP'.
if ! head -c 5 "$OUT_FILE" | grep -q 'PGDMP'; then
  die "header file bukan PGDMP — dump tidak valid: $OUT_FILE"
fi
SHA="$(sha256sum "$OUT_FILE" | awk '{print $1}')"
log "verifikasi OK — $(numfmt --to=iec "$SIZE_BYTES" 2>/dev/null || echo "${SIZE_BYTES}B"), sha256=${SHA:0:16}..."

# --- 3. Backup caddy_data opsional (sertifikat TLS) ------------------------
if [ "${BACKUP_CADDY_DATA:-false}" = "true" ]; then
  CADDY_TAR="$BACKUP_DIR/caddy_data-$STAMP.tar.gz"
  # Volume asli: rigdaily_caddy_data (prefix = nama project compose).
  if docker run --rm -v rigdaily_caddy_data:/data:ro -v "$BACKUP_DIR":/backup \
        alpine sh -c "tar czf /backup/caddy_data-$STAMP.tar.gz -C /data ." 2>/dev/null; then
    log "caddy_data -> $CADDY_TAR"
  else
    log "PERINGATAN: gagal backup caddy_data (lewati, ini tidak fatal)."
  fi
fi

# --- 4. Retensi -------------------------------------------------------------
# Hapus dump harian lebih tua dari RETENTION_DAYS. File tar caddy mengikuti.
DELETED="$(find "$BACKUP_DIR" -maxdepth 1 -name '*.dump' -type f \
             -mtime "+$RETENTION_DAYS" -print -delete | wc -l)"
log "retensi: menghapus $DELETED file lebih tua dari $RETENTION_DAYS hari."

# Jaga minimal 3 salinan terbaru walau retensi kecil.
COUNT="$(find "$BACKUP_DIR" -maxdepth 1 -name '*.dump' -type f | wc -l)"
log "total dump tersimpan: $COUNT file."

# --- 5. Ringkasan -----------------------------------------------------------
echo "------------------------------------------------------------"
echo " BACKUP RINGKASAN"
echo "  tanggal  : $STAMP"
echo "  file     : $OUT_FILE"
echo "  ukuran   : $(numfmt --to=iec "$SIZE_BYTES" 2>/dev/null || echo "${SIZE_BYTES}B")"
echo "  sha256   : $SHA"
echo "  retensi  : $RETENTION_DAYS hari ($COUNT file tersimpan)"
echo "  lokasi   : $BACKUP_DIR"
echo "------------------------------------------------------------"
log "selesai."

# --- 6. Peringatan disk (importan di 40 GB) --------------------------------
DISK_USE="$(df -Pk "$BACKUP_DIR" | awk 'NR==2{print $5}' | tr -d '%')"
if [ "$DISK_USE" -ge 85 ]; then
  log "PERINGATAN: disk terpakai ${DISK_USE}%. Segera pindahkan/bersihkan backup lama."
fi
