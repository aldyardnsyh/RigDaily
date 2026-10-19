import { test, expect } from '@playwright/test';
import { latestReportId, dashboardKpi } from './helpers/auth';

/** Cost & AFE: konsistensi angka (P1-2) dan operasi cost line. */
test.describe('Cost & AFE', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/cost');
    await expect(page.locator('main')).toBeVisible({ timeout: 30_000 });
  });

  test('KPI biaya harian konsisten dengan API dashboard', async ({ page }) => {
    const kpi = await dashboardKpi(page);
    const cost = Number(kpi.dailyCost);
    if (cost > 0) {
      const formatted = Math.round(cost).toLocaleString('en-US');
      await expect(page.locator('main')).toContainText(new RegExp(formatted.replace(/,/g, ',?')));
    }
  });

  test('AFE terpakai konsisten dengan kumulatif (bukan jalur berbeda)', async ({ page }) => {
    const res = await page.request.get('/api/dashboard');
    const body = (await res.json()) as {
      data: { kpi: { cumulativeCost: number; afeBudget: number | null; afeConsumedPercent: number | null } };
    };
    const k = body.data.kpi;
    if (k.afeBudget && k.afeBudget > 0) {
      const expected = Math.round((k.cumulativeCost / k.afeBudget) * 100 * 100) / 100;
      expect(Math.abs(Number(k.afeConsumedPercent) - expected)).toBeLessThan(0.05);
    }
  });

  test('tabel cost line menampilkan data', async ({ page }) => {
    const id = await latestReportId(page);
    const res = await page.request.get(`/api/reports/${id}/costs`);
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { data: { lines: unknown[] } };
    expect(body.data.lines.length).toBeGreaterThan(0);
    await expect(page.locator('table').first()).toBeVisible();
  });

  test('tambah cost line dengan nominal 0 ditolak', async ({ page }) => {
    const id = await latestReportId(page);
    const d = (await page.request.get(`/api/reports/${id}`).then((r) => r.json())) as { data: { status: string } };
    test.skip(d.data.status !== 'draft', 'Cost line hanya bisa ditambah pada laporan draft');

    const res = await page.request.post(`/api/reports/${id}/costs`, {
      data: { category: 'Rig Spread', description: 'Uji nol', amount: 0 },
    });
    expect(res.status()).toBe(400);
  });

  test('halaman cost menampilkan breakdown kategori', async ({ page }) => {
    await expect(page.locator('main')).toContainText(/Rig Spread|kategori|Kategori/i);
  });
});
