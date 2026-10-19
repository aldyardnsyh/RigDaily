// DDR: pakai useActiveWell (reaktif) menggantikan logika wellId lokal yang statis.
const fs = require('fs');
const NL = String.fromCharCode(10);

const f = 'apps/web/app/(app)/ddr/page.tsx';
let t = fs.readFileSync(f, 'utf8');

// 1. Import hook
if (!t.includes("from '@/lib/hooks/useActiveWell'")) {
  const anchor = "import { useApi } from '@/lib/hooks/useApi';";
  if (t.includes(anchor)) {
    t = t.replace(anchor, anchor + NL + "import { useActiveWell } from '@/lib/hooks/useActiveWell';");
  } else {
    const lastImport = t.lastIndexOf(NL + 'import ');
    const endLine = t.indexOf(NL, lastImport + 1);
    t = t.slice(0, endLine + 1) + "import { useActiveWell } from '@/lib/hooks/useActiveWell';" + NL + t.slice(endLine + 1);
  }
}

// 2. Ganti blok pemilihan sumur lokal (statis) dengan hook reaktif
const startMarker = "  const requestedWellId = useMemo(() => {";
const start = t.indexOf(startMarker);
if (start === -1) {
  console.log('GAGAL: blok requestedWellId tidak ditemukan');
  process.exit(1);
}
const endMarker = "  const well = wells.data?.find((w) => w.id === wellId) ?? null;";
const end = t.indexOf(endMarker, start);
if (end === -1) {
  console.log('GAGAL: akhir blok wellId tidak ditemukan');
  process.exit(1);
}
const endPos = end + endMarker.length;

const replacement = [
  '  /*',
  '   * Sumur aktif berasal dari `useActiveWell` yang REAKTIF terhadap ?wellId=.',
  '   * Sebelumnya nilai URL dibaca dengan useMemo([]) sehingga tidak berubah',
  '   * saat user mengganti sumur lewat WellSwitcher.',
  '   */',
  '  const activeWell = useActiveWell();',
  '  const wellId = activeWell.wellId;',
  '  const well = activeWell.well;',
].join(NL);

t = t.slice(0, start) + replacement + t.slice(endPos);

// 3. `wells` masih dipakai untuk daftar -> arahkan ke activeWell.wells
t = t.replace("  const wells = useApi<WellDto[]>('/api/wells');", '  const wells: WellDto[] = activeWell.wells;');
// jika masih ada pemakaian wells.data, sesuaikan
t = t.replace(/wells\.data\?\./g, 'wells.');
t = t.replace(/wells\.data\s*&&\s*wells\.data\.length/g, 'wells.length');
t = t.replace(/wells\.data\.length/g, 'wells.length');
t = t.replace(/wells\.loading/g, 'activeWell.loading');
t = t.replace(/wells\.error/g, 'activeWell.error');

fs.writeFileSync(f, t, 'utf8');
console.log('DDR: useActiveWell reaktif dipasang');
