import { test, expect } from '@playwright/test';
import { dashboardKpi } from './helpers/auth';

test.describe('Dashboard - KPI & navigasi', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
  });

  test('KPI menampilkan angka nyata dari API', async ({ page }) => {
    const kpi = await dashboardKpi(page);
    const depth = Number(kpi.depthToday);
    expect(depth).toBeGreaterThan(0);

    // Nilai depth dirender oleh KpiCard (format 1 desimal).
    await expect(page.getByText(new RegExp(`${depth.toFixed(1)}`)).first()).toBeVisible();
  });

  test('NPT % konsisten antara API dan tampilan', async ({ page }) => {
    const kpi = await dashboardKpi(page);
    const npt = Number(kpi.nptPercent);
    expect(npt).toBeGreaterThan(0);

    // Dashboard merender NPT dengan 2 desimal.
    await expect(page.getByText(new RegExp(`${npt.toFixed(2)}%`)).first()).toBeVisible();
  });

  test('tabel laporan terbaru punya baris data', async ({ page }) => {
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test('tombol Buat DDR Baru mengarah ke /ddr', async ({ page }) => {
    // Tombol memakai aria-label "Buat Daily Drilling Report baru",
    // sehingga nama aksesibelnya bukan teks visual. Pakai aria-label.
    await page.getByRole('button', { name: /Buat Daily Drilling Report baru/i }).click();
    await expect(page).toHaveURL(/\/ddr/, { timeout: 30_000 });
  });

  test('total biaya harian tampil sesuai API', async ({ page }) => {
    const kpi = await dashboardKpi(page);
    const cost = Number(kpi.dailyCost);
    if (Number.isFinite(cost) && cost > 0) {
      // Format mata uang ribuan dipisah koma, mis. 50,250
      const intPart = Math.round(cost).toLocaleString('en-US');
      await expect(page.getByText(new RegExp(intPart.replace(/,/g, ',?'))).first()).toBeVisible();
    }
  });
});
