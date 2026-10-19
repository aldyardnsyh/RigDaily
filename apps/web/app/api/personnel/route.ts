/**
 * GET /api/personnel?rigId=&wellId=&reportId=&from=&to=&limit=
 *
 * Daftar POB (crew per DDR) + ringkasan mustering. Semua filter opsional;
 * tanpa filter → 500 baris terbaru dari seluruh laporan.
 *
 * Butuh `report:read`. `limit` default 500, maksimum 2000 (lihat repo).
 */
import { z } from 'zod';
import { fail, ok, parseBody } from '@/lib/api-response';
import { requirePermission } from '@/lib/auth';
import { queryToObject } from '@/lib/http-query';
import { getPobSummary, listPersonnel } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LIMIT = 500;

const zQuery = z
  .object({
    rigId: z.string().uuid('rigId harus UUID').optional(),
    wellId: z.string().uuid('wellId harus UUID').optional(),
    reportId: z.string().uuid('reportId harus UUID').optional(),
    from: z.string().regex(ISO_DATE, 'from harus YYYY-MM-DD').optional(),
    to: z.string().regex(ISO_DATE, 'to harus YYYY-MM-DD').optional(),
    limit: z.coerce.number().int().min(1).max(2000).optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: 'Rentang tanggal tidak valid: "from" harus ≤ "to".',
  });

export async function GET(req: Request): Promise<Response> {
  try {
    await requirePermission('report:read');
    const query = parseBody(zQuery, queryToObject(req.url));

    const filter = {
      rigId: query.rigId,
      wellId: query.wellId,
      reportId: query.reportId,
      from: query.from,
      to: query.to,
    };

    const [items, summary] = await Promise.all([
      listPersonnel({ ...filter, limit: query.limit ?? DEFAULT_LIMIT }),
      getPobSummary(filter),
    ]);

    return ok({ items, summary });
  } catch (err) {
    return fail(err);
  }
}
