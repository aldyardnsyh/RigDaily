# @rigdaily/desktop - Terminal DDR Rig (Offline-First)

Aplikasi Electron untuk terminal di rig. Menyimpan DDR (Daily Drilling Report) **lokal di
SQLite**, mengantre semua perubahan di **outbox**, lalu mengirimkannya ke server kantor saat
ada sinyal. Aplikasi tetap bisa dipakai penuh walau jaringan putus berhari-hari.

- Arsitektur & aturan angka: `docs/KONTRAK-FROZEN.md`
- Primitif sync (hash, backoff, indikator): `packages/shared/src/sync.ts` (frozen)
- Endpoint server yang dipakai: `apps/web/app/api/sync/push` dan `/pull`

---

## 1. Instalasi

Dependency desktop **tidak ikut terpasang** saat `npm install` di root (Electron ~250 MB,
`better-sqlite3` butuh native build). Pasang khusus workspace ini:

```powershell
# di root repo
npm install --workspace=@rigdaily/desktop
```

> Jangan menjalankan `npm install` biasa di root hanya untuk desktop - lockfile root dipakai
> bersama `@rigdaily/web`. Selalu pakai flag `--workspace`.

### `better-sqlite3` butuh rebuild native

`better-sqlite3` adalah modul native (C++). Binary dari npm dibuat untuk Node, **bukan**
untuk ABI Electron, sehingga wajib di-rebuild:

```powershell
# di apps/desktop
npx electron-rebuild -f -w better-sqlite3
```

Butuh:
- **Windows:** Visual Studio Build Tools (workload "Desktop development with C++") + Python 3.
- Alternatif tanpa compiler: `npm install better-sqlite3 --build-from-source=false` lalu
  jalankan `electron-rebuild` (mengunduh prebuild bila tersedia untuk versi Electron tsb).

Gejala lupa rebuild (pesan khas saat app start):

```
Error: The module '...\better_sqlite3.node' was compiled against a different Node.js version
using NODE_MODULE_VERSION 115. This version of Node.js requires NODE_MODULE_VERSION 123.
```

Kalau muncul pesan itu: jalankan `electron-rebuild` sekali, lalu `npm start` kembali.

---

## 2. Menjalankan

```powershell
cd apps\desktop
npm run build     # tsc -p tsconfig.json  → dist/
npm start         # build + electron .
```

`npm run typecheck` melakukan pengecekan tipe tanpa menulis file.

Variabel lingkungan opsional:

| Env | Arti |
|---|---|
| `RIGDAILY_URL` | URL yang dimuat window. Menimpa `config.serverUrl` (berguna untuk dev ke `http://localhost:3000`). |

Contoh dev:

```powershell
$env:RIGDAILY_URL="http://localhost:3000"; npm start
```

---

## 3. Build installer Windows

```powershell
cd apps\desktop
npm run dist      # build + electron-builder --win nsis
```

Output: `apps/desktop/release/RigDaily-Internal-0.1.0-x64.exe` (NSIS, x64, one-click = false).

- `electron-builder.yml` → `appId: com.rigdaily.internal`, `asar: true`.
- **Icon opsional.** Bila `build/icon.ico` tidak ada, installer memakai icon default Electron
  dan build tetap sukses. Untuk icon kustom cukup taruh `apps/desktop/build/icon.ico` (256×256).
- `better-sqlite3` di-`asarUnpack` supaya `.node` bisa dimuat dari `app.asar.unpacked`.

---

## 4. Konfigurasi `serverUrl` + `apiKey`

Config disimpan di `<userData>/config.json`:

| Platform | Path |
|---|---|
| Windows | `%APPDATA%\RigDaily Internal\config.json` |
| macOS | `~/Library/Application Support/RigDaily Internal/config.json` |
| Linux | `~/.config/RigDaily Internal/config.json` |

Bentuk file (dibuat otomatis pada start pertama):

```json
{
  "deviceId": "3f6c0f8e-1d0a-4c6e-9a0f-5f0f0f0f0f0f",
  "deviceName": "RIG-TERMINAL-01",
  "serverUrl": "http://localhost:3000",
  "apiKey": "kunci-dari-sync-center",
  "rigId": null
}
```

- `deviceId` dibuat sekali (`crypto.randomUUID()`) dan **jangan diganti** - server memakai
  ID ini untuk mencocokkan baris `sync_devices`. Mengganti `deviceId` = device baru.
- `deviceName` default dari `os.hostname()`.
- `serverUrl` default `http://localhost:3000`. Di rig, isi URL kantor (mis.
  `https://rigdaily.kantor.internal`).
