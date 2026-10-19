/**
 * GET /api/reports/[id]/mud → data mud satu DDR (null bila belum diisi)
 * PUT /api/reports/[id]/mud → upsert data mud satu DDR
 *
 * Body PUT: `{ weightPpg?, viscositySecQt?, ph?, pv?, yp?, chemicalsAdded?, costUsd? }`
 * (schema `zMudRecord` dari @rigdaily/shared - enum/rentang didefinisikan di sana).
 *
 * GET butuh `report:read`; PUT butuh `time:edit` (mud adalah bagian operasional
 * harian yang diisi Rig Clerk bersama time breakdown) dan HANYA saat status
 * `draft` - balas 409 `REPORT_LOCKED` bila sudah submit (perubahan pasca-approval
 * wajib lewat amendment).
 */
import { z } from 'zod';
import { zMudRecord } from '@rigdaily/shared';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { getReportById, upsertMud } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Minimal satu kolom harus dikirim - PUT kosong tidak bermakna. */
const zBody = zMudRecord
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Isi minimal satu kolom mud.' });

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    await requirePermission('report:read');

    const report = await getReportById(params.id);
    if (!report) {
      throw new ApiError(404, 'REPORT_NOT_FOUND', `Laporan ${params.id} tidak ditemukan.`);
    }

    return ok({ reportId: params.id, mud: report.mud });
  } catch (err) {
    return fail(err);
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const user = await requirePermission('time:edit');

    const report = await getReportById(params.id);
    if (!report) {
      throw new ApiError(404, 'REPORT_NOT_FOUND', `Laporan ${params.id} tidak ditemukan.`);
    }

    if (report.status !== 'draft') {
      throw new ApiError(
        409,
        'REPORT_LOCKED',
        'Laporan yang sudah submitted/approved hanya bisa diubah lewat amendment.',
      );
    }

    const body = parseBody(zBody, await readJson(req));

    await upsertMud(params.id, {
      weightPpg: body.weightPpg ?? null,
      viscositySecQt: body.viscositySecQt ?? null,
      ph: body.ph ?? null,
      pv: body.pv ?? null,
      yp: body.yp ?? null,
      chemicalsAdded: body.chemicalsAdded ?? null,
      costUsd: body.costUsd ?? null,
    });

    await recordAudit({
      entity: 'daily_report',
      entityId: params.id,
      action: 'upsert_mud',
      actor: user,
      ip: getClientIp(req),
      oldJson: { mud: report.mud },
      newJson: { mud: body },
    });

    const updated = await getReportById(params.id);
    return ok({ reportId: params.id, mud: updated?.mud ?? null });
  } catch (err) {
    return fail(err);
  }
}
