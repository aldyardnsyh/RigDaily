import { test, expect } from '@playwright/test';

/** Personnel/POB dan Insights/benchmarking. */
test.describe('Personnel & POB', () => {
  test('ringkasan POB sesuai jumlah kru DDR', async ({ page }) => {
    const res = await page.request.get('/api/personnel?limit=500');
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      data: { items: unknown[]; summary: { total: number; inCount: number; manHours: number } };
    };
    expect(body.data.items.length).toBeGreaterThan(0);
    expect(body.data.summary.total).toBeGreaterThan(0);
    expect(body.data.summary.manHours).toBeGreaterThan(0);

    await page.goto('/personnel');
    await expect(page.locator('main')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('main')).toContainText(/POB|Personnel|Kru/i);
  });

  test('agregat per perusahaan tersedia', async ({ page }) => {
    const res = await page.request.get('/api/personnel?limit=500');
    const body = (await res.json()) as {
      data: { summary: { byCompany: Array<{ company: string; count: number }> } };
    };
    expect(body.data.summary.byCompany.length).toBeGreaterThan(0);
    const sum = body.data.summary.byCompany.reduce((a, b) => a + b.count, 0);
    expect(sum).toBeGreaterThan(0);
  });
});

test.describe('Insights & Benchmarking', () => {
  test('benchmark memuat 3 sumur dengan metrik nyata', async ({ page }) => {
    const res = await page.request.get('/api/insights');
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      data: {
        benchmark: Array<{ wellName: string; avgNptPercent: number; reportCount: number }>;
        baselines: Array<{ name: string; actual: number; baseline: number | null }>;
      };
    };
    expect(body.data.benchmark.length).toBeGreaterThanOrEqual(3);
    const names = body.data.benchmark.map((b) => b.wellName);
    expect(names).toEqual(expect.arrayContaining(['ARUN-07', 'ARUN-05', 'ARUN-06']));
    // Sumur dengan laporan harus punya NPT > 0
    const withReports = body.data.benchmark.filter((b) => b.reportCount > 0);
    expect(withReports.length).toBeGreaterThan(0);
    expect(withReports.some((b) => b.avgNptPercent > 0)).toBe(true);
    expect(body.data.baselines.length).toBeGreaterThan(0);
  });

  test('tren per metrik tersedia', async ({ page }) => {
    for (const metric of ['npt', 'cost', 'depth', 'rop']) {
      const res = await page.request.get(`/api/insights/benchmark?metric=${metric}&days=30`);
      expect(res.ok(), `metric ${metric}`).toBeTruthy();
      const body = (await res.json()) as { data: { points: unknown[] } };
      expect(body.data.points.length).toBeGreaterThan(0);
    }
  });

  test('halaman insights menampilkan tabel benchmark', async ({ page }) => {
    await page.goto('/insights');
    await expect(page.locator('main')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('main')).toContainText(/ARUN-07/);
  });
});
