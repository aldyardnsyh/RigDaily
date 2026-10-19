/**
 * Auto-migrasi skema database untuk mode DEVELOPMENT.
 *
 * KENAPA DI SINI (dan bukan di instrumentation.ts):
 * `instrumentation.ts` dievaluasi di dalam bundler Next (webpack), sehingga
 * `pg` ikut ter-trace dan gagal resolve modul Node bawaan (`fs`/`net`/`tls`)
 * serta paket opsional `pg-native`. Akibatnya SEMUA route API mengembalikan 500.
 *
 * `next.config.js` dieksekusi oleh Node murni SEBELUM bundler aktif, jadi aman
 * memuat `pg`/drizzle di sini. Dijalankan hanya saat `next dev`.
 *
 * Idempotent: semua DDL memakai IF NOT EXISTS. Bila skema sudah ada, hanya satu
 * query ringan yang dijalankan.
 */
const path = require('node:path');
const fs = require('node:fs');

async function ensureSchema(repoRoot) {
  // Hanya untuk development. Produksi dikelola entrypoint container.
  if (process.env.NODE_ENV === 'production') return;
  if (process.env.RIGDAILY_SKIP_AUTOMIGRATE === '1') return;

  const hasPg = !!process.env.DATABASE_URL && process.env.RIGDAILY_DRIVER !== 'pglite';
  const hasPglite = !process.env.DATABASE_URL || process.env.RIGDAILY_DRIVER === 'pglite';

  try {
    if (hasPg) {
      const { Pool } = require('pg');
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 1,
        connectionTimeoutMillis: 5000,
      });
      const client = await pool.connect();
      try {
        const res = await client.query("SELECT to_regclass('public.users') AS t");
        if (res.rows[0] && res.rows[0].t) {
          console.log('[db] skema PostgreSQL siap (tabel users ditemukan).');
          return;
        }
      } finally {
        client.release();
      }
      await pool.end();
      await runMigrateWithPg();
      return;
    }

    if (hasPglite) {
      console.warn(
        '[db] DATABASE_URL kosong -> memakai PGlite (dev only). ' +
          'Data TIDAK dipakai bersama dengan PostgreSQL. ' +
          'Untuk memakai PostgreSQL: isi DATABASE_URL di .env.local.',
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[db] peringatan saat cek skema:', msg);
    console.error(
      '[db] Jalankan manual: `npm run db:migrate` lalu `npm run db:seed`. ' +
        'Pastikan PostgreSQL hidup (docker compose -f infra/docker/compose.dev.yml up -d).',
    );
  }
}

/** Jalankan migrasi DDL lewat pg langsung (tanpa tsx/ts-node). */
async function runMigrateWithPg() {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
  const client = await pool.connect();
  try {
    const { STATEMENTS } = loadStatements();
    for (const stmt of STATEMENTS) {
      try {
        await client.query(stmt);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/pgcrypto|extension/i.test(msg)) continue;
        throw new Error(`migrasi gagal: ${msg}\n${stmt.slice(0, 120)}...`);
      }
    }
    console.log(`[db] migrasi otomatis selesai (${STATEMENTS.length} statement). Jalankan \`npm run db:seed\` bila data demo belum ada.`);
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Ambil daftar DDL dari packages/database/src/migrate.ts dengan membaca file
 * sumbernya (array string literal). Menghindari kebutuhan transpiler di
 * next.config.js.
 */
function loadStatements() {
  const file = path.join(__dirname, '..', '..', 'packages', 'database', 'src', 'migrate.ts');
  const src = fs.readFileSync(file, 'utf8');
  const startMarker = 'const STATEMENTS: string[] = [';
  const start = src.indexOf(startMarker);
  if (start === -1) throw new Error('STATEMENTS tidak ditemukan di migrate.ts');
  const bodyStart = start + startMarker.length;
  const end = src.indexOf('\n];', bodyStart);
  if (end === -1) throw new Error('akhir STATEMENTS tidak ditemukan');
  const body = src.slice(bodyStart, end);

  // Ekstrak setiap template literal backtick; abaikan komentar JS di antaranya.
  const statements = [];
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '`') {
      let out = '';
      i += 1;
      while (i < body.length && body[i] !== '`') {
        if (body[i] === '\\' && body[i + 1] === '`') {
          out += '`';
          i += 2;
          continue;
        }
        out += body[i];
        i += 1;
      }
      i += 1;
      const trimmed = out.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      continue;
    }
    i += 1;
  }
  if (statements.length === 0) throw new Error('tidak ada statement DDL yang terbaca');
  return { STATEMENTS: statements };
}

module.exports = { ensureSchema, loadStatements };
