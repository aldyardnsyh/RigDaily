/** @type {import('next').NextConfig} */
const path = require('node:path');
const { loadRootEnv } = require('./load-root-env');

// Muat .env.local dari ROOT monorepo (Next hanya membaca dari apps/web/).
const repoRoot = path.join(__dirname, '../..');
const envLoad = loadRootEnv(repoRoot);
if (envLoad.applied > 0) {
  console.log(`[env] ${envLoad.applied} variabel dimuat dari: ${envLoad.files.join(', ')}`);
}

const isStandalone = process.env.NEXT_OUTPUT === 'standalone';

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@rigdaily/ui'],
  experimental: {
    // Paket yang WAJIB di-resolve saat runtime (bukan di-bundle):
    // PGlite memuat WASM, pdfkit memuat file font/afm, pg butuh modul Node bawaan.
    serverComponentsExternalPackages: ['@electric-sql/pglite', 'pdfkit', 'pg', 'pg-native'],
    ...(isStandalone ? { outputFileTracingRoot: repoRoot } : {}),
  },
  webpack: (config, { isServer, nextRuntime }) => {
    if (isServer && nextRuntime === 'nodejs') {
      const externals = Array.isArray(config.externals)
        ? config.externals
        : [config.externals].filter(Boolean);
      // `pg-native` bersifat opsional di dalam `pg`; tanpa entri ini webpack
      // memunculkan "Module not found: Can't resolve 'pg-native'".
      // `@electric-sql/pglite` memuat berkas WASM yang tidak bisa di-bundle.
      externals.push('pg-native', '@electric-sql/pglite');
      config.externals = externals;
    }
    return config;
  },
  output: isStandalone ? 'standalone' : undefined,
  eslint: { ignoreDuringBuilds: true },
};

module.exports = nextConfig;
