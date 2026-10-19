/**
 * Helper toast (sonner).
 *
 * Semua aksi mutasi di RigDaily memberi umpan balik lewat `toast` sonner yang
 * di-render di region `aria-live`. Tidak ada `data-testid` pada toast, jadi
 * locator memakai region live + teks pesan (stabil karena pesan berasal dari
 * kode aplikasi, bukan data).
 */
import { expect, type Page } from '@playwright/test';

export function toastRegion(page: Page) {
  return page.locator('[data-sonner-toaster]');
}

/** Tunggu toast yang berisi `text` muncul (substring, case-insensitive). */
export async function expectToast(page: Page, text: string | RegExp, timeout = 15_000) {
  const region = toastRegion(page);
  await expect(region).toBeVisible({ timeout });
  await expect(region).toContainText(text, { timeout });
  return region;
}

/** Tunggu toast hilang (sonner auto-dismiss) agar tidak menutupi klik berikutnya. */
export async function dismissToasts(page: Page) {
  const items = page.locator('[data-sonner-toast]');
  const count = await items.count();
  for (let i = 0; i < count; i += 1) {
    await items.nth(0).click({ timeout: 2000 }).catch(() => undefined);
  }
}
