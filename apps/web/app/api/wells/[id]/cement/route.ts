/**
 * GET    /api/wells/[id]/cement                → program semen satu sumur
 * POST   /api/wells/[id]/cement                → tambah job semen
 * PATCH  /api/wells/[id]/cement?cementId=...   → ubah sebagian kolom job semen
 * DELETE /api/wells/[id]/cement?cementId=...   → soft delete satu job semen
 *
 * GET butuh `report:read`; semua mutasi butuh `wellfile:edit`.
 * Audit: `cement_create` / `cement_update` / `cement_delete` pada entitas
 * `cement_program`.
 */
import { z } from 'zod';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { assertRigAccess } from '@/lib/rbac';
import { requireQueryParam } from '@/lib/http-query';
import {
  createCementProgram,
  getWellById,
  listCementPrograms,
  listReports,
  softDeleteCementProgram,
  updateCementProgram,
} from '@/lib/repo';
import type { CementInput } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CASING_SECTIONS = ['conductor', 'surface', 'intermediate', 'production', 'liner'] as const;
const JOB_TYPES = ['primary', 'squeeze', 'plug', 'liner'] as const;
const EVALUATIONS = ['good', 'partial', 'poor', 'unknown'] as const;
const CEMENT_STATUSES = ['planned', 'executed', 'cancelled'] as const;

const zIsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD')
  .nullable();

const zNullableNumber = (max: number) => z.number().finite().min(0).max(max).nullable();

/** Kolom bersama POST & PATCH. */
const zCementFields = {
  casingDesignId: z.string().uuid('casingDesignId harus UUID').nullable().optional(),
  section: z.enum(CASING_SECTIONS).optional(),
  jobType: z.enum(JOB_TYPES).optional(),
  plannedDate: zIsoDate.optional(),
  executedDate: zIsoDate.optional(),
  slurryType: z.string().trim().max(40).nullable().optional(),
  slurryDensityPpg: zNullableNumber(30).optional(),
  yieldFt3Sx: zNullableNumber(10000).optional(),
  volumeBbl: zNullableNumber(100000).optional(),
  sacksSx: z.number().int().min(0).max(1000000).nullable().optional(),
  mixWaterBbl: zNullableNumber(100000).optional(),
  additive: z.string().max(4000).nullable().optional(),
  plugBumpedPsi: zNullableNumber(100000).optional(),
  topOfCementMd: zNullableNumber(20000).optional(),
  evaluation: z.enum(EVALUATIONS).optional(),
  status: z.enum(CEMENT_STATUSES).optional(),
  notes: z.string().max(4000).nullable().optional(),
} as const;

const zCreate = z
  .object({
    ...zCementFields,
    section: z.enum(CASING_SECTIONS),
  })
  .strict();

const zPatch = z.object({ ...zCementFields }).strict();

/** Rig pemilik sumur = rig DDR terbaru (null bila belum ada laporan). */
async function rigIdOfWell(wellId: string): Promise<string | null> {
  const { items } = await listReports({ wellId, limit: 1 });
  return items[0]?.rigId ?? null;
}

async function requireWell(wellId: string): Promise<void> {
  const well = await getWellById(wellId);
  if (!well) {
    throw new ApiError(404, 'WELL_NOT_FOUND', `Sumur ${wellId} tidak ditemukan.`);
  }
}

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    await requirePermission('report:read');
    await requireWell(params.id);

    return ok({ wellId: params.id, items: await listCementPrograms(params.id) });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const user = await requirePermission('wellfile:edit');
    await requireWell(params.id);
    assertRigAccess(user, await rigIdOfWell(params.id));

    const body = parseBody(zCreate, await readJson(req));

    const input: CementInput = {
      casingDesignId: body.casingDesignId ?? null,
      section: body.section,
      jobType: body.jobType,
      plannedDate: body.plannedDate ?? null,
      executedDate: body.executedDate ?? null,
      slurryType: body.slurryType ?? null,
      slurryDensityPpg: body.slurryDensityPpg ?? null,
      yieldFt3Sx: body.yieldFt3Sx ?? null,
      volumeBbl: body.volumeBbl ?? null,
      sacksSx: body.sacksSx ?? null,
      mixWaterBbl: body.mixWaterBbl ?? null,
      additive: body.additive ?? null,
      plugBumpedPsi: body.plugBumpedPsi ?? null,
      topOfCementMd: body.topOfCementMd ?? null,
      evaluation: body.evaluation,
      status: body.status,
      notes: body.notes ?? null,
    };

    const created = await createCementProgram(params.id, input);

    await recordAudit({
      entity: 'cement_program',
      entityId: created.id,
      action: 'cement_create',
      actor: user,
      ip: getClientIp(req),
      newJson: {
        wellId: params.id,
        section: body.section,
        jobType: body.jobType ?? 'primary',
        status: body.status ?? 'planned',
      },
    });

    return ok(created, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const user = await requirePermission('wellfile:edit');
    await requireWell(params.id);
    assertRigAccess(user, await rigIdOfWell(params.id));

    const cementId = requireQueryParam(req, 'cementId');
    const body = parseBody(zPatch, await readJson(req));
    if (Object.keys(body).length === 0) {
      throw new ApiError(400, 'EMPTY_PATCH', 'Tidak ada kolom job semen yang dikirim untuk diubah.');
    }

    const before = (await listCementPrograms(params.id)).find((c) => c.id === cementId);
    if (!before) {
      throw new ApiError(404, 'CEMENT_NOT_FOUND', `Job semen ${cementId} tidak ditemukan pada sumur ini.`);
    }

    await updateCementProgram(cementId, body);

    const after = (await listCementPrograms(params.id)).find((c) => c.id === cementId);

    await recordAudit({
      entity: 'cement_program',
      entityId: cementId,
      action: 'cement_update',
      actor: user,
      ip: getClientIp(req),
      oldJson: {
        section: before.section,
        jobType: before.jobType,
        evaluation: before.evaluation,
        status: before.status,
      },
      newJson: {
        section: after?.section ?? null,
        jobType: after?.jobType ?? null,
        evaluation: after?.evaluation ?? null,
        status: after?.status ?? null,
        changed: Object.keys(body),
      },
    });

    return ok(after ?? before);
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const user = await requirePermission('wellfile:edit');
    await requireWell(params.id);
    assertRigAccess(user, await rigIdOfWell(params.id));

    const cementId = requireQueryParam(req, 'cementId');

    const before = (await listCementPrograms(params.id)).find((c) => c.id === cementId);
    if (!before) {
      throw new ApiError(404, 'CEMENT_NOT_FOUND', `Job semen ${cementId} tidak ditemukan pada sumur ini.`);
    }

    const deleted = await softDeleteCementProgram(cementId);
    if (!deleted) {
      throw new ApiError(404, 'CEMENT_NOT_FOUND', `Job semen ${cementId} tidak ditemukan pada sumur ini.`);
    }

    await recordAudit({
      entity: 'cement_program',
      entityId: cementId,
      action: 'cement_delete',
      actor: user,
      ip: getClientIp(req),
      oldJson: {
        section: before.section,
        jobType: before.jobType,
        status: before.status,
        wellId: params.id,
      },
      newJson: { deleted: true },
    });

    return ok({ id: cementId, deleted: true });
  } catch (err) {
    return fail(err);
  }
}
