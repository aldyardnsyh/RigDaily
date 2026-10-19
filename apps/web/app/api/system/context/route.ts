/**
 * GET /api/system/context
 *
 * Konteks perangkat & waktu untuk halaman LOGIN (sebelum ada sesi).
 *
 * Semua nilai berasal dari kenyataan, bukan angka tetap:
 *  - `ip`        : alamat IP klien menurut header proxy (x-forwarded-for) atau socket.
 *  - `clientIp`  : alias eksplisit untuk keterbacaan.
 *  - `network`   : label jaringan privat/publik berdasarkan kelas IP.
 *  - `terminal`  : identitas perangkat yang masuk akal untuk ditampilkan, diturunkan
 *                  dari alamat IP + user agent (bukan nama karangan).
 *  - `userAgent` : string mentah untuk audit/dukungan.
 *  - `browser` / `platform` : hasil parse user agent.
 *  - `time`      : waktu server (ISO + lokal zona operasi).
 *  - `connection`: status DB (apakah sistem benar-benar siap menerima login).
 *  - `appVersion`: versi aplikasi.
 *
 * TANPA auth: halaman login butuh data ini sebelum user masuk. Tidak ada
 * informasi sensitif yang dibocorkan (tanpa kredensial, tanpa data sumur).
 */
import { sql } from 'drizzle-orm';
import { db } from '@rigdaily/database';
import { ok } from '@/lib/api-response';
import { getClientIp } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIME_ZONE = process.env.RIGDAILY_TIMEZONE ?? 'Asia/Jakarta';
const APP_VERSION = '0.1.0';

function isPrivateIp(ip: string): boolean {
  if (!ip) return false;
  if (ip === '::1' || ip === '127.0.0.1') return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('172.')) {
    const second = Number(ip.split('.')[1] ?? 0);
    return second >= 16 && second <= 31;
  }
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) return true;
  return false;
}

function networkLabel(ip: string): string {
  if (!ip || ip === 'unknown') return 'Tidak diketahui';
  if (isPrivateIp(ip)) return 'Jaringan privat (LAN/VPN)';
  return 'Jaringan publik';
}

/** Parse user agent menjadi label ramah (tanpa pustaka tambahan). */
function parseUserAgent(ua: string): { browser: string; platform: string; device: string } {
  const browser = /Edg\//.test(ua)
    ? 'Microsoft Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua) && !/Chromium/.test(ua)
        ? 'Google Chrome'
        : /Firefox\//.test(ua)
          ? 'Mozilla Firefox'
          : /Safari\//.test(ua) && !/Chrome/.test(ua)
            ? 'Safari'
            : 'Peramban lain';

  const platform = /Windows NT 10/.test(ua)
    ? 'Windows 10/11'
    : /Windows NT/.test(ua)
      ? 'Windows'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Android/.test(ua)
          ? 'Android'
          : /iPhone|iPad|iPod/.test(ua)
            ? 'iOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Tidak diketahui';

  const device = /Mobile|Android|iPhone/.test(ua)
    ? 'Perangkat bergerak'
    : /iPad|Tablet/.test(ua)
      ? 'Tablet'
      : 'Komputer';

  return { browser, platform, device };
}

/**
 * Identitas terminal diturunkan dari IP + platform, bukan nama karangan.
 * Contoh: "LT-192-168-1-24" untuk laptop di 192.168.1.24.
 */
function terminalLabel(ip: string, platform: string, device: string): string {
  if (!ip || ip === 'unknown') return 'Perangkat tanpa IP terdeteksi';
  const compact = ip.replace(/[^0-9a-zA-Z]/g, '-').replace(/-+/g, '-');
  const prefix = device === 'Perangkat bergerak' ? 'MB' : device === 'Tablet' ? 'TB' : 'LT';
  return `${prefix}-${compact}`;
}

export async function GET(req: Request): Promise<Response> {
  const ip = getClientIp(req);
  const ua = req.headers.get('user-agent') ?? '';
  const { browser, platform, device } = parseUserAgent(ua);

  let dbReady = false;
  try {
    await db.execute(sql`SELECT 1`);
    dbReady = true;
  } catch {
    dbReady = false;
  }

  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) if (p.type !== 'literal') parts[p.type] = p.value;
  if (parts.hour === '24') parts.hour = '00';

  return ok({
    ip,
    clientIp: ip,
    network: networkLabel(ip),
    terminal: terminalLabel(ip, platform, device),
    userAgent: ua || null,
    browser,
    platform,
    device,
    time: {
      iso: now.toISOString(),
      epochMs: now.getTime(),
      timeZone: TIME_ZONE,
      localDate: `${parts.year}-${parts.month}-${parts.day}`,
      localTime: `${parts.hour}:${parts.minute}:${parts.second}`,
    },
    connection: {
      database: dbReady,
      status: dbReady ? ('online' as const) : ('degraded' as const),
    },
    appVersion: APP_VERSION,
  });
}
