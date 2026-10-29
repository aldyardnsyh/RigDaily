/**
 * Generator ikon RigDaily.
 *
 * Bentuk marka: HELM PROYEK (hard hat) di atas kotak navy. Geometri di sini
 * harus sama dengan `packages/ui/src/components/brand-mark.tsx` dan
 * `apps/web/app/icon.svg`, supaya ikon di tab browser, ikon PWA, dan marka di
 * dalam aplikasi tidak pernah berbeda lagi.
 *
 * Kenapa dibuat sendiri, bukan pakai rasterizer eksternal:
 *  - Tanpa dependensi. PNG ditulis manual dengan zlib bawaan Node, ICO dibungkus
 *    dari PNG (format ICO mendukung PNG tertanam).
 *  - Deterministik dan bisa dijalankan ulang kapan saja tanpa unduhan.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..', 'apps', 'web');

const NAVY = [0x00, 0x6B, 0x5C];
const TEAL = [0xff, 0xff, 0xff];

const BG_R = 12; // sudut membulat ikon
const STROKE = 5.33; // 2 pada grid 24, diskalakan 64/24

/** Jarak titik ke segmen garis. */
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Titik di dalam persegi membulat. */
function inRoundRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return Math.hypot(px - cx, py - cy) <= r;
}

/** Busur lingkaran jadi rangkaian titik. */
function arc(cx, cy, r, fromDeg, toDeg, steps = 28) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((fromDeg + ((toDeg - fromDeg) * i) / steps) * Math.PI) / 180;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/* --- Geometri helm pada grid 64x64 (24 x 2.6667) --- */
const S = 64 / 24;
const HAT_LINES = [
  // kaki kiri kubah
  [
    [4 * S, 12 * S],
    [4 * S, 15 * S],
  ],
  // kaki kanan kubah
  [
    [20 * S, 12 * S],
    [20 * S, 15 * S],
  ],
  // busur kiri: pusat (10,12) r6, 180 -> 270
  arc(10 * S, 12 * S, 6 * S, 180, 270),
  // busur kanan: pusat (14,12) r6, 270 -> 360
  arc(14 * S, 12 * S, 6 * S, 270, 360),
  // tonjolan atas
  [
    [10 * S, 10 * S],
    [10 * S, 5 * S],
    [13 * S, 5 * S],
    [13 * S, 10 * S],
  ],
];
const BRIM = { x: 5.33, y: 40, w: 53.33, h: 8, r: 2.67 };

/** Warna paling atas pada satu titik (koordinat viewBox 0..64), atau null. */
function colorAt(px, py) {
  if (inRoundRect(px, py, BRIM.x, BRIM.y, BRIM.w, BRIM.h, BRIM.r)) return TEAL;
  for (const line of HAT_LINES) {
    for (let i = 0; i < line.length - 1; i++) {
      const [x1, y1] = line[i];
      const [x2, y2] = line[i + 1];
      if (distToSegment(px, py, x1, y1, x2, y2) <= STROKE / 2) return TEAL;
    }
  }
  if (inRoundRect(px, py, 0, 0, 64, 64, BG_R)) return NAVY;
  return null;
}

/**
 * Render RGBA.
 * @param size piksel keluaran
 * @param artScale skala gambar di dalam kanvas (1 = penuh)
 * @param fullBleed true: latar navy memenuhi seluruh kanvas (untuk maskable)
 */
function render(size, artScale = 1, fullBleed = false) {
  const SS = 4; // supersampling 4x4 untuk tepi halus
  const out = Buffer.alloc(size * size * 4);
  const off = (64 - 64 * artScale) / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = ((x + (sx + 0.5) / SS) / size) * 64;
          const uy = ((y + (sy + 0.5) / SS) / size) * 64;
          const ax = (ux - off) / artScale;
          const ay = (uy - off) / artScale;
          let c = colorAt(ax, ay);
          if (!c && fullBleed) c = NAVY;
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a += 255;
          }
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      if (a > 0) {
        const covered = a / 255;
        out[i] = Math.round(r / covered);
        out[i + 1] = Math.round(g / covered);
        out[i + 2] = Math.round(b / covered);
        out[i + 3] = Math.round(a / n);
      }
    }
  }
  return out;
}

/* ---------------------------- encoder PNG ---------------------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------------------- encoder ICO ---------------------------- */

/** ICO berisi PNG tertanam (didukung Windows Vista ke atas dan semua browser modern). */
function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + 16 * entries.length;
  entries.forEach((e, i) => {
    const b = i * 16;
    dir[b] = e.size >= 256 ? 0 : e.size;
    dir[b + 1] = e.size >= 256 ? 0 : e.size;
    dir[b + 2] = 0;
    dir[b + 3] = 0;
    dir.writeUInt16LE(1, b + 4); // planes
    dir.writeUInt16LE(32, b + 6); // bit depth
    dir.writeUInt32LE(e.png.length, b + 8);
    dir.writeUInt32LE(offset, b + 12);
    offset += e.png.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

/* ------------------------------- jalankan ------------------------------- */

mkdirSync(join(WEB, 'public'), { recursive: true });

// favicon.ico: 16/32/48 sekaligus, supaya tajam di tab, bookmark, dan taskbar.
const icoSizes = [16, 32, 48];
writeFileSync(
  join(WEB, 'app', 'favicon.ico'),
  encodeIco(icoSizes.map((size) => ({ size, png: encodePng(size, render(size)) }))),
);

// PNG untuk manifest (Android / PWA) dan apple-touch-icon.
for (const size of [192, 512]) {
  writeFileSync(join(WEB, 'public', `icon-${size}.png`), encodePng(size, render(size)));
}
// Maskable: latar penuh, gambar 72% di tengah agar tidak terpotong bentuk launcher.
writeFileSync(
  join(WEB, 'public', 'icon-maskable-512.png'),
  encodePng(512, render(512, 0.72, true)),
);
writeFileSync(join(WEB, 'public', 'apple-touch-icon.png'), encodePng(180, render(180)));

console.log('[icons] helm: favicon.ico (16/32/48) + icon-192/512 + maskable + apple-touch');
