/**
 * Billing flags per laporan (P0-7).
 *
 * GET    /api/reports/[id]/billing-flags                → daftar flag (`billing:read`)
 * POST   /api/reports/[id]/billing-flags                → upsert flag (`billing:manage`)
 * DELETE /api/reports/[id]/billing-flags?flagId=<uuid>  → soft delete flag (`billing:manage`)
 *
 * Model: satu baris `billing_flags` per (report, time_row). `timeRowId = null`
 * berarti flag level laporan (berlaku untuk semua baris tanggal tsb). Billing
 * baris adalah agregat per (tanggal, kode IADC), jadi penandaan dilakukan di level
 * time row - UI /billing mengirim `timeRowId` milik baris waktu tanggal tersebut.
 *
 * Setiap mutasi dicatat di audit log. Flag boleh diubah kapan pun (termasuk
 * laporan yang sudah approved) karena ini status komersial, bukan data DDR.
 */
import { z } from 'zod';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { queryToObject } from '@/lib/http-query';
import { deleteBillingFlag, getBillingFlags, getReportById, setBillingFlag } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zBody = z
  .object({
    timeRowId: z.string().uuid('timeRowId harus UUID').nullable().optional(),
    forceMajeure: z.boolean().optional(),
    disputed: z.boolean().optional(),
    rebillable: z.boolean().optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .refine(
    (v) =>
      v.forceMajeure !== undefined ||
      v.disputed !== undefined ||
      v.rebillable !== undefined ||
      v.note !== undefined,
    { message: 'Minimal satu field flag (forceMajeure/disputed/rebillable/note) harus dikirim.' },
  );

const zDeleteQuery = z.object({
  flagId: z.string().uuid('flagId harus UUID'),
});

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    await requirePermission('billing:read');

    const report = await getReportById(params.id);
    if (!report) {
      throw new ApiError(404, 'REPORT_NOT_FOUND', `Laporan ${params.id} tidak ditemukan.`);
    }

    return ok({ reportId: report.id, flags: await getBillingFlags(report.id) });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const user = await requirePermission('billing:manage');

    const report = await getReportById(params.id);
    if (!report) {
      throw new ApiError(404, 'REPORT_NOT_FOUND', `Laporan ${params.id} tidak ditemukan.`);
    }

    const body = parseBody(zBody, await readJson(req));

    // timeRowId wajib milik laporan ini - mencegah flag disilangkan antar laporan.
    if (body.timeRowId) {
      const owned = report.timeRows.some((t) => t.id === body.timeRowId);
      if (!owned) {
        throw new ApiError(
          422,
          'TIME_ROW_NOT_FOUND',
          `Time row ${body.timeRowId} bukan milik laporan ${report.reportNo}.`,
        );
      }
    }

    const before = (await getBillingFlags(report.id)).find((f) => f.timeRowId === (body.timeRowId ?? null)) ?? null;

    const { id } = await setBillingFlag({
      reportId: report.id,
      timeRowId: body.timeRowId ?? null,
      forceMajeure: body.forceMajeure,
      disputed: body.disputed,
      rebillable: body.rebillable,
      note: body.note,
    });

    await recordAudit({
      entity: 'billing_flag',
      entityId: id,
      action: before ? 'update' : 'create',
      actor: user,
      ip: getClientIp(req),
      oldJson: before,
      newJson: {
        reportId: report.id,
        timeRowId: body.timeRowId ?? null,
        forceMajeure: body.forceMajeure,
        disputed: body.disputed,
        rebillable: body.rebillable,
        note: body.note,
      },
    });

    return ok({ id, flags: await getBillingFlags(report.id) });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const user = await requirePermission('billing:manage');

    const report = await getReportById(params.id);
    if (!report) {
      throw new ApiError(404, 'REPORT_NOT_FOUND', `Laporan ${params.id} tidak ditemukan.`);
    }

    const { flagId } = parseBody(zDeleteQuery, queryToObject(req.url));

    const existing = (await getBillingFlags(report.id)).find((f) => f.id === flagId);
    if (!existing) {
      throw new ApiError(404, 'FLAG_NOT_FOUND', `Flag ${flagId} tidak ditemukan pada laporan ini.`);
    }

    await deleteBillingFlag(flagId);

    await recordAudit({
      entity: 'billing_flag',
      entityId: flagId,
      action: 'delete',
      actor: user,
      ip: getClientIp(req),
      oldJson: existing,
      newJson: { reportId: report.id, timeRowId: existing.timeRowId },
    });

    return ok({ ok: true, flags: await getBillingFlags(report.id) });
  } catch (err) {
    return fail(err);
  }
}
