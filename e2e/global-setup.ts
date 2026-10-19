import { chromium, request, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Global setup: login SEKALI lalu simpan cookie sesi ke `e2e/.auth/admin.json`.
 *
 * Alasan: endpoint login punya rate limit 5 percobaan / 15 menit per IP+email.
 * Bila setiap test login ulang, test ke-6 dan seterusnya akan mendapat 429 dan
 * gagal bukan karena bug aplikasi.
 */
const STATE_DIR = join(__dirname, '.auth');
const STATE_FILE = join(STATE_DIR, 'admin.json');
const BASE_URL = `http://127.0.0.1:${process.env.E2E_PORT ?? 3400}`;

export default async function globalSetup(): Promise<void> {
  mkdirSync(STATE_DIR, { recursive: true });

  const api = await request.newContext({ baseURL: BASE_URL });
  const res = await api.post('/api/auth/login', {
    data: { email: 'admin@rigdaily.local', password: 'rigdaily123' },
  });

  expect(res.ok(), `login global gagal (status ${res.status()})`).toBeTruthy();

  // Ambil cookie sesi dari respons lalu tanam ke storageState browser.
  const setCookie = res.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie');
  const cookies = setCookie.map((h) => {
    const [pair] = h.value.split(';');
    const [name, ...rest] = pair.split('=');
    return {
      name: name.trim(),
      value: rest.join('=').trim(),
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax' as const,
      expires: -1,
    };
  });

  expect(cookies.length, 'cookie sesi tidak diterima dari /api/auth/login').toBeGreaterThan(0);

  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addCookies(cookies);
  await context.storageState({ path: STATE_FILE });
  await browser.close();
  await api.dispose();
}
