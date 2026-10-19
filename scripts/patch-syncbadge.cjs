const fs = require('fs');
const f = 'packages/ui/src/components/appshell.tsx';
let t = fs.readFileSync(f, 'utf8');
const NL = String.fromCharCode(10);

// 1. Prop baru
if (!t.includes('syncBadge?: React.ReactNode;')) {
  t = t.replace(
    '  syncLabel?: string;',
    '  syncLabel?: string;' + NL + '  /** Slot indikator sinkronisasi (data nyata dari apps/web). */' + NL + '  syncBadge?: React.ReactNode;'
  );
  t = t.replace(
    "  syncLabel = 'Synced 2m ago',",
    "  syncLabel = 'Status sinkronisasi'," + NL + '  syncBadge,'
  );
}

// 2. Blok badge lama -> slot
const startMarker = '<span className="ml-auto inline-flex h-9 items-center gap-2 rounded-[var(--radius-badge)] bg-[var(--success-soft)] px-3 text-[13px] font-semibold text-[var(--success)]">';
const start = t.indexOf(startMarker);
if (start === -1) {
  console.log('GAGAL: badge sync tidak ditemukan');
  process.exit(1);
}
const endMarker = '</span>';
// cari penutup span pertama setelah startMarker + konten
const afterContent = t.indexOf('{syncLabel}', start);
const end = t.indexOf(endMarker, afterContent);
if (end === -1) {
  console.log('GAGAL: penutup badge tidak ditemukan');
  process.exit(1);
}
const endPos = end + endMarker.length;

const replacement = [
  '<span className="ml-auto" style={{ display: \'inline-flex\', minWidth: 0 }}>',
  '            {syncBadge ?? (',
  '              <span className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-badge)] bg-[var(--bg-surface-2)] px-3 text-[12px] font-semibold text-[var(--text-secondary)]">',
  '                <Cloud size={15} aria-hidden />',
  '                {syncLabel}',
  '              </span>',
  '            )}',
  '          </span>',
].join(NL);

t = t.slice(0, start) + replacement + t.slice(endPos);
fs.writeFileSync(f, t, 'utf8');
console.log('AppShell: slot syncBadge terpasang');
