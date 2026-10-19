import { test, expect } from '@playwright/test';
import { CREDENTIALS, login } from './helpers/auth';

// Spec ini menguji form login, jadi mulai TANPA sesi tersimpan.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Auth - login, proteksi rute, logout', () => {
  test('halaman /login menampilkan form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('#login-email')).toBeVisible();
    await expect(page.locator('#login-pass')).toBeVisible();
    await expect(page.locator('.auth-primary')).toBeVisible();
  });

  test('password salah ditolak dan tetap di /login', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#login-email').fill(CREDENTIALS.admin.email);
    await page.locator('#login-pass').fill('password-salah-sekali');
    await page.locator('.auth-primary').click();

    await expect(page.locator('#login-error')).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test('login benar mengarah ke dashboard', async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('rute terproteksi tanpa sesi dialihkan ke /login', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/ddr');
    await expect(page).toHaveURL(/\/login/);
    expect(page.url()).toContain('next=');
  });

  test('logout mengakhiri sesi', async ({ page }) => {
    await login(page);

    // Buka menu pengguna lalu klik keluar.
    const menuButton = page.getByRole('button', { name: /menu akun/i }).first();
    await menuButton.click();
    await page.getByRole('menuitem', { name: /keluar/i }).click();

    await page.waitForURL(/\/login/, { timeout: 30_000 });

    // Setelah logout, rute terproteksi harus mengalihkan lagi.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});
