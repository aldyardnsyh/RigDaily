/**
 * GET    /api/auth/sessions - daftar sesi aktif milik user (yang ini ditandai current).
 * DELETE /api/auth/sessions - cabut SEMUA sesi lain (semua perangkat selain ini).
 *
 * Token mentah dari cookie di-hash (`sha256Hex`) sebelum dibandingkan dengan
 * `sessions.tokenHash`; token mentah tidak pernah disimpan maupun dikirim balik.
 */
import { cookies } from 'next/headers';
import { ApiError, fail, getClientIp, ok } from '@/lib/api-response';
import { recordAudit, requireUser, SESSION_COOKIE } from '@/lib/auth';
import { hashSessionToken, listSessions, revokeOtherSessions } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function currentTokenHash(): Promise<string> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Sesi tidak valid atau sudah berakhir.');
  }
  return hashSessionToken(token);
}

export async function GET(): Promise<Response> {
  try {
    const user = await requireUser();
    const tokenHash = await currentTokenHash();

    return ok(await listSessions(user.id, tokenHash));
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request): Promise<Response> {
  try {
    const user = await requireUser();
    const tokenHash = await currentTokenHash();

    const revoked = await revokeOtherSessions(user.id, tokenHash);

    await recordAudit({
      entity: 'user',
      entityId: user.id,
      action: 'sessions_revoke_others',
      actor: user,
      newJson: { revoked },
      ip: getClientIp(req),
      terminal: req.headers.get('user-agent')?.slice(0, 300) ?? null,
    });

    return ok({ revoked });
  } catch (err) {
    return fail(err);
  }
}
