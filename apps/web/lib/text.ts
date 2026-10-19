/**
 * Sanitasi teks yang tampil di UI.
 *
 * LATAR BELAKANG MASALAH
 * Nilai lama di database bisa berisi "mojibake": UTF-8 yang dibaca sebagai
 * CP1252 sehingga em dash (U+2014) tersimpan sebagai tiga karakter
 * "â€"" dan tampil berantakan di layar, mis.
 *   "Mud Pumps (#1 & #2): Degraded â€" Pump 2 high discharge pulsation"
 *
 * PERBAIKAN BERLAPIS
 * 1. Data baru disimpan bersih (ditegakkan di lapisan penulisan).
 * 2. Data lama dibersihkan saat dibaca, lewat `cleanText()`. Ini penting
 *    karena database produksi tidak bisa diasumsikan bersih.
 *
 * `cleanText()` aman untuk dipakai di server maupun klien: tanpa dependensi,
 * tanpa akses jaringan.
 */

/** Urutan penting: pola terpanjang lebih dulu agar tidak saling menimpa. */
const REPLACEMENTS: Array<[string, string]> = [
  ['â€\u009d', '"'], ['“', '"'], ['’', "'"], ['‘', "'"],
  ['-', '-'], ['-', '-'], ['...', '...'], ['•', '*'],
  ['€', 'EUR'], ['™', 'TM'], ['‹', '<'], ['›', '>'],
  ['«', '"'], ['»', '"'], ['°', ' deg'], ['±', '+/-'],
  ['·', '*'], ['§', 'S'], ['¶', 'P'], ['©', '(c)'], ['®', '(R)'],
  ['é', 'e'], ['è', 'e'], ['ê', 'e'], ['á', 'a'], ['à', 'a'],
  ['ó', 'o'], ['ò', 'o'], ['ú', 'u'], ['í', 'i'], ['ñ', 'n'],
  ['ü', 'u'], ['ö', 'o'], ['ä', 'a'], ['ç', 'c'], ['ß', 'ss'],
  ['', ''],
];

/** Karakter tipografi non-ASCII yang harus menjadi ASCII setara. */
const TYPOGRAPHY: Array<[RegExp, string]> = [
  [/\u2014/g, '-'],  // em dash
  [/\u2013/g, '-'],  // en dash
  [/\u2026/g, '...'], // ellipsis
  [/\u2018|\u2019/g, "'"],
  [/\u201C|\u201D/g, '"'],
  [/\u00A0|\u202F/g, ' '], // NBSP
  [/\u2022/g, '*'],
  [/\u00B0/g, ' deg'],
  [/\u00D7/g, 'x'],
  [/\uFFFD/g, ''],
];

/** Bersihkan satu string: pulihkan mojibake lalu normalkan tipografi. */
export function cleanText(input: string): string {
  let out = input;
  for (const [bad, good] of REPLACEMENTS) {
    if (out.includes(bad)) out = out.split(bad).join(good);
  }
  for (const [pattern, good] of TYPOGRAPHY) {
    out = out.replace(pattern, good);
  }
  return out;
}

/** Bersihkan semua nilai string dalam objek/array secara rekursif. */
export function cleanDeep<T>(value: T): T {
  if (typeof value === 'string') return cleanText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => cleanDeep(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[cleanText(k)] = cleanDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}

/** Deteksi apakah sebuah string masih mengandung sisa mojibake. */
export function hasMojibake(input: string): boolean {
  return /â€|Ã.|Â.|ðŸ|/.test(input);
}
