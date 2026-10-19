/**
 * Audit kualitas teks menyeluruh:
 *  1. Mojibake (UTF-8 salah dibaca CP1252): "â€" -> "—" dst.
 *  2. Em-dash (—, U+2014) dan en-dash (–, U+2013) yang DILARANG pada teks UI.
 *  3. Ciri slop lain: ellipsis "…" tiga titik, tanda kutip keriting, NBSP.
 *
 * Jalankan: node scripts/audit-text-quality.mjs [--fix]
 *   tanpa flag  -> laporan saja (exit 1 bila ada temuan)
 *   --fix       -> perbaiki otomatis: mojibake dipulihkan, em/en-dash & ellipsis
 *                  diganti ASCII yang setara
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const FIX = process.argv.includes('--fix');

const SKIP_DIRS = new Set([
  'node_modules', '.next', '.git', 'dist', 'dist-server', 'test-results',
  'e2e-report', 'playwright-report', 'artifacts', '.pglite-data', 'graphify-out',
  'coverage', '.vitest',
]);
const EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.json', '.md', '.html', '.yml', '.yaml', '.sh', '.ps1']);

// --- 1. Mojibake yang pasti rusak (UTF-8 dibaca CP1252) ---
const MOJIBAKE = [
  ['â€\u009d', '”'], ['â€œ', '“'], ['â€™', '’'], ['â€˜', '‘'],
  ['â€”', '—'], ['â€“', '–'], ['â€¦', '…'], ['â€¢', '•'],
  ['â‚¬', '€'], ['â„¢', '™'], ['â€¹', '‹'], ['â€º', '›'],
  ['Â«', '«'], ['Â»', '»'], ['Â°', '°'], ['Â±', '±'],
  ['Â·', '·'], ['Â§', '§'], ['Â¶', '¶'], ['Â©', '©'], ['Â®', '®'],
  ['Ã©', 'é'], ['Ã¨', 'è'], ['Ãª', 'ê'], ['Ã¡', 'á'], ['Ã ', 'à'],
  ['Ã³', 'ó'], ['Ã²', 'ò'], ['Ãº', 'ú'], ['Ã­', 'í'], ['Ã±', 'ñ'],
  ['Ã¼', 'ü'], ['Ã¶', 'ö'], ['Ã¤', 'ä'], ['Ã§', 'ç'], ['ÃŸ', 'ß'],
  ['ï¿½', ''],
];

// --- 2. Karakter tipografi yang harus jadi ASCII di teks UI ---
// Alasan: konsistensi, keamanan encoding, dan menghindari "slop" gaya AI.
const TYPO = [
  [' — ', ' - '],
  ['—', '-'],
  [' – ', ' - '],
  ['–', '-'],
  ['…', '...'],
  ['\u00A0', ' '], // NBSP
  ['\u202F', ' '], // narrow NBSP
];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
    if (dir === '.' && name === 'scripts') continue; // alat audit sendiri
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out);
    else {
      const dot = name.lastIndexOf('.');
      if (dot > 0 && EXT.has(name.slice(dot))) out.push(p);
    }
  }
  return out;
}

const files = walk('.').filter((f) => !/[\\/]lib[\\/]text\.ts$/.test(f));
const mojibakeHits = [];
const typoHits = [];
let fixedFiles = 0;

for (const file of files) {
  const before = readFileSync(file, 'utf8');
  let after = before;

  for (const [bad, good] of MOJIBAKE) if (after.includes(bad)) after = after.split(bad).join(good);
  const mojiCount = (before.match(/â€|Ã.|Â.|ðŸ|ï¿½/g) ?? []).length;

  // Em/en dash & ellipsis: hanya di file teks UI (tsx/ts/md), bukan JSON data.
  const isUi = /\.(tsx?|md)$/.test(file);
  let typoCount = 0;
  if (isUi) {
    for (const [bad, good] of TYPO) {
      const c = after.split(bad).length - 1;
      if (c > 0) {
        typoCount += c;
        after = after.split(bad).join(good);
      }
    }
  }

  if (mojiCount > 0) {
    mojibakeHits.push({ file: relative('.', file), count: mojiCount });
  }
  if (typoCount > 0) {
    typoHits.push({ file: relative('.', file), count: typoCount });
  }

  // Jangan sentuh file biner-ish atau test snapshot.
  if (after !== before && FIX) {
    writeFileSync(file, after, 'utf8');
    fixedFiles += 1;
  }
}

console.log('=== MOJIBAKE (karakter rusak) ===');
if (mojibakeHits.length === 0) console.log('BERSIH: 0 temuan');
else {
  const total = mojibakeHits.reduce((a, b) => a + b.count, 0);
  console.log(`Ditemukan ${total} pada ${mojibakeHits.length} file`);
  for (const h of mojibakeHits.slice(0, 20)) console.log(`  ${h.count}x  ${h.file}`);
}

console.log('\n=== EM/EN DASH & ELLIPSIS pada teks UI ===');
if (typoHits.length === 0) console.log('BERSIH: 0 temuan');
else {
  const total = typoHits.reduce((a, b) => a + b.count, 0);
  console.log(`Ditemukan ${total} pada ${typoHits.length} file`);
  for (const h of typoHits.slice(0, 20)) console.log(`  ${h.count}x  ${h.file}`);
}

if (FIX) console.log(`\nFIX: ${fixedFiles} file diperbarui.`);

const failed = mojibakeHits.length > 0 || typoHits.length > 0;
process.exit(FIX ? 0 : failed ? 1 : 0);
