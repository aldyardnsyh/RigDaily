import { test, expect } from '@playwright/test';

/** Profil & keamanan: data profil, ganti password, sesi aktif. */
test.describe('Profil & Keamanan', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/profile');
    await expect(page.locator('main')).toBeVisible({ timeout: 30_000 });
  });

  test('profil menampilkan identitas dan role', async ({ page }) => {
    const res = await page.request.get('/api/auth/me');
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      data: { user: { name: string; email: string; role: string }; profile: { permissions: string[] } };
    };
    expect(body.data.profile.permissions.length).toBeGreaterThan(0);

    await expect(page.locator('main')).toContainText(body.data.user.email);
    await expect(page.locator('main')).toContainText(/Administrator|Admin/i);
  });

  test('PATCH profil menyimpan nama dan bisa dikembalikan', async ({ page }) => {
    const me = (await (await page.request.get('/api/auth/me')).json()) as {
      data: { user: { name: string } };
    };
    const original = me.data.user.name;

    const res = await page.request.patch('/api/auth/me', { data: { name: `${original} E2E` } });
    expect(res.ok()).toBeTruthy();

    const after = (await (await page.request.get('/api/auth/me')).json()) as {
      data: { user: { name: string } };
    };
    expect(after.data.user.name).toBe(`${original} E2E`);

    await page.request.patch('/api/auth/me', { data: { name: original } });
  });

  test('email duplikat ditolak 409', async ({ page }) => {
    const me = (await (await page.request.get('/api/auth/me')).json()) as {
      data: { user: { email: string } };
    };
    // Pakai email milik user lain yang sudah ada.
    const res = await page.request.patch('/api/auth/me', {
      data: { email: 'dave.miller@medco-energi.com' },
    });
    if (me.data.user.email !== 'dave.miller@medco-energi.com') {
      expect(res.status()).toBe(409);
    }
  });

  test('ganti password dengan password lama salah ditolak', async ({ page }) => {
    const res = await page.request.post('/api/auth/password', {
      data: { currentPassword: 'salah-sekali', newPassword: 'PasswordBaru123', confirmPassword: 'PasswordBaru123' },
    });
    expect([400, 401]).toContain(res.status());
  });

  test('ganti password dengan konfirmasi tidak cocok ditolak', async ({ page }) => {
    const res = await page.request.post('/api/auth/password', {
      data: { currentPassword: 'rigdaily123', newPassword: 'PasswordBaru123', confirmPassword: 'Berbeda123' },
    });
    expect(res.status()).toBe(400);
  });

  test('daftar sesi aktif menandai sesi ini', async ({ page }) => {
    const res = await page.request.get('/api/auth/sessions');
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { data: Array<{ current: boolean }> };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.some((s) => s.current)).toBe(true);
  });

  test('menu akun tersedia di topbar', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: /menu akun/i }).first()).toBeVisible({ timeout: 30_000 });
  });
});
