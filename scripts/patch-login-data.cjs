// Login: ganti tabel transaksi dummy dengan data perangkat nyata dari server.
const fs = require('fs');
const NL = String.fromCharCode(10);
const f = 'apps/web/app/(auth)/login/page.tsx';
let t = fs.readFileSync(f, 'utf8');

// --- 1. Tipe LoginInfo ---
if (!t.includes('type LoginInfo')) {
  const anchor = 'type SystemContext = {';
  const idx = t.indexOf(anchor);
  const block = [
    'type LoginDevice = {',
    '  deviceId: string;',
    '  name: string;',
    '  lastSeenAt: string | null;',
    '  pendingCount: number;',
    '};',
    '',
    'type LoginInfo = {',
    '  organization: { name: string; type: string };',
    '  counts: { rigs: number; wells: number; users: number; reports: number };',
    '  ready: boolean;',
    '  devices: LoginDevice[];',
    '};',
    '',
  ].join(NL);
  t = t.slice(0, idx) + block + t.slice(idx);
}

// --- 2. State loginInfo, hapus tx dummy ---
t = t.replace(/const \[tx, setTx\] = useState\(TX_INIT\);/g, 'const [loginInfo, setLoginInfo] = useState<LoginInfo | null>(null);');
t = t.replace(/setTx\(\(prev\) => \[[^\]]*\]\);/gs, '');
t = t.replace(/setTx\(TX_INIT\);/g, '');

// hapus konstanta TX_INIT
t = t.replace(/const TX_INIT = \[[\s\S]*?\];/, '');

// --- 3. Fetch login-info dalam useEffect yang sama ---
t = t.replace(
  "    fetch('/api/system/context', { cache: 'no-store' })",
  [
    "    fetch('/api/system/login-info', { cache: 'no-store' })",
    '      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))',
    '      .then((body: { data: LoginInfo }) => {',
    '        if (alive) setLoginInfo(body.data);',
    '      })',
    '      .catch(() => undefined);',
    '',
    "    fetch('/api/system/context', { cache: 'no-store' })",
  ].join(NL)
);

// --- 4. Ganti tabel transaksi dengan daftar perangkat ---
const tableStart = t.indexOf('                  {tx.slice(0, 5).map(');
if (tableStart === -1) {
  console.log('WARN: blok tx.map tidak ditemukan (mungkin sudah diganti)');
} else {
  const tableEndMarker = '))}\n                </tbody>';
  const tableEnd = t.indexOf(tableEndMarker, tableStart);
  if (tableEnd === -1) {
    console.log('GAGAL: akhir blok tx.map tidak ditemukan');
    process.exit(1);
  }
  const endPos = tableEnd + tableEndMarker.length;

  const replacement = [
    '                  {(loginInfo?.devices ?? []).length === 0 ? (',
    '                    <tr>',
    '                      <td colSpan={4} style={{ textAlign: \'center\', color: \'var(--text-secondary)\' }}>',
    '                        Belum ada perangkat terdaftar. Perangkat muncul setelah aplikasi desktop rig tersambung.',
    '                      </td>',
    '                    </tr>',
    '                  ) : (',
    '                    (loginInfo?.devices ?? []).map((d) => (',
    '                      <tr key={d.deviceId}>',
    '                        <td className="tnum">',
    '                          {d.lastSeenAt',
    '                            ? new Date(d.lastSeenAt).toLocaleTimeString(\'id-ID\', {',
    '                                hour: \'2-digit\',',
    '                                minute: \'2-digit\',',
    '                                second: \'2-digit\',',
    '                                timeZone: ctx?.time.timeZone ?? \'Asia/Jakarta\',',
    '                              })',
    '                            : \'-\'}',
    '                        </td>',
    '                        <td>{d.name}</td>',
    '                        <td className="tnum">{d.deviceId}</td>',
    '                        <td>',
    '                          <span className="auth-success-badge">',
    '                            {d.pendingCount > 0 ? `${d.pendingCount} tertunda` : \'Tersinkron\'}',
    '                          </span>',
    '                        </td>',
    '                      </tr>',
    '                    ))',
    '                  )}',
    '                </tbody>',
  ].join(NL);

  t = t.slice(0, tableStart) + replacement + t.slice(endPos);
}

// --- 5. Header tabel: kolom sesuai data perangkat ---
t = t.replace(/<th>Ukuran<\/th>\s*\n\s*<th>Hasil<\/th>/g, '<th>Perangkat</th>' + NL + '                    <th>Status</th>');

// --- 6. Footer: hapus nama sumur hardcode ---
t = t.replace(
  /Hotline Dukungan Lapangan: Ext\. 4091 \(Radio Rig Ch\. 3\)\s*<span aria-hidden>[^<]*<\/span>\s*Sumur ARUN-07/g,
  'Dukungan internal: hubungi administrator sistem'
);

// --- 7. Identitas organisasi di header: pakai data nyata ---
t = t.replace(
  /Rig 12 \(DEEP-HORIZON 04\)\s*<span aria-hidden>[^<]*<\/span>\s*Lapangan Arun Blok B/,
  '{loginInfo ? `${loginInfo.organization.name} - ${loginInfo.counts.rigs} rig, ${loginInfo.counts.wells} sumur` : \'Mendeteksi instalasi...\'}'
);

fs.writeFileSync(f, t, 'utf8');
console.log('Login: data dummy diganti data server');
