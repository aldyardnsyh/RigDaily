/**
 * GET    /api/rigs/[id] → detail satu rig                     (`wellfile:read`)
 * PATCH  /api/rigs/[id] → ubah data rig                       (`master:manage`)
 * DELETE /api/rigs/[id] → soft delete rig                     (`master:manage`)
 *
 * Body PATCH: subset `{ name?, code?, type?, contractor?, contractRef? }`
 *
 * Penghapusan ditolak 409 `RIG_IN_USE` bila rig masih dipakai DDR aktif, well
 * (via DDR), atau device sync aktif - rig yang hilang akan memutus billing.
 */
import { z } from 'zod';
import { zRigType } from '@rigdaily/shared';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { countRigUsage, getRigById, softDeleteRig, updateRig, type RigDto } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zPatch = z
  .object({
    name: z.string().trim().min(1, 'Nama rig wajib diisi').max(160).optional(),
    code: z.string().trim().max(60).nullable().optional(),
    type: zRigType.optional(),
    contractor: z.string().trim().max(200).nullable().optional(),
    contractRef: z.string().trim().max(120).nullable().optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.name !== undefined ||
      v.code !== undefined ||
      v.type !== undefined ||
      v.contractor !== undefined ||
      v.contractRef !== undefined,
    { message: 'Isi minimal satu dari: name, code, type, contractor, contractRef' },
  );

function snapshot(rig: RigDto): Record<string, unknown> {
  return {
    name: rig.name,
    code: rig.code,
    type: rig.type,
    contractor: rig.contractor,
    contractRef: rig.contractRef,
  };
}

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    await requirePermission('wellfile:read');

    const rig = await getRigById(params.id);
    if (!rig) {
      throw new ApiError(404, 'NOT_FOUND', `Rig ${params.id} tidak ditemukan.`);
    }

    return ok(rig);
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const actor = await requirePermission('master:manage');
    const patch = parseBody(zPatch, await readJson(req));

    const { before, after } = await updateRig(params.id, patch);
    if (!before || !after) {
      throw new ApiError(404, 'NOT_FOUND', `Rig ${params.id} tidak ditemukan.`);
    }

    await recordAudit({
      entity: 'rig',
      entityId: params.id,
      action: 'update',
      actor,
      oldJson: snapshot(before),
      newJson: { ...snapshot(after), changed: Object.keys(patch) },
      ip: getClientIp(req),
      terminal: req.headers.get('user-agent')?.slice(0, 300) ?? null,
    });

    return ok(after);
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const actor = await requirePermission('master:manage');

    const rig = await getRigById(params.id);
    if (!rig) {
      throw new ApiError(404, 'NOT_FOUND', `Rig ${params.id} tidak ditemukan.`);
    }

    const usage = await countRigUsage(params.id);
    if (usage.reports > 0 || usage.wells > 0 || usage.devices > 0) {
      throw new ApiError(
        409,
        'RIG_IN_USE',
        `Rig "${rig.name}" masih dipakai (${usage.reports} DDR, ${usage.wells} sumur, ${usage.devices} device). Lepaskan dulu sebelum menghapus.`,
        usage,
      );
    }

    const removed = await softDeleteRig(params.id);
    if (!removed) {
      throw new ApiError(404, 'NOT_FOUND', `Rig ${params.id} tidak ditemukan.`);
    }

    await recordAudit({
      entity: 'rig',
      entityId: params.id,
      action: 'delete',
      actor,
      oldJson: snapshot(removed),
      newJson: { deleted: true },
      ip: getClientIp(req),
      terminal: req.headers.get('user-agent')?.slice(0, 300) ?? null,
    });

    return ok({ id: params.id, deleted: true });
  } catch (err) {
    return fail(err);
  }
}
