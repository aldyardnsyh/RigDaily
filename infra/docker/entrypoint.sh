#!/bin/sh
# ============================================================================
# entrypoint.sh — boot container web RigDaily
#
# URUTAN:
#   1. Tunggu PostgreSQL siap (pg_isready via node, tanpa perlu client psql).
#   2. Jalankan migrasi idempotent + audit konfigurasi driver.
#   3. Seed opsional bila SEED_ON_START=true (HANYA untuk demo pertama).
#   4. exec server Next.js standalone (/app/server.js).
#
# Catatan: dijalankan sebagai PID anak `tini` (lihat ENTRYPOINT Dockerfile),
# jadi `exec` di akhir membuat node menjadi penerima langsung SIGTERM.
# ============================================================================
set -euo pipefail

# --- Helper log (timestamp + level) ----------------------------------------
log()  { printf '%s [entrypoint] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die()  { printf '%s [entrypoint] FATAL: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; exit 1; }

# --- 0. Guard driver ---------------------------------------------------------
# Produksi WAJIB memakai PostgreSQL. Bila DATABASE_URL kosong, client.ts akan
# diam-diam jatuh ke PGlite (file lokal di dalam container) -> data HILANG saat
# container dibuat ulang. Kita hentikan boot agar kesalahan ini tidak senyap.
if [ -z "${DATABASE_URL:-}" ]; then
  die "DATABASE_URL kosong. Produksi wajib PostgreSQL (jangan PGlite). Isi DATABASE_URL di .env."
fi
if [ "${RIGDAILY_DRIVER:-}" = "pglite" ]; then
  die "RIGDAILY_DRIVER=pglite terdeteksi di produksi. Hapus variabel ini dari .env."
fi

DB_WAIT_SECONDS="${DB_WAIT_SECONDS:-90}"
log "menunggu database siap (timeout ${DB_WAIT_SECONDS}s)..."

# --- 1. Tunggu DB -----------------------------------------------------------
# Pakai node + modul `pg` (sudah ada di standalone) untuk SELECT 1. Lebih
# portabel daripada psql (tidak ada di image) maupun nc (tidak ada di distroless
# dasar). Connection string dibaca dari env, tidak di-log.
waited=0
until node -e '
  const { Client } = require("pg");
  const c = new Client({ connectionString: process.env.DATABASE_URL,
                         connectionTimeoutMillis: 3000 });
  c.connect()
    .then(() => c.query("SELECT 1"))
    .then(() => c.end())
    .then(() => process.exit(0))
    .catch(() => { try { c.end(); } catch (e) {} process.exit(1); });
' >/dev/null 2>&1; do
  waited=$((waited + 3))
  if [ "$waited" -ge "$DB_WAIT_SECONDS" ]; then
    die "database tidak siap setelah ${DB_WAIT_SECONDS}s. Cek service 'db' (docker compose logs db)."
  fi
  sleep 3
done
log "database siap."

# --- 2. Migrasi -------------------------------------------------------------
# dist-server/ = hasil `tsc -p tsconfig.server.json` (CommonJS). File entry
# memakai `if (require.main === module)`, jadi menjalankan `node <file>` =
# menjalankan migrate()/seed() lalu process.exit(0|1).
if [ ! -f /app/dist-server/database/src/migrate.js ]; then
  die "dist-server/database/src/migrate.js tidak ada — image rusak. Build ulang dengan Dockerfile terbaru."
fi

log "menjalankan migrasi (idempotent)..."
if ! node /app/dist-server/database/src/migrate.js; then
  die "migrasi gagal. Periksa DATABASE_URL / hak user DB / log di atas."
fi
log "migrasi selesai."

# --- 3. Seed opsional --------------------------------------------------------
# HANYA untuk demo pertama. Setelah data awal ada, set SEED_ON_START=false agar
# tiap restart tidak meng-upsert data demo (idempotent, tapi tetap boros).
if [ "${SEED_ON_START:-false}" = "true" ]; then
  log "SEED_ON_START=true -> menjalankan seed demo..."
  if ! node /app/dist-server/database/src/seed.js; then
    die "seed gagal. Periksa log di atas (SEED_PASSWORD / migrasi)."
  fi
  log "seed selesai. SEGERA ganti password akun default & set SEED_ON_START=false."
else
  log "seed dilewati (SEED_ON_START=${SEED_ON_START:-false})."
fi

# --- 4. Jalankan server ------------------------------------------------------
# Next.js standalone: entry `server.js` ada di root hasil standalone. Dockerfile
# menaruhnya di /app/server.js (tracing root = apps/web -> layout flat). Cek
# lokasi alternatif (/app/apps/web/server.js) sebagai jaring pengaman bila
# konfigurasi tracing root berubah, agar container tetap bisa boot.
SERVER_JS="/app/server.js"
if [ ! -f "$SERVER_JS" ] && [ -f "/app/apps/web/server.js" ]; then
  SERVER_JS="/app/apps/web/server.js"
fi
[ -f "$SERVER_JS" ] || die "server.js tidak ditemukan (cek COPY .next/standalone di Dockerfile)."

log "memulai Next.js standalone ($SERVER_JS) di ${HOSTNAME:-0.0.0.0}:${PORT:-3000}..."
exec node "$SERVER_JS"
