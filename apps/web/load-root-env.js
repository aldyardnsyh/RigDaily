/**
 * Muat variabel environment untuk MONOREPO.
 *
 * MASALAH YANG DIPERBAIKI:
 * Next.js hanya memuat `.env.local` dari direktori proyeknya sendiri
 * (`apps/web/`), BUKAN dari root monorepo. Akibatnya `.env.local` di root
 * tidak terbaca, `DATABASE_URL` kosong, aplikasi diam-diam jatuh ke PGlite
 * kosong, dan login gagal dengan `relation "users" does not exist`.
 *
 * SOLUSI:
 * `next.config.js` memanggil `loadRootEnv()` sebelum konfigurasi dievaluasi,
 * sehingga satu file `.env.local` di root berlaku untuk `npm run dev`,
 * `npm run build`, dan `next start`.
 *
 * Prioritas (tanpa menimpa env yang sudah ada — shell menang):
 *   1. Variabel yang sudah ada di process.env (shell / CI / Docker)
 *   2. `.env.local` di root
 *   3. `.env` di root
 *   4. `.env.local` / `.env` di apps/web (kompatibilitas)
 */
const fs = require('node:fs');
const path = require('node:path');

/** Parser .env minimal (dukung kutip, komentar, escape \n). */
function parseEnv(content) {
  const out = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    value = value.replace(/\\n/g, '\n');
    out[key] = value;
  }
  return out;
}

function loadFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return 0;
    const parsed = parseEnv(fs.readFileSync(filePath, 'utf8'));
    let applied = 0;
    for (const [key, value] of Object.entries(parsed)) {
      // Jangan timpa nilai yang sudah ada (shell/CI menang).
      if (process.env[key] === undefined) {
        process.env[key] = value;
        applied += 1;
      }
    }
    return applied;
  } catch {
    return 0;
  }
}

/**
 * Muat env monorepo. Aman dipanggil berkali-kali (idempotent).
 * @param {string} repoRoot
 * @returns {{ files: string[], applied: number }}
 */
function loadRootEnv(repoRoot) {
  const candidates = [
    path.join(repoRoot, '.env.local'),
    path.join(repoRoot, '.env'),
    path.join(repoRoot, 'apps', 'web', '.env.local'),
    path.join(repoRoot, 'apps', 'web', '.env'),
  ];
  const files = [];
  let applied = 0;
  for (const file of candidates) {
    const n = loadFile(file);
    if (n > 0) {
      files.push(path.relative(repoRoot, file));
      applied += n;
    }
  }
  return { files, applied };
}

module.exports = { loadRootEnv, parseEnv };
