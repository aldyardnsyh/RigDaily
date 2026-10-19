// Verifikasi endpoint nyata (cepat, tanpa browser).
const BASE = process.argv[2] ?? 'http://127.0.0.1:3400';
let cookie = '';
const results = [];
const rec = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(46)} ${detail ?? ''}`);
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
const json = async (r) => {
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { raw: t }; }
};

(async () => {
  // --- endpoint publik (tanpa sesi) ---
  let r = await req('/api/system/time');
  let b = await json(r);
  rec('GET /api/system/time', r.ok && !!b.data?.timeZone, `tz=${b.data?.timeZone} waktu=${b.data?.localTime} shift=${b.data?.shift}`);

  r = await req('/api/system/context');
  b = await json(r);
  rec('GET /api/system/context', r.ok, `ip=${b.data?.ip} jaringan=${b.data?.network}`);
  rec('  IP bukan ::1', b.data?.ip !== '::1' && !String(b.data?.ip).startsWith('::ffff'), `ip=${b.data?.ip}`);

  r = await req('/api/system/login-info');
  b = await json(r);
  rec('GET /api/system/login-info', r.ok, `org=${b.data?.organization?.name} rig=${b.data?.counts?.rigs} sumur=${b.data?.counts?.wells}`);

  r = await req('/api/system/login-activity');
  b = await json(r);
  rec('GET /api/system/login-activity', r.ok, `events=${b.data?.events?.length} sesi=${b.data?.activeSessions}`);

  // --- login ---
  r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@rigdaily.local', password: 'rigdaily123' }) });
  b = await json(r);
  rec('POST /api/auth/login', r.ok && !!cookie, `user=${b.data?.user?.name}`);

  // --- data inti ---
  r = await req('/api/reports?limit=50');
  b = await json(r);
  const items = b.data?.items ?? [];
  rec('GET /api/reports', r.ok && items.length >= 8, `total=${b.data?.total}`);

  // 3 sumur berbeda
  const wellsRes = await req('/api/wells');
  const wells = (await json(wellsRes)).data ?? [];
  rec('GET /api/wells', wellsRes.ok && wells.length === 3, wells.map((w) => w.name).join(', '));

  for (const w of wells) {
    const kRes = await req(`/api/dashboard?wellId=${w.id}`);
    const k = (await json(kRes)).data?.kpi;
    rec(`  dashboard ${w.name}`, kRes.ok && k?.depthToday > 0, `depth=${k?.depthToday} npt%=${k?.nptPercent} cost=${k?.dailyCost}`);
  }

  // Insights: 3 sumur punya NPT berbeda
  r = await req('/api/insights');
  b = await json(r);
  const bench = b.data?.benchmark ?? [];
  const npts = bench.map((x) => x.avgNptPercent);
  rec('GET /api/insights', r.ok && bench.length === 3, bench.map((x) => `${x.wellName}:${x.avgNptPercent}%`).join(' '));
  rec('  NPT antar sumur berbeda', new Set(npts).size > 1, `unik=${[...new Set(npts)].join(',')}`);

  // Personil
  r = await req('/api/personnel?limit=500');
  b = await json(r);
  rec('GET /api/personnel', r.ok && b.data?.items?.length > 0, `items=${b.data?.items?.length} total=${b.data?.summary?.total}`);

  // Admin overview
  r = await req('/api/admin/overview');
  b = await json(r);
  rec('GET /api/admin/overview', r.ok, `wells=${b.data?.counts?.wells} ddr=${b.data?.counts?.reports} db=${b.data?.db?.driver}`);

  // CRUD user: buat -> ubah -> hapus
  const suffix = Date.now().toString(36).slice(-5);
  r = await req('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: `Uji ${suffix}`, email: `uji.${suffix}@rigdaily.local`, role: 'Viewer', rigScope: [] }) });
  b = await json(r);
  const newUserId = b.data?.id;
  rec('POST user (create)', r.status() === 201 && !!newUserId, `id=${newUserId ? 'ok' : '-'}`);

  if (newUserId) {
    r = await req('/api/admin/users', { method: 'PATCH', body: JSON.stringify({ id: newUserId, name: `Ubah ${suffix}` }) });
    rec('PATCH user (update)', r.ok);

    r = await req(`/api/admin/users?id=${newUserId}`, { method: 'DELETE' });
    rec('DELETE user (soft delete)', r.ok);
  }

  // BHA ada pada laporan terbaru
  const latestId = items[0]?.id;
  if (latestId) {
    r = await req(`/api/reports/${latestId}`);
    b = await json(r);
    rec('BHA laporan terbaru terisi', (b.data?.bha?.length ?? 0) > 0, `bha=${b.data?.bha?.length} crew=${b.data?.crew?.length} cost=${b.data?.costLines?.length}`);
    rec('  validasi 24 jam', b.data?.validation?.ok === true, `total=${b.data?.validation?.totalMinutes}`);
  }

  // PDF
  if (latestId) {
    const pdf = await req(`/api/reports/${latestId}/pdf?type=ddr`);
    const buf = Buffer.from(await pdf.arrayBuffer());
    rec('PDF DDR valid', pdf.ok && buf.subarray(0, 5).toString() === '%PDF-', `${buf.length} bytes`);
  }

  // Halaman utama
  for (const p of ['/dashboard', '/ddr', '/time', '/well-file', '/personnel', '/insights', '/admin', '/login']) {
    const res = await fetch(BASE + p, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
    rec(`page ${p}`, res.status === 200, `status=${res.status}`);
  }

  const pass = results.filter(Boolean).length;
  console.log(`\n===== ${pass}/${results.length} PASS =====`);
  process.exitCode = pass === results.length ? 0 : 1;
})();

