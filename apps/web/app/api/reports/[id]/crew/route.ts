/**
 * PUT /api/reports/[id]/crew - ganti SELURUH daftar crew/POB satu DDR.
 *
 * Body: `{ crew: [{ name, position, company?, shift, hours, pobStatus, musterStation? }] }`
 * Butuh `personnel:edit`. Hanya saat status `draft`.
 */
import { z } from 'zod';
import { zCrewRow } from '@rigdaily/shared';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { getReportById, replaceCrew } from '@/lib/repo';
import { toCrewRepoRows } from '@/lib/report-payload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zBody = z.object({
  crew: z.array(zCrewRow).max(300),
});

export async function PUT(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const user = await requirePermission('personnel:edit');

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
    const rows = toCrewRepoRows(body.crew);

    await replaceCrew(params.id, rows);

    await recordAudit({
      entity: 'daily_report',
      entityId: params.id,
      action: 'replace_crew',
      actor: user,
      ip: getClientIp(req),
      oldJson: {
        crew: report.crew.map((c) => ({
          name: c.name,
          position: c.position,
          shift: c.shift,
          hours: c.hours,
          pobStatus: c.pobStatus,
        })),
        count: report.crew.length,
      },
      newJson: {
        crew: rows.map((c) => ({
          name: c.name,
          position: c.position,
          shift: c.shift,
          hours: c.hours,
          pobStatus: c.pobStatus,
        })),
        count: rows.length,
      },
    });

    return ok({ ok: true, count: rows.length });
  } catch (err) {
    return fail(err);
  }
}
