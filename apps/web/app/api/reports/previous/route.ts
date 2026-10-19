/**
 * GET /api/reports/previous?wellId=&before=  → laporan TERAKHIR sebelum tanggal `before`
 *
 * Dipakai copy-forward DDR: sumber salinan diambil dari server lewat
 * `getPreviousReport()` - tidak bergantung pada laporan mana yang sedang
 * dibuka di layar, dan tidak bergantung pada status laporan sumber.
 *
 * `before` default = hari ini WIB (`todayIsoLocal`), zona yang sama dengan
 * tanggal draft baru di klien - P1-4: `toISOString()` (UTC) membuat pukul
 * 00:00-06:59 WIB dianggap "kemarin".
 * Respons: `{ data: ReportDetail | null }` (null = sumur belum punya laporan sebelumnya).
 * Butuh `report:read`.
 */
import { z } from 'zod';
import { zIsoDate } from '@rigdaily/shared';
import { fail, ok, parseBody } from '@/lib/api-response';
import { requirePermission } from '@/lib/auth';
import { todayIsoLocal } from '@/lib/date';
import { queryToObject } from '@/lib/http-query';
import { getPreviousReport } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zQuery = z.object({
  wellId: z.string().uuid('wellId harus UUID'),
  before: zIsoDate.optional(),
});

export async function GET(req: Request): Promise<Response> {
  try {
    await requirePermission('report:read');

    const query = parseBody(zQuery, queryToObject(req.url));
    const before = query.before ?? todayIsoLocal();

    return ok(await getPreviousReport(query.wellId, before));
  } catch (err) {
    return fail(err);
  }
}
