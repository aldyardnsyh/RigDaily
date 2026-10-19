// Ganti data statis pada halaman login dengan konteks perangkat & waktu nyata.
const fs = require('fs');

const f = 'apps/web/app/(auth)/login/page.tsx';
let t = fs.readFileSync(f, 'utf8');

/* ---------------- 1. Tipe konteks ---------------- */
const typeBlock = `
type SystemContext = {
  ip: string;
  clientIp: string;
  network: string;
  terminal: string;
  userAgent: string | null;
  browser: string;
  platform: string;
  device: string;
  time: { iso: string; epochMs: number; timeZone: string; localDate: string; localTime: string };
  connection: { database: boolean; status: 'online' | 'degraded' };
  appVersion: string;
};
`;

// sisipkan setelah import terakhir
const lastImport = t.lastIndexOf('\nimport ');
const endImport = t.indexOf('\n', lastImport + 1);
t = t.slice(0, endImport + 1) + typeBlock + t.slice(endImport + 1);

/* ---------------- 2. Header: IP / jaringan / waktu nyata ---------------- */
const oldHeader = `        <div className="auth-top-status tnum">
          <span className="auth-lan">
            <span className="auth-status-dot" /> LAN 10.142.8.204 <strong>TERHUBUNG</strong>
          </span>
          <span>UTC {clock}</span>
        </div>`;

const newHeader = `        <div className="auth-top-status tnum">
          <span className="auth-lan" title={ctx ? \`Jaringan: \${ctx.network} - UA: \${ctx.userAgent ?? '-'}\` : 'Mendeteksi jaringan'}>
            <span
              className="auth-status-dot"
              style={{
                background: !ctx ? 'var(--text-muted)' : ctx.connection.database ? 'var(--success)' : 'var(--danger)',
              }}
            />
            {ctx ? ctx.clientIp : 'mendeteksi...'}{' '}
            <strong>{!ctx ? 'MEMUAT' : ctx.connection.database ? 'TERHUBUNG' : 'DB TERGANGGU'}</strong>
          </span>
          <span>{ctx ? \`\${ctx.time.localTime} \${ctx.time.timeZone.replace('Asia/', 'WIB ')}\` : '--:--:--'}</span>
        </div>`;

if (!t.includes('auth-top-status tnum')) {
  console.log('GAGAL: header login tidak ditemukan');
  process.exit(1);
}
t = t.replace(oldHeader, newHeader);

/* ---------------- 3. Terminal: identitas nyata ---------------- */
t = t.replace(
  `            <span>
              Stasiun Terminal Lapangan: <strong>RIG12-DOGHOUSE-01</strong>
            </span>`,
  `            <span style={{ minWidth: 0 }}>
              Terminal: <strong>{ctx ? ctx.terminal : 'mendeteksi perangkat...'}</strong>
              {ctx ? (
                <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', fontWeight: 400 }}>
                  {ctx.device} / {ctx.platform} / {ctx.browser}
                </span>
              ) : null}
            </span>`
);

/* ---------------- 4. Ganti penggunaan jam UTC statis ---------------- */
t = t.replace(/UTC \{clock\}/g, '');
t = t.replace(/Jadwal sinkron otomatis berikutnya: [0-9:]+ UTC/g, 'Jadwal sinkron otomatis mengikuti pengaturan Reporter di server');
t = t.replace(/Data terakhir: [0-9]+ [A-Za-z]+ [0-9:]+ UTC/g, 'Data terakhir: mengikuti sinkronisasi terakhir yang tercatat di server');

fs.writeFileSync(f, t, 'utf8');
console.log('login: header & terminal memakai data nyata');
