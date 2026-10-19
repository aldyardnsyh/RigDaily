/**
 * GET /api/system/time
 *
 * Sumber waktu tunggal untuk UI. Semua jam/tanggal yang tampil di klien
 * HARUS berasal dari sini (atau dihitung dari selisih waktu server), bukan
 * dari jam perangkat pengguna: perangkat rig sering salah setel zona waktu.
 *
 * Mengembalikan:
 *  - `iso`        : waktu server dalam ISO 8601 (UTC)
 *  - `epochMs`    : milidetik sejak epoch (untuk sinkronisasi jam klien)
 *  - `timeZone`   : zona waktu operasi (default Asia/Jakarta)
 *  - `localIso`   : tanggal operasi `YYYY-MM-DD` pada zona tersebut
 *  - `localTime`  : jam operasi `HH:MM`
 *  - `shift`      : shift berjalan (Day 06:00-18:00 / Night 18:00-06:00)
 *  - `reportDate` : tanggal laporan yang sedang berjalan (periode 06:00-06:00)
 *  - `uptimeSec`  : umur proses server
 */
import { ok } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIME_ZONE = process.env.RIGDAILY_TIMEZONE ?? 'Asia/Jakarta';

type Parts = { year: string; month: string; day: string; hour: string; minute: string; second: string };

function zonedParts(date: Date, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  // en-CA dengan hour12:false bisa memberi "24" untuk tengah malam.
  if (out.hour === '24') out.hour = '00';
  return out as unknown as Parts;
}

export async function GET(): Promise<Response> {
  const now = new Date();
  const p = zonedParts(now, TIME_ZONE);

  const hour = Number(p.hour);
  const minute = Number(p.minute);

  // Shift operasi: Day 06:00-18:00, Night 18:00-06:00.
  const isDayShift = hour >= 6 && hour < 18;
  const shift = isDayShift ? 'Day' : 'Night';

  /*
   * Periode laporan DDR berjalan 06:00 -> 06:00. Laporan yang sedang diisi
   * sebelum pukul 06:00 masih milik tanggal kemarin.
   */
  let reportYear = Number(p.year);
  let reportMonth = Number(p.month);
  let reportDay = Number(p.day);
  if (hour < 6) {
    const d = new Date(Date.UTC(reportYear, reportMonth - 1, reportDay));
    d.setUTCDate(d.getUTCDate() - 1);
    reportYear = d.getUTCFullYear();
    reportMonth = d.getUTCMonth() + 1;
    reportDay = d.getUTCDate();
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  const reportDate = `${reportYear}-${pad(reportMonth)}-${pad(reportDay)}`;

  return ok({
    iso: now.toISOString(),
    epochMs: now.getTime(),
    timeZone: TIME_ZONE,
    localIso: `${p.year}-${p.month}-${p.day}`,
    localTime: `${p.hour}:${p.minute}`,
    localDateTime: `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`,
    shift,
    shiftWindow: isDayShift ? '06:00-18:00' : '18:00-06:00',
    reportDate,
    uptimeSec: Math.round(process.uptime()),
    serverTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    ...(minute >= 0 ? {} : {}),
  });
}
