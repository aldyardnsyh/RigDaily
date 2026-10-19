// Smoke test untuk fitur baru: personnel/POB, insights, toggle distribution rule.
const BASE = process.argv[2] ?? 'http://127.0.0.1:3777';
let cookie = '';
const out = [];
const rec = (n, ok, d) => { out.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n.padEnd(44)} ${d ?? ''}`); };

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
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { raw: t }; } };

(async () => {
  let r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@rigdaily.local', password: 'rigdaily123' }) });
  rec('login', r.status === 200);

  // --- PERSONNEL / POB ---
  r = await req('/api/personnel');
  let b = await j(r);
  const pob = b.data;
  rec('GET /api/personnel', r.status === 200 && Array.isArray(pob?.items), `items=${pob?.items?.length}`);
  rec('  POB summary', pob?.summary?.total === 6 && pob?.summary?.manHours === 72,
    `total=${pob?.summary?.total} in=${pob?.summary?.inCount} out=${pob?.summary?.outCount} manHours=${pob?.summary?.manHours}`);
  rec('  byCompany', (pob?.summary?.byCompany?.length ?? 0) >= 2,
    (pob?.summary?.byCompany ?? []).map((x) => `${x.company}:${x.count}`).join(', '));
  rec('  byMuster', (pob?.summary?.byMuster?.length ?? 0) >= 1,
    (pob?.summary?.byMuster ?? []).map((x) => `${x.station}:${x.count}`).join(', '));

  // --- INSIGHTS ---
  r = await req('/api/insights');
  b = await j(r);
  const ins = b.data;
  rec('GET /api/insights', r.status === 200, `benchmark=${ins?.benchmark?.length} baselines=${ins?.baselines?.length}`);
  const arun = ins?.benchmark?.[0];
  rec('  benchmark ARUN-07', arun?.wellName === 'ARUN-07', `npt%=${arun?.avgNptPercent} cost=${arun?.avgDailyCost} rop=${arun?.avgRopMHr}`);
  rec('  baseline comparison', (ins?.baselines?.length ?? 0) >= 2,
    (ins?.baselines ?? []).map((x) => `${x.name}: ${x.actual} vs ${x.baseline}`).join(' | '));

  for (const metric of ['npt', 'cost', 'depth', 'rop']) {
    r = await req(`/api/insights/benchmark?metric=${metric}&days=30`);
    b = await j(r);
    rec(`GET /api/insights/benchmark?metric=${metric}`, r.status === 200 && (b.data?.points?.length ?? 0) > 0,
      `points=${b.data?.points?.length}`);
  }

  // --- TOGGLE DISTRIBUTION RULE ---
  r = await req('/api/master/rules');
  b = await j(r);
  const rule = b.data?.rules?.[0];
  rec('GET /api/master/rules', r.status === 200 && !!rule, `rules=${b.data?.rules?.length} first=${rule?.name} active=${rule?.active}`);

  const before = rule?.active;
  r = await req(`/api/master/rules/${rule.id}`, { method: 'PATCH', body: JSON.stringify({ active: !before }) });
  rec('PATCH /api/master/rules/[id] toggle', r.status === 200, `status=${r.status}`);

  r = await req('/api/master/rules');
  b = await j(r);
  const after = b.data?.rules?.find((x) => x.id === rule.id)?.active;
  rec('  toggle benar-benar tersimpan', after === !before, `before=${before} after=${after}`);

  // kembalikan
  await req(`/api/master/rules/${rule.id}`, { method: 'PATCH', body: JSON.stringify({ active: before }) });
  r = await req('/api/master/rules');
  b = await j(r);
  rec('  restore', b.data?.rules?.find((x) => x.id === rule.id)?.active === before);

  // PATCH shortcut
  r = await req('/api/master/rules', { method: 'PATCH', body: JSON.stringify({ id: rule.id, active: before }) });
  rec('PATCH /api/master/rules (shortcut)', r.status === 200 || r.status === 204, `status=${r.status}`);

  // --- HALAMAN BARU ---
  for (const p of ['/personnel', '/insights']) {
    r = await req(p);
    const html = await r.text();
    rec(`page ${p}`, r.status === 200 && html.includes('<html'), `len=${html.length}`);
  }

  // --- cek tidak ada teks "belum tersedia" di halaman ---
  for (const p of ['/reports', '/well-file', '/dashboard', '/ddr']) {
    r = await req(p);
    const html = await r.text();
    const bad = html.includes('belum tersedia') || html.includes('endpoint belum ada');
    rec(`page ${p} tanpa teks stub`, !bad, bad ? 'MASIH ADA' : 'bersih');
  }

  const pass = out.filter(Boolean).length;
  console.log(`\n===== ${pass}/${out.length} PASS =====`);
  if (pass !== out.length) process.exitCode = 1;
})();
