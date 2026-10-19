// Tambah tipe + state + fetch untuk log aktivitas akses di halaman login.
const fs = require('fs');
const NL = String.fromCharCode(10);
const f = 'apps/web/app/(auth)/login/page.tsx';
let t = fs.readFileSync(f, 'utf8');

// --- tipe ---
if (!t.includes('type LoginActivity')) {
  const types = [
    'type LoginActivityEvent = {',
    "  at: string;",
    "  action: 'login' | 'logout';",
    '  name: string;',
    '  initials: string;',
    '  maskedEmail: string;',
    '  ip: string;',
    '  network: string;',
    '  terminal: string | null;',
    '};',
    '',
    'type LoginActivity = { events: LoginActivityEvent[]; activeSessions: number; windowDays: number };',
    '',
    'type LoginInfo = {',
  ].join(NL);
  t = t.replace('type LoginInfo = {', types);
}

// --- state ---
if (!t.includes('const [activity, setActivity]')) {
  t = t.replace(
    'const [loginInfo, setLoginInfo] = useState<LoginInfo | null>(null);',
    'const [loginInfo, setLoginInfo] = useState<LoginInfo | null>(null);' + NL +
      '  const [activity, setActivity] = useState<LoginActivity | null>(null);'
  );
}

// --- fetch ---
if (!t.includes('login-activity')) {
  const anchor = "    fetch('/api/system/login-info', { cache: 'no-store' })";
  const inject = [
    "    fetch('/api/system/login-activity', { cache: 'no-store' })",
    '      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))',
    '      .then((body: { data: LoginActivity }) => {',
    '        if (alive) setActivity(body.data);',
    '      })',
    '      .catch(() => undefined);',
    '',
    anchor,
  ].join(NL);
  t = t.replace(anchor, inject);
}

fs.writeFileSync(f, t, 'utf8');
console.log('login: tipe + state + fetch aktivitas dipasang');
