import { test, expect } from '@playwright/test';

/**
 * CROSS-MODULE - membuktikan data yang sama mengalir konsisten antar modul.
 *
 * Inilah bukti bahwa aplikasi bukan sekumpulan halaman terpisah: satu angka
 * (kedalaman, jam, biaya, POB, NPT) harus identik di semua tempat yang
 * menampilkannya, karena semuanya berasal dari satu ledger di PostgreSQL.
 *
 * CATATAN SEMANTIK (penting, bukan bug):
 *  - `/api/dashboard` TANPA `wellId` = agregat portofolio (semua sumur).
 *  - `/api/dashboard?wellId=X` = angka sumur X.
 *  - `/api/insights` = RATA-RATA seluruh laporan per sumur, bukan laporan
 *    terbaru. Jadi membandingkan NPT Insights dengan dashboard GLOBAL memang
 *    berbeda; yang sebanding adalah dashboard per sumur pada sumur yang sama.
 */
test.describe('Integrasi lintas modul', () => {
  test('kedalaman & jam DDR konsisten di Dashboard, DDR, Time, Well File', async ({ page }) => {
    const listRes = await page.request.get('/api/reports?limit=1');
    const list = (await listRes.json()) as {
      data: {
        items: Array<{
          id: string;
          reportNo: number;
          wellId: string;
          wellName: string;
          depthMdEnd: number;
          totalMinutes: number;
          nptPercent: number;
          costDailyUsd: number;
        }>;
      };
    };
    const latest = list.data.items[0];
    expect(latest).toBeTruthy();

    const detail = (await (await page.request.get(`/api/reports/${latest.id}`)).json()) as {
      data: { totalMinutes: number; depthMdEnd: number };
    };

    // 1. API detail == API list (sumber sama)
    expect(Number(detail.data.depthMdEnd)).toBeCloseTo(Number(latest.depthMdEnd), 1);
    expect(Number(detail.data.totalMinutes)).toBe(Number(latest.totalMinutes));

    // 2. Dashboard PER SUMUR menampilkan kedalaman yang sama
    const kpi = (await (
      await page.request.get(`/api/dashboard?wellId=${latest.wellId}`)
    ).json()) as {
      data: { kpi: { depthToday: number; nptPercent: number; dailyCost: number } };
    };
    expect(Number(kpi.data.kpi.depthToday)).toBeCloseTo(Number(latest.depthMdEnd), 1);
    expect(Number(kpi.data.kpi.nptPercent)).toBeCloseTo(Number(latest.nptPercent), 2);
    expect(Number(kpi.data.kpi.dailyCost)).toBeCloseTo(Number(latest.costDailyUsd), 2);

    // 3. Well File menampilkan kedalaman terakhir yang sama
    const well = (await (await page.request.get('/api/wells')).json()) as {
      data: Array<{ id: string; latestDepthMd: number | null }>;
    };
    const w = well.data.find((x) => x.id === latest.wellId);
    if (w && w.latestDepthMd != null) {
      expect(Number(w.latestDepthMd)).toBeCloseTo(Number(latest.depthMdEnd), 1);
    }

    // 4. Time breakdown: total menit == total laporan
    expect(Number(detail.data.totalMinutes)).toBe(1440);
  });

  test('POB di /personnel mencakup kru DDR', async ({ page }) => {
    const list = (await (await page.request.get('/api/reports?limit=1')).json()) as {
      data: { items: Array<{ id: string }> };
    };
    const id = list.data.items[0].id;

    const detail = (await (await page.request.get(`/api/reports/${id}`)).json()) as {
      data: { crew: unknown[] };
    };
    const pob = (await (await page.request.get('/api/personnel?limit=500')).json()) as {
      data: { items: unknown[] };
    };

    expect(detail.data.crew.length).toBeGreaterThan(0);
    expect(pob.data.items.length).toBeGreaterThanOrEqual(detail.data.crew.length);
  });

  test('NPT Insights (rata-rata sumur) konsisten dengan perhitungan laporan', async ({ page }) => {
    const insights = (await (await page.request.get('/api/insights')).json()) as {
      data: { benchmark: Array<{ wellId: string; wellName: string; avgNptPercent: number; reportCount: number }> };
    };

    // Pilih satu sumur yang punya laporan.
    const target = insights.data.benchmark.find((b) => b.reportCount > 0);
    expect(target).toBeTruthy();

    // Hitung ulang rata-rata NPT dari laporan sumur tersebut lewat API.
    const reports = (await (
      await page.request.get(`/api/reports?wellId=${target!.wellId}&limit=50`)
    ).json()) as {
      data: { items: Array<{ nptPercent: number }> };
    };
    const items = reports.data.items.filter((r) => Number.isFinite(r.nptPercent));
    expect(items.length).toBeGreaterThan(0);
    const manualAvg = items.reduce((a, r) => a + Number(r.nptPercent), 0) / items.length;

    // Insights = rata-rata semua laporan sumur itu.
    expect(Number(target!.avgNptPercent)).toBeCloseTo(manualAvg, 1);
  });

  test('biaya kumulatif: portofolio (tanpa wellId) = jumlah per sumur', async ({ page }) => {
    const portfolio = (await (await page.request.get('/api/dashboard')).json()) as {
      data: { kpi: { cumulativeCost: number } };
    };
    const wells = (await (await page.request.get('/api/wells')).json()) as {
      data: Array<{ id: string }>;
    };

    let sumPerWell = 0;
    for (const w of wells.data) {
      const perWell = (await (await page.request.get(`/api/dashboard?wellId=${w.id}`)).json()) as {
        data: { kpi: { cumulativeCost: number } };
      };
      sumPerWell += Number(perWell.data.kpi.cumulativeCost);
    }

    expect(sumPerWell).toBeGreaterThan(0);
    expect(Number(portfolio.data.kpi.cumulativeCost)).toBeCloseTo(sumPerWell, 2);
  });

  test('setiap halaman utama dapat dibuka tanpa error', async ({ page }) => {
    const pages = [
      '/dashboard',
      '/ddr',
      '/time',
      '/cost',
      '/well-file',
      '/daily-ops',
      '/marine-mac',
      '/safety-survey',
      '/personnel',
      '/insights',
      '/billing',
      '/reports',
      '/sync',
      '/admin',
      '/profile',
    ];
    for (const p of pages) {
      const res = await page.goto(p);
      expect(res?.status(), `halaman ${p}`).toBe(200);
      await expect(page.locator('main')).toBeVisible();
    }
  });

  test('navigasi sidebar menuju semua modul tanpa link mati', async ({ page }) => {
    await page.goto('/dashboard');
    const hrefs = await page.locator('aside nav a').evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).getAttribute('href')).filter(Boolean),
    );
    expect(hrefs.length).toBeGreaterThanOrEqual(13);
    for (const href of hrefs) {
      const res = await page.goto(href as string);
      expect(res?.status(), `nav ${href}`).toBe(200);
    }
  });
});
