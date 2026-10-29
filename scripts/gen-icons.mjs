/**
 * Generator ikon RigDaily.
 *
 * Kenapa dibuat sendiri, bukan pakai rasterizer eksternal:
 *  - Ikon aplikasi sudah ada sebagai SVG (app/icon.svg). Yang dibutuhkan hanya
 *    turunannya: favicon.ico (16/32/48) dan PNG 192/512 untuk manifest PWA.
 *  - Browser lama dan Android meminta /favicon.ico dan PNG; SVG saja tidak cukup.
 *  - Tanpa dependensi: PNG ditulis manual dengan zlib bawaan Node, ICO dibungkus
 *    dari PNG (format ICO mendukung PNG tertanam). Hasilnya deterministik dan
 *    bisa dijalankan ulang kapan saja tanpa unduhan.
 *
 * Geometri mengikuti app/icon.svg (viewBox 64x64) supaya semua ukuran identik.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..', 'apps', 'web');

const NAVY = [0x0f, 0x2a, 0x44];
const TEAL = [0x0e, 0x9f, 0x8a];
const AMBER = [0xf5, 0x9e, 0x0b];
const WHITE = [0xff, 0xff, 0xff];
const GRAY = [0x64, 0x74, 0x8b];

const BG_R = 12; // sudut membulat ikon
const STROKE = 2.2;

/** Jarak titik ke segmen garis. */
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Titik di dalam persegi membulat. */
function inRoundRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return Math.hypot(px - cx, py - cy) <= r;
}

const DERRICK = [
  [20, 50, 32, 16],
  [44, 50, 32, 16],
  [24, 39, 40, 39],
  [27, 30, 37, 30],
];

/** Warna paling atas pada satu titik (koordinat viewBox 0..64), atau null. */
function colorAt(px, py) {
  // Urutan tumpuk: leg, base, crown, derrick, latar (paling atas lebih dulu).
  if (inRoundRect(px, py, 22, 53, 4, 5, 0) || inRoundRect(px, py, 38, 53, 4, 5, 0)) return GRAY;
  if (inRoundRect(px, py, 18, 50, 28, 3, 1.5)) return WHITE;
  if (inRoundRect(px, py, 29, 13, 6, 3, 1)) return AMBER;
  for (const [x1, y1, x2, y2] of DERRICK) {
    if (distToSegment(px, py, x1, y1, x2, y2) <= STROKE / 2) return TEAL;
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
          // Petakan ke koordinat seni (memperhitungkan skala + tengah).
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
        // Warna dirata-rata hanya dari sampel yang tertutup (hindari gelap di tepi).
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

  // Baris PNG diawali filter byte 0.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
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
    dir[b + 2] = 0; // palet
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
const ico = encodeIco(
  icoSizes.map((size) => ({ size, png: encodePng(size, render(size)) })),
);
writeFileSync(join(WEB, 'app', 'favicon.ico'), ico);

// PNG untuk manifest (Android / PWA) dan apple-touch-icon.
for (const size of [192, 512]) {
  writeFileSync(join(WEB, 'public', `icon-${size}.png`), encodePng(size, render(size)));
}
// Maskable: latar penuh, gambar 72% di tengah agar tidak terpotong lingkaran launcher.
writeFileSync(
  join(WEB, 'public', 'icon-maskable-512.png'),
  encodePng(512, render(512, 0.72, true)),
);
writeFileSync(
  join(WEB, 'public', 'apple-touch-icon.png'),
  encodePng(180, render(180)),
);

console.log('[icons] favicon.ico (16/32/48) ->', join(WEB, 'app', 'favicon.ico'));
console.log('[icons] icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png');
