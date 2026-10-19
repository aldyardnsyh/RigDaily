<#
.SYNOPSIS
    Build image RigDaily di laptop, kirim ke VPS Lighthouse, lalu rollout.

.DESCRIPTION
    VPS target hanya 2 vCPU / ~2 GB RAM -> `next build` di VPS akan OOM.
    Karena itu seluruh build dilakukan di MESIN LOKAL, hasilnya disimpan sebagai
    image, lalu dikirim ke VPS lewat `docker save | gzip` + `scp`.

    Alur:
      1. Build Next.js lokal dengan NEXT_OUTPUT=standalone.
      2. docker build -t rigdaily-web:<Tag> .
      3. docker save rigdaily-web:<Tag> | gzip > rigdaily-web-<Tag>.tar.gz
      4. scp arsip + docker-compose.prod.yml + Caddyfile + postgres.conf ke VPS.
      5. ssh -> docker load, set IMAGE_TAG di .env, docker compose up -d.

.PARAMETER Tag
    Tag image / versi rilis. Default: timestamp UTC.

.PARAMETER VpsHost
    IP publik atau hostname VPS.

.PARAMETER User
    User SSH di VPS (dibuat oleh setup-vps.sh). Default: rigdaily.

.PARAMETER RemoteDir
    Direktori aplikasi di VPS. Default: /opt/rigdaily.

.PARAMETER SkipBuild
    Lewati `npm run build` lokal (pakai .next yang sudah ada).

.PARAMETER SkipPush
    Hanya build image lokal, jangan kirim ke VPS.

.EXAMPLE
    infra\scripts\deploy.ps1 -Tag v1.0.0 -VpsHost 203.0.113.10 -User rigdaily
