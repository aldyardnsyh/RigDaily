/**
 * GET /api/dashboard/trend?wellId=<uuid>&days=14
 *
 * Tren kedalaman / NPT% / biaya harian per tanggal (urut naik).
 * `wellId` WAJIB (tren selalu per sumur); `days` default 14, max 365.
 * Butuh `dashboard:read`.
 */
import { z } from 'zod';
import { fail, ok, parseBody } from '@/lib/api-response';
import { requirePermission } from '@/lib/auth';
import { queryToObject } from '@/lib/http-query';
import { getTrend } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zQuery = z.object({
  wellId: z.string().uuid('wellId wajib diisi dan harus UUID'),
  days: z.coerce.number().int().min(1).max(365).default(14),
});

export async function GET(req: Request): Promise<Response> {
  try {
    await requirePermission('dashboard:read');
    const query = parseBody(zQuery, queryToObject(req.url));

    const points = await getTrend(query.wellId, query.days);

    return ok({ wellId: query.wellId, days: query.days, points });
  } catch (err) {
    return fail(err);
  }
}
