/**
 * POST /api/reports/[id]/submit
 *
 * Kirim DDR dari `draft` → `submitted`. Butuh `report:submit`.
 *
 * Syarat (ditegakkan server, bukan hanya UI):
 *  1. `validation.ok === true` (total tepat 1440 menit, tanpa error 24 jam/IADC/overlap)
 *     → bila tidak, 422 `VALIDATION_FAILED` + `details: issues`.
 *  2. Status saat ini harus `draft` → bila tidak, 409 `REPORT_LOCKED`.
 */
import { ApiError, fail, getClientIp, ok } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { getReportById, updateReportStatus } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const user = await requirePermission('report:submit');

    const report = await getReportById(params.id);
    if (!report) {
      throw new ApiError(404, 'REPORT_NOT_FOUND', `Laporan ${params.id} tidak ditemukan.`);
    }

    if (!report.validation.ok) {
      throw new ApiError(
        422,
        'VALIDATION_FAILED',
        `Laporan belum bisa disubmit: ${report.validation.totalMinutes} menit terhitung (harus 1440) dengan ${
          report.validation.issues.filter((i) => i.severity === 'error').length
        } error.`,
        report.validation.issues,
      );
    }

    if (report.status !== 'draft') {
      throw new ApiError(
        409,
        'REPORT_LOCKED',
        `Laporan sudah berstatus "${report.status}" - tidak dapat disubmit ulang.`,
        { status: report.status },
      );
    }

    await updateReportStatus(params.id, 'submitted', user.id);

    await recordAudit({
      entity: 'daily_report',
      entityId: params.id,
      action: 'submit',
      actor: user,
      ip: getClientIp(req),
      oldJson: { status: report.status },
      newJson: {
        status: 'submitted',
        totalMinutes: report.validation.totalMinutes,
        reportNo: report.reportNo,
      },
    });

    const updated = await getReportById(params.id);
    return ok({ id: params.id, status: updated?.status ?? 'submitted', reportNo: report.reportNo });
  } catch (err) {
    return fail(err);
  }
}