- `apiKey` diambil dari **Sync Center kantor** (menu device → generate key). Nilainya adalah
  kunci mentah; server mencocokkan `sha256Hex(apiKey)` dengan `sync_devices.api_key_hash`.

Cara mengubah tanpa tangan:

1. Di aplikasi, renderer memanggil `window.rigdaily.config.set({ serverUrl, apiKey })`
   (tersedia dari preload; lihat `src/preload.ts`).
2. Atau edit `config.json` saat aplikasi **tertutup**, lalu buka lagi.

Catatan protokol: worker mengirim header **`x-device-key: <apiKey>`** (header yang dibaca
`apps/web/app/api/sync/push`) dan juga `Authorization: Bearer <apiKey>` untuk kompatibilitas
gateway. Endpoint `/api/sync/pull` memerlukan **sesi user** dengan permission `sync:read`,
jadi di deployment yang memakai device key murni, pull akan menghasilkan 401 sampai device
di-provisioning sesi/gateway yang sesuai - push tetap berjalan.

---

## 5. Alur offline → sync

```
[Renderer]                      [Main process]                     [Kantor]
window.rigdaily.reports.save →  IPC zod validate
                                  └─ SATU transaksi SQLite:
                                      1. upsert reports (dirty=1)
                                      2. replace time_rows
                                      3. outbox += daily_report (create/update)
                                      4. outbox += time_breakdown (bila grid berubah)
                                                                        │
SyncWorker tiap 60 dtk / "Sync Now":                                    │
  pending = listPendingOutbox(100)                                      │
  POST /api/sync/push ──────────────────────────────────────────────►  ack/conflict/rejected
  GET  /api/sync/pull?since=lastPulledAt ───────────────────────────►  delta perubahan
  simpan meta.lastPulledAt = serverTime                                 │
```

**Yang dijamin:**

1. **Atomik.** Data lokal dan baris outbox selalu ditulis dalam satu transaksi SQLite. Tidak
   mungkin ada laporan yang tersimpan tapi tidak pernah terkirim (atau sebaliknya).
2. **Idempoten.** Setiap mutation punya `clientMutationId` (UUID). Server mencatatnya; kiriman
   ulang setelah timeout tidak menggandakan data.
3. **Offline = normal.** Semua panggilan jaringan dibungkus try/catch + timeout 20 detik.
   Kegagalan hanya menaikkan `retry_count` dan mengatur jadwal retry (`backoffForRetry`:
   5s → 15s → 45s → 135s → 405s). Setelah retry ke-5, mutation pindah ke `dead_letter`.
4. **Tidak ada auto-overwrite.** Ack `conflict` (DDR sudah `approved/distributed/locked` di
   server dan versi server lebih baru) hanya menandai outbox `conflict`. Penyelesaian dilakukan
   **manual** oleh Company Man di Sync Center kantor - aplikasi rig tidak pernah menimpa
   laporan terkunci.
5. **Pull tidak menimpa kerja rig.** Report lokal dengan `dirty = 1` tidak ditimpa hasil pull;
   kejadian tersebut dihitung sebagai konflik lokal di `SyncState.conflicts`.

**Indikator 3 warna** (`syncIndicator` dari `@rigdaily/shared`):

| Warna | Arti |
|---|---|
| 🟢 `green` | Semua terkirim, server terjangkau |
| 🟠 `amber` | Offline, atau masih ada item pending |
| 🔴 `red` | Ada item gagal/dead-letter, atau error sync terakhir |

### Fallback halaman offline

Saat start, window memuat `RIGDAILY_URL ?? config.serverUrl`. Bila gagal (`did-fail-load`,
bukan `ERR_ABORTED`), aplikasi memuat `offline.html` - halaman statis lokal berisi:

- status offline + indikator dari `window.rigdaily.sync.onState`,
- tombol **Sync Now** → `window.rigdaily.sync.run()`,
- tombol **Export Backup**,
- tabel draft/laporan lokal (`window.rigdaily.reports.list()` + statistik outbox).

Halaman ini memakai token warna yang sama dengan `packages/ui/tokens.css`.

---

## 6. Backup bundle (`.json.gz`)

Bukan ZIP. Kontrak melarang menambah dependency, jadi backup memakai `node:zlib`:

```
<userData>/backups/rigdaily-2026-09-14T031500Z.json.gz
```

Isi (JSON di dalam gzip):

