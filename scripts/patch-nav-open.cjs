// Ganti blok readStoredOpen/writeStoredOpen/useNavGroups dengan versi
// DEFAULT TERBUKA SEMUA grup.
const fs = require('fs');
const NL = String.fromCharCode(10);
const f = 'packages/ui/src/components/appshell.tsx';
const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);

// Cari batas blok: dari baris berisi "Baca state tersimpan" sampai sebelum
// baris "/** Inisial 2 huruf".
const startIdx = lines.findIndex((l) => l.includes('Baca state tersimpan'));
const endIdx = lines.findIndex((l) => l.includes('Inisial 2 huruf'));
if (startIdx === -1 || endIdx === -1) {
  console.log('GAGAL: batas blok tidak ditemukan', startIdx, endIdx);
  process.exit(1);
}

// startIdx menunjuk ke baris komentar "/** Baca state ..."; mulai dari situ.
const head = lines.slice(0, startIdx);
// endIdx menunjuk ke baris komentar "/** Inisial ..."; kita sisipkan sebelum itu,
// dan buang baris kosong tepat sebelum komentar itu.
let tailStart = endIdx;
while (tailStart > 0 && lines[tailStart - 1].trim() === '') tailStart -= 1;
const tail = lines.slice(tailStart);

const block = [
  '/**',
  ' * Baca daftar grup yang DITUTUP dari localStorage.',
  ' *',
  ' * DEFAULT: SEMUA GRUP TERBUKA.',
  ' * Alasan: pengguna baru harus langsung melihat seluruh fitur yang tersedia',
  ' * (Operations, Well Engineering, Drilling Support, dst) tanpa perlu menebak',
  ' * bahwa ada menu tersembunyi. Klik header grup untuk menutupnya.',
  ' *',
  ' * Yang disimpan adalah grup yang DITUTUP, bukan yang dibuka. Dengan begitu',
  ' * grup baru yang ditambahkan kemudian otomatis ikut terbuka tanpa perlu',
  ' * migrasi data localStorage pengguna lama.',
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
  'function writeStoredClosed(value: Record<string, boolean>): void {',
  '  if (typeof window === ' + "'" + 'undefined' + "'" + ') return;',
  '  try {',
  '    window.localStorage.setItem(NAV_OPEN_STORAGE_KEY, JSON.stringify(value));',
  '  } catch {',
  '    // Mode privat / kuota penuh: state hanya hidup di memori, bukan error.',
  '  }',
  '}',
  '',
  '/**',
  ' * State buka/tutup grup navigasi.',
  ' *',
  ' * Aturan:',
  ' * - DEFAULT TERBUKA: semua grup terbuka agar seluruh fitur langsung terlihat.',
  ' * - Grup yang memuat halaman aktif SELALU terbuka (override, tidak disimpan).',
  ' * - Klik header grup menutupnya; pilihan itu disimpan di localStorage.',
  ' * - Sebelum hidrasi (SSR), semua grup juga dirender terbuka supaya tidak ada',
  ' *   kedipan buka-tutup saat halaman selesai dimuat.',
  ' */',
  'function useNavGroups(activeId: string): {',
  '  isOpen: (groupId: string) => boolean;',
  '  toggle: (groupId: string) => void;',
  '} {',
  '  const activeGroup = groupIdForActive(activeId);',
  '  /** Berisi grup yang DITUTUP pengguna. Kosong = semua terbuka. */',
  '  const [closedMap, setClosedMap] = useState<Record<string, boolean>>({});',
  '  const hydratedRef = useRef(false);',
  '',
  '  useEffect(() => {',
  '    // Hidrasi setelah mount: server tidak tahu localStorage, hindari mismatch.',
  '    setClosedMap(readStoredClosed());',
  '    hydratedRef.current = true;',
  '  }, []);',
  '',
  '  const toggle = useCallback((groupId: string) => {',
  '    setClosedMap((prev) => {',
  '      const next = { ...prev, [groupId]: !prev[groupId] };',
  '      writeStoredClosed(next);',
  '      return next;',
  '    });',
  '  }, []);',
  '',
  '  const isOpen = useCallback(',
  '    (groupId: string) => {',
  '      // Grup yang memuat halaman aktif selalu terbuka.',
  '      if (activeGroup === groupId) return true;',
  '      // Sebelum hidrasi: terbuka (default), agar tidak berkedip.',
  '      if (!hydratedRef.current) return true;',
  '      // Selain itu: terbuka kecuali pengguna menutupnya.',
  '      return closedMap[groupId] !== true;',
  '    },',
  '    [activeGroup, closedMap],',
  '  );',
  '',
  '  return { isOpen, toggle };',
  '}',
  '',
].join(NL);

const out = head.join(NL) + (head.length ? NL : '') + block + tail.join(NL);
fs.writeFileSync(f, out, 'utf8');
console.log('OK: default navigasi sekarang TERBUKA SEMUA');
