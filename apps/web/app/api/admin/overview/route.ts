/**
 * GET /api/admin/overview - ringkasan sistem untuk layar monitor admin.
 *
 * SEMUA angka berasal dari query DB nyata (lihat `getSystemOverview` di
 * `lib/repo/master.ts`): jumlah entitas, distribusi status DDR, 10 audit
 * terakhir, 10 sesi aktif terakhir, status & ukuran DB, dan waktu server.
 *
 * Butuh `user:manage` (hanya Admin).
 */
import { fail, ok } from '@/lib/api-response';
import { requirePermission } from '@/lib/auth';
import { getSystemOverview } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    await requirePermission('user:manage');
    return ok(await getSystemOverview());
  } catch (err) {
    return fail(err);
  }
}
