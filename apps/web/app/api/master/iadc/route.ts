/**
 * GET /api/master/iadc
 *
 * Daftar 34 kode IADC (master, bisa di-toggle NPT per company).
 * Butuh permission `report:read` - dipakai TimeGrid & admin master data.
 */
import { fail, ok } from '@/lib/api-response';
import { requirePermission } from '@/lib/auth';
import { listIadcCodes } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    await requirePermission('report:read');
    return ok(await listIadcCodes());
  } catch (err) {
    return fail(err);
  }
}
