/**
 * GET /api/reports/[id]/bha → daftar komponen BHA satu DDR
 * PUT /api/reports/[id]/bha → ganti SELURUH daftar komponen BHA
 *
 * Body PUT: `{ items: [{ component, odIn?, lengthM?, hours? }] }`
 *   component wajib 1..160 karakter; odIn 0..60 inci; lengthM ≥ 0; hours 0..24.
 *
 * GET butuh `report:read`; PUT butuh `time:edit` dan HANYA saat status `draft`
 * (balas 409 `REPORT_LOCKED` bila tidak). Replace dijalankan `replaceBha`
 * (hapus-lalu-insert dalam satu transaksi, pola sama `replaceTimeRows`).
 */
import { z } from 'zod';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { getReportById, listBha, replaceBha } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zBhaRow = z.object({
  component: z.string().trim().min(1, 'Component wajib diisi').max(160, 'Component maksimal 160 karakter'),
  odIn: z.number().min(0, 'OD minimal 0 inci').max(60, 'OD maksimal 60 inci').nullable().optional(),
  lengthM: z.number().min(0, 'Length minimal 0 m').nullable().optional(),
  hours: z.number().min(0, 'Jam minimal 0').max(24, 'Jam maksimal 24').nullable().optional(),
});

const zBody = z.object({
  items: z.array(zBhaRow).max(100, 'Maksimal 100 komponen BHA'),
});

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    await requirePermission('report:read');

    const report = await getReportById(params.id);
    if (!report) {
      throw new ApiError(404, 'REPORT_NOT_FOUND', `Laporan ${params.id} tidak ditemukan.`);
    }

    return ok({ reportId: params.id, items: await listBha(params.id) });
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

    await replaceBha(
      params.id,
      body.items.map((b) => ({
        component: b.component,
        odIn: b.odIn ?? null,
        lengthM: b.lengthM ?? null,
        hours: b.hours ?? null,
      })),
    );

    await recordAudit({
      entity: 'daily_report',
      entityId: params.id,
      action: 'replace_bha',
      actor: user,
      ip: getClientIp(req),
      oldJson: { items: report.bha, count: report.bha.length },
      newJson: { items: body.items, count: body.items.length },
    });

    return ok({ reportId: params.id, items: await listBha(params.id) });
  } catch (err) {
    return fail(err);
  }
}
