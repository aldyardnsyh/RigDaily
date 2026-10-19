/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    setupFiles: ['tests/helpers/setup.ts'],
    env: {
      RIGDAILY_DRIVER: 'pglite',
    },
  },
  resolve: {
    alias: {
      // `server-only` adalah penanda build-time Next.js, bukan modul runtime.
      // Di vitest diganti modul kosong agar `lib/repo/*` bisa di-import.
      'server-only': resolve(__dirname, 'tests/helpers/server-only-stub.ts'),
      '@rigdaily/shared': resolve(__dirname, 'packages/shared/src/index.ts'),
      '@rigdaily/database': resolve(__dirname, 'packages/database/src/index.ts'),
      '@': resolve(__dirname, 'apps/web'),
    },
  },
});
