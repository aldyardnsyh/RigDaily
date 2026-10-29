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

/*
 * Identitas build: disuntik saat build agar setiap deployment membawa jejak
 * asalnya (vendor, edisi, commit, waktu build). Dibaca oleh /api/health.
 * Nilai default aman untuk build lokal tanpa CI.
 */
process.env.APP_EDITION = process.env.APP_EDITION ?? 'community';
process.env.BUILD_COMMIT = process.env.BUILD_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'local';
process.env.BUILD_TIME = process.env.BUILD_TIME ?? new Date().toISOString();

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@rigdaily/ui'],
  experimental: {
    // Paket yang WAJIB di-resolve saat runtime (bukan di-bundle):
    // PGlite memuat WASM, pdfkit memuat file font/afm, pg butuh modul Node bawaan.
    serverComponentsExternalPackages: ['@electric-sql/pglite', 'pdfkit', 'pg', 'pg-native'],
    // Trace dari root monorepo supaya node_modules hoisted (PGlite WASM,
    // data font PDF) ikut terbawa ke output serverless Vercel.
    outputFileTracingRoot: repoRoot,
    outputFileTracingIncludes: {
      '/*': [
        '../../node_modules/@electric-sql/pglite/**/*',
        './node_modules/@electric-sql/pglite/**/*',
        '../../node_modules/pdfkit/js/data/**/*',
        './node_modules/pdfkit/js/data/**/*',
      ],
    },
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
