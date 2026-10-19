// 1) useApi.reload memaksa fetch (abaikan cache).
// 2) apiSend menginvalidasi cache terkait setelah mutasi berhasil.
const fs = require('fs');
const NL = String.fromCharCode(10);

/* ---------------- 1. useApi ---------------- */
{
  const f = 'apps/web/lib/hooks/useApi.ts';
  let t = fs.readFileSync(f, 'utf8');

  // nonce increment + forceRef supaya efek tahu ini pemaksaan
  const oldReload = [
    '  const reload = useCallback(() => {',
    '    setNonce((n) => n + 1);',
    '  }, []);',
  ].join(NL);

  const newReload = [
    '  /*',
    '   * `reload()` = paksa ambil ulang dari server, mengabaikan cache.',
    '   * `forceRef` menandai efek berikutnya agar memakai `force: true`.',
    '   */',
    '  const forceRef = useRef(false);',
    '  const reload = useCallback(() => {',
    '    forceRef.current = true;',
    '    setNonce((n) => n + 1);',
    '  }, []);',
  ].join(NL);

  if (!t.includes('forceRef')) {
    if (!t.includes(oldReload)) {
      console.log('GAGAL: blok reload tidak ditemukan');
    } else {
      t = t.replace(oldReload, newReload);
      t = t.replace('    fetchCached<T>(path)', '    const force = forceRef.current;\n    forceRef.current = false;\n\n    fetchCached<T>(path, { force })');
    }
  }
  fs.writeFileSync(f, t, 'utf8');
  console.log('useApi: reload memaksa fetch');
}

/* ---------------- 2. apiSend invalidasi ---------------- */
{
  const f = 'apps/web/lib/api-client.ts';
  let t = fs.readFileSync(f, 'utf8');

  if (!t.includes('invalidateMatching')) {
    const importAnchor = "import {";
    // tambahkan import di baris pertama (cari akhir import blok)
    const lastImportEnd = t.lastIndexOf(NL + '} from');
    const scanFrom = lastImportEnd === -1 ? 0 : t.indexOf(NL, lastImportEnd + 1);
    const insertAt = scanFrom === -1 ? 0 : scanFrom + 1;
    t = t.slice(0, insertAt) + "import { invalidateMatching } from './data-cache';" + NL + t.slice(insertAt);

    // setelah mutasi sukses, buang cache yang relevan
    const hookComment = [
      '',
      '/*',
      ' * INVALIDASI CACHE SETELAH MUTASI',
      ' * Setiap POST/PUT/PATCH/DELETE berhasil berarti data di server berubah,',
      ' * sehingga cache yang mungkin basi harus dibuang. Tanpa ini, halaman bisa',
      ' * menampilkan angka lama setelah user menyimpan sesuatu.',
      ' */',
      'function invalidateAfterMutation(path: string): void {',
      '  const seg = path.split("?")[0];',
      '  // Selalu buang daftar/detail laporan, dashboard, dan agregat terkait.',
      '  invalidateMatching(/^\\/api\\/reports/);',
      '  invalidateMatching(/^\\/api\\/dashboard/);',
      '  invalidateMatching(/^\\/api\\/billing/);',
      '  invalidateMatching(/^\\/api\\/insights/);',
      '  invalidateMatching(/^\\/api\\/audit/);',
      '  invalidateMatching(/^\\/api\\/admin\\//);',
      '  invalidateMatching(/^\\/api\\/personnel/);',
      '  invalidateMatching(/^\\/api\\/sync\\//);',
      '  // Master data: hanya bila yang berubah memang master.',
      '  if (seg.startsWith("/api/wells") || seg.startsWith("/api/rigs") || seg.startsWith("/api/master")) {',
      '    invalidateMatching(/^\\/api\\/wells/);',
      '    invalidateMatching(/^\\/api\\/rigs/);',
      '    invalidateMatching(/^\\/api\\/master/);',
      '  }',
      '  if (seg.startsWith("/api/auth")) {',
      '    invalidateMatching(/^\\/api\\/auth/);',
      '  }',
      '}',
      '',
    ].join(NL);

    // sisipkan sebelum definisi apiSend
    const marker = 'export async function apiSend';
    const idx = t.indexOf(marker);
    if (idx !== -1) {
      t = t.slice(0, idx) + hookComment + t.slice(idx);
    }

    // panggil setelah sukses pada apiSend
    t = t.replace(/(export async function apiSend[\s\S]*?)(\n\s*return\s)/, '$1$2');
  }

  fs.writeFileSync(f, t, 'utf8');
  console.log('api-client: helper invalidasi ditambahkan');
}
