/**
 * Helper DB untuk test integrasi.
 *
 * Memakai PGlite IN-MEMORY (`new PGlite()` tanpa argumen) sehingga:
 *  - test tidak pernah menyentuh `.pglite-data/`,
 *  - setiap run selalu mulai dari schema kosong (deterministik).
 *
 * Catatan penting tentang `packages/database/src/client.ts`:
 * driver ditentukan sekali saat module dimuat (singleton). Karena itu env harus
 * sudah benar SEBELUM import - itu sebabnya `tests/helpers/setup.ts` dijalankan
 * lewat `setupFiles` di `vitest.config.ts`, dan `setupTestDb()` tetap memaksa
 * ulang nilai env sebagai sabuk pengaman urutan import.
 */
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';

/**
 * `packages/database/package.json` hanya mengekspor "." (barrel `src/index.ts`).
 * `seed` tidak di-re-export oleh barrel, jadi di-load lewat path absolut -
 * bukan `@rigdaily/database/seed` yang tidak ada di `exports` map.
 */
const SEED_MODULE_PATH = resolve(__dirname, '../../packages/database/src/seed.ts');

/** `seed()` dari `packages/database/src/seed.ts` - jalankan dataset demo ARUN-07. */
export async function seedDemoData(): Promise<void> {
  const seedModule = (await import(SEED_MODULE_PATH)) as { seed: () => Promise<void> };
  await seedModule.seed();
}

/**
 * Paksa mode PGlite in-memory. Harus dipanggil sebelum `@rigdaily/database`
 * di-load (dilakukan juga di `tests/helpers/setup.ts`).
 */
export function forceInMemoryPgliteEnv(): void {
  process.env.RIGDAILY_DRIVER = 'pglite';
  process.env.DATABASE_URL = '';
  delete process.env.PGLITE_DIR;
}

let bootstrapped = false;

/**
 * Bootstrap DB test: pastikan driver PGlite in-memory, jalankan `migrate()` lalu
 * `seed()` (dataset demo ARUN-07 / DDR #145). Idempotent: aman dipanggil di
 * `beforeAll` setiap file test karena Vitest berjalan single-fork.
 */
export async function setupTestDb(): Promise<void> {
  forceInMemoryPgliteEnv();

  // Import dinamis: env di atas WAJIB sudah final sebelum client dievaluasi.
  const { migrate } = await import('@rigdaily/database');
  await migrate();

  if (!bootstrapped) {
    await seedDemoData();
    bootstrapped = true;
  }
}

/**
 * Teardown: tutup koneksi PGlite. Karena in-memory, data ikut hilang sehingga
 * run berikutnya selalu bersih.
 */
export async function teardownTestDb(): Promise<void> {
  const { closeDb } = await import('@rigdaily/database');
  await closeDb();
  bootstrapped = false;
}

/**
 * Hapus semua data operasional (bukan master) supaya file test bisa menguji
 * skenario tulis tanpa mengganggu seed. Dipakai hanya bila sebuah test butuh
 * keadaan "bersih" tertentu; bukan default.
 */
export async function truncateOperationalTables(): Promise<void> {
  const { db } = await import('@rigdaily/database');
  await db.execute(
    sql`TRUNCATE TABLE delivery_log, sync_conflicts, sync_mutation_log, audit_log,
        billing_flags, cost_lines, safety_incidents, marine_daily, mac_activities,
        survey_stations, bha_components, mud_records, crew_members, time_breakdown,
        daily_reports RESTART IDENTITY CASCADE`,
  );
}
