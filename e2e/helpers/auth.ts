import { expect, type Page } from '@playwright/test';

export const CREDENTIALS = {
  admin: { email: 'admin@rigdaily.local', password: 'rigdaily123' },
  companyMan: { email: 'dave.miller@medco-energi.com', password: 'rigdaily123' },
  clerk: { email: 's.jenkins@medco-energi.com', password: 'rigdaily123' },
  viewer: { email: 'h.setiawan@pertamina-jv.com', password: 'rigdaily123' },
} as const;

export type RoleKey = keyof typeof CREDENTIALS;

/**
 * Login manual lewat form.
 *
 * CATATAN: endpoint login punya rate limit (5 percobaan / 15 menit), jadi
 * hampir semua spec memakai `storageState` dari global-setup dan TIDAK
 * memanggil fungsi ini. Pakai hanya untuk menguji alur login itu sendiri.
 */
export async function login(page: Page, opts?: { email?: string; password?: string }): Promise<void> {
  const email = opts?.email ?? CREDENTIALS.admin.email;
  const password = opts?.password ?? CREDENTIALS.admin.password;

  await page.goto('/login');
  await page.locator('#login-email').fill(email);
  await page.locator('#login-pass').fill(password);
  await page.locator('.auth-primary').click();
  await page.waitForURL(/\/dashboard/, { timeout: 45_000 });
}

export function uniqueSuffix(): string {
  return Date.now().toString(36).slice(-6);
}

export async function latestReportId(page: Page): Promise<string> {
  const res = await page.request.get('/api/reports?limit=1');
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { data: { items: Array<{ id: string }> } };
  expect(body.data.items.length).toBeGreaterThan(0);
  return body.data.items[0].id;
}

export async function reportDetail(page: Page, id: string): Promise<Record<string, unknown>> {
  const res = await page.request.get(`/api/reports/${id}`);
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { data: Record<string, unknown> };
  return body.data;
}

export async function dashboardKpi(page: Page): Promise<Record<string, number | null>> {
  const res = await page.request.get('/api/dashboard');
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { data: { kpi: Record<string, number | null> } };
  return body.data.kpi;
}
