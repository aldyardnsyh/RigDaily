/**
 * POST /api/reports/[id]/approve
 *
 * Tanda tangan digital Company Man: `submitted` → `approved`.
 * Body: `{ signatureName: string }` (min 3 karakter).
 *
 * Butuh `report:approve`. Status selain `submitted` → 409.
 * Setelah approved laporan terkunci (`lockedAt`), perubahan hanya lewat amendment.
 */
import { z } from 'zod';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { getReportById, updateReportStatus } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zBody = z.object({
  signatureName: z
    .string()
    .trim()
    .min(3, 'Nama penanda tangan minimal 3 karakter')
    .max(200, 'Nama penanda tangan maksimal 200 karakter'),
});

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const user = await requirePermission('report:approve');

    const report = await getReportById(params.id);
    if (!report) {
      throw new ApiError(404, 'REPORT_NOT_FOUND', `Laporan ${params.id} tidak ditemukan.`);
    }

    const body = parseBody(zBody, await readJson(req));

    if (report.status !== 'submitted') {
      throw new ApiError(
        409,
        'INVALID_STATUS',
        `Hanya laporan berstatus "submitted" yang bisa di-approve (status sekarang: "${report.status}").`,
        { status: report.status },
      );
    }

    await updateReportStatus(params.id, 'approved', user.id, {
      signatureName: body.signatureName,
      approvedBy: user.id,
    });

    await recordAudit({
      entity: 'daily_report',
      entityId: params.id,
      action: 'approve',
      actor: user,
      ip: getClientIp(req),
      oldJson: { status: report.status },
      newJson: {
        status: 'approved',
        signatureName: body.signatureName,
        approvedBy: user.id,
        reportNo: report.reportNo,
      },
    });

    const updated = await getReportById(params.id);
    return ok({
      id: params.id,
      status: updated?.status ?? 'approved',
      signatureName: body.signatureName,
      approvedAt: updated?.approvedAt ?? null,
      reportNo: report.reportNo,
    });
  } catch (err) {
    return fail(err);
  }
}
