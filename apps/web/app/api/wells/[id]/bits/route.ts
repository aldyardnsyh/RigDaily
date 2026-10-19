/**
 * GET    /api/wells/[id]/bits             → daftar bit + ringkasan sumur
 * POST   /api/wells/[id]/bits             → catat bit baru
 * PATCH  /api/wells/[id]/bits?bitId=...   → ubah sebagian kolom bit
 * DELETE /api/wells/[id]/bits?bitId=...   → soft delete satu bit
 *
 * Permission:
 * - GET   : `report:read`
 * - POST  : `report:edit-draft` (rig clerk mengisi dari DDR) ATAU `wellfile:edit`
 * - PATCH : `wellfile:edit`
 * - DELETE: `wellfile:edit`
 *
 * Audit: `bit_create` / `bit_update` / `bit_delete` pada entitas `bit`.
 */
import { z } from 'zod';
import { can } from '@rigdaily/shared';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission, requireUser } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { assertRigAccess } from '@/lib/rbac';
import { requireQueryParam } from '@/lib/http-query';
import {
  createBit,
  getBitSummary,
  getWellById,
  listBits,
  listReports,
  softDeleteBit,
  updateBit,
} from '@/lib/repo';
import type { BitInput } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BIT_TYPES = ['PDC', 'tricone', 'impregnated', 'core', 'reamer'] as const;
const BIT_STATUSES = ['active', 'pulled', 'available'] as const;

/** Kolom bersama POST & PATCH (opsional semua; default diisi repo). */
const zBitFields = {
  bitNo: z.number().int().min(1, 'Nomor bit minimal 1').max(9999).optional(),
  bitType: z.enum(BIT_TYPES).optional(),
  iadcBitCode: z.string().trim().max(12).nullable().optional(),
  sizeIn: z.number().finite().min(0).max(100).nullable().optional(),
  manufacturer: z.string().trim().max(160).nullable().optional(),
  model: z.string().trim().max(160).nullable().optional(),
  serialNo: z.string().trim().max(120).nullable().optional(),
  nozzleCount: z.number().int().min(0).max(50).nullable().optional(),
  tfaIn2: z.number().finite().min(0).max(10).nullable().optional(),
  depthInMd: z.number().finite().min(0).max(20000).nullable().optional(),
  depthOutMd: z.number().finite().min(0).max(20000).nullable().optional(),
  rotatingHours: z.number().finite().min(0).max(10000).nullable().optional(),
  footageM: z.number().finite().min(0).max(20000).nullable().optional(),
  dullGrade: z.string().trim().max(40).nullable().optional(),
  status: z.enum(BIT_STATUSES).optional(),
  notes: z.string().max(4000).nullable().optional(),
} as const;

const zCreate = z
  .object({
    ...zBitFields,
    reportId: z.string().uuid('reportId harus UUID').nullable().optional(),
  })
  .strict();

const zPatch = z.object({ ...zBitFields }).strict();

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

/** POST boleh oleh pemegang `report:edit-draft` ATAU `wellfile:edit`. */
async function requireBitCreatePermission(): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, 'report:edit-draft') && !can(user.role, 'wellfile:edit')) {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Anda tidak memiliki izin "report:edit-draft" atau "wellfile:edit" untuk aksi ini.',
    );
  }
  return user;
}

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    await requirePermission('report:read');
    await requireWell(params.id);

    const [items, summary] = await Promise.all([listBits(params.id), getBitSummary(params.id)]);
    return ok({ items, summary });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const user = await requireBitCreatePermission();
    await requireWell(params.id);
    assertRigAccess(user, await rigIdOfWell(params.id));

    const body = parseBody(zCreate, await readJson(req));

    const input: BitInput = {
      reportId: body.reportId ?? null,
      bitNo: body.bitNo,
      bitType: body.bitType,
      iadcBitCode: body.iadcBitCode ?? null,
      sizeIn: body.sizeIn ?? null,
      manufacturer: body.manufacturer ?? null,
      model: body.model ?? null,
      serialNo: body.serialNo ?? null,
      nozzleCount: body.nozzleCount ?? null,
      tfaIn2: body.tfaIn2 ?? null,
      depthInMd: body.depthInMd ?? null,
      depthOutMd: body.depthOutMd ?? null,
      rotatingHours: body.rotatingHours ?? null,
      footageM: body.footageM ?? null,
      dullGrade: body.dullGrade ?? null,
      status: body.status,
      notes: body.notes ?? null,
    };

    const created = await createBit(params.id, input);

    await recordAudit({
      entity: 'bit',
      entityId: created.id,
      action: 'bit_create',
      actor: user,
      ip: getClientIp(req),
      newJson: {
        wellId: params.id,
        bitNo: created.bitNo,
        bitType: body.bitType ?? 'PDC',
        iadcBitCode: body.iadcBitCode ?? null,
        status: body.status ?? 'active',
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

    const bitId = requireQueryParam(req, 'bitId');
    const body = parseBody(zPatch, await readJson(req));
    if (Object.keys(body).length === 0) {
      throw new ApiError(400, 'EMPTY_PATCH', 'Tidak ada kolom bit yang dikirim untuk diubah.');
    }

    const before = (await listBits(params.id)).find((b) => b.id === bitId);
    if (!before) {
      throw new ApiError(404, 'BIT_NOT_FOUND', `Bit ${bitId} tidak ditemukan pada sumur ini.`);
    }

    await updateBit(bitId, body);

    const after = (await listBits(params.id)).find((b) => b.id === bitId);

    await recordAudit({
      entity: 'bit',
      entityId: bitId,
      action: 'bit_update',
      actor: user,
      ip: getClientIp(req),
      oldJson: {
        bitNo: before.bitNo,
        status: before.status,
        bitType: before.bitType,
        footageM: before.footageM,
      },
      newJson: {
        bitNo: after?.bitNo ?? null,
        status: after?.status ?? null,
        bitType: after?.bitType ?? null,
        footageM: after?.footageM ?? null,
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

    const bitId = requireQueryParam(req, 'bitId');

    const before = (await listBits(params.id)).find((b) => b.id === bitId);
    if (!before) {
      throw new ApiError(404, 'BIT_NOT_FOUND', `Bit ${bitId} tidak ditemukan pada sumur ini.`);
    }

    const deleted = await softDeleteBit(bitId);
    if (!deleted) {
      throw new ApiError(404, 'BIT_NOT_FOUND', `Bit ${bitId} tidak ditemukan pada sumur ini.`);
    }

    await recordAudit({
      entity: 'bit',
      entityId: bitId,
      action: 'bit_delete',
      actor: user,
      ip: getClientIp(req),
      oldJson: {
        bitNo: before.bitNo,
        bitType: before.bitType,
        status: before.status,
        wellId: params.id,
      },
      newJson: { deleted: true },
    });

    return ok({ id: bitId, deleted: true });
  } catch (err) {
    return fail(err);
  }
}
