import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Playwright config - E2E RigDaily Internal.
 *
 * Memakai build PRODUKSI (`next start`) agar lebih hemat memori dan menguji
 * artefak yang benar-benar dikirim ke VPS.
 *
 * Sesi login dipakai ulang lewat `storageState` (diisi global-setup) supaya
 * rate limit login (5 percobaan / 15 menit) tidak terpicu oleh banyak test.
 */
const PORT = Number(process.env.E2E_PORT ?? 3400);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const STATE = join(__dirname, 'e2e', '.auth', 'admin.json');

const webServerDisabled = process.env.PW_SKIP_WEBSERVER === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { outputFolder: 'e2e-report', open: 'never' }]],
  globalSetup: require.resolve('./e2e/global-setup'),
  use: {
    baseURL: BASE_URL,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    storageState: existsSync(STATE) ? STATE : undefined,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: webServerDisabled
    ? undefined
    : {
        command: `npx next start -p ${PORT}`,
        cwd: 'apps/web',
        url: `${BASE_URL}/api/health`,
        reuseExistingServer: true,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
        env: {
          NODE_ENV: 'production',
          PORT: String(PORT),
          DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgres://rigdaily:rigdaily@127.0.0.1:55432/rigdaily',
          RIGDAILY_SKIP_AUTOMIGRATE: '1',
        },
      },
});
