#!/usr/bin/env bash
# ============================================================================
# setup-vps.sh — bootstrap VPS Tencent Lighthouse (Ubuntu 22.04 / 24.04)
#
# MENGAPA SCRIPT INI ADA:
#   RigDaily menyasar VPS 2 vCPU / 2 GB RAM. Tanpa swap, `docker compose up`
#   saat DB sedang checkpoint/besar bisa memicu OOM-killer membunuh proses.
#   Swap 2 GB adalah JARING PENGAMAN, bukan pengganti RAM.
#
# YANG DILAKUKAN:
#   1. Cek OS & hak root.
#   2. Swap 2 GB + sysctl tuning (vm.swappiness rendah).
#   3. Timezone Asia/Jakarta.
#   4. Install Docker Engine + compose plugin (repo resmi Docker).
#   5. Buat user non-root `rigdaily` (anggota grup docker) + direktori /opt/rigdaily.
#   6. Firewall ufw: buka 22/80/443 (3000 & 5432 TETAP TERTUTUP).
#   7. Logrotate untuk log aplikasi & docker.
#
# IDEMPOTENT: aman dijalankan ulang (cek sebelum menulis/mengubah).
# Jalankan sebagai root:  sudo bash infra/scripts/setup-vps.sh
# ============================================================================
set -euo pipefail

log()  { printf '\033[1;32m[setup]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n'  "$*"; }
die()  { printf '\033[1;31m[fatal]\033[0m %s\n' "$*" >&2; exit 1; }

# --- 0. Pra-syarat ----------------------------------------------------------
[ "$(id -u)" -eq 0 ] || die "jalankan sebagai root (sudo)."
command -v apt-get >/dev/null || die "script ini untuk Ubuntu/Debian (apt)."

DEPLOY_USER="${DEPLOY_USER:-rigdaily}"
APP_DIR="/opt/rigdaily"
SWAP_SIZE="${SWAP_SIZE:-2G}"

if [ -f /etc/os-release ]; then
  . /etc/os-release
  log "OS terdeteksi: ${PRETTY_NAME:-unknown}"
fi

# --- 1. Paket dasar ---------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
log "apt update & paket dasar..."
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg lsb-release ufw logrotate tzdata cron

# --- 2. Swap 2 GB (WAJIB untuk RAM 2 GB) ------------------------------------
# swappiness=10 -> OS memakai RAM dulu, swap hanya saat tertekan.
if swapon --show | grep -q '/swapfile'; then
  log "swapfile sudah aktif — dilewati."
else
  if [ ! -f /swapfile ]; then
    log "membuat swapfile ${SWAP_SIZE}..."
    fallocate -l "$SWAP_SIZE" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  log "swap aktif: $(swapon --show --noheadings | tr -s ' ')"
fi

# --- 3. sysctl tuning -------------------------------------------------------
# vm.swappiness=10         : hindari swap agresif (DB lebih baik di RAM).
# vm.overcommit_memory=1   : hindari "fork failed" saat npm/docker sibuk.
# net.core.somaxconn=1024  : backlog koneksi cukup untuk Caddy.
# fs.file-max              : cukup untuk banyak koneksi DB + file log.
cat > /etc/sysctl.d/99-rigdaily.conf <<'EOF'
vm.swappiness = 10
vm.overcommit_memory = 1
vm.vfs_cache_pressure = 50
net.core.somaxconn = 1024
fs.file-max = 65536
EOF
sysctl --system >/dev/null
log "sysctl tuning diterapkan."

# --- 4. Timezone ------------------------------------------------------------
timedatectl set-timezone Asia/Jakarta 2>/dev/null || ln -sf /usr/share/zoneinfo/Asia/Jakarta /etc/localtime
log "timezone: $(timedatectl show -p Timezone --value 2>/dev/null || date +%Z)"

# --- 5. Docker Engine + compose plugin (repo resmi) -------------------------
if command -v docker >/dev/null 2>&1; then
  log "docker sudah terpasang ($(docker --version)) — dilewati."
else
  log "install Docker Engine + compose plugin..."
  install -m 0755 -d /etc/apt/keyrings
  if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
  fi
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi
docker compose version >/dev/null 2>&1 || die "docker compose plugin tidak tersedia."
log "docker compose: $(docker compose version --short 2>/dev/null || echo ok)"

# --- 6. User deploy + direktori aplikasi ------------------------------------
if id "$DEPLOY_USER" >/dev/null 2>&1; then
  log "user '$DEPLOY_USER' sudah ada — dilewati."
else
  log "membuat user '$DEPLOY_USER'..."
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER" || true

mkdir -p "$APP_DIR"/backups "$APP_DIR"/data
chown -R "$DEPLOY_USER":"$DEPLOY_USER" "$APP_DIR"
chmod 750 "$APP_DIR"
log "direktori aplikasi: $APP_DIR (owner $DEPLOY_USER)."

# --- 7. Firewall ufw --------------------------------------------------------
# Hanya 22/80/443. Port 3000 (web) & 5432 (db) TIDAK dibuka ke internet —
# Caddy yang menjembatani, DB hanya di network internal Docker.
log "konfigurasi ufw..."
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp   comment 'SSH'      >/dev/null
ufw allow 80/tcp   comment 'HTTP'     >/dev/null
ufw allow 443/tcp  comment 'HTTPS'    >/dev/null
ufw allow 443/udp  comment 'HTTP/3'   >/dev/null
ufw --force enable >/dev/null
log "ufw aktif: $(ufw status | grep -cE 'ALLOW|LIMIT') aturan."

# --- 8. Logrotate -----------------------------------------------------------
# Docker json-file sudah dirotasi per-container (max-size/max-file), tapi ini
# menjaga log sistem & file aplikasi di /opt/rigdaily/logs.
cat > /etc/logrotate.d/rigdaily <<'EOF'
/opt/rigdaily/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
EOF
mkdir -p "$APP_DIR/logs" && chown "$DEPLOY_USER":"$DEPLOY_USER" "$APP_DIR/logs"
log "logrotate /etc/logrotate.d/rigdaily dipasang."

# --- Ringkasan --------------------------------------------------------------
echo
log "SELESAI. Ringkasan:"
echo "  swap      : $(swapon --show --noheadings | awk '{print $3}' | tr -d '\n' || echo '-')"
echo "  RAM       : $(free -h | awk '/^Mem:/{print $2}')"
echo "  user      : $DEPLOY_USER (grup docker)"
echo "  app dir   : $APP_DIR"
echo "  port buka : 22 / 80 / 443"
echo
warn "Langkah selanjutnya:"
echo "  1) login ulang sebagai $DEPLOY_USER (agar grup docker aktif), atau 'newgrp docker'."
echo "  2) dari laptop: infra/scripts/deploy.ps1 -Tag v1.0.0 -VpsHost <IP> -User $DEPLOY_USER"
echo "  3) di VPS: cp .env.example .env  lalu isi  (lihat docs/deploy/README.md)."
