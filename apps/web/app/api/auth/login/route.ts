/**
 * POST /api/auth/login
 *
 * Rate limit 5 percobaan / 15 menit per (IP + email), lalu verifikasi kredensial.
 * Cookie sesi di-set oleh `login()` (HttpOnly, SameSite=Lax, Secure di produksi).
 */
import { zLoginRequest } from '@rigdaily/shared';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { login, recordAudit, SESSION_TTL_HOURS } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LIMIT = 5;
const WINDOW_MS = 15 * 60 * 1000;

/**
 * Terjemahkan error infrastruktur (DB belum siap) menjadi pesan yang bisa
 * ditindaklanjuti, bukan 500 generik.
 */
function translateDbError(err: unknown): ApiError | null {
  const code = (err as { code?: string } | null)?.code;
  const msg = err instanceof Error ? err.message : String(err);
  if (code === '42P01' || /relation ".*" does not exist/i.test(msg)) {
    return new ApiError(
      503,
      'DB_NOT_INITIALIZED',
      'Database belum diinisialisasi (tabel tidak ditemukan). Jalankan `npm run db:migrate` lalu `npm run db:seed`, kemudian restart `npm run dev`.',
    );
  }
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(msg)) {
    return new ApiError(
      503,
      'DB_UNREACHABLE',
      'Tidak bisa terhubung ke database. Pastikan PostgreSQL berjalan (docker compose -f infra/docker/compose.dev.yml up -d) dan DATABASE_URL benar.',
    );
  }
  if (code === '3D000' || /database ".*" does not exist/i.test(msg)) {
    return new ApiError(503, 'DB_UNKNOWN', 'Database tidak ditemukan. Periksa nama database pada DATABASE_URL.');
  }
  return null;
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = parseBody(zLoginRequest, await readJson(req));
    const email = body.email.trim().toLowerCase();
    const ip = getClientIp(req);
    const terminal = req.headers.get('user-agent')?.slice(0, 300) ?? null;

    const limit = rateLimit(`${ip}:${email}`, { limit: LIMIT, windowMs: WINDOW_MS });
    if (!limit.allowed) {
      throw new ApiError(
        429,
        'RATE_LIMITED',
        `Terlalu banyak percobaan login. Coba lagi dalam ${limit.retryAfterSec} detik.`,
        { retryAfterSec: limit.retryAfterSec },
      );
    }

    const user = await login(email, body.password, { ip, userAgent: terminal ?? undefined });

    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();

    await recordAudit({
      entity: 'auth',
      entityId: user.id,
      action: 'login',
      actor: user,
      ip,
      terminal,
      newJson: { email: user.email, role: user.role },
    });

    return ok({ user, expiresAt });
  } catch (err) {
    const dbErr = translateDbError(err);
    if (dbErr) {
      console.error('[api] login gagal karena database:', dbErr.message);
      return fail(dbErr);
    }
    return fail(err);
  }
}
