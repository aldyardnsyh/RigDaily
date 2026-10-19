/**
 * Client DB DUAL-DRIVER.
 *
 * - DATABASE_URL diset  -> PostgreSQL via node-postgres (produksi / VPS)
 * - DATABASE_URL kosong -> PGlite (Postgres 16 asli via WASM, in-process)
 *   Dipakai untuk development lokal tanpa Docker & untuk test suite.
 *
 * Keduanya memakai schema Drizzle yang SAMA (packages/database/src/schema).
 * API query builder identik, jadi repository layer tidak perlu tahu driver.
 *
 * CATATAN BUNDLER (penting untuk Next.js):
 * `pg` dan `@electric-sql/pglite` dimuat LAZY lewat `require()` di dalam fungsi,
 * bukan `import` di top-level. Alasannya: `pg` bergantung pada modul Node
 * bawaan (`fs`, `net`, `tls`) dan opsional `pg-native`. Bila di-`import`
 * statis, webpack Next mencoba mem-bundle-nya dan gagal
 * ("Module not found: Can't resolve 'fs'/'pg-native'"), membuat SEMUA route
 * API mengembalikan 500. Dengan `require` lazy, kode ini tetap CommonJS-aman
 * dan hanya dieksekusi di runtime Node.
 */
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import * as schema from './schema/index';

export type Db = NodePgDatabase<typeof schema>;

const usePglite = !process.env.DATABASE_URL || process.env.RIGDAILY_DRIVER === 'pglite';

declare global {
  // eslint-disable-next-line no-var
  var __rigdailyDb: Db | undefined;
  // eslint-disable-next-line no-var
  var __rigdailyPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __rigdailyPglite: { close: () => Promise<void>; waitReady: Promise<void> } | undefined;
}

let dbInstance: Db;
let poolInstance: Pool | null = null;
let pgliteInstance: { close: () => Promise<void>; waitReady: Promise<void> } | null = null;

if (usePglite) {
  // PGlite dipakai untuk dev tanpa Docker & test suite.
  // Guard: di produksi jangan pernah jatuh ke PGlite secara diam-diam.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[database] DATABASE_URL kosong di NODE_ENV=production. ' +
        'Produksi WAJIB memakai PostgreSQL - PGlite akan kehilangan data saat container dibuat ulang. ' +
        'Isi DATABASE_URL di .env (lihat .env.example).',
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  // Tanpa anotasi 	ypeof import(...): TypeScript menyisakan referensi yang
  // membuat webpack tetap mencoba me-resolve paket tersebut.
  const pgliteMod = require('@electric-sql/pglite') as { PGlite: new (dir?: string) => unknown };
  const PGlite = pgliteMod.PGlite;
  const dataDir = process.env.PGLITE_DIR ?? undefined;
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  pgliteInstance = client as unknown as { close: () => Promise<void>; waitReady: Promise<void> };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pgliteDrizzleMod = require('drizzle-orm/pglite') as {
    drizzle: (client: unknown, cfg: { schema: typeof schema }) => unknown;
  };
  const drizzlePglite = pgliteDrizzleMod.drizzle as (client: unknown, cfg: { schema: typeof schema }) => Db;
  dbInstance = drizzlePglite(client, { schema }) as unknown as Db;
  global.__rigdailyPglite = pgliteInstance;
  if (!process.env.DATABASE_URL) {
    console.warn(
      '[database] DATABASE_URL kosong -> memakai PGlite (dev only). ' +
        `Data: ${dataDir ?? 'in-memory'}. Jalankan "npm run db:migrate" lalu "npm run db:seed" bila tabel belum ada.`,
    );
  }
} else {
  const connectionString = process.env.DATABASE_URL as string;
  if (global.__rigdailyPool) {
    poolInstance = global.__rigdailyPool;
  } else {
    // require lazy: cegah webpack mem-bundle `pg` (butuh fs/net/tls).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pgMod = require('pg') as { Pool: new (cfg: { connectionString: string; max: number; idleTimeoutMillis: number; connectionTimeoutMillis: number }) => Pool };
    const PgPool = pgMod.Pool;
    poolInstance = new PgPool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    if (process.env.NODE_ENV !== 'production') global.__rigdailyPool = poolInstance;
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pgDrizzleMod = require('drizzle-orm/node-postgres') as {
    drizzle: (pool: unknown, cfg: { schema: typeof schema }) => Db;
  };
  const drizzlePg = pgDrizzleMod.drizzle;
  dbInstance = drizzlePg(poolInstance, { schema });
}

export const db: Db = dbInstance;
export const pool = poolInstance;
export const isPglite = usePglite;

/**
 * Auto-migrasi untuk mode DEVELOPMENT saja.
 *
 * Tujuan: mencegah error membingungkan seperti `relation "users" does not exist`
 * ketika `.env.local` belum ada / DATABASE_URL berubah. Migrasi bersifat
 * idempotent (semua DDL memakai IF NOT EXISTS), jadi aman dipanggil berulang.
 *
 * Di produksi auto-migrasi DIMATIKAN - skema dikelola oleh entrypoint container
 * (lihat infra/docker/entrypoint.sh) agar startup terkontrol.
 */
export async function ensureSchemaReady(): Promise<{ migrated: boolean; driver: 'pglite' | 'postgres' }> {
  const driver: 'pglite' | 'postgres' = isPglite ? 'pglite' : 'postgres';
  if (process.env.NODE_ENV === 'production') return { migrated: false, driver };

  const { sql } = await import('drizzle-orm');
  try {
    const res = (await db.execute(sql`SELECT to_regclass('public.users') AS t`)) as unknown as {
      rows?: Array<{ t: string | null }>;
    };
    if (res.rows?.[0]?.t) return { migrated: false, driver };
  } catch {
    /* to_regclass bisa gagal di DB yang benar-benar kosong - lanjut migrasi */
  }

  const { migrate } = await import('./migrate');
  await migrate();
  console.warn(
    `[database] Skema belum ada di ${driver} -> migrasi otomatis dijalankan. ` +
      'Jalankan "npm run db:seed" bila data demo belum ada.',
  );
  return { migrated: true, driver };
}

/** Tutup koneksi (dipakai script CLI & teardown test). */
export async function closeDb(): Promise<void> {
  if (pgliteInstance) {
    await pgliteInstance.close().catch(() => undefined);
  }
  if (poolInstance) {
    await poolInstance.end().catch(() => undefined);
  }
}

export { schema };
