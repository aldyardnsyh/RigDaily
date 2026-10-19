/**
 * GET  /api/sync/conflicts?status=open|resolved|all  → daftar konflik
 * POST /api/sync/conflicts { id, resolution }        → selesaikan satu konflik
 *
 * Get: `sync:read`; Post: `sync:resolve` (CompanyMan/Admin).
 * Laporan approved tidak pernah ditimpa otomatis - resolusi manual di sini.
 */
import { z } from 'zod';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { requirePermission, recordAudit } from '@/lib/auth';
import { queryToObject } from '@/lib/http-query';
import { listConflicts, resolveConflict } from '@/lib/sync/conflict';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zListQuery = z.object({
  status: z.enum(['open', 'resolved', 'discarded', 'all']).default('open'),
});

const zResolveBody = z.object({
  id: z.string().uuid('ID konflik harus UUID'),
  resolution: z.enum(['keep_rig', 'keep_server', 'merge']),
});

export async function GET(req: Request): Promise<Response> {
  try {
    await requirePermission('sync:read');
    const query = parseBody(zListQuery, queryToObject(req.url));
    return ok(await listConflicts(query.status));
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const user = await requirePermission('sync:resolve');
    const body = parseBody(zResolveBody, await readJson(req));

    if (!body.id) {
      throw new ApiError(400, 'MISSING_ID', 'ID konflik wajib diisi.');
    }

    // `resolveConflict` menulis audit `sync_conflict/resolve` sendiri (lengkap
    // dengan oldJson/newJson); di sini cukup catat aksi HTTP untuk jejak request.
    await resolveConflict(body.id, body.resolution, user.id);

    await recordAudit({
      entity: 'sync',
      entityId: body.id,
      action: 'sync_resolve',
      actor: user,
      ip: getClientIp(req),
      newJson: { resolution: body.resolution },
    });

    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
