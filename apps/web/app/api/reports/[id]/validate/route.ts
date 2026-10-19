/**
 * POST /api/reports/[id]/validate
 *
 * Menjalankan validasi 24 jam + kode IADC pada time breakdown TERSIMPAN lalu
 * mengembalikan hasilnya. TIDAK menyimpan apa pun (read-only secara efek).
 * Butuh `report:read`.
 *
 * Angka & issue berasal dari `validateTimeBreakdown()` di @rigdaily/shared
 * (lewat `getReportById().validation`) - layar, PDF, dan submit memakai sumber sama.
 */
import { ApiError, fail, ok } from '@/lib/api-response';
import { requirePermission } from '@/lib/auth';
import { getReportById } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    await requirePermission('report:read');

    const report = await getReportById(params.id);
    if (!report) {
      throw new ApiError(404, 'REPORT_NOT_FOUND', `Laporan ${params.id} tidak ditemukan.`);
    }

    return ok(report.validation);
  } catch (err) {
    return fail(err);
  }
}
