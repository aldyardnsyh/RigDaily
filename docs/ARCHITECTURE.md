# Arsitektur RigDaily — Modular Monolith

> Dokumen ini menjelaskan bentuk arsitektur yang dipakai, aturan yang mengikatnya,
> dan kapan bentuk ini boleh ditinggalkan. Ditulis untuk dibaca calon klien,
> auditor, dan maintainer baru — bukan untuk mengesankan, melainkan untuk jujur.

## 1. Bentuk yang dipakai

**Modular monolith dalam satu monorepo npm workspaces**, satu database PostgreSQL,
satu deployment Next.js. Bukan microservices.

```
rimbase-rebuild/
├── apps/web/              # Satu-satunya aplikasi (Next.js 14 App Router)
├── packages/shared/       # Kontrak + kalkulasi murni (zod, IADC, biaya, waktu)
├── packages/database/     # Skema + migrasi + seed (Drizzle ORM)
├── packages/ui/           # Komponen presentasi + design token
├── scripts/check-deps.mjs # Penjaga batas antar package
└── tests/ e2e/            # Vitest (unit) + Playwright (E2E)
```

Aliran dependensi satu arah, tanpa siklus:

```
apps/web ──> packages/ui ──> (tidak boleh ke mana pun)
    │              ╳
    ├──────> packages/shared <── packages/database
    └──────> packages/database ──> packages/shared
```

Dibaca: aplikasi boleh memakai ketiganya; database hanya boleh memakai shared;
shared dan ui tidak boleh memakai package internal apa pun.

## 2. Aturan batas (mengikat)

Aturan di atas bukan imbauan — diperiksa mesin setiap kali `verify` jalan:

```bash
npm run deps:check   # gagal (exit 1) bila ada import terlarang
npm run verify       # deps:check + typecheck + test + build
```

Yang dilarang:

1. `packages/shared` mengimpor `@rigdaily/*` apa pun.
2. `packages/ui` mengimpor `@rigdaily/*` apa pun.
3. `packages/database` mengimpor selain `@rigdaily/shared`.
4. Import relatif yang keluar dari package sendiri (`../../packages/...`) —
   semua komunikasi antar package wajib lewat barrel export (`@rigdaily/...`).

Pelanggaran = build merah. Tidak ada pengecualian diam-diam.

## 3. Kenapa bukan microservices (saat ini)

| Pertimbangan | Status |
|---|---|
| Beban operasional | Satu deploy Vercel, satu database. Microservices menggandakan pipeline, observability, dan on-call tanpa manfaat yang terbayar. |
| Transaksi | "Approve DDR + catat audit + kunci laporan" hari ini satu transaksi Postgres. Dipecah jadi service, berubah menjadi saga terdistribusi. |
| Batas domain | Batas yang stabil belum terbukti dari beban nyata. Memecah berdasarkan tebakan hampir selalu salah dan mahal dibetulkan. |
| Ukuran tim | Satu tim kecil. Microservices baru terbayar saat 3+ tim saling memblokir ritme deploy. |

## 4. Pemicu migrasi yang sah

Migrasi ke service terpisah dibenarkan bila **salah satu** kondisi ini terukur,
bukan karena "nanti kalau besar":

1. **Beban baca ekstrem** — dashboard dibaca 100x lebih sering daripada DDR ditulis.
   Respons: pisahkan read model, bukan seluruh aplikasi.
2. **Beban kerja asing** — ekspor PDF berat memperlambat API interaktif.
   Respons: pisahkan worker PDF (stateless, antrean jelas). Kandidat pertama.
3. **Tabrakan tim** — 3+ tim deploy tiap hari dan saling blokir.
   Respons: pisahkan per domain yang bertabrakan.
4. **Isolasi kegagalan** — sync rig tidak boleh ikut mati saat billing deploy.
   Respons: pisahkan jalur sync.

Pecahnya selalu **vertikal per kemampuan** (PDF worker, sync service), tidak pernah
horizontal per layer ("auth service", "database service").

## 5. Yang belum ada (jujur)

- Tidak ada service discovery, message broker, atau distributed tracing —
  karena memang belum dibutuhkan.
- Tidak ada multi-region atau failover otomatis. Database tunggal PostgreSQL.
- Mode demo memakai PGlite in-memory: data hilang saat instance mati.
  Itu disengaja (data contoh), bukan ketahanan produksi.
