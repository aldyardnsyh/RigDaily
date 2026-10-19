# syntax=docker/dockerfile:1.7
# ============================================================================
# RigDaily — Dockerfile produksi (multi-stage)
#
# TARGET: Tencent Cloud Lighthouse VPS 2 vCPU / ~2 GB RAM / 40 GB disk.
#
# KEPUTUSAN ARSITEKTUR (kenapa begini):
#   1. `next build` DILARANG dijalankan di VPS (2 vCPU + 2 GB -> OOM tanpa swap).
#      Image di-build di LAPTOP / CI lalu dikirim lewat `docker save` + `scp`
#      (lihat infra/scripts/deploy.ps1). Karena itu Dockerfile ini dioptimalkan
#      untuk build LOKAL yang cepat, bukan build di VPS.
#   2. Output Next.js memakai `output: 'standalone'` (diaktifkan env
#      NEXT_OUTPUT=standalone, sudah dibaca apps/web/next.config.js). Runner
#      memakai hasil `.next/standalone` yang SUDAH membundel dependency runtime
#      (next, react, pg, drizzle-orm, pdfkit) -> node_modules tidak disalin utuh.
#   3. Migrasi saat container start: paket server (`packages/database` +
#      `packages/shared`) dikompilasi ke CommonJS biasa di `dist-server/` lewat
#      `tsc -p tsconfig.server.json`. Runner menjalankan
#      `node dist-server/database/src/migrate.js` — tanpa tsx, tanpa esbuild,
#      tanpa dependency npm baru. Detail di docs/deploy/README.md.
#
# Ukuran image akhir ditargetkan < 400 MB (base node:22-alpine ~ 140 MB +
# standalone ~ 120 MB + dist-server < 5 MB).
# ============================================================================

# ---------------------------------------------------------------------------
# ARG global (dapat di-override saat `docker build`)
# ---------------------------------------------------------------------------
ARG NODE_VERSION=22

# ============================================================================
# STAGE 1 — deps: install SEMUA dependency (termasuk devDeps untuk build).
#   Manifest disalin lebih dulu agar cache layer `npm ci` dipakai ulang bila
#   hanya source yang berubah.
# ============================================================================
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
ENV npm_config_update_notifier=false \
    npm_config_fund=false

# Root manifest + lockfile (npm workspaces).
COPY package.json package-lock.json ./
# Manifest tiap workspace (wajib ada sebelum `npm ci` agar workspace ter-link).
COPY packages/shared/package.json   ./packages/shared/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/ui/package.json       ./packages/ui/package.json
COPY apps/web/package.json          ./apps/web/package.json

# `--include=dev` wajib: next/typescript/tailwind adalah devDependency, dan
# tsc untuk dist-server juga devDependency. Ini tahap build, bukan runtime.
RUN npm ci --include=dev --no-audit --no-fund

# ============================================================================
# STAGE 2 — builder: compile Next.js standalone + script server (dist-server).
# ============================================================================
FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /app

# Bawa node_modules hasil stage deps (sudah ter-link sebagai workspace).
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/package-lock.json ./package-lock.json

# Salin source. Direktori paket & app WAJIB ada sebelum `npm run build` karena
# next.config.js memakai `transpilePackages: ['@rigdaily/ui']` dan paket lain
# diekspor sebagai TS mentah (lihat packages/*/package.json -> "main": src/index.ts).
COPY packages ./packages
COPY apps/web ./apps/web
COPY tsconfig.server.json ./tsconfig.server.json

# Standalone output untuk web (next.config.js membaca NEXT_OUTPUT).
ENV NEXT_OUTPUT=standalone \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

# 2a. Build aplikasi web -> apps/web/.next/standalone + .next/static
RUN npm run build --workspace=@rigdaily/web

# 2b. Build script server (migrate/seed) -> dist-server/database/src/*.js + shared/src/*.js
#     CommonJS, dijalankan dengan `node` polos di runner.
RUN npx tsc -p tsconfig.server.json

