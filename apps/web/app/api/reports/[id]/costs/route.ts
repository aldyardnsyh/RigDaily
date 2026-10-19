/**
 * GET    /api/reports/[id]/costs              → daftar cost line + ringkasan
 * POST   /api/reports/[id]/costs              → tambah satu cost line
 * DELETE /api/reports/[id]/costs?costLineId=  → hapus (soft delete) satu cost line
 *
 * GET butuh `cost:read`; POST/DELETE butuh `cost:edit`.
 * Total harian/kumulatif di-recompute repo memakai `summarizeCost()` shared.
 */
import { z } from 'zod';
import { zCostLine } from '@rigdaily/shared';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { queryToObject } from '@/lib/http-query';
import { addCostLine, deleteCostLine, getReportById } from '@/lib/repo';
import type { ReportDetail } from '@/lib/repo/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zDeleteQuery = z.object({
  costLineId: z.string().uuid('costLineId harus UUID'),
});

/** Satu baris cost untuk POST - field `id` dari schema shared tidak dipakai. */
const zCostBody = zCostLine.omit({ id: true });

/** 404 yang jelas bila laporan tidak ada (menghindari TypeError null di pemanggil). */
async function requireReport(id: string): Promise<ReportDetail> {
  const report = await getReportById(id);
  if (!report) {
    throw new ApiError(404, 'REPORT_NOT_FOUND', `Laporan ${id} tidak ditemukan.`);
  }
  return report;
}

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    await requirePermission('cost:read');
    const report = await requireReport(params.id);

    return ok({
      reportId: report.id,
      lines: report.costLines,
      dailyTotal: report.costDailyUsd,
      cumulativeTotal: report.costCumulativeUsd,
    });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const user = await requirePermission('cost:edit');
    const report = await requireReport(params.id);

    if (report.status !== 'draft') {
      throw new ApiError(
        409,
        'REPORT_LOCKED',
        'Laporan yang sudah submitted/approved hanya bisa diubah lewat amendment.',
      );
    }

    const body = parseBody(zCostBody, await readJson(req));

    const created = await addCostLine(params.id, {
      category: body.category,
      description: body.description,
      vendor: body.vendor ?? null,
      afeCode: body.afeCode ?? null,
      billingType: body.billingType ?? null,
      amount: body.amount,
      rebillable: body.rebillable,
    });

    await recordAudit({
      entity: 'cost_line',
      entityId: created.id,
      action: 'create',
      actor: user,
      ip: getClientIp(req),
      newJson: {
        reportId: params.id,
        category: body.category,
        description: body.description,
        amount: body.amount,
        rebillable: body.rebillable,
      },
    });

    const updated = await getReportById(params.id);
    return ok(
      {
        id: created.id,
        lines: updated?.costLines ?? [],
        dailyTotal: updated?.costDailyUsd ?? 0,
        cumulativeTotal: updated?.costCumulativeUsd ?? 0,
      },
      { status: 201 },
    );
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const user = await requirePermission('cost:edit');
    const report = await requireReport(params.id);
    const { costLineId } = parseBody(zDeleteQuery, queryToObject(req.url));

    if (report.status !== 'draft') {
      throw new ApiError(
        409,
        'REPORT_LOCKED',
        'Laporan yang sudah submitted/approved hanya bisa diubah lewat amendment.',
      );
    }

    const existing = report.costLines.find((l) => l.id === costLineId);
    if (!existing) {
      throw new ApiError(404, 'COST_LINE_NOT_FOUND', `Cost line ${costLineId} tidak ada pada laporan ini.`);
    }

    await deleteCostLine(costLineId);

    await recordAudit({
      entity: 'cost_line',
      entityId: costLineId,
      action: 'delete',
      actor: user,
      ip: getClientIp(req),
      oldJson: {
        reportId: params.id,
        category: existing.category,
        description: existing.description,
        amount: existing.amount,
      },
    });

    const updated = await getReportById(params.id);
    return ok({
      ok: true,
      lines: updated?.costLines ?? [],
      dailyTotal: updated?.costDailyUsd ?? 0,
      cumulativeTotal: updated?.costCumulativeUsd ?? 0,
    });
  } catch (err) {
    return fail(err);
  }
}
