# RigDaily — Pelaporan Operasi Sumur Harian

DDR (Daily Drilling Report), time breakdown 24 jam, NPT, biaya dan AFE, billing,
personel, marine, safety, dan sinkronisasi rig ke kantor — dalam satu aplikasi web.

Hak cipta (c) 2026 PogungSoftwareHouseTeam (PSHT). Seluruh hak dilindungi.

## Status

Aplikasi internal yang sedang dikembangkan aktif. Mode demo tersedia untuk
evaluasi tanpa instalasi database: data contoh dimuat otomatis dan bisa direset.

## Tech stack (terverifikasi dari `package.json` dan `node_modules`)

| Lapisan | Teknologi | Versi terpasang |
|---|---|---|
| Framework | Next.js App Router | 14.2.35 |
| UI runtime | React | 18.3.1 |
| Bahasa | TypeScript | 5.5.4 |
| Database produksi | PostgreSQL + Drizzle ORM | pg 8.23.1, drizzle-orm 0.33.0 |
| Database demo | PGlite in-memory | 0.2.17 |
| Validasi | Zod | 3.25.76 |
| Styling | Tailwind CSS 3 + design token sendiri | 3.4.7 |
| PDF | pdfkit (server-side) | 0.15.2 |
| Auth | Sesi cookie + JWT (`jose`) | 5.10.0 |
| Monorepo | npm workspaces (`apps/*`, `packages/*`) | — |
| Unit test | Vitest, 360 test | 2.1.9 |
| E2E test | Playwright + browser-qa | 1.64.1 |
| Deploy | Vercel (build `next build`) | — |

Yang **sengaja tidak** dipakai: pnpm, Turborepo, Docker untuk aplikasi (hanya
untuk Postgres lokal via `infra/docker`), Google Fonts (font sistem agar build
tidak bergantung jaringan), dan Electron (masih rencana di blueprint, belum ada
kode — jadi tidak diklaim).

## Struktur

```
apps/web/              # Aplikasi Next.js (satu-satunya aplikasi)
packages/shared/       # Kontrak + kalkulasi murni (tidak boleh import internal lain)
packages/database/     # Skema, migrasi, seed (hanya boleh import shared)
packages/ui/           # Komponen presentasi + token (tidak boleh import internal lain)
scripts/check-deps.mjs # Penjaga batas antar package
```

Arsitektur: **modular monolith**. Alasan, aturan, dan pemicu migrasi yang sah
didokumentasikan di [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — bukan di sini
supaya README tetap ringkas.

## Menjalankan

```bash
# Prasyarat: Node.js >= 22
npm install

# Opsi A: Postgres lokal (Docker)
npm run pg:up && npm run db:migrate && npm run db:seed

# Opsi B: mode demo tanpa database (PGlite in-memory)
# kosongkan DATABASE_URL, lalu set RIGDAILY_DEMO=1

npm run dev        # pengembangan
npm run verify     # deps:check + typecheck + test + build
npm test           # unit (Vitest)
npm run e2e        # end-to-end (Playwright, butuh server + database)
```

## SEO dan indeksasi

Hanya halaman depan publik (`/`) yang boleh diindeks: `app/robots.ts`,
`app/sitemap.ts`, metadata Open Graph, dan JSON-LD `SoftwareApplication`.
Seluruh area aplikasi (`/login`, `/dashboard`, dst) memakai `noindex`.
Set `NEXT_PUBLIC_SITE_URL` ke domain produksi agar sitemap valid.
