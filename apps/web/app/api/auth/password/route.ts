/**
 * POST /api/auth/password
 *
 * Ganti password user yang sedang login.
 *
 * Body: { currentPassword, newPassword, confirmPassword }
 *
 * Aturan:
 * - `newPassword === confirmPassword` wajib (400 PASSWORD_MISMATCH).
 * - Password baru tidak boleh sama dengan yang lama (400 PASSWORD_SAME).
 * - Password lama diverifikasi di repo (401 INVALID_CURRENT_PASSWORD).
 * - Rate limit 3 percobaan / 15 menit per userId agar password lama tidak bisa
 *   ditebak lewat endpoint ini (cookie sesi saja tidak cukup).
 * - Semua sesi LAIN dicabut setelah sukses; jumlahnya dilaporkan ke client.
 *
 * Audit `password_change` TIDAK memuat password/hash apa pun.
 */
import { cookies } from 'next/headers';
import { z } from 'zod';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requireUser, SESSION_COOKIE } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { changePassword, hashSessionToken, PASSWORD_MIN_LENGTH } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LIMIT = 3;
const WINDOW_MS = 15 * 60 * 1000;

const zPasswordChange = z
  .object({
    currentPassword: z.string().min(1, 'Password saat ini wajib diisi').max(200, 'Password maksimal 200 karakter'),
    newPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `Password baru minimal ${PASSWORD_MIN_LENGTH} karakter`)
      .max(200, 'Password maksimal 200 karakter'),
    confirmPassword: z.string().min(1, 'Konfirmasi password wajib diisi').max(200, 'Password maksimal 200 karakter'),
  })
  .strict();

export async function POST(req: Request): Promise<Response> {
  try {
    const user = await requireUser();
    const ip = getClientIp(req);
    const terminal = req.headers.get('user-agent')?.slice(0, 300) ?? null;

    const limit = rateLimit(`password:${user.id}`, { limit: LIMIT, windowMs: WINDOW_MS });
    if (!limit.allowed) {
      throw new ApiError(
        429,
        'RATE_LIMITED',
        `Terlalu banyak percobaan ganti password. Coba lagi dalam ${limit.retryAfterSec} detik.`,
        { retryAfterSec: limit.retryAfterSec },
      );
    }

    const body = parseBody(zPasswordChange, await readJson(req));

    if (body.newPassword !== body.confirmPassword) {
      throw new ApiError(400, 'PASSWORD_MISMATCH', 'Konfirmasi password baru tidak sama.');
    }
    if (body.newPassword === body.currentPassword) {
      throw new ApiError(400, 'PASSWORD_SAME', 'Password baru harus berbeda dari password saat ini.');
    }

    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    const tokenHash = token ? hashSessionToken(token) : '';
    if (!tokenHash) {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Sesi tidak valid atau sudah berakhir.');
    }

    // ApiError INVALID_CURRENT_PASSWORD (401) diteruskan apa adanya oleh fail().
    const revokedSessions = await changePassword(user.id, body.currentPassword, body.newPassword, tokenHash);

    await recordAudit({
      entity: 'user',
      entityId: user.id,
      action: 'password_change',
      actor: user,
      // Sengaja tanpa password/hash: hanya jejak bahwa password berubah.
      oldJson: null,
      newJson: { revokedSessions },
      ip,
      terminal,
    });

    return ok({ ok: true, revokedSessions });
  } catch (err) {
    return fail(err);
  }
}
