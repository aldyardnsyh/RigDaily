/**
 * Ambil screenshot seluruh halaman untuk dokumentasi README.
 *
 * Menjalankan Next.js production server sebagai child process, login lewat
 * API untuk memperoleh cookie sesi, menyuntikkan cookie ke agent-browser,
 * lalu memotret setiap halaman dalam ukuran 1440x900 (viewport desktop).
 *
 * Jalankan: node scripts/capture-screenshots.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync } from 'node:fs';

const PORT = 3430;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = 'docs/screenshots';

/** [path, nama file, deskripsi singkat] */
const PAGES = [
  ['/login', '01-login', 'Halaman masuk: deteksi IP, waktu server, log aktivitas'],
  ['/dashboard', '02-dashboard', 'Dashboard eksekutif: KPI, tren kedalaman, komposisi waktu'],
  ['/ddr', '03-ddr', 'Daily Drilling Report: form 24 jam dengan validasi'],
  ['/time', '04-time-breakdown', 'Time Breakdown: grid IADC dan rekonsiliasi 24 jam'],
  ['/well-header', '05-well-header', 'Well Header: WELL ID, WELL NAME, DIVISION, FIELD'],
  ['/bits', '06-bits', 'Bits / BHA: riwayat matabor, jam putar, ROP'],
  ['/casing-cement', '07-casing-cement', 'Casing & Cement: desain casing dan program semen'],
  ['/well-file', '08-well-file', 'Well File: profil sumur dan penampang lubang bor'],
  ['/daily-ops', '09-daily-ops', 'Daily Operations: fase completion sampai facilities'],
  ['/safety-survey', '10-safety-survey', 'Safety & Survey: insiden HSE dan directional survey'],
  ['/marine-mac', '11-marine-mac', 'Marine & MAC: marine daily dan dual derrick'],
  ['/personnel', '12-personnel', 'Personnel & POB: kru, man-hours, muster station'],
  ['/performance', '13-performance', 'Performance: ROP, NPT trend, benchmark antar sumur'],
  ['/insights', '14-insights', 'Insights: benchmarking dan KPI terhadap baseline'],
  ['/cost', '15-cost', 'Costs: biaya harian, kumulatif, dan AFE'],
  ['/billing', '16-billing', 'Monthly Billing: tagihan tiered dan flag dispute'],
  ['/reports', '17-reports-library', 'Reports Library: katalog laporan dan distribusi'],
  ['/print', '18-print-preview', 'Print Preview: pratinjau PDF dan cetak'],
  ['/sync', '19-sync-center', 'Sync Center: perangkat, konflik, distribusi'],
  ['/admin', '20-admin', 'Admin Console: monitoring, pengguna, master data'],
  ['/profile', '21-profile', 'Profil & Keamanan: identitas, password, sesi aktif'],
];

function ab(args) {
  return execFileSync('agent-browser', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
}

const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
  cwd: 'apps/web',
  shell: true,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://rigdaily:rigdaily@127.0.0.1:55432/rigdaily',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));

async function waitReady() {
  for (let i = 0; i < 45; i++) {
    await sleep(2000);
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch {
      /* belum siap */
    }
  }
  return false;
}

try {
  mkdirSync(OUT, { recursive: true });

  if (!(await waitReady())) {
    console.error('server tidak siap. Log terakhir:');
    console.error(log.slice(-800));
    process.exit(1);
  }
  console.log(`server siap di ${BASE}`);

  // Login lewat API untuk mendapat cookie sesi.
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@rigdaily.local', password: 'rigdaily123' }),
  });
  const cookies = login.headers.getSetCookie?.() ?? [];
  const pair = cookies.map((c) => c.split(';')[0]).find((p) => p.startsWith('rigdaily_session='));
  if (!pair) {
    console.error('login gagal, cookie sesi tidak diterima');
    process.exit(1);
  }
  const token = pair.slice(pair.indexOf('=') + 1);
  console.log('login OK, cookie sesi diterima');

  // Siapkan browser: buka sesi kosong, set cookie, lalu atur viewport.
  ab(['open']);
  ab(['cookies', 'set', 'rigdaily_session', token, '--url', `${BASE}/`]);
  ab(['set', 'viewport', '1440', '900', '1']);

  let ok = 0;
  for (const [path, name, desc] of PAGES) {
    try {
      ab(['open', `${BASE}${path}`]);
      try {
        ab(['wait', '--load', 'networkidle']);
      } catch {
        /* abaikan: sebagian halaman punya polling */
      }
      await sleep(1700);
      // Urutan argumen penting: `--full` harus SEBELUM path, jika tidak
      // flag tersebut dianggap sebagai nama file tujuan.
      ab(['screenshot', '--full', `${OUT}/${name}.png`]);
      console.log(`OK    ${name.padEnd(22)} ${path}  (${desc})`);
      ok += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
      console.log(`GAGAL ${name.padEnd(22)} ${path} -> ${msg}`);
    }
  }

  console.log(`\n${ok}/${PAGES.length} screenshot tersimpan di ${OUT}`);
  process.exitCode = ok === PAGES.length ? 0 : 1;
} catch (e) {
  console.error('ERROR:', e.message);
  process.exitCode = 1;
} finally {
  try {
    ab(['close', '--all']);
  } catch {
    /* browser mungkin belum terbuka */
  }
  server.kill('SIGTERM');
  await sleep(400);
  process.exit(process.exitCode ?? 0);
}
