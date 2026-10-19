/**
 * POST /api/auth/logout
 *
 * Hapus baris `sessions` + cookie. Audit ditulis SEBELUM sesi dihancurkan
 * supaya aktornya masih diketahui.
 */
import { fail, getClientIp, ok } from '@/lib/api-response';
import { destroySession, getSessionUser, recordAudit } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  try {
    const user = await getSessionUser();

    if (user) {
      await recordAudit({
        entity: 'auth',
        entityId: user.id,
        action: 'logout',
        actor: user,
        ip: getClientIp(req),
        terminal: req.headers.get('user-agent')?.slice(0, 300) ?? null,
      });
    }

    await destroySession();

    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
