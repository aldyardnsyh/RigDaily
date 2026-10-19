/**
 * GET    /api/master/kpi          → daftar definisi KPI (termasuk yang non-aktif)
 * POST   /api/master/kpi          → tambah definisi KPI
 * PATCH  /api/master/kpi          → ubah definisi KPI
 * DELETE /api/master/kpi?id=<uuid> → soft delete definisi KPI
 *
 * Body POST : `{ name, formula, category?, baseline?, unit?, active? }`
 * Body PATCH: `{ id, name?, formula?, category?, baseline?, unit?, active? }`
 *
 * GET butuh `dashboard:read`; POST/PATCH/DELETE butuh `master:manage`.
 */
import { z } from 'zod';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { queryToObject } from '@/lib/http-query';
import {
  createKpiDefinition,
  getKpiDefinitionById,
  listKpiDefinitionsDetailed,
  softDeleteKpiDefinition,
  updateKpiDefinition,
} from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zBody = z.object({
  name: z.string().trim().min(1, 'Nama KPI wajib diisi').max(160),
  formula: z.string().trim().min(1, 'Formula wajib diisi').max(4000),
  category: z.string().trim().max(80).nullable().optional(),
  baseline: z.number().nullable().optional(),
  unit: z.string().trim().max(30).nullable().optional(),
  active: z.boolean().optional(),
});

const zPatch = z
  .object({
    id: z.string().uuid('id harus UUID'),
    name: z.string().trim().min(1, 'Nama KPI wajib diisi').max(160).optional(),
    formula: z.string().trim().min(1, 'Formula wajib diisi').max(4000).optional(),
    category: z.string().trim().max(80).nullable().optional(),
    baseline: z.number().nullable().optional(),
    unit: z.string().trim().max(30).nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.name !== undefined ||
      v.formula !== undefined ||
      v.category !== undefined ||
      v.baseline !== undefined ||
      v.unit !== undefined ||
      v.active !== undefined,
    { message: 'Isi minimal satu dari: name, formula, category, baseline, unit, active' },
  );

const zDeleteQuery = z.object({
  id: z.string().uuid('id harus UUID'),
});

export async function GET(): Promise<Response> {
  try {
    await requirePermission('dashboard:read');
    return ok(await listKpiDefinitionsDetailed());
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const user = await requirePermission('master:manage');
    const body = parseBody(zBody, await readJson(req));

    const created = await createKpiDefinition({
      name: body.name,
      formula: body.formula,
      category: body.category ?? null,
      baseline: body.baseline ?? null,
      unit: body.unit ?? null,
      active: body.active ?? true,
    });

    await recordAudit({
      entity: 'kpi_definition',
      entityId: created.id,
      action: 'create',
      actor: user,
      ip: getClientIp(req),
      newJson: {
        name: body.name,
        formula: body.formula,
        category: body.category ?? null,
        baseline: body.baseline ?? null,
        unit: body.unit ?? null,
        active: body.active ?? true,
      },
    });

    return ok(created, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(req: Request): Promise<Response> {
  try {
    const user = await requirePermission('master:manage');
    const body = parseBody(zPatch, await readJson(req));

    const { before, after } = await updateKpiDefinition(body.id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.formula !== undefined ? { formula: body.formula } : {}),
      ...(body.category !== undefined ? { category: body.category } : {}),
      ...(body.baseline !== undefined ? { baseline: body.baseline } : {}),
      ...(body.unit !== undefined ? { unit: body.unit } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
    });

    if (!before || !after) {
      throw new ApiError(404, 'NOT_FOUND', `Definisi KPI ${body.id} tidak ditemukan.`);
    }

    await recordAudit({
      entity: 'kpi_definition',
      entityId: body.id,
      action: 'update',
      actor: user,
      ip: getClientIp(req),
      oldJson: {
        name: before.name,
        formula: before.formula,
        category: before.category,
        baseline: before.baseline,
        unit: before.unit,
        active: before.active,
      },
      newJson: {
        name: after.name,
        formula: after.formula,
        category: after.category,
        baseline: after.baseline,
        unit: after.unit,
        active: after.active,
        changed: Object.keys(body).filter((k) => k !== 'id'),
      },
    });

    return ok(after);
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request): Promise<Response> {
  try {
    const user = await requirePermission('master:manage');
    const { id } = parseBody(zDeleteQuery, queryToObject(req.url));

    const removed = await softDeleteKpiDefinition(id);
    if (!removed) {
      throw new ApiError(404, 'NOT_FOUND', `Definisi KPI ${id} tidak ditemukan.`);
    }

    await recordAudit({
      entity: 'kpi_definition',
      entityId: id,
      action: 'delete',
      actor: user,
      ip: getClientIp(req),
      oldJson: {
        name: removed.name,
        formula: removed.formula,
        category: removed.category,
        baseline: removed.baseline,
        unit: removed.unit,
        active: removed.active,
      },
      newJson: { deleted: true },
    });

    return ok({ id, deleted: true });
  } catch (err) {
    return fail(err);
  }
}
