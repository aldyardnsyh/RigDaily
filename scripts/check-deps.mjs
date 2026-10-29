/**
 * Penjaga batas antar package (modular monolith).
 *
 * ATURAN (satu arah, tanpa siklus):
 *   shared   -> tidak boleh import package internal apa pun (murni: zod saja)
 *   ui       -> tidak boleh import shared / database / web (presentasi murni)
 *   database -> hanya boleh import shared (kontrak + kalkulasi)
 *   apps/web -> boleh import shared, ui, database (komposisi akhir)
 *
 * DILARANG juga: import relatif yang keluar dari package sendiri
 * (`../../packages/...`), karena itu melewati kontrak publik package
 * (barrel export) dan membuat dependensi tersembunyi.
 *
 * Kenapa script Node biasa, bukan plugin eslint:
 *  - nol dependensi, jalan di mana saja (`node scripts/check-deps.mjs`)
 *  - gagal dengan pesan yang menunjuk file + baris pelanggar
 *  - cukup cepat untuk dijalankan di setiap commit dan di CI
 *
 * Keluar dengan kode 1 bila ada pelanggaran, 0 bila bersih.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

const PACKAGES = ['packages/shared', 'packages/ui', 'packages/database'];
const APP = 'apps/web';

/** Package apa saja yang boleh diimport oleh tiap area. */
const ALLOWED = {
  'packages/shared': new Set([]),
  'packages/ui': new Set([]),
  'packages/database': new Set(['@rigdaily/shared']),
  'apps/web': new Set(['@rigdaily/shared', '@rigdaily/ui', '@rigdaily/database']),
};

const INTERNAL_RE = /from\s+['"](@rigdaily\/[a-z-]+)['"]/g;
const RELATIVE_UP_RE = /from\s+['"](\.\.\/)+/g;

function listFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      listFiles(full, out);
    } else if (/\.(ts|tsx|mjs|js)$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function areaOf(file) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  if (rel.startsWith('packages/shared/')) return 'packages/shared';
  if (rel.startsWith('packages/ui/')) return 'packages/ui';
  if (rel.startsWith('packages/database/')) return 'packages/database';
  if (rel.startsWith('apps/web/')) return 'apps/web';
  return null;
}

const violations = [];

for (const area of [...PACKAGES, APP]) {
  for (const file of listFiles(join(ROOT, area))) {
    const src = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file).replace(/\\/g, '/');

    let m;
    INTERNAL_RE.lastIndex = 0;
    while ((m = INTERNAL_RE.exec(src))) {
      const target = m[1];
      if (!ALLOWED[area].has(target)) {
        violations.push(`${rel}: import terlarang '${target}' (area '${area}' tidak boleh memakai '${target}')`);
      }
    }

    RELATIVE_UP_RE.lastIndex = 0;
    while ((m = RELATIVE_UP_RE.exec(src))) {
      // Import relatif naik yang keluar dari package sendiri = melewati kontrak.
      const depth = (m[1].match(/\.\.\//g) || []).length;
      const parts = rel.split('/');
      const areaDepth = area.split('/').length;
      if (parts.length - depth < areaDepth) {
        violations.push(`${rel}: import relatif '${m[0].slice(5)}' keluar dari package (pakai '@rigdaily/...' lewat barrel export)`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('[deps] BATAS ANTAR PACKAGE DILANGGAR:');
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

console.log('[deps] bersih: shared murni, ui presentasi saja, database hanya lewat shared.');
