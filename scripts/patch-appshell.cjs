// Sisipkan slot wellSwitcher & clock ke AppShell (menggantikan nilai statis).
const fs = require('fs');
const f = 'packages/ui/src/components/appshell.tsx';
let t = fs.readFileSync(f, 'utf8');

const propAnchor = '  userMenu?: React.ReactNode;\n  children: React.ReactNode;';
const propNew = [
  '  userMenu?: React.ReactNode;',
  '  /** Slot pemilih sumur (menggantikan tombol wellbore statis). */',
  '  wellSwitcher?: React.ReactNode;',
  '  /** Slot jam/tanggal dari waktu server (menggantikan tanggal statis). */',
  '  clock?: React.ReactNode;',
  '  children: React.ReactNode;',
].join('\n');

const destrAnchor = '  userMenu,\n  children,\n}: Props) {';
const destrNew = '  userMenu,\n  wellSwitcher,\n  clock,\n  children,\n}: Props) {';

// Blok tombol well + tanggal statis: cari penanda unik.
const startMarker = '          <button\n            type="button"\n            className="flex h-[var(--control-h)] items-center gap-2 rounded-[var(--radius-input)] border border-[var(--border-default)] bg-white px-3 text-[13px] font-semibold"\n            aria-label="Ganti wellbore"';
const endMarker = '            {date}\n          </span>';

const startIdx = t.indexOf(startMarker);
if (startIdx === -1) {
  console.log('GAGAL: penanda blok well tidak ditemukan');
  process.exit(1);
}
const endIdx = t.indexOf(endMarker, startIdx);
if (endIdx === -1) {
  console.log('GAGAL: penanda akhir blok tanggal tidak ditemukan');
  process.exit(1);
}
const endPos = endIdx + endMarker.length;

const replacement = [
  '          {wellSwitcher ?? (',
  '            <button',
  '              type="button"',
  '              className="flex h-[var(--control-h)] items-center gap-2 rounded-[var(--radius-input)] border border-[var(--border-default)] bg-white px-3 text-[13px] font-semibold"',
  '              aria-label="Ganti wellbore"',
  '            >',
  '              <HardHat size={16} aria-hidden />',
  '              <span className="well-value">',
  '                <span className="text-[var(--text-muted)]">SUMUR:</span> {well}',
  '              </span>',
  '              <ChevronDown size={14} aria-hidden />',
  '            </button>',
  '          )}',
  '          {clock ?? (',
  '            <span className="tnum hidden items-center gap-2 rounded-[var(--radius-input)] bg-[var(--bg-surface-2)] px-3 py-2 text-[13px] font-medium md:flex">',
  '              <CalendarDays size={15} aria-hidden />',
  '              {date}',
  '            </span>',
  '          )}',
].join('\n');

t = t.slice(0, startIdx) + replacement + t.slice(endPos);

if (!t.includes('wellSwitcher?: React.ReactNode')) {
  t = t.replace(propAnchor, propNew);
} else {
  console.log('props sudah ada');
}
if (!t.includes('  wellSwitcher,\n  clock,')) {
  t = t.replace(destrAnchor, destrNew);
} else {
  console.log('destructuring sudah ada');
}

fs.writeFileSync(f, t, 'utf8');
console.log('OK: slot wellSwitcher & clock dipasang');