#>
[CmdletBinding()]
param(
    [string]$Tag = (Get-Date -AsUTC -Format 'yyyyMMdd-HHmmss'),
    [Parameter(Mandatory = $true)][string]$VpsHost,
    [string]$User = 'rigdaily',
    [string]$RemoteDir = '/opt/rigdaily',
    [switch]$SkipBuild,
    [switch]$SkipPush
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# --- Helper output -----------------------------------------------------------
function Write-Step($msg) { Write-Host "[deploy] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[deploy] OK  $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[deploy] WARN $msg" -ForegroundColor Yellow }

# --- 0. Konteks --------------------------------------------------------------
$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Push-Location $RepoRoot
try {
    $ImageName   = 'rigdaily-web'
    $ImageRef    = "$ImageName`:$Tag"
    $ArchiveName = "$ImageName-$Tag.tar.gz"
    $ArchivePath = Join-Path $RepoRoot $ArchiveName
    $Remote      = "$User@$VpsHost"

    Write-Step "repo root : $RepoRoot"
    Write-Step "image ref : $ImageRef"
    Write-Step "target    : $Remote ($RemoteDir)"

    # Sanity: tool yang dibutuhkan harus ada.
    foreach ($tool in @('docker', 'ssh', 'scp')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
            throw "perintah '$tool' tidak ditemukan di PATH."
        }
    }

    # --- 1. Build Next.js lokal (standalone) --------------------------------
    if (-not $SkipBuild) {
        Write-Step "1/5 build Next.js lokal (NEXT_OUTPUT=standalone)..."
        # Env di-set eksplisit supaya output standalone terbentuk walau shell
        # pengguna belum menyetelnya. next.config.js membaca NEXT_OUTPUT.
        $env:NEXT_OUTPUT = 'standalone'
        $env:NODE_ENV    = 'production'
        $env:NEXT_TELEMETRY_DISABLED = '1'

        npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build gagal (exit $LASTEXITCODE)." }

        if (-not (Test-Path 'apps/web/.next/standalone/server.js')) {
            throw "standalone output tidak ada. Pastikan NEXT_OUTPUT=standalone dan build sukses."
        }
        Write-Ok "build lokal selesai."
    } else {
        Write-Warn "SkipBuild: memakai .next yang sudah ada."
    }

    # --- 2. Build image Docker ----------------------------------------------
    Write-Step "2/5 docker build -> $ImageRef ..."
    docker build -t $ImageRef .
    if ($LASTEXITCODE -ne 0) { throw "docker build gagal (exit $LASTEXITCODE)." }

    $size = docker image inspect $ImageRef --format '{{.Size}}'
    if ($size) {
        $mb = [math]::Round([int64]$size / 1MB, 1)
        Write-Ok "image dibuat: $mb MB."
        if ($mb -gt 400) { Write-Warn "image > 400 MB — target < 400 MB. Cek .dockerignore." }
    }

    if ($SkipPush) {
        Write-Ok "SkipPush: berhenti setelah build image ($ImageRef)."
        return
    }

    # --- 3. Simpan image + gzip ---------------------------------------------
    Write-Step "3/5 docker save | gzip -> $ArchiveName ..."
    # PowerShell tidak mendukung pipe biner antar-proses dengan andal; tulis
    # tar mentah dulu, lalu kompres dengan gzip stream .NET.
    $tarPath = Join-Path $RepoRoot "$ImageName-$Tag.tar"
    docker save -o $tarPath $ImageRef
    if ($LASTEXITCODE -ne 0) { throw "docker save gagal." }

    $in  = [System.IO.File]::OpenRead($tarPath)
    $out = [System.IO.File]::Create($ArchivePath)
    try {
        $gz = New-Object System.IO.Compression.GZipStream($out, [System.IO.Compression.CompressionLevel]::Fastest)
        try { $in.CopyTo($gz) } finally { $gz.Dispose() }
    } finally {
        $in.Dispose(); $out.Dispose(); Remove-Item $tarPath -Force
    }
    $archiveMb = [math]::Round((Get-Item $ArchivePath).Length / 1MB, 1)
    Write-Ok "arsip dibuat: $ArchiveName ($archiveMb MB)."

    # --- 4. Kirim ke VPS -----------------------------------------------------
    Write-Step "4/5 scp arsip + konfigurasi ke $Remote ..."
    # Pastikan direktori remote ada (dependensi: user & /opt/rigdaily dari setup-vps.sh).
    ssh $Remote "mkdir -p $RemoteDir/infra/caddy $RemoteDir/infra/docker $RemoteDir/backups"
    if ($LASTEXITCODE -ne 0) { throw "ssh gagal (cek kunci SSH / host)." }

    scp $ArchivePath "${Remote}:$RemoteDir/"
    if ($LASTEXITCODE -ne 0) { throw "scp arsip gagal." }

    # Konfigurasi pendamping ikut disinkronkan agar compose di VPS cocok dengan image.
    scp 'docker-compose.prod.yml' "${Remote}:$RemoteDir/"
    scp 'infra/caddy/Caddyfile'          "${Remote}:$RemoteDir/infra/caddy/"
    scp 'infra/docker/postgres.conf'     "${Remote}:$RemoteDir/infra/docker/"
    scp 'infra/docker/entrypoint.sh'     "${Remote}:$RemoteDir/infra/docker/"
    scp 'infra/scripts/backup.sh'        "${Remote}:$RemoteDir/infra/scripts/backup.sh"
    scp 'infra/scripts/restore.sh'       "${Remote}:$RemoteDir/infra/scripts/restore.sh"
    if ($LASTEXITCODE -ne 0) { throw "scp konfigurasi gagal." }
    Write-Ok "arsip & konfigurasi terkirim."

    # --- 5. Muat image & rollout di VPS -------------------------------------
    Write-Step "5/5 docker load + rollout di VPS ..."
    $remoteCmd = @"
set -euo pipefail
cd '$RemoteDir'
gzip -dc '$ArchiveName' | docker load
# Set/ubah IMAGE_TAG di .env (idempotent: replace atau append).
if grep -q '^IMAGE_TAG=' .env 2>/dev/null; then
  sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=$ImageRef/' .env
else
  echo 'IMAGE_TAG=$ImageRef' >> .env
fi
docker compose -f docker-compose.prod.yml --env-file .env up -d
rm -f '$ArchiveName'
echo '--- status ---'
docker compose -f docker-compose.prod.yml ps
"@
    # Pipe skrip ke bash remote agar tidak perlu file sementara.
    $remoteCmd | ssh $Remote 'bash -s'
    if ($LASTEXITCODE -ne 0) { throw "rollout di VPS gagal." }

    Write-Ok "rollout selesai: $ImageRef"
    Write-Step "verifikasi: ssh $Remote `"curl -fsS http://127.0.0.1:3000/api/health || docker compose -f $RemoteDir/docker-compose.prod.yml logs --tail=50 web`""
}
finally {
    Pop-Location
}
