/**
 * GET /api/billing?rigId=<uuid>&month=YYYY-MM
 *
 * Billing bulanan tiered untuk satu rig: jam per (tanggal, kode IADC) dikali rate
 * card via `calcMonthlyBilling()` shared. Butuh `billing:read`.
 *
 * Kedua query WAJIB: tanpa `rigId`/`month` → 400 (bukan diam-diam semua rig).
 */
import { z } from 'zod';
import { ApiError, fail, ok, parseBody } from '@/lib/api-response';
import { requirePermission } from '@/lib/auth';
import { assertRigAccess } from '@/lib/rbac';
import { queryToObject } from '@/lib/http-query';
import { getMonthlyBilling, getRigById } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zQuery = z.object({
  rigId: z.string().uuid('rigId harus UUID'),
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Format bulan harus YYYY-MM (contoh 2026-09)'),
});

export async function GET(req: Request): Promise<Response> {
  try {
    const user = await requirePermission('billing:read');
    const query = parseBody(zQuery, queryToObject(req.url));

    const rig = await getRigById(query.rigId);
    if (!rig) {
      throw new ApiError(404, 'RIG_NOT_FOUND', `Rig ${query.rigId} tidak ditemukan.`);
    }

    assertRigAccess(user, query.rigId);

    const billing = await getMonthlyBilling(query.rigId, query.month);

    return ok({
      rigId: query.rigId,
      rigName: rig.name,
      month: query.month,
      ...billing,
    });
  } catch (err) {
    return fail(err);
  }
}
