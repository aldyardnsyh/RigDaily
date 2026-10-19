// Ubah default accordion navigasi menjadi TERBUKA SEMUA.
// Pengguna baru langsung melihat seluruh fitur; klik header grup untuk menutup.
const fs = require('fs');
const NL = String.fromCharCode(10);
const f = 'packages/ui/src/components/appshell.tsx';
let t = fs.readFileSync(f, 'utf8');

/* ---------- 1. readStoredOpen: default true untuk semua grup ---------- */
const oldRead = t.slice(t.indexOf('function readStoredOpen()'), t.indexOf('function groupIdForActive'));
if (!oldRead) {
  console.log('GAGAL: readStoredOpen tidak ditemukan');
  process.exit(1);
}

const newRead = [
  '/**',
  ' * Baca state buka/tutup grup dari localStorage.',
  ' *',
  ' * DEFAULT: SEMUA GRUP TERBUKA.',
  ' * Alasan: pengguna baru harus langsung melihat seluruh fitur yang tersedia',
  ' * (Operations, Well Engineering, Drilling Support, dst) tanpa perlu menebak',
  ' * bahwa ada menu tersembunyi. Klik header grup untuk menutupnya.',
  ' *',
  ' * Yang disimpan adalah grup yang DITUTUP (closed), bukan yang dibuka. Dengan',
  ' * begitu, grup baru yang ditambahkan ke aplikasi otomatis ikut terbuka tanpa',
  ' * perlu migrasi data localStorage pengguna lama.',
  ' */',
  'function readStoredClosed(): Record<string, boolean> {',
  '  if (typeof window === ' + "'" + 'undefined' + "'" + ') return {};',
  '  try {',
  '    const raw = window.localStorage.getItem(NAV_OPEN_STORAGE_KEY);',
  '    if (!raw) return {};',
  '    const parsed: unknown = JSON.parse(raw);',
  '    if (typeof parsed !== ' + "'" + 'object' + "'" + ' || parsed === null || Array.isArray(parsed)) return {};',
  '    const result: Record<string, boolean> = {};',
  '    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {',
  '      if (typeof value === ' + "'" + 'boolean' + "'" + ') result[key] = value;',
  '    }',
  '    return result;',
  '  } catch {',
  '    return {};',
  '  }',
  '}',
  '',
  '/** Simpan daftar grup yang ditutup. */',
  'function writeStoredClosed(map: Record<string, boolean>): void {',
  '  if (typeof window === ' + "'" + 'undefined' + "'" + ') return;',
  '  try {',
  '    window.localStorage.setItem(NAV_OPEN_STORAGE_KEY, JSON.stringify(map));',
  '  } catch {',
  '    /* localStorage diblokir (mode privat): abaikan, state tetap jalan di memori */',
  '  }',
  '}',
  '',
  '',
].join(NL);

t = t.replace(oldRead, newRead);
fs.writeFileSync(f, t, 'utf8');
console.log('readStoredClosed + writeStoredClosed dipasang');
