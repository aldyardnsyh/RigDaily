// Integrasikan cache ke useApi: tampilkan cache segera, fetch di latar.
const fs = require('fs');
const NL = String.fromCharCode(10);
const f = 'apps/web/lib/hooks/useApi.ts';
let t = fs.readFileSync(f, 'utf8');

const oldBlock = [
  '    const seq = ++seqRef.current;',
  '    setLoading(true);',
  '    setError(null);',
  '',
  '    apiGet<T>(path)',
  '      .then((result) => {',
  '        if (!aliveRef.current || seq !== seqRef.current) return;',
  '        setData(result);',
  '        setLoading(false);',
  '      })',
  '      .catch((err: unknown) => {',
  '        if (!aliveRef.current || seq !== seqRef.current) return;',
  '        setError(messageOf(err));',
  '        setLoading(false);',
  '      });',
].join(NL);

const newBlock = [
  '    const seq = ++seqRef.current;',
  '',
  '    /*',
  '     * JALUR CEPAT CACHE',
  '     * Bila data masih segar di memori, tampilkan langsung TANPA spinner.',
  '     * Ini membuat perpindahan halaman terasa instan: data master (sumur,',
  '     * rig, profil) tidak diambil ulang setiap pindah halaman.',
  '     * Bila data usang, data lama tetap tampil sambil diperbarui di latar',
  '     * (stale-while-revalidate) sehingga layar tidak berkedip.',
  '     */',
  '    const cached = peekCache<T>(path);',
  '    if (cached !== undefined) {',
  '      setData(cached);',
  '      setLoading(false);',
  '      setError(null);',
  '    } else {',
  '      setLoading(true);',
  '      setError(null);',
  '    }',
  '',
  '    fetchCached<T>(path)',
  '      .then((result) => {',
  '        if (!aliveRef.current || seq !== seqRef.current) return;',
  '        setData(result);',
  '        setLoading(false);',
  '      })',
  '      .catch((err: unknown) => {',
  '        if (!aliveRef.current || seq !== seqRef.current) return;',
  '        setError(messageOf(err));',
  '        setLoading(false);',
  '      });',
].join(NL);

if (!t.includes(oldBlock)) {
  console.log('GAGAL: blok fetch tidak ditemukan');
  process.exit(1);
}
t = t.replace(oldBlock, newBlock);

// import
const oldImport = "import { ApiClientError, apiGet } from '@/lib/api-client';";
const newImport =
  "import { ApiClientError } from '@/lib/api-client';" + NL + "import { fetchCached, peekCache } from '@/lib/data-cache';";
if (t.includes(oldImport)) {
  t = t.replace(oldImport, newImport);
} else {
  console.log('WARN: import apiGet tidak ditemukan, tambahkan manual nanti');
}

fs.writeFileSync(f, t, 'utf8');
console.log('useApi: cache terintegrasi');
