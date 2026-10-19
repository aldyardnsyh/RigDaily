/**
 * GET /api/audit?entity=&entityId=&limit=
 *
 * Jejak audit. Identik dengan `/api/admin/audit` (satu implementasi: `listAudit`),
 * disediakan di path ringkas untuk halaman audit & Sync Center.
 * Butuh `audit:read`.
 */
import { z } from 'zod';
import { fail, ok, parseBody } from '@/lib/api-response';
import { requirePermission } from '@/lib/auth';
import { queryToObject } from '@/lib/http-query';
import { listAudit } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zAuditQuery = z.object({
  entity: z.string().min(1).max(60).optional(),
  entityId: z.string().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export async function GET(req: Request): Promise<Response> {
  try {
    await requirePermission('audit:read');
    const query = parseBody(zAuditQuery, queryToObject(req.url));

    return ok(
      await listAudit({
        entity: query.entity,
        entityId: query.entityId,
        limit: query.limit,
      }),
    );
  } catch (err) {
    return fail(err);
  }
}
