/**
 * GET /api/reports/[id]/survey  → daftar stasiun directional survey satu DDR
 * PUT /api/reports/[id]/survey  → ganti SELURUH daftar stasiun survey
 *
 * Body PUT: `{ items: [{ md, inclination?, azimuth?, tvd? }] }`
 *   md 0..15000 (meter), inclination/azimuth 0..360, tvd 0..15000 atau null.
 *
 * GET butuh `report:read`; PUT butuh `report:edit-draft` dan HANYA saat status
 * `draft` (balas 409 `REPORT_LOCKED` bila tidak).
 */
import { z } from 'zod';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { getReportById, listSurvey, replaceSurvey } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zSurveyRow = z.object({
  md: z.number().min(0, 'MD minimal 0 m').max(15000, 'MD maksimal 15000 m'),
  inclination: z.number().min(0).max(360).nullable().optional(),
  azimuth: z.number().min(0).max(360).nullable().optional(),
  tvd: z.number().min(0).max(15000).nullable().optional(),
});

const zBody = z.object({
  items: z.array(zSurveyRow).max(500, 'Maksimal 500 stasiun survey'),
});

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    await requirePermission('report:read');

    const report = await getReportById(params.id);
    if (!report) {
      throw new ApiError(404, 'REPORT_NOT_FOUND', `Laporan ${params.id} tidak ditemukan.`);
    }

    return ok({ reportId: params.id, items: await listSurvey(params.id) });
  } catch (err) {
    return fail(err);
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const user = await requirePermission('report:edit-draft');

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

    await replaceSurvey(
      params.id,
      body.items.map((s) => ({
        md: s.md,
        inclination: s.inclination ?? null,
        azimuth: s.azimuth ?? null,
        tvd: s.tvd ?? null,
      })),
    );

    await recordAudit({
      entity: 'daily_report',
      entityId: params.id,
      action: 'replace_survey',
      actor: user,
      ip: getClientIp(req),
      oldJson: { items: report.survey, count: report.survey.length },
      newJson: { items: body.items, count: body.items.length },
    });

    return ok({ reportId: params.id, items: await listSurvey(params.id) });
  } catch (err) {
    return fail(err);
  }
}
