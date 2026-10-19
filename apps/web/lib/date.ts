/**
 * Helper tanggal - AMAN untuk client & server (pure JS, tanpa dependency, tanpa
 * `server-only`).
 *
 * MASALAH YANG DIPERBAIKI (P1-4)
 *   `new Date().toISOString().slice(0, 10)` selalu menghasilkan tanggal **UTC**.
 *   Di WIB (UTC+7), pukul 00:00-06:59 tanggal lokal masih tanggal kemarin di UTC
 *   → "hari ini" salah satu hari, copy-forward membuat DDR bertanggal kemarin,
 *   dan laporan hari ini tidak dikenali sebagai "sudah ada".
 *
 * SOLUSI
 *   Ambil komponen Y/M/D di zona waktu yang diminta lewat `Intl.DateTimeFormat`
 *   locale `en-CA` (format bawaannya `YYYY-MM-DD`), bukan komponen UTC.
 */
/** Format tanggal lokal `YYYY-MM-DD` di zona waktu `tz`. */
export function isoDateInTz(date: Date, tz = 'Asia/Jakarta'): string {
  // 'en-CA' → 'YYYY-MM-DD' (ISO 8601 dasar). Berlaku sama di Node & browser.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Tanggal (WIB) hari ini untuk `date`, format `YYYY-MM-DD`. */
export function todayIsoLocalFor(date: Date, tz = 'Asia/Jakarta'): string {
  return isoDateInTz(date, tz);
}

/** Tanggal (WIB) hari ini, format `YYYY-MM-DD`. Aman untuk client & server. */
export function todayIsoLocal(tz = 'Asia/Jakarta'): string {
  return isoDateInTz(new Date(), tz);
}

/** Bulan (WIB) hari ini, format `YYYY-MM` - untuk pemilih periode billing/audit. */
export function currentMonthIsoLocal(tz = 'Asia/Jakarta'): string {
  return isoDateInTz(new Date(), tz).slice(0, 7);
}
