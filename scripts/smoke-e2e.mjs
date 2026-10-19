// Smoke test end-to-end memakai Node fetch (perilaku cookie sama seperti browser).
// Jalankan: node scripts/smoke-e2e.mjs http://127.0.0.1:3999
const BASE = process.argv[2] ?? 'http://127.0.0.1:3999';

let cookie = '';
const results = [];
function rec(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(38)} ${detail ?? ''}`);
}

async function req(path, opts = {}) {
  const headers = { ...(opts.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  if (opts.body) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + path, { ...opts, headers, redirect: 'manual' });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookie) {
    const pair = c.split(';')[0];
    if (pair.startsWith('rigdaily_session=')) cookie = pair;
  }
  return res;
}

async function json(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

const main = async () => {
  // health
  let res = await req('/api/health');
  let body = await json(res);
  rec('GET /api/health', res.status === 200 && body.data?.db === true, `db=${body.data?.db} driver=${body.data?.driver}`);

  // tanpa sesi harus 401
  res = await req('/api/reports');
  rec('GET /api/reports tanpa sesi', res.status === 401, `status=${res.status}`);

  // login salah
  res = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@rigdaily.local', password: 'salah-password' }) });
  rec('login password salah', res.status === 401, `status=${res.status}`);

  // login benar
  res = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@rigdaily.local', password: 'rigdaily123' }) });
  body = await json(res);
  rec('login benar', res.status === 200 && !!cookie, `user=${body.data?.user?.name} role=${body.data?.user?.role}`);

  // me
  res = await req('/api/auth/me');
  body = await json(res);
  rec('GET /api/auth/me', res.status === 200, `permissions=${body.data?.permissions?.length}`);

  // reports
  res = await req('/api/reports');
  body = await json(res);
  const item = body.data?.items?.[0];
  rec('GET /api/reports', res.status === 200 && body.data?.total >= 1, `total=${body.data?.total} reportNo=${item?.reportNo} status=${item?.status}`);
  const id = item?.id;

  // detail
  res = await req(`/api/reports/${id}`);
  body = await json(res);
  const d = body.data;
  rec('GET /api/reports/:id', res.status === 200, `min=${d?.totalMinutes} prd=${d?.productiveMinutes} npt=${d?.nptMinutes} wow=${d?.wowMinutes}`);
  rec('  totals sesuai kontrak', d?.totalMinutes === 1440 && d?.productiveMinutes === 1200 && d?.nptMinutes === 150 && d?.wowMinutes === 90);
  rec('  cost harian', d?.costDailyUsd === 50250, `costDaily=${d?.costDailyUsd} cumul=${d?.costCumulativeUsd}`);
  rec('  children lengkap', d?.timeRows?.length === 9 && d?.crew?.length === 6 && d?.bha?.length === 5 && d?.survey?.length === 4 && d?.mac?.length === 3 && d?.costLines?.length === 8,
    `rows=${d?.timeRows?.length} crew=${d?.crew?.length} bha=${d?.bha?.length} surv=${d?.survey?.length} mac=${d?.mac?.length} cost=${d?.costLines?.length}`);
  rec('  validasi 24h lolos', d?.validation?.ok === true, `issues=${d?.validation?.issues?.length}`);

  // validate endpoint
  res = await req(`/api/reports/${id}/validate`, { method: 'POST' });
  body = await json(res);
  rec('POST validate', res.status === 200 && body.data?.ok === true, `total=${body.data?.totalMinutes}`);

  // dashboard
  res = await req('/api/dashboard');
  body = await json(res);
  const k = body.data?.kpi;
  rec('GET /api/dashboard', res.status === 200, `depth=${k?.depthToday} npt%=${k?.nptPercent} cost=${k?.dailyCost} afe%=${k?.afeConsumedPercent}`);

  // pdf
  res = await req(`/api/reports/${id}/pdf?type=ddr`);
  const ddrBuf = Buffer.from(await res.arrayBuffer());
  rec('GET pdf ddr', res.status === 200 && ddrBuf.subarray(0, 5).toString() === '%PDF-', `bytes=${ddrBuf.length} type=${res.headers.get('content-type')}`);
  res = await req(`/api/reports/${id}/pdf?type=iadc`);
  const iadcBuf = Buffer.from(await res.arrayBuffer());
  rec('GET pdf iadc', res.status === 200 && iadcBuf.subarray(0, 5).toString() === '%PDF-', `bytes=${iadcBuf.length}`);

  // master
  res = await req('/api/master/iadc');
  body = await json(res);
  rec('GET /api/master/iadc', res.status === 200 && body.data?.length === 34, `count=${body.data?.length}`);

  res = await req('/api/master/rate-cards');
  body = await json(res);
  rec('GET /api/master/rate-cards', res.status === 200, `count=${body.data?.length}`);

  res = await req('/api/master/kpi');
  body = await json(res);
  rec('GET /api/master/kpi', res.status === 200, `count=${body.data?.length}`);

  res = await req('/api/master/rules');
  body = await json(res);
  rec('GET /api/master/rules', res.status === 200, `rules=${body.data?.rules?.length} log=${body.data?.deliveryLog?.length}`);

  // incidents
  res = await req('/api/incidents');
  body = await json(res);
  rec('GET /api/incidents', res.status === 200, `count=${body.data?.length} ref=${body.data?.[0]?.refNo} sev=${body.data?.[0]?.severity}`);

  // marine / mac / survey
  res = await req(`/api/reports/${id}/mac`);
  body = await json(res);
  rec('GET mac', res.status === 200, `count=${body.data?.items?.length ?? body.data?.length}`);
  res = await req(`/api/reports/${id}/survey`);
  body = await json(res);
  rec('GET survey', res.status === 200, `count=${body.data?.items?.length ?? body.data?.length}`);
  res = await req(`/api/reports/${id}/marine`);
  rec('GET marine', res.status === 200 || res.status === 404, `status=${res.status}`);

  // rigs & billing
  res = await req('/api/rigs');
  body = await json(res);
  const rigId = body.data?.[0]?.id;
  rec('GET /api/rigs', res.status === 200, `count=${body.data?.length}`);
  res = await req(`/api/billing?rigId=${rigId}&month=2026-09`);
  body = await json(res);
  rec('GET /api/billing', res.status === 200 && body.data?.totals?.amount > 0, `hours=${body.data?.totals?.billableHours} amount=${body.data?.totals?.amount} rows=${body.data?.rows?.length}`);

  // sync
  res = await req('/api/sync/devices');
  body = await json(res);
  rec('GET /api/sync/devices', res.status === 200, `count=${body.data?.devices?.length ?? body.data?.length}`);
  res = await req('/api/sync/conflicts');
  body = await json(res);
  rec('GET /api/sync/conflicts', res.status === 200, `count=${Array.isArray(body.data) ? body.data.length : 'obj'}`);
  res = await req('/api/sync/pull?since=1970-01-01T00:00:00Z');
  body = await json(res);
  rec('GET /api/sync/pull', res.status === 200 && body.data?.changes?.length > 0, `changes=${body.data?.changes?.length}`);

  // distribute dry-run
  res = await req('/api/reports/distribute', { method: 'POST', body: JSON.stringify({ dryRun: true }) });
  body = await json(res);
  rec('POST distribute (dryRun)', res.status === 200, `queued=${body.data?.queued} sent=${body.data?.sent} failed=${body.data?.failed}`);

  // admin
  res = await req('/api/admin/users');
  body = await json(res);
  rec('GET /api/admin/users', res.status === 200, `count=${body.data?.length}`);
  res = await req('/api/admin/audit?limit=10');
  body = await json(res);
  rec('GET /api/admin/audit', res.status === 200, `count=${body.data?.length}`);

  // halaman
  for (const page of ['/dashboard', '/ddr', '/time', '/cost', '/well-file', '/reports', '/sync', '/admin', '/billing', '/daily-ops', '/marine-mac', '/safety-survey']) {
    res = await req(page);
    const html = await res.text();
    rec(`page ${page}`, res.status === 200 && html.includes('<html'), `len=${html.length}`);
  }

  // middleware redirect
  cookie = '';
  res = await req('/dashboard');
  rec('middleware redirect tanpa sesi', res.status === 307 || res.status === 302, `status=${res.status} loc=${res.headers.get('location')}`);

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n===== ${passed}/${results.length} PASS =====`);
  if (passed !== results.length) process.exitCode = 1;
};

main().catch((e) => { console.error('SMOKE ERROR', e); process.exitCode = 1; });
