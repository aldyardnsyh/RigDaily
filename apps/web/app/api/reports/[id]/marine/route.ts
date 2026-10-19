/**
 * GET /api/reports/[id]/marine  → data marine daily (variant + fields) satu DDR
 * PUT /api/reports/[id]/marine  → simpan (upsert) marine daily
 *
 * Body PUT: `{ variant: 'jackup'|'anchored_floater'|'dpp_floater', fields: object }`
 *
 * GET butuh `report:read`; PUT butuh `marine:edit` dan HANYA saat status `draft`
 * (setelah submit → amendment, balas 409 `REPORT_LOCKED`).
 */
import { z } from 'zod';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { getMarine, getReportById, upsertMarine } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zVariant = z.enum(['jackup', 'anchored_floater', 'dpp_floater']);

const zBody = z.object({
  variant: zVariant,
  fields: z.record(z.string(), z.unknown()),
});

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    await requirePermission('report:read');

    const report = await getReportById(params.id);
    if (!report) {
      throw new ApiError(404, 'REPORT_NOT_FOUND', `Laporan ${params.id} tidak ditemukan.`);
    }

    const marine = await getMarine(params.id);
    return ok(marine);
  } catch (err) {
    return fail(err);
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const user = await requirePermission('marine:edit');

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
    const before = await getMarine(params.id);

    await upsertMarine(params.id, body.variant, body.fields);

    await recordAudit({
      entity: 'marine_daily',
      entityId: params.id,
      action: 'upsert_marine',
      actor: user,
      ip: getClientIp(req),
      oldJson: before ? { variant: before.variant, fields: before.fields } : null,
      newJson: { variant: body.variant, fields: body.fields },
    });

    const after = await getMarine(params.id);
    return ok(after);
  } catch (err) {
    return fail(err);
  }
}
