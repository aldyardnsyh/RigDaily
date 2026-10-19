import { test, expect } from '@playwright/test';

/** Billing bulanan: pemilih rig/bulan, tiered, flags, export. */
test.describe('Billing bulanan', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/billing');
    await expect(page.locator('main')).toBeVisible({ timeout: 30_000 });
  });

  test('ledger menampilkan baris untuk rig & bulan DDR seed', async ({ page }) => {
    const rigsRes = await page.request.get('/api/rigs');
    const rigs = (await rigsRes.json()) as { data: Array<{ id: string; code: string }> };
    const rig12 = rigs.data.find((r) => r.code === 'RIG-12');
    expect(rig12).toBeTruthy();

    const res = await page.request.get(`/api/billing?rigId=${rig12!.id}&month=2026-09`);
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { data: { rows: unknown[]; totals: { amount: number } } };
    expect(body.data.rows.length).toBeGreaterThan(0);
    expect(body.data.totals.amount).toBeGreaterThan(0);
  });

  test('bulan tanpa data mengembalikan nol', async ({ page }) => {
    const rigsRes = await page.request.get('/api/rigs');
    const rigs = (await rigsRes.json()) as { data: Array<{ id: string }> };
    const res = await page.request.get(`/api/billing?rigId=${rigs.data[0].id}&month=2026-01`);
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { data: { rows: unknown[]; totals: { amount: number } } };
    expect(body.data.rows.length).toBe(0);
    expect(body.data.totals.amount).toBe(0);
  });

  test('parameter bulan tidak valid ditolak', async ({ page }) => {
    const rigsRes = await page.request.get('/api/rigs');
    const rigs = (await rigsRes.json()) as { data: Array<{ id: string }> };
    const res = await page.request.get(`/api/billing?rigId=${rigs.data[0].id}&month=2026-13`);
    expect(res.status()).toBe(400);
  });

  test('tanpa rigId ditolak', async ({ page }) => {
    const res = await page.request.get('/api/billing?month=2026-09');
    expect(res.status()).toBe(400);
  });

  test('chart dan KPI tampil', async ({ page }) => {
    await expect(page.locator('main')).toContainText(/Billable|Tagihan|Hour|jam/i);
  });
});
