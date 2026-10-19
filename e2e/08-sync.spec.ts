import { test, expect } from '@playwright/test';

/** Sync Center: device, pull, konflik, distribusi. */
test.describe('Sync Center', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/sync');
    await expect(page.locator('main')).toBeVisible({ timeout: 30_000 });
  });

  test('daftar device sync tampil', async ({ page }) => {
    const res = await page.request.get('/api/sync/devices');
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { data: { devices?: unknown[] } | unknown[] };
    const devices = Array.isArray(body.data) ? body.data : body.data.devices ?? [];
    expect(devices.length).toBeGreaterThan(0);
    await expect(page.locator('main')).toContainText(/device|perangkat|RIG-/i);
  });

  test('pull mengembalikan perubahan', async ({ page }) => {
    const res = await page.request.get('/api/sync/pull?since=1970-01-01T00:00:00Z');
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { data: { changes: unknown[]; hasMore: boolean } };
    expect(body.data.changes.length).toBeGreaterThan(0);
    expect(typeof body.data.hasMore).toBe('boolean');
  });

  test('daftar konflik dapat dibaca (kosong pun valid)', async ({ page }) => {
    const res = await page.request.get('/api/sync/conflicts');
    expect(res.ok()).toBeTruthy();
  });

  test('aturan distribusi tampil di halaman sync', async ({ page }) => {
    const res = await page.request.get('/api/master/rules');
    expect(res.ok()).toBeTruthy();
    await expect(page.locator('main')).toContainText(/distribusi|Distribusi|rule/i);
  });
});
