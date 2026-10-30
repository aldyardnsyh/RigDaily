/**
 * Rebuild better-sqlite3 terhadap ABI Electron (bukan Node sistem).
 *
 * Dipanggil via `npm run rebuild:native` SEBELUM `npm run dist`.
 * Jangan digabung ke `dist` karena butuh electron-rebuild yang tidak boleh
 * ikut terkirim ke production dependencies.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// apps/desktop/scripts -> apps/desktop
const appDir = join(here, '..');
process.chdir(appDir);

const require = createRequire(join(appDir, 'package.json'));
const { rebuild } = require('electron-rebuild/lib/src/rebuild.js');

await rebuild({
  buildPath: appDir,
  force: true,
  onlyModules: ['better-sqlite3'],
  electronVersion: '31.7.7', // ABI 125. Sinkron dengan devDependencies electron.
});
console.log('[rebuild:native] better-sqlite3 OK untuk Electron 31 (ABI 125)');
