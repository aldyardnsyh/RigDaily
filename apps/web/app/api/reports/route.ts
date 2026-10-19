/**
 * GET  /api/reports   → daftar DDR (filter + paginasi)
 * POST /api/reports   → buat DDR lengkap (header + time + crew + cost + mud)
 *
 * GET  butuh `report:read`; POST butuh `report:create`.
 *
 * Catatan renumbering: nomor laporan yang dikirim device HANYA dipakai bila belum
 * terpakai untuk sumur tersebut - kalau tidak, server memberi nomor berikutnya
 * (mencegah unique index `daily_reports_well_date_uq` gagal).
 */
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { zDailyReportPayload, zIsoDate, zReportStatus } from '@rigdaily/shared';
import { db, schema } from '@rigdaily/database';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { queryToObject } from '@/lib/http-query';
import { toCrewRepoRows } from '@/lib/report-payload';
import {
  createReport,
  getReportByWellAndDate,
  listReports,
  replaceCostLines,
  replaceCrew,
  replaceTimeRows,
  upsertMud,
} from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zListQuery = z.object({
  wellId: z.string().uuid().optional(),
  rigId: z.string().uuid().optional(),
  status: z.union([zReportStatus, z.literal('all')]).optional(),
  from: zIsoDate.optional(),
  to: zIsoDate.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function GET(req: Request): Promise<Response> {
  try {
    await requirePermission('report:read');
    const query = parseBody(zListQuery, queryToObject(req.url));

    const result = await listReports({
      wellId: query.wellId,
      rigId: query.rigId,
      status: query.status,
      from: query.from,
      to: query.to,
      limit: query.limit,
      offset: query.offset,
    });

    return ok(result);
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const user = await requirePermission('report:create');
    const payload = parseBody(zDailyReportPayload, await readJson(req));

    /* Validasi referensi: sumur & rig harus ada (pesan 422 yang jelas, bukan FK error). */
    const wellRows = await db
      .select({ id: schema.wells.id })
      .from(schema.wells)
      .where(and(eq(schema.wells.id, payload.wellId), isNull(schema.wells.deletedAt)))
      .limit(1);

    if (!wellRows[0]) {
      throw new ApiError(422, 'WELL_NOT_FOUND', `Sumur ${payload.wellId} tidak ditemukan.`);
    }

    if (payload.rigId) {
      const rigRows = await db
        .select({ id: schema.rigs.id })
        .from(schema.rigs)
        .where(and(eq(schema.rigs.id, payload.rigId), isNull(schema.rigs.deletedAt)))
        .limit(1);
      if (!rigRows[0]) {
        throw new ApiError(422, 'RIG_NOT_FOUND', `Rig ${payload.rigId} tidak ditemukan.`);
      }
    }

    /* Nomor laporan: unik per (sumur, tanggal) - ambil dari device hanya bila bebas. */
    let reportNo = payload.reportNo;
    if (reportNo !== undefined) {
      const taken = await getReportByWellAndDate(payload.wellId, payload.reportDate);
      if (taken) reportNo = undefined;
    }

    const created = await createReport({
      wellId: payload.wellId,
      rigId: payload.rigId ?? null,
      reportDate: payload.reportDate,
      reportNo,
      depthMdStart: payload.depthMdStart,
      depthMdEnd: payload.depthMdEnd,
      summary: payload.summary ?? null,
      planNext: payload.planNext ?? null,
      createdBy: user.id,
    });

    await replaceTimeRows(
      created.id,
      (payload.timeRows ?? []).map((r) => ({
        start: r.start,
        end: r.end,
        iadcCode: r.iadcCode,
        iadcSubcode: r.iadcSubcode ?? null,
        vendor: r.vendor ?? null,
        nptFlag: r.nptFlag ?? false,
        remarks: r.remarks ?? null,
      })),
    );

    const crew = toCrewRepoRows(payload.crew);
    await replaceCrew(created.id, crew);

    const costLines = payload.costLines ?? [];
    await replaceCostLines(
      created.id,
      costLines.map((c) => ({
        category: c.category,
        description: c.description,
        vendor: c.vendor ?? null,
        afeCode: c.afeCode ?? null,
        billingType: c.billingType ?? null,
        amount: c.amount,
        rebillable: c.rebillable ?? false,
      })),
    );

    if (payload.mud) {
      await upsertMud(created.id, {
        weightPpg: payload.mud.weightPpg ?? null,
        viscositySecQt: payload.mud.viscositySecQt ?? null,
        ph: payload.mud.ph ?? null,
        pv: payload.mud.pv ?? null,
        yp: payload.mud.yp ?? null,
        chemicalsAdded: payload.mud.chemicalsAdded ?? null,
        costUsd: payload.mud.costUsd ?? null,
      });
    }

    await recordAudit({
      entity: 'daily_report',
      entityId: created.id,
      action: 'create',
      actor: user,
      ip: getClientIp(req),
      newJson: {
        reportNo: created.reportNo,
        wellId: payload.wellId,
        rigId: payload.rigId ?? null,
        reportDate: payload.reportDate,
        depthMdStart: payload.depthMdStart,
        depthMdEnd: payload.depthMdEnd,
        timeRows: (payload.timeRows ?? []).length,
        crew: crew.length,
        costLines: costLines.length,
        mud: payload.mud ? true : false,
      },
    });

    return ok({ id: created.id, reportNo: created.reportNo }, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}
