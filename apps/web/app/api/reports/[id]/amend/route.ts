/**
 * POST /api/reports/[id]/amend
 *
 * Buat amendment untuk laporan yang SUDAH final (`approved|distributed|locked`).
 * Body: `zAmendmentRequest` (`reportId`, `reason` min 10 char, `changes`).
 *
 * Butuh `report:amend`. Status selain approved/distributed/locked → 409.
 *
 * Repo membuat DDR BARU (revisi + 1, status draft) yang menyalin seluruh anak;
 * laporan induk tidak diubah - jejak revisi tetap utuh untuk audit.
 */
import { zAmendmentRequest } from '@rigdaily/shared';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { createAmendment, getReportById } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Status yang boleh di-amend (laporan sudah final / terkunci). */
const AMENDABLE = ['approved', 'distributed', 'locked'] as const;

function isAmendable(status: string): boolean {
  return (AMENDABLE as readonly string[]).includes(status);
}

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const user = await requirePermission('report:amend');

    const report = await getReportById(params.id);
    if (!report) {
      throw new ApiError(404, 'REPORT_NOT_FOUND', `Laporan ${params.id} tidak ditemukan.`);
    }

    const body = parseBody(zAmendmentRequest, await readJson(req));

    if (body.reportId !== params.id) {
      throw new ApiError(
        400,
        'REPORT_ID_MISMATCH',
        `Body.reportId (${body.reportId}) harus sama dengan ID laporan pada URL (${params.id}).`,
      );
    }

    if (!isAmendable(report.status)) {
      throw new ApiError(
        409,
        'NOT_AMENDABLE',
        `Amendment hanya untuk laporan berstatus approved/distributed/locked (status sekarang: "${report.status}"). Ubah langsung selama masih draft.`,
        { status: report.status },
      );
    }

    const created = await createAmendment(params.id, body.reason, user.id);

    await recordAudit({
      entity: 'daily_report',
      entityId: created.id,
      action: 'amend',
      actor: user,
      ip: getClientIp(req),
      oldJson: { parentReportId: report.id, parentStatus: report.status, revision: report.revision },
      newJson: {
        id: created.id,
        reportNo: created.reportNo,
        reason: body.reason,
        changes: body.changes,
        parentReportId: report.id,
      },
    });

    return ok({ id: created.id, reportNo: created.reportNo }, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}
