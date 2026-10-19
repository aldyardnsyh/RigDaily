/**
 * GET    /api/wells            - daftar sumur (rig & kedalaman dari DDR terbaru) - `wellfile:read`
 * POST   /api/wells            - buat sumur baru                                    - `master:manage`
 * DELETE /api/wells?id=<uuid>  - soft delete sumur                                  - `master:manage`
 *
 * Penghapusan ditolak (409 `WELL_HAS_REPORTS`) bila sumur masih punya DDR aktif:
 * menghapusnya akan meninggalkan laporan tanpa well file yang valid.
 */
import { z } from 'zod';
import { zWellPhase, zWellType } from '@rigdaily/shared';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { queryToObject } from '@/lib/http-query';
import {
  countReportsForWell,
  createWell,
  getWellById,
  listWells,
  softDeleteWell,
} from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zCreate = z
  .object({
    /** WELL ID: kode unik internal operator. */
    wellCode: z.string().trim().max(60).nullable().optional(),
    name: z.string().trim().min(1, 'Nama sumur wajib diisi').max(160),
    /** DIVISION: unit bisnis pemilik sumur. */
    division: z.string().trim().max(120).nullable().optional(),
    apiNo: z.string().trim().max(60).nullable().optional(),
    type: zWellType,
    phase: zWellPhase,
    spudDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD')
      .nullable()
      .optional(),
    tdPlannedM: z.number().min(0).max(20000).nullable().optional(),
    afeBudgetUsd: z.number().min(0).nullable().optional(),
    operator: z.string().trim().max(200).nullable().optional(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lon: z.number().min(-180).max(180).nullable().optional(),
    fieldId: z.string().uuid('fieldId harus UUID').nullable().optional(),
  })
  .strict();

const zDeleteQuery = z.object({
  id: z.string().uuid('id harus UUID'),
});

export async function GET(): Promise<Response> {
  try {
    await requirePermission('wellfile:read');
    return ok(await listWells());
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const actor = await requirePermission('master:manage');
    const body = parseBody(zCreate, await readJson(req));

    const created = await createWell({
      wellCode: body.wellCode ?? null,
      name: body.name,
      division: body.division ?? null,
      apiNo: body.apiNo ?? null,
      type: body.type,
      phase: body.phase,
      spudDate: body.spudDate ?? null,
      tdPlannedM: body.tdPlannedM ?? null,
      afeBudgetUsd: body.afeBudgetUsd ?? null,
      operator: body.operator ?? null,
      lat: body.lat ?? null,
      lon: body.lon ?? null,
      fieldId: body.fieldId ?? null,
    });

    await recordAudit({
      entity: 'well',
      entityId: created.id,
      action: 'create',
      actor,
      newJson: {
        name: body.name,
        apiNo: body.apiNo ?? null,
        type: body.type,
        phase: body.phase,
        spudDate: body.spudDate ?? null,
        tdPlannedM: body.tdPlannedM ?? null,
        afeBudgetUsd: body.afeBudgetUsd ?? null,
        operator: body.operator ?? null,
        lat: body.lat ?? null,
        lon: body.lon ?? null,
        fieldId: body.fieldId ?? null,
      },
      ip: getClientIp(req),
      terminal: req.headers.get('user-agent')?.slice(0, 300) ?? null,
    });

    return ok(await getWellById(created.id), { status: 201 });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request): Promise<Response> {
  try {
    const actor = await requirePermission('master:manage');
    const { id } = parseBody(zDeleteQuery, queryToObject(req.url));

    const well = await getWellById(id);
    if (!well) {
      throw new ApiError(404, 'NOT_FOUND', `Sumur ${id} tidak ditemukan.`);
    }

    const reportCount = await countReportsForWell(id);
    if (reportCount > 0) {
      throw new ApiError(
        409,
        'WELL_HAS_REPORTS',
        `Sumur "${well.name}" masih memiliki ${reportCount} DDR aktif. Hapus/amandemen laporannya terlebih dahulu.`,
        { reports: reportCount },
      );
    }

    const deleted = await softDeleteWell(id);
    if (!deleted) {
      throw new ApiError(404, 'NOT_FOUND', `Sumur ${id} tidak ditemukan.`);
    }

    await recordAudit({
      entity: 'well',
      entityId: id,
      action: 'delete',
      actor,
      oldJson: {
        name: well.name,
        wellCode: well.wellCode,
      division: well.division,
      apiNo: well.apiNo,
        type: well.type,
        phase: well.phase,
        spudDate: well.spudDate,
        tdPlannedM: well.tdPlannedM,
        afeBudgetUsd: well.afeBudgetUsd,
        operator: well.operator,
        lat: well.lat,
        lon: well.lon,
        fieldName: well.fieldName,
      },
      newJson: { deleted: true },
      ip: getClientIp(req),
      terminal: req.headers.get('user-agent')?.slice(0, 300) ?? null,
    });

    return ok({ id, deleted: true });
  } catch (err) {
    return fail(err);
  }
}
