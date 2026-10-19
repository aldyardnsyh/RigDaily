/**
 * Global setup file untuk Vitest (didaftarkan lewat `setupFiles`).
 *
 * Tujuan: memaksa seluruh test suite memakai PGlite IN-MEMORY, supaya:
 *  - tidak pernah menyentuh `.pglite-data/` milik developer,
 *  - tidak pernah menyentuh PostgreSQL produksi walau `DATABASE_URL` terisi
 *    di environment mesin yang menjalankan test.
 *
 * `packages/database/src/client.ts` membaca env ini saat module di-inisialisasi
 * (singleton), jadi nilai di bawah harus di-set SEBELUM ada import client.
 * `setupFiles` dijalankan sebelum file test (dan import-nya) dimuat.
 */

process.env.RIGDAILY_DRIVER = 'pglite';
process.env.DATABASE_URL = '';
delete process.env.PGLITE_DIR;
