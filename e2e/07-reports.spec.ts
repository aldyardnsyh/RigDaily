import { test, expect } from '@playwright/test';

/** Reports Library: daftar, PDF, distribusi, import CSV. */
test.describe('Reports Library', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/reports');
    await expect(page.locator('main')).toBeVisible({ timeout: 30_000 });
  });

  test('daftar memuat semua DDR seed (>= 3)', async ({ page }) => {
    const res = await page.request.get('/api/reports?limit=50');
    const body = (await res.json()) as { data: { items: unknown[]; total: number } };
    expect(body.data.total).toBeGreaterThanOrEqual(3);
    await expect(page.locator('main')).toContainText(/145|DDR/i);
  });

  test('PDF per laporan dapat diakses', async ({ page }) => {
    const res = await page.request.get('/api/reports?limit=1');
    const body = (await res.json()) as { data: { items: Array<{ id: string }> } };
    const id = body.data.items[0].id;
    const pdf = await page.request.get(`/api/reports/${id}/pdf?type=ddr`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
  });

  test('distribusi dry-run tidak mengirim email', async ({ page }) => {
    const res = await page.request.post('/api/reports/distribute', { data: { dryRun: true } });
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { data: { queued: number; sent: number; failed: number } };
    expect(body.data.sent).toBe(0);
    expect(body.data.failed).toBe(0);
  });

  test('toggle aturan distribusi tersimpan', async ({ page }) => {
    const rulesRes = await page.request.get('/api/master/rules');
    const rules = (await rulesRes.json()) as { data: { rules: Array<{ id: string; active: boolean }> } };
    const rule = rules.data.rules[0];
    expect(rule).toBeTruthy();

    const patch = await page.request.patch(`/api/master/rules/${rule.id}`, { data: { active: !rule.active } });
    expect(patch.ok()).toBeTruthy();

    const after = (await (await page.request.get('/api/master/rules')).json()) as {
      data: { rules: Array<{ id: string; active: boolean }> };
    };
    expect(after.data.rules.find((r) => r.id === rule.id)?.active).toBe(!rule.active);

    // kembalikan
    await page.request.patch(`/api/master/rules/${rule.id}`, { data: { active: rule.active } });
  });

  test('import CSV menolak kolom wajib yang hilang', async ({ page }) => {
    const wellsRes = await page.request.get('/api/wells');
    const wells = (await wellsRes.json()) as { data: Array<{ id: string }> };
    const res = await page.request.post('/api/reports/import', {
      data: { csv: 'foo,bar\n1,2', wellId: wells.data[0].id },
    });
    // 400 (body tidak valid) / 422, atau 201 dengan errorCount > 0 (header tak dikenal)
    if (res.status() === 200 || res.status() === 201) {
      const body = (await res.json()) as { data: { errorCount: number } };
      expect(body.data.errorCount).toBeGreaterThan(0);
    } else {
      expect([400, 422]).toContain(res.status());
    }
  });

  test('pencarian menyaring daftar', async ({ page }) => {
    const search = page.locator('#report-search');
    if (await search.count()) {
      await search.fill('145');
      await page.waitForTimeout(600);
      await expect(page.locator('main')).toContainText(/145/);
    }
  });
});
