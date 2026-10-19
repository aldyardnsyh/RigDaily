import { test, expect } from '@playwright/test';
import { uniqueSuffix } from './helpers/auth';

/** Admin Console: pengguna, IADC, rate card, KPI, audit, device. */
test.describe('Admin Console', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('main')).toBeVisible({ timeout: 30_000 });
  });

  test('daftar pengguna memuat 7 akun seed', async ({ page }) => {
    const res = await page.request.get('/api/admin/users');
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBeGreaterThanOrEqual(7);
    await expect(page.locator('main')).toContainText(/Pengguna|Users|Akses/i);
  });

  test('kode IADC master berisi 34 kode', async ({ page }) => {
    const res = await page.request.get('/api/master/iadc');
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBe(34);
  });

  test('toggle NPT pada kode IADC tersimpan dan bisa dikembalikan', async ({ page }) => {
    const before = (await (await page.request.get('/api/master/iadc')).json()) as {
      data: Array<{ code: string; nptDefault: boolean }>;
    };
    const target = before.data.find((c) => c.code === '01');
    expect(target).toBeTruthy();

    const patch = await page.request.patch('/api/master/iadc/01', { data: { nptDefault: !target!.nptDefault } });
    expect(patch.ok()).toBeTruthy();

    const after = (await (await page.request.get('/api/master/iadc')).json()) as {
      data: Array<{ code: string; nptDefault: boolean }>;
    };
    expect(after.data.find((c) => c.code === '01')?.nptDefault).toBe(!target!.nptDefault);

    await page.request.patch('/api/master/iadc/01', { data: { nptDefault: target!.nptDefault } });
  });

  test('membuat pengguna baru berhasil', async ({ page }) => {
    const suffix = uniqueSuffix();
    const email = `e2e.${suffix}@rigdaily.local`;
    const res = await page.request.post('/api/admin/users', {
      data: { name: `Uji E2E ${suffix}`, email, role: 'Viewer', rigScope: [] },
    });
    expect([200, 201]).toContain(res.status());

    const list = (await (await page.request.get('/api/admin/users')).json()) as {
      data: Array<{ email: string }>;
    };
    expect(list.data.some((u) => u.email === email)).toBe(true);
  });

  test('membuat pengguna dengan email duplikat ditolak', async ({ page }) => {
    const res = await page.request.post('/api/admin/users', {
      data: { name: 'Duplikat', email: 'admin@rigdaily.local', role: 'Viewer', rigScope: [] },
    });
    expect([409, 400]).toContain(res.status());
  });

  test('audit log berisi entri', async ({ page }) => {
    const res = await page.request.get('/api/admin/audit?limit=20');
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBeGreaterThan(0);
  });

  test('halaman admin menampilkan domain IADC dan audit', async ({ page }) => {
    await expect(page.locator('main')).toContainText(/IADC/i);
    await expect(page.locator('main')).toContainText(/[Aa]udit/);
  });
});
