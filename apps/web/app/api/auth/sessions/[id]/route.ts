/**
 * DELETE /api/auth/sessions/[id]
 *
 * Cabut satu sesi MILIK user yang login. 404 bila sesi tidak ada atau bukan
 * miliknya (id sesi user lain tidak boleh bisa dicabut dari endpoint ini).
 *
 * Catatan: mencabut sesi yang sedang dipakai akan membuat request berikutnya
 * gagal 401 - itu perilaku yang benar (setara logout di perangkat itu).
 */
import { ApiError, fail, getClientIp, ok } from '@/lib/api-response';
import { recordAudit, requireUser } from '@/lib/auth';
import { revokeSession } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const user = await requireUser();

    const id = decodeURIComponent(params.id ?? '').trim();
    if (!id) throw new ApiError(400, 'INVALID_ID', 'id sesi wajib diisi.');

    const revoked = await revokeSession(user.id, id);
    if (!revoked) {
      throw new ApiError(404, 'SESSION_NOT_FOUND', 'Sesi tidak ditemukan atau sudah berakhir.');
    }

    await recordAudit({
      entity: 'user',
      entityId: user.id,
      action: 'sessions_revoke',
      actor: user,
      newJson: { sessionId: id },
      ip: getClientIp(req),
      terminal: req.headers.get('user-agent')?.slice(0, 300) ?? null,
    });

    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
