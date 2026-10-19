/**
 * Perbaiki mojibake (UTF-8 yang salah dibaca sebagai CP1252/Latin-1).
 *
 * Contoh kerusakan: "â€"" seharusnya "—" (em dash), "â€™" -> "'", "Â§" -> "§".
 * Hanya mengganti urutan byte yang JELAS rusak; teks normal tidak disentuh.
 *
 * Jalankan: node scripts/fix-encoding.mjs [--dry]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const DRY = process.argv.includes('--dry');
const ROOTS = [
  'apps/web/app', 'apps/web/components', 'apps/web/lib',
  'packages/ui/src', 'packages/shared/src', 'packages/database/src',
  'apps/desktop/src', 'tests', 'infra', 'docs',
];
const EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.css', '.json', '.md', '.sh', '.ps1', '.yml', '.html', '.example']);

// Urutan penting: pola terpanjang lebih dulu.
const REPLACEMENTS = [
  ['â€', '”'], ['â€œ', '“'], ['â€™', '’'], ['â€˜', '‘'],
  ['â€”', '—'], ['â€“', '–'], ['â€¦', '…'], ['â€¢', '•'],
  ['â‚¬', '€'], ['â„¢', '™'], ['â€¹', '‹'], ['â€º', '›'],
  ['Â«', '«'], ['Â»', '»'], ['Â°', '°'], ['Â±', '±'],
  ['Â·', '·'], ['Â§', '§'], ['Â¶', '¶'], ['Â©', '©'], ['Â®', '®'],
  ['Ã©', 'é'], ['Ã¨', 'è'], ['Ãª', 'ê'], ['Ã¡', 'á'], ['Ã ', 'à'],
  ['Ã³', 'ó'], ['Ã²', 'ò'], ['Ãº', 'ú'], ['Ã­', 'í'], ['Ã±', 'ñ'],
  ['Ã¼', 'ü'], ['Ã¶', 'ö'], ['Ã¤', 'ä'], ['Ã§', 'ç'], ['ÃŸ', 'ß'],
  ['ï¿½', ''],
];

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.next' || name === 'dist' || name.startsWith('.')) continue;
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else {
      const dot = name.lastIndexOf('.');
      const ext = dot === -1 ? '' : name.slice(dot);
      if (EXT.has(ext) || name.endsWith('.env.example')) out.push(p);
    }
  }
  return out;
}

const files = [...new Set(ROOTS.flatMap((r) => walk(r)))];
let changedFiles = 0;
let changedLines = 0;

for (const f of files) {
  const before = readFileSync(f, 'utf8');
  let after = before;
  const lineCount = before.split(/\r?\n/).length;

  for (const [bad, good] of REPLACEMENTS) {
    if (after.includes(bad)) after = after.split(bad).join(good);
  }

  if (after !== before) {
    const afterLines = after.split(/\r?\n/).length;
    if (afterLines !== lineCount) {
      console.error(`SKIP ${relative('.', f)} — jumlah baris berubah (perlu periksa manual)`);
      continue;
    }
    const diffLines = before.split(/\r?\n/).filter((l, i) => l !== after.split(/\r?\n/)[i]).length;
    changedFiles += 1;
    changedLines += diffLines;
    console.log(`FIX  ${relative('.', f)}  (${diffLines} baris)`);
    if (!DRY) writeFileSync(f, after, 'utf8');
  }
}

console.log(`\n${DRY ? '[DRY RUN] ' : ''}${changedFiles} file, ${changedLines} baris diperbaiki.`);