```json
{
  "format": "rigdaily-backup",
  "formatVersion": 1,
  "exportedAt": "2026-09-14T03:15:00.000Z",
  "deviceId": "...",
  "config": { "...": "..." },
  "reports": [ ],
  "timeRows": [ ],
  "outbox": [ ]
}
```

- **Otomatis:** saat start, bila `meta.lastBackupAt` lebih tua dari 24 jam, bundle ditulis ke
  `userData/backups/`. Retensi: 14 file terbaru.
- **Manual export:** menu `File → Export Backup Bundle...` atau `window.rigdaily.backup.export()`.
  Dialog Save menyimpan dengan ekstensi `.json.gz`.
- **Import/restore:** `window.rigdaily.backup.import()` → pilih file → isi dipulihkan
  (`reports` + `time_rows` di-upsert, `outbox` di-`INSERT OR IGNORE` berdasarkan
  `client_mutation_id`, jadi tidak ada mutation dobel). Tersedia juga secara programatik:
  `importBackupBundle(path)` di `src/backup.ts`.

Restore adalah jalur pemulihan darurat (mis. profile Electron rusak). Setelah restore,
lakukan **Sync Now** untuk menyelaraskan lagi dengan kantor.

---

## 7. Struktur file

```
apps/desktop/
  package.json          @rigdaily/desktop, main = dist/main.js
  tsconfig.json         ES2022 / CommonJS / strict / outDir dist
  electron-builder.yml  NSIS x64, asar + asarUnpack better-sqlite3
  offline.html          fallback UI saat server tidak terjangkau
  .gitignore
  src/
    main.ts             lifecycle, window, menu, backup harian, offline fallback
    preload.ts          contextBridge → window.rigdaily (tanpa nodeIntegration)
    ipc.ts              ipcMain.handle + validasi zod semua argumen
    db.ts               SQLite: reports / time_rows / outbox / meta
    sync-worker.ts      push → ack → pull, backoff, indikator
    backup.ts           bundle .json.gz export/import + retensi
    config.ts           config.json (deviceId stabil)
    types.ts            LocalReport, OutboxItem, SyncState, RigDailyApi, ...
    shims.d.ts          deklarasi fallback electron / better-sqlite3
```

### Skema SQLite lokal

| Tabel | Isi |
|---|---|
| `reports` | header DDR (`local_id` PK, `server_id`, `dirty`) |
| `time_rows` | grid 24 jam (`duration_min`, `time_class` dihitung `@rigdaily/shared`) |
| `outbox` | antrean mutation (`client_mutation_id` UNIQUE, `hash`, `retry_count`, `status`) |
| `meta` | key/value: `lastPulledAt`, `lastBackupAt` |

Pragma: `journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`.

### Channel IPC

| Channel | Fungsi |
|---|---|
| `db:reports:list` | `listLocalReports()` |
| `db:reports:get` | `{ localId }` → report + timeRows |
| `db:reports:save` | `{ report, timeRows }` → simpan + outbox (satu transaksi) |
| `db:reports:delete` | `{ localId }` → hapus lokal + outbox delete |
| `outbox:pending` | `listPendingOutbox(limit)` |
| `outbox:stats` | hitungan per status |
| `sync:run` | jalankan satu siklus push+pull |
| `sync:state` | `SyncState` terkini |
| `config:get` / `config:set` | baca/tulis config |
| `backup:export` / `backup:import` | bundle `.json.gz` via dialog |
| `app:info` | `{ version, deviceId, dbPath, userData }` |

---

## 8. Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| `Cannot find module 'better-sqlite3'` | Belum `npm install --workspace=@rigdaily/desktop`. |
| `NODE_MODULE_VERSION` mismatch | `npx electron-rebuild -f -w better-sqlite3`. |
| Indikator merah `push HTTP 401` | `apiKey` kosong/salah. Isi dari Sync Center; `deviceId` harus sama dengan device pemilik key. |
| Indikator merah `pull HTTP 401` | Pull butuh sesi user (`sync:read`). Lihat catatan §4. |
| Item `dead_letter` | Mutation ditolak server (mis. `PAYLOAD_HASH_MISMATCH`, validasi 422). Perbaiki data di rig lalu simpan ulang - mutation baru akan dibuat. |
| Blank window saat server mati | Seharusnya jatuh ke `offline.html`; cek konsol main (`Tampilan → Developer Tools`). |
| Ingin reset total (hapus data lokal) | Tutup app, hapus `<userData>\app.db*` **setelah** membuat backup bundle. `deviceId` di `config.json` tetap. |
