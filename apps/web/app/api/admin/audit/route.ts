/**
 * GET /api/admin/audit
 *
 * Query: `entity?`, `entityId?`, `limit?` (default 100, max 500).
 * Butuh `audit:read` (Admin, CompanyMan, DrillingEngineer, CostController, HSE).
 */
import { z } from 'zod';
import { fail, ok, parseBody } from '@/lib/api-response';
import { requirePermission } from '@/lib/auth';
import { listAudit } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zAuditQuery = z.object({
  entity: z.string().min(1).max(60).optional(),
  entityId: z.string().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/** Query string -> objek biasa agar bisa divalidasi zod seperti body. */
function queryToObject(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  new URL(url).searchParams.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export async function GET(req: Request): Promise<Response> {
  try {
    await requirePermission('audit:read');
    const query = parseBody(zAuditQuery, queryToObject(req.url));
    const entries = await listAudit({
      entity: query.entity,
      entityId: query.entityId,
      limit: query.limit,
    });

    return ok(entries);
  } catch (err) {
    return fail(err);
  }
}
