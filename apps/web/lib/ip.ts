/**
 * Utilitas alamat IP.
 *
 * MASALAH YANG DIPERBAIKI
 * Sebelumnya IP ditampilkan apa adanya dari header. Di lingkungan lokal,
 * Next.js menerima `::1` atau `::ffff:127.0.0.1` (IPv6-mapped IPv4) sehingga
 * yang tercetak bukan alamat IPv4 asli komputer. Di belakang proxy,
 * `x-forwarded-for` bisa berisi rantai alamat.
 *
 * Fungsi di sini:
 *  - `normalizeIp()` : memetakan IPv6-mapped ke IPv4, `::1` -> `127.0.0.1`.
 *  - `pickClientIp()`: memilih alamat klien paling masuk akal dari rantai proxy,
 *    membuang entri yang tidak valid (mis. spasi/kosong).
 *  - `describeIp()`  : label jaringan + apakah loopback/lokal.
 */

/** Ubah `::ffff:192.168.1.5` -> `192.168.1.5`, `::1` -> `127.0.0.1`. */
export function normalizeIp(raw: string | null | undefined): string {
  if (!raw) return 'unknown';
  let ip = raw.trim();

  // Buang port bila ada (mis. "192.168.1.5:54321").
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.split(':')[0];

  // IPv6 dengan bracket: [::1]:3000
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(ip);
  if (bracket) ip = bracket[1];

  // IPv6-mapped IPv4
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1];

  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return '127.0.0.1';
  if (ip === '::' || ip === '') return 'unknown';

  return ip;
}

/** Apakah IP loopback (komputer yang sama dengan server). */
export function isLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.');
}

/** Apakah IP privat (LAN/VPN). */
export function isPrivateIp(ip: string): boolean {
  if (isLoopback(ip)) return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('169.254.')) return true;
  if (ip.startsWith('172.')) {
    const second = Number(ip.split('.')[1] ?? 0);
    return second >= 16 && second <= 31;
  }
  if (ip.includes(':')) {
    const low = ip.toLowerCase();
    return low.startsWith('fc') || low.startsWith('fd') || low.startsWith('fe80');
  }
  return false;
}

export type IpInfo = {
  /** IP yang ditampilkan ke pengguna (sudah dinormalisasi). */
  ip: string;
  /** Alamat IPv4 lokal mesin klien bila peramban mengizinkannya. */
  localIp: string | null;
  /** Label jaringan. */
  network: string;
  loopback: boolean;
  private: boolean;
  /** Asal alamat: 'server' (dilihat server) atau 'browser' (dilaporkan klien). */
  source: 'server' | 'browser';
};

export function describeIp(ip: string, localIp?: string | null): IpInfo {
  const normalized = normalizeIp(ip);
  const local = localIp ? normalizeIp(localIp) : null;

  /*
   * Bila server hanya melihat loopback (::1) tetapi peramban melaporkan IPv4
   * lokalnya (mis. 192.168.1.24), pakai alamat peramban karena itu yang
   * benar-benar mengidentifikasi komputer pengguna.
   */
  const useBrowserIp = local && isLoopback(normalized) && !isLoopback(local);

  const shown = useBrowserIp ? local : normalized;

  const network = isLoopback(shown)
    ? 'Komputer lokal (loopback)'
    : isPrivateIp(shown)
      ? 'Jaringan privat (LAN/VPN)'
      : shown === 'unknown'
        ? 'Tidak diketahui'
        : 'Jaringan publik';

  return {
    ip: shown,
    localIp: local,
    network,
    loopback: isLoopback(shown),
    private: isPrivateIp(shown),
    source: useBrowserIp ? 'browser' : 'server',
  };
}

/**
 * Pilih alamat klien dari header proxy.
 *
 * Urutan: `x-forwarded-for` (entri pertama yang valid) -> `x-real-ip` ->
 * `cf-connecting-ip` -> `unknown`.
 */
export function pickClientIp(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for');
  if (fwd) {
    for (const part of fwd.split(',')) {
      const candidate = normalizeIp(part);
      if (candidate !== 'unknown') return candidate;
    }
  }
  for (const name of ['x-real-ip', 'cf-connecting-ip', 'true-client-ip', 'x-client-ip']) {
    const v = headers.get(name);
    if (v) {
      const candidate = normalizeIp(v);
      if (candidate !== 'unknown') return candidate;
    }
  }
  return 'unknown';
}
