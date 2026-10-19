import { test as base, expect } from '@playwright/test';
import { authedPage, type RoleKey } from './auth';

/**
 * Fixture bersama: halaman yang SUDAH login sebagai admin.
 *
 * Sesi diambil dari `storageState` (sekali per worker) lalu diverifikasi;
 * bila cookie kedaluwarsa helper otomatis login ulang. Setiap test tetap
 * independen karena context browser baru per test.
 */
export const test = base.extend<{ page: import('@playwright/test').Page }>({
  page: async ({ browser }, use) => {
    const page = await authedPage(browser, 'admin');
    await use(page);
    await page.context().close();
  },
});

/** Versi eksplisit untuk test yang butuh role lain. */
export async function pageFor(browser: import('@playwright/test').Browser, role: RoleKey) {
  return authedPage(browser, role);
}

export { expect };
