// Jalankan server produksi, uji endpoint, lalu matikan. Satu proses, tanpa job.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 3411;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = 'apps/web';

const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
  cwd: ROOT,
  shell: true,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://rigdaily:rigdaily@127.0.0.1:55432/rigdaily',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d.toString()));
server.stderr.on('data', (d) => (serverLog += d.toString()));

let cookie = '';
const results = [];
const rec = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(44)} ${detail ?? ''}`);
};

async function req(path, opts = {}) {
  const headers = { ...(opts.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  if (opts.body) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + path, { ...opts, headers, redirect: 'manual' });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const p = c.split(';')[0];
    if (p.startsWith('rigdaily_session=')) cookie = p;
  }
  return res;
}
const asJson = async (r) => {
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    return { raw: t };
  }
};

async function waitReady(maxSec = 90) {
  for (let i = 0; i < maxSec; i += 2) {
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
  const ready = await waitReady();
  if (!ready) {
    console.error('Server tidak siap. Log terakhir:');
    console.error(serverLog.slice(-1500));
    process.exit(1);
  }

  /* ---------- endpoint publik ---------- */
  let r = await req('/api/system/time');
  let b = await asJson(r);
  rec('GET /api/system/time', r.ok && !!b.data?.timeZone, `tz=${b.data?.timeZone} jam=${b.data?.localTime}`);

  r = await req('/api/system/context');
  b = await asJson(r);
  rec('GET /api/system/context', r.ok, `ip=${b.data?.ip} jaringan=${b.data?.network}`);
  rec('  IP dinormalisasi (bukan ::1)', b.data?.ip !== '::1' && !String(b.data?.ip).startsWith('::ffff'), `ip=${b.data?.ip}`);

  r = await req('/api/system/login-info');
  b = await asJson(r);
  rec('GET /api/system/login-info', r.ok, `rig=${b.data?.counts?.rigs} sumur=${b.data?.counts?.wells}`);

  r = await req('/api/system/login-activity');
  b = await asJson(r);
  rec('GET /api/system/login-activity', r.ok, `events=${b.data?.events?.length} sesi=${b.data?.activeSessions}`);

  /* ---------- login ---------- */
  r = await req('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'admin@rigdaily.local', password: 'rigdaily123' }),
  });
  b = await asJson(r);
  rec('POST /api/auth/login', r.ok && !!cookie, `user=${b.data?.user?.name}`);

  /* ---------- data inti ---------- */
  r = await req('/api/reports?limit=50');
  b = await asJson(r);
  const items = b.data?.items ?? [];
  rec('GET /api/reports', r.ok && items.length >= 8, `total=${b.data?.total}`);

  const wellsRes = await req('/api/wells');
  const wells = (await asJson(wellsRes)).data ?? [];
  rec('GET /api/wells', wellsRes.ok && wells.length === 3, wells.map((w) => w.name).join(', '));

  const kpiByWell = [];
  for (const w of wells) {
    const kRes = await req(`/api/dashboard?wellId=${w.id}`);
    const k = (await asJson(kRes)).data?.kpi;
    kpiByWell.push({ name: w.name, depth: k?.depthToday, npt: k?.nptPercent, cost: k?.dailyCost });
    rec(`  dashboard ${w.name}`, kRes.ok && k?.depthToday > 0, `depth=${k?.depthToday} npt%=${k?.nptPercent}`);
  }
  rec('  kedalaman antar sumur berbeda', new Set(kpiByWell.map((x) => x.depth)).size > 1,
    kpiByWell.map((x) => `${x.name}:${x.depth}`).join(' '));

  r = await req('/api/insights');
  b = await asJson(r);
  const bench = b.data?.benchmark ?? [];
  rec('GET /api/insights', r.ok && bench.length === 3, bench.map((x) => `${x.wellName}:${x.avgNptPercent}%`).join(' '));
  rec('  NPT antar sumur berbeda', new Set(bench.map((x) => x.avgNptPercent)).size > 1);

  r = await req('/api/personnel?limit=500');
  b = await asJson(r);
  rec('GET /api/personnel', r.ok && (b.data?.items?.length ?? 0) > 0, `items=${b.data?.items?.length}`);

  r = await req('/api/admin/overview');
  b = await asJson(r);
  rec('GET /api/admin/overview', r.ok, `ddr=${b.data?.counts?.reports} db=${b.data?.db?.driver}`);

  /* ---------- CRUD pengguna ---------- */
  const suffix = Date.now().toString(36).slice(-5);
  r = await req('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ name: `Uji ${suffix}`, email: `uji.${suffix}@rigdaily.local`, role: 'Viewer', rigScope: [] }),
  });
  b = await asJson(r);
  const newId = b.data?.id;
  rec('POST user (create)', r.status === 201 && !!newId);

  if (newId) {
    r = await req('/api/admin/users', { method: 'PATCH', body: JSON.stringify({ id: newId, name: `Ubah ${suffix}` }) });
    rec('PATCH user (update)', r.ok);
    r = await req(`/api/admin/users?id=${newId}`, { method: 'DELETE' });
    rec('DELETE user (soft delete)', r.ok);
  }

  /* ---------- kelengkapan laporan ---------- */
  const latestId = items[0]?.id;
  if (latestId) {
    r = await req(`/api/reports/${latestId}`);
    b = await asJson(r);
    const d = b.data;
    rec('laporan terbaru lengkap', (d?.bha?.length ?? 0) > 0 && (d?.crew?.length ?? 0) > 0,
      `bha=${d?.bha?.length} crew=${d?.crew?.length} cost=${d?.costLines?.length} survey=${d?.survey?.length}`);
    rec('  validasi 24 jam', d?.validation?.ok === true, `total=${d?.validation?.totalMinutes}`);
    rec('  tidak ada mojibake di data', !/â€|Ã.|Â.|ï¿½/.test(JSON.stringify(d)), '');

    const pdf = await req(`/api/reports/${latestId}/pdf?type=ddr`);
    const buf = Buffer.from(await pdf.arrayBuffer());
    rec('PDF DDR valid', pdf.ok && buf.subarray(0, 5).toString() === '%PDF-', `${buf.length} bytes`);
  }

  /* ---------- halaman ---------- */
  for (const p of ['/dashboard', '/ddr', '/time', '/cost', '/well-file', '/personnel', '/insights', '/admin', '/profile']) {
    const res = await fetch(BASE + p, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
    rec(`page ${p}`, res.status === 200, `status=${res.status}`);
  }

  /* ---------- ukur latensi ---------- */
  const t0 = Date.now();
  await req('/api/reports?limit=1');
  const t1 = Date.now();
  await req('/api/wells');
  const t2 = Date.now();
  await req('/api/dashboard');
  const t3 = Date.now();
  console.log(`\nLATENSI: reports ${t1 - t0}ms | wells ${t2 - t1}ms | dashboard ${t3 - t2}ms`);

  const pass = results.filter(Boolean).length;
  console.log(`\n===== ${pass}/${results.length} PASS =====`);
  process.exitCode = pass === results.length ? 0 : 1;
} catch (err) {
  console.error('ERROR:', err.message);
  console.error(serverLog.slice(-1200));
  process.exitCode = 1;
} finally {
  server.kill('SIGTERM');
  await sleep(500);
  process.exit(process.exitCode ?? 0);
}
