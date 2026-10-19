/**
 * Wrapper `next dev` untuk monorepo.
 *
 * Kenapa ada: `next.config.js` dieksekusi TIDAK terprediksi (bisa lebih dari
 * sekali, dan tidak selalu pada saat yang tepat untuk I/O async). Karena itu
 * persiapan database (cek skema + migrasi otomatis) dijalankan di sini —
 * proses Node murni sebelum Next dimulai.
 *
 * Pemakaian: `npm run dev` -> script ini -> spawn `next dev`.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const { loadRootEnv } = require('./load-root-env');
const { ensureSchema } = require('./ensure-schema');

const repoRoot = path.join(__dirname, '..', '..');
const { files, applied } = loadRootEnv(repoRoot);
if (applied > 0) console.log(`[env] ${applied} variabel dimuat dari: ${files.join(', ')}`);

async function main() {
  await ensureSchema(repoRoot);

  const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['next', 'dev'], {
    stdio: 'inherit',
    env: process.env,
    cwd: __dirname,
    shell: process.platform === 'win32',
  });

  const forward = (sig) => () => {
    if (!child.killed) child.kill(sig);
  };
  process.on('SIGINT', forward('SIGINT'));
  process.on('SIGTERM', forward('SIGTERM'));

  child.on('exit', (code) => process.exit(code ?? 0));
  child.on('error', (err) => {
    console.error('[dev] gagal menjalankan next dev:', err.message);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error('[dev] error:', err);
  process.exit(1);
});
