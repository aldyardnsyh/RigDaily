/**
 * GET /api/wells/[id]/casing  → desain casing satu sumur (urut `sortOrder`)
 * PUT /api/wells/[id]/casing  → ganti SELURUH desain casing sekaligus
 *
 * Body PUT: `{ items: [{ section, sortOrder, sizeIn, weightPpf, grade, connection,
 * topMd, shoeMd, holeSizeIn, joints, cementRequired, notes }] }`
 *
 * GET butuh `report:read`; PUT butuh `wellfile:edit`.
 * Audit: `casing_design_update` pada entitas `well`.
 */
import { z } from 'zod';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { assertRigAccess } from '@/lib/rbac';
import { getWellById, listCasingDesign, listReports, replaceCasingDesign } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CASING_SECTIONS = ['conductor', 'surface', 'intermediate', 'production', 'liner'] as const;

const zNullableNumber = (max: number) => z.number().finite().min(0).max(max).nullable();

const zCasingItem = z
  .object({
    section: z.enum(CASING_SECTIONS),
    sortOrder: z.number().int().min(1).max(50),
    sizeIn: z.number().finite().min(0).max(100),
    weightPpf: zNullableNumber(500),
    grade: z.string().trim().max(40).nullable(),
    connection: z.string().trim().max(60).nullable(),
    topMd: zNullableNumber(20000),
    shoeMd: zNullableNumber(20000),
    holeSizeIn: zNullableNumber(100),
    joints: z.number().int().min(0).max(10000).nullable(),
    cementRequired: z.boolean(),
    notes: z.string().max(4000).nullable(),
  })
  .strict();

const zBody = z
  .object({
    items: z.array(zCasingItem).max(20, 'Maksimal 20 baris desain casing'),
  })
  .strict();

/** Rig pemilik sumur = rig DDR terbaru (null bila belum ada laporan). */
async function rigIdOfWell(wellId: string): Promise<string | null> {
  const { items } = await listReports({ wellId, limit: 1 });
  return items[0]?.rigId ?? null;
}

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    await requirePermission('report:read');

    const well = await getWellById(params.id);
    if (!well) {
      throw new ApiError(404, 'WELL_NOT_FOUND', `Sumur ${params.id} tidak ditemukan.`);
    }

    return ok({ wellId: params.id, items: await listCasingDesign(params.id) });
  } catch (err) {
    return fail(err);
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const user = await requirePermission('wellfile:edit');

    const well = await getWellById(params.id);
    if (!well) {
      throw new ApiError(404, 'WELL_NOT_FOUND', `Sumur ${params.id} tidak ditemukan.`);
    }
    assertRigAccess(user, await rigIdOfWell(params.id));

    const body = parseBody(zBody, await readJson(req));

    const before = await listCasingDesign(params.id);
    await replaceCasingDesign(params.id, body.items);
    const after = await listCasingDesign(params.id);

    await recordAudit({
      entity: 'well',
      entityId: params.id,
      action: 'casing_design_update',
      actor: user,
      ip: getClientIp(req),
      oldJson: { count: before.length, items: before.map((c) => `${c.sortOrder}:${c.section}:${c.sizeIn}`) },
      newJson: { count: after.length, items: after.map((c) => `${c.sortOrder}:${c.section}:${c.sizeIn}`) },
    });

    return ok({ wellId: params.id, items: after });
  } catch (err) {
    return fail(err);
  }
}
