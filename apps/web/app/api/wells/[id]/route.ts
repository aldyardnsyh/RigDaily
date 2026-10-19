/**
 * GET   /api/wells/[id] → detail sumur + milestone
 * PATCH /api/wells/[id] → ubah well file (nama, API no, tipe, fase, spud, TD,
 *                          AFE, operator, koordinat, field)
 *
 * PATCH butuh `wellfile:edit` DAN akses rig: sumur tidak menyimpan rigId, jadi
 * scope dicek terhadap rig dari DDR terbaru sumur tersebut (`assertRigAccess`).
 * Editor global (rigScope kosong) & Admin selalu lolos.
 *
 * Catatan scope: mengubah `fieldId` ATAU memindahkan sumur ke sumur lain tidak
 * mengubah rig, jadi pemeriksaan rig tetap memakai DDR terbaru sebelum patch.
 */
import { z } from 'zod';
import { zWellPhase, zWellType } from '@rigdaily/shared';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { assertRigAccess } from '@/lib/rbac';
import {
  getRigById,
  getWellById,
  getWellMilestones,
  listReports,
  updateWellDetails,
  type WellDto,
} from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zPatch = z
  .object({
    wellCode: z.string().trim().max(60).nullable().optional(),
    division: z.string().trim().max(120).nullable().optional(),
    name: z.string().trim().min(1, 'Nama sumur wajib diisi').max(160).optional(),
    apiNo: z.string().trim().max(60).nullable().optional(),
    type: zWellType.optional(),
    phase: zWellPhase.optional(),
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

/** Rig pemilik sumur = rig DDR terbaru (null bila belum ada laporan). */
async function rigIdOfWell(wellId: string): Promise<string | null> {
  const { items } = await listReports({ wellId, limit: 1 });
  const rigId = items[0]?.rigId ?? null;
  if (!rigId) return null;

  // Pastikan rig masih ada (bukan referensi yatim).
  const rig = await getRigById(rigId);
  return rig ? rigId : null;
}

function snapshot(well: WellDto): Record<string, unknown> {
  return {
    name: well.name,
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
  };
}

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    await requirePermission('wellfile:read');

    const well = await getWellById(params.id);
    if (!well) {
      throw new ApiError(404, 'WELL_NOT_FOUND', `Sumur ${params.id} tidak ditemukan.`);
    }

    return ok({ ...well, milestones: await getWellMilestones(params.id) });
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const user = await requirePermission('wellfile:edit');

    const well = await getWellById(params.id);
    if (!well) {
      throw new ApiError(404, 'WELL_NOT_FOUND', `Sumur ${params.id} tidak ditemukan.`);
    }

    // Sumur tanpa DDR (rigId null) hanya boleh diubah user global (Admin / scope kosong).
    assertRigAccess(user, await rigIdOfWell(params.id));

    const patch = parseBody(zPatch, await readJson(req));
    if (Object.keys(patch).length === 0) {
      throw new ApiError(400, 'EMPTY_PATCH', 'Tidak ada kolom yang dikirim untuk diubah.');
    }

    await updateWellDetails(params.id, patch);

    const after = await getWellById(params.id);

    await recordAudit({
      entity: 'well',
      entityId: params.id,
      action: 'update',
      actor: user,
      ip: getClientIp(req),
      oldJson: snapshot(well),
      newJson: { ...(after ? snapshot(after) : patch), changed: Object.keys(patch) },
    });

    return ok(after);
  } catch (err) {
    return fail(err);
  }
}
