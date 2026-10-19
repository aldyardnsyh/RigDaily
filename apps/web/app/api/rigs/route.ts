/**
 * GET  /api/rigs - daftar rig aktif + jumlah DDR 7 hari terakhir (`wellfile:read`).
 * POST /api/rigs - buat rig baru (`master:manage`).
 *
 * Body POST: `{ name, code?, type, contractor?, contractRef? }`
 */
import { z } from 'zod';
import { zRigType } from '@rigdaily/shared';
import { fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { createRig, getRigById, listRigs } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zCreate = z
  .object({
    name: z.string().trim().min(1, 'Nama rig wajib diisi').max(160),
    code: z.string().trim().max(60).nullable().optional(),
    type: zRigType,
    contractor: z.string().trim().max(200).nullable().optional(),
    contractRef: z.string().trim().max(120).nullable().optional(),
  })
  .strict();

export async function GET(): Promise<Response> {
  try {
    await requirePermission('wellfile:read');
    return ok(await listRigs());
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const actor = await requirePermission('master:manage');
    const body = parseBody(zCreate, await readJson(req));

    const created = await createRig({
      name: body.name,
      code: body.code ?? null,
      type: body.type,
      contractor: body.contractor ?? null,
      contractRef: body.contractRef ?? null,
    });

    await recordAudit({
      entity: 'rig',
      entityId: created.id,
      action: 'create',
      actor,
      newJson: {
        name: body.name,
        code: body.code ?? null,
        type: body.type,
        contractor: body.contractor ?? null,
        contractRef: body.contractRef ?? null,
      },
      ip: getClientIp(req),
      terminal: req.headers.get('user-agent')?.slice(0, 300) ?? null,
    });

    return ok(await getRigById(created.id), { status: 201 });
  } catch (err) {
    return fail(err);
  }
}