# 2c. Shim resolusi runtime untuk `@rigdaily/shared`.
#     `paths` di tsconfig hanya memengaruhi resolusi saat compile; kode hasil
#     kompilasi tetap memanggil `require("@rigdaily/shared")`. Tanpa shim, Node
#     akan mencari node_modules/@rigdaily/shared yang (via symlink workspace)
#     menunjuk ke packages/shared/src/index.ts (TypeScript mentah) -> gagal.
#     Shim ini me-re-export hasil kompilasi dist-server/shared/src. Node akan
#     menemukannya dengan menaiki folder dari dist-server/database/src/*.js.
#     TIDAK menambah dependency npm — hanya file JS + package.json kecil.
RUN mkdir -p dist-server/node_modules/@rigdaily/shared \
 && printf '{"name":"@rigdaily/shared","version":"0.1.0","main":"index.js"}' \
      > dist-server/node_modules/@rigdaily/shared/package.json \
 && printf 'module.exports = require("../../../shared/src");' \
      > dist-server/node_modules/@rigdaily/shared/index.js

# ============================================================================
# STAGE 3 — runner: image minimal, non-root, hanya artefak yang dibutuhkan.
# ============================================================================
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=Asia/Jakarta

# `tini` = init kecil (PID 1) yang meneruskan signal & memungut zombie proses.
# Image alpine dasar sudah menyertakan `wget` -> dipakai HEALTHCHECK & entrypoint.
RUN apk add --no-cache tini && \
    addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

# --- Artefak Next.js standalone -------------------------------------------
# LAYOUT (monorepo, DETERMINISTIK): next.config.js menyetel
# `experimental.outputFileTracingRoot = <root repo>` saat NEXT_OUTPUT=standalone,
# sehingga output standalone mempertahankan struktur workspace:
#   .next/standalone/apps/web/server.js
#   .next/standalone/node_modules/...
#   .next/standalone/packages/{shared,database}/...
#   .next/standalone/package.json
# Seluruh tree disalin apa adanya ke /app agar server.js menemukan node_modules
# dan workspace packages di jalur relatif yang benar.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
# Aset statis & publik TIDAK ikut di-trace standalone -> salin manual ke lokasi
# yang diharapkan server (relatif terhadap dir = /app/apps/web).
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

# --- Script server terkompilasi (migrate/seed) ----------------------------
# dist-server/database/src/migrate.js + dist-server/shared/src/*.js (CommonJS)
# + dist-server/node_modules/@rigdaily/shared (shim resolusi runtime).
# Butuh `drizzle-orm`, `pg` (dan `zod` lewat shared) di /app/node_modules —
# sudah tersedia dari standalone trace karena aplikasi web memakainya.
COPY --from=builder --chown=nextjs:nodejs /app/dist-server ./dist-server

# Entrypoint container (tunggu DB -> migrate -> optional seed -> exec server).
COPY --chown=nextjs:nodejs infra/docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# --- Sanity check build-time (gagal cepat, bukan crash di produksi) --------
# Pastikan modul runtime untuk script migrasi benar-benar ada di /app/node_modules
# (hasil trace standalone) DAN server.js ada di layout monorepo yang diharapkan.
RUN test -f /app/apps/web/server.js || (echo '[build] apps/web/server.js tidak ada — layout standalone tidak sesuai harapan' && exit 1)
RUN node -e "for (const m of ['drizzle-orm','pg','zod']) { try { require.resolve(m); } catch { console.error('[build] modul wajib hilang dari standalone trace: '+m); process.exit(1); } } console.log('[build] modul runtime migrasi OK');"

USER nextjs
EXPOSE 3000

# Healthcheck memakai endpoint nyata: GET /api/health (200 = DB ok, 503 = down).
# `wget -qO-` dari BusyBox; gagal (exit != 0) bila status bukan 2xx.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/app/entrypoint.sh"]
