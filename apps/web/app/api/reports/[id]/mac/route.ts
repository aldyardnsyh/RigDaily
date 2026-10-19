/**
 * GET /api/reports/[id]/mac  → daftar aktivitas MAC (dual derrick) satu DDR
 * PUT /api/reports/[id]/mac  → ganti SELURUH daftar aktivitas MAC
 *
 * Body PUT: `{ items: [{ activityCenter, operation, hours, billable }] }`
 *
 * GET butuh `report:read`; PUT butuh `report:edit-draft` dan HANYA saat status
 * `draft` (balas 409 `REPORT_LOCKED` bila tidak).
 */
import { z } from 'zod';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { getReportById, listMac, replaceMac } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zMacRow = z.object({
  activityCenter: z.string().trim().min(1, 'Activity center wajib diisi').max(60),
  operation: z.string().trim().min(1, 'Operation wajib diisi').max(200),
  hours: z.number().min(0, 'Jam minimal 0').max(24, 'Jam maksimal 24'),
  billable: z.boolean(),
});

const zBody = z.object({
  items: z.array(zMacRow).max(100, 'Maksimal 100 baris aktivitas'),
});

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    await requirePermission('report:read');

    const report = await getReportById(params.id);
    if (!report) {
      throw new ApiError(404, 'REPORT_NOT_FOUND', `Laporan ${params.id} tidak ditemukan.`);
    }

    return ok({ reportId: params.id, items: await listMac(params.id) });
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

    await replaceMac(params.id, body.items);

    await recordAudit({
      entity: 'daily_report',
      entityId: params.id,
      action: 'replace_mac',
      actor: user,
      ip: getClientIp(req),
      oldJson: { items: report.mac, count: report.mac.length },
      newJson: { items: body.items, count: body.items.length },
    });

    return ok({ reportId: params.id, items: await listMac(params.id) });
  } catch (err) {
    return fail(err);
  }
}
