import 'server-only';

import { sql } from 'drizzle-orm';
import {
  migrate,
  seed,
  seedDemoExtras,
  seedEngineering,
  seedVariants,
  db,
  schema,
} from '@rigdaily/database';

/**
 * MODE DEMO untuk deployment publik tanpa database eksternal.
 *
 * Mengapa perlu bootstrap sendiri:
 * Vercel menjalankan beberapa instance serverless. PGlite in-memory hanya hidup
 * di dalam satu instance, jadi setiap instance baru harus menyiapkan schema dan
 * data contoh sebelum request pertama dilayani. Bootstrap di-cache per proses
 * supaya tidak dijalankan berulang pada setiap request.
 */

export function isDemoMode(): boolean {
  return process.env.RIGDAILY_DEMO === '1' || process.env.RIGDAILY_DEMO === 'true';
}

/** True bila driver yang dipakai PGlite (bukan PostgreSQL). */
export function isDemoDatabase(): boolean {
  return !process.env.DATABASE_URL || process.env.RIGDAILY_DRIVER === 'pglite';
}

declare global {
  // eslint-disable-next-line no-var
  var __rigdailyDemoReady: Promise<void> | undefined;
  // eslint-disable-next-line no-var
  var __rigdailyDemoReset: Promise<void> | undefined;
  // eslint-disable-next-line no-var
  var __rigdailyDemoWarnedExternal: boolean | undefined;
}

async function bootstrap(): Promise<void> {
  const startedAt = Date.now();

  await migrate();

  const userCount = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users);
  if ((userCount[0]?.n ?? 0) === 0) {
    await seed();
  }

  // Idempotent: mengisi dataset yang mungkin belum ada pada database lama.
  await seedVariants();
  await seedEngineering();
  await seedDemoExtras();

  console.log(
    `[demo] data contoh siap dalam ${Date.now() - startedAt} ms ` +
      `(driver: ${isDemoDatabase() ? 'PGlite in-memory' : 'PostgreSQL'}).`,
  );
}

/**
 * Pastikan schema + seluruh data demo tersedia pada instance ini.
 * Aman dipanggil dari setiap request; kerja berat hanya sekali per proses.
 */
export async function ensureDemoReady(): Promise<void> {
  if (!isDemoMode()) return;

  // Mode demo dengan PostgreSQL bukan skenario yang didukung: data sudah
  // dikelola lewat migrasi/seed normal, dan reset demo tidak boleh menyentuh
  // database permanen. Bootstrap hanya untuk database in-memory.
  if (!isDemoDatabase()) {
    if (!globalThis.__rigdailyDemoWarnedExternal) {
      globalThis.__rigdailyDemoWarnedExternal = true;
      console.warn(
        '[demo] RIGDAILY_DEMO aktif tetapi DATABASE_URL terisi. ' +
          'Bootstrap dan reset demo dinonaktifkan agar database permanen tidak tersentuh.',
      );
    }
    return;
  }

  if (!globalThis.__rigdailyDemoReady) {
    globalThis.__rigdailyDemoReady = bootstrap().catch((err) => {
      // Jangan menyimpan promise yang gagal: request berikutnya boleh mencoba lagi.
      globalThis.__rigdailyDemoReady = undefined;
      console.error('[demo] bootstrap gagal:', err);
      throw err;
    });
  }

  return globalThis.__rigdailyDemoReady;
}

/**
 * Kosongkan seluruh tabel lalu isi ulang data contoh.
 * Dipakai tombol "Reset data demo" di banner. Hanya tersedia di mode demo.
 */
export async function resetDemoData(): Promise<void> {
  if (!isDemoMode()) {
    throw new Error('Reset hanya tersedia dalam mode demo.');
  }

  if (!isDemoDatabase()) {
    throw new Error(
      'Reset data demo hanya tersedia pada database in-memory (PGlite). ' +
        'Hapus DATABASE_URL atau set RIGDAILY_DRIVER=pglite.',
    );
  }

  const task = (async () => {
    const result = (await db.execute(sql`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `)) as unknown as { rows?: Array<{ tablename: string }> };

    const tables = (result.rows ?? [])
      .map((r) => `"${r.tablename.replace(/"/g, '""')}"`)
      .join(', ');

    if (tables) {
      await db.execute(sql.raw(`TRUNCATE TABLE ${tables} CASCADE`));
    }

    await seed();
    await seedVariants();
    await seedEngineering();
    await seedDemoExtras();
    console.log('[demo] data contoh direset.');
  })();

  globalThis.__rigdailyDemoReset = task;
  globalThis.__rigdailyDemoReady = task.catch((err) => {
    globalThis.__rigdailyDemoReady = undefined;
    throw err;
  });

  await task;
}
