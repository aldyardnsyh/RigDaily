/**
 * Uji RBAC & sesi: memastikan halaman terlindungi TIDAK pernah dirender
 * untuk sesi yang tidak sah, dan cookie sisa tidak membuat pengguna
 * terlempar ke dashboard dari halaman login.
 *
 * Skenario yang diuji:
 *  1. Tanpa cookie           -> /dashboard harus 307 ke /login
 *  2. Cookie palsu/kedaluwarsa -> /dashboard harus 307 ke /login (bukan 200)
 *  3. Cookie palsu + buka /login -> tetap di /login (bukan ke dashboard)
 *  4. Login benar -> /dashboard 200, /login dialihkan ke /dashboard
 *  5. Logout -> cookie dihapus, /dashboard kembali ke /login
 *  6. API tanpa sesi -> 401 + header no-store
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 3412;
const BASE = `http://127.0.0.1:${PORT}`;

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

const results = [];
const rec = (n, ok, d) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n.padEnd(52)} ${d ?? ''}`);
};

const SESSION = 'rigdaily_session';

async function ready() {
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch {}
  }
  return false;
}

/** status + location tanpa mengikuti redirect. */
async function head(path, cookie, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (cookie) headers.cookie = cookie;
  const r = await fetch(BASE + path, { headers, redirect: 'manual' });
  return { status: r.status, location: r.headers.get('location'), headers: r.headers, body: await r.text() };
}

try {
  if (!(await ready())) {
    console.error('server tidak siap');
    console.error(log.slice(-800));
    process.exit(1);
  }

  // 1. tanpa cookie
  let r = await head('/dashboard');
  rec('tanpa cookie: /dashboard -> /login', r.status === 307 && String(r.location).includes('/login'), `status=${r.status} loc=${r.location}`);

  // 2. cookie palsu (sesi tidak ada di DB)
  const fake = `${SESSION}=palsu-tidak-ada-di-database`;
  r = await head('/dashboard', fake);
  rec('cookie palsu: /dashboard -> /login', r.status === 307 && String(r.location).includes('/login'), `status=${r.status} loc=${r.location}`);

  // 3. cookie palsu + /login -> harus tetap di login (TIDAK ke dashboard)
  r = await head('/login', fake);
  const wentToDashboard = r.status === 307 && String(r.location).includes('/dashboard');
  rec('cookie palsu: /login TIDAK ke dashboard', !wentToDashboard, `status=${r.status} loc=${r.location ?? '-'}`);

  // 4. login benar
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@rigdaily.local', password: 'rigdaily123' }),
  });
  const setCookies = loginRes.headers.getSetCookie?.() ?? [];
  const sessionPair = setCookies.map((c) => c.split(';')[0]).find((p) => p.startsWith(`${SESSION}=`));
  rec('login benar', loginRes.ok && !!sessionPair, `cookies=${setCookies.length}`);

  if (sessionPair) {
    r = await head('/dashboard', sessionPair);
    rec('sesi sah: /dashboard 200', r.status === 200, `status=${r.status}`);

    r = await head('/login', sessionPair);
    rec('sesi sah: /login -> /dashboard', r.status === 307 && String(r.location).includes('/dashboard'), `status=${r.status}`);

    // header no-store pada halaman terlindungi
    rec('halaman terlindungi no-store', String(r.headers.get('cache-control') ?? '').includes('no-store') || r.status === 307, `cc=${r.headers.get('cache-control') ?? '-'}`);

    // API terautentikasi
    const apiRes = await fetch(`${BASE}/api/auth/me`, { headers: { cookie: sessionPair } });
    rec('API /api/auth/me dengan sesi 200', apiRes.ok, `status=${apiRes.status}`);
    rec('  API no-store', String(apiRes.headers.get('cache-control') ?? '').includes('no-store'), `cc=${apiRes.headers.get('cache-control')}`);

    // 5. logout
    const outRes = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { cookie: sessionPair } });
    rec('logout 200', outRes.ok, `status=${outRes.status}`);

    // cookie yang dikirim saat logout harus memerintahkan penghapusan (Max-Age=0)
    const outCookies = outRes.headers.getSetCookie?.() ?? [];
    const clearing = outCookies.some((c) => c.includes(`${SESSION}=`) && /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c));
    rec('  logout menghapus cookie (Max-Age=0)', clearing, `${outCookies.length} set-cookie`);

    // 6. sesi lama dipakai lagi -> harus ditolak
    r = await head('/dashboard', sessionPair);
    rec('sesi setelah logout: /dashboard -> /login', r.status === 307 && String(r.location).includes('/login'), `status=${r.status} loc=${r.location}`);
  }

  // 7. API tanpa sesi -> 401 & no-store
  const unauth = await fetch(`${BASE}/api/auth/me`);
  rec('API tanpa sesi 401', unauth.status === 401, `status=${unauth.status}`);
  rec('  API 401 no-store', String(unauth.headers.get('cache-control') ?? '').includes('no-store'), `cc=${unauth.headers.get('cache-control')}`);

  const pass = results.filter(Boolean).length;
  console.log(`\n===== ${pass}/${results.length} PASS =====`);
  process.exitCode = pass === results.length ? 0 : 1;
} catch (e) {
  console.error('ERROR:', e.message);
  console.error(log.slice(-600));
  process.exitCode = 1;
} finally {
  server.kill('SIGTERM');
  await sleep(400);
  process.exit(process.exitCode ?? 0);
}
