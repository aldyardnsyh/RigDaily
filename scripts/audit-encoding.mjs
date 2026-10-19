/**
 * Audit karakter rusak (mojibake) di seluruh source.
 *
 * Yang dicari: karakter hasil salah-encoding (mis. "â€"" yang seharusnya "—"),
 * karakter CJK (写/中文), Fullwidth, replacement char (U+FFFD), dan emoji.
 *
 * Jalankan: node scripts/audit-encoding.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['apps/web/app', 'apps/web/components', 'apps/web/lib', 'packages/ui/src', 'packages/shared/src', 'packages/database/src'];
const EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.css', '.json', '.md']);

// Pola mojibake khas (UTF-8 dibaca sebagai Latin-1/Windows-1252)
const MOJIBAKE = /(â€|Ã|Â|ðŸ|ï¿½|\\u00e2\\u20ac)/;
// Karakter bermasalah lain
const SUSPECT = /[\uFFFD\u4E00-\u9FFF\u3000-\u303F\uFF00-\uFFEF\u2018\u2019\u201C\u201D\u2013\u2014\u2026\u00A0]/;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXT.has(name.slice(name.lastIndexOf('.')))) out.push(p);
  }
  return out;
}

const files = ROOTS.flatMap((r) => walk(r));
const report = [];
let totalMojibake = 0;
let totalSuspect = 0;

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const lines = src.split(/\r?\n/);
  const hits = [];
  lines.forEach((line, i) => {
    if (MOJIBAKE.test(line) || SUSPECT.test(line)) {
      const m = line.match(MOJIBAKE) ?? line.match(SUSPECT);
      hits.push({ line: i + 1, char: m[0], text: line.trim().slice(0, 130) });
    }
  });
  if (hits.length) {
    const moji = hits.filter((h) => MOJIBAKE.test(h.char)).length;
    totalMojibake += moji;
    totalSuspect += hits.length - moji;
    report.push({ file: relative('.', f), hits });
  }
}

if (report.length === 0) {
  console.log('BERSIH: tidak ada mojibake / karakter CJK / replacement char.');
  process.exit(0);
}

console.log(`Ditemukan masalah di ${report.length} file (mojibake=${totalMojibake}, karakter lain=${totalSuspect})\n`);
for (const r of report.sort((a, b) => b.hits.length - a.hits.length)) {
  console.log(`### ${r.file}  (${r.hits.length})`);
  for (const h of r.hits.slice(0, 6)) {
    console.log(`   L${h.line} [${h.char}] ${h.text}`);
  }
  if (r.hits.length > 6) console.log(`   ... dan ${r.hits.length - 6} lagi`);
}
process.exit(1);
