# Starter packages/ui - Cara Pakai (2 menit)

Hasil export Figma/Stitch Anda tinggal ditempel ke token yang sudah dikunci di `../packages/ui/tokens.css`.

## 1. Copy ke proyek Next.js asli

```
rimbase-rebuild/
  packages/ui/  <- copy folder ini utuh
  apps/web/
    app/globals.css  <- copy dari apps/web-example/globals.css
    tailwind.config.js <- copy dari apps/web-example/tailwind.config.js
```

Install: `npm i -D tailwindcss postcss autoprefixer` lalu `npx tailwindcss init -p` dan timpa config dengan contoh.

## 2. Pakai komponen

```tsx
import '@rigdaily/ui/tokens.css';
import { Button, Field, Badge, Card, KpiCard, TimeGrid } from '@rigdaily/ui';

<Button>Submit for Approval</Button>
<Badge kind="Approved">Approved</Badge>
<Field label="Mud Weight" placeholder="12.4 ppg" />
```

## 3. Samakan dengan Figma

- Jika di Figma ada warna geser 1-2 shade, yang menang = `tokens.css` ini (sudah sesuai Prompt 0).
- Jangan tambah hex baru. Kalau butuh varian, tambah sebagai `--nama-baru` di tokens.css + daftarkan di preset.
- Font wajib Inter. Angka wajib class `tnum` atau komponen KpiCard/TimeGrid (sudah tabular).
- Sidebar 264px navy #0F2A44, topbar 64px putih, cards radius 10px, input/button 40px (44px mode sarung tangan).

## 4. Checklist sebelum coding layar 1-15

- [ ] globals.css di-import sekali di root layout
- [ ] Semua layar pakai Card/Button/Badge dari ui, bukan style inline
- [ ] TimeGrid total 1440 menit + NPT rose tint muncul
- [ ] Print DDR pakai class `print-sheet` + `no-print` untuk sidebar

> File ini + tokens.css = jembatan Stitch → Next.js + Electron (File 06). Simpan export Figma di `../../lampiran/stitch/`.
