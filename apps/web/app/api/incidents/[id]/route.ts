/**
 * PATCH  /api/incidents/[id]
 * DELETE /api/incidents/[id]
 *
 * Ubah sebagian kolom insiden (status alur, corrective action, assignee, dst.).
 * Body: subset `{ refNo?, type?, severity?, occurredAt?, location?, description?,
 * immediateAction?, correctiveAction?, assignee?, dueDate?, status? }`.
 * `reportId` tidak bisa dipindah - relasi ke DDR permanen.
 *
 * DELETE = soft delete (register HSE kehilangan baris, jejak audit tetap).
 * Butuh `safety:edit`.
 */
import { z } from 'zod';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { listIncidents, softDeleteIncident, updateIncident } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zPatch = z
  .object({
    refNo: z.string().trim().max(60).nullable().optional(),
    type: z.string().trim().min(1).max(80).optional(),
    severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    occurredAt: z
      .string()
      .trim()
      .min(1)
      .nullable()
      .optional()
      .refine((v) => v === null || v === undefined || !Number.isNaN(new Date(v).getTime()), {
        message: 'Format tanggal/jam insiden tidak valid.',
      }),
    location: z.string().trim().max(160).nullable().optional(),
    description: z.string().trim().min(1).max(4000).optional(),
    immediateAction: z.string().max(4000).nullable().optional(),
    correctiveAction: z.string().max(4000).nullable().optional(),
    assignee: z.string().trim().max(160).nullable().optional(),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD')
      .nullable()
      .optional(),
    status: z.enum(['draft', 'open', 'closed']).optional(),
  })
  .strict();

export async function PATCH(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const user = await requirePermission('safety:edit');
    const patch = parseBody(zPatch, await readJson(req));

    const keys = Object.keys(patch);
    if (keys.length === 0) {
      throw new ApiError(400, 'EMPTY_PATCH', 'Tidak ada kolom insiden yang dikirim untuk diubah.');
    }

    const before = (await listIncidents()).find((i) => i.id === params.id);
    if (!before) {
      throw new ApiError(404, 'INCIDENT_NOT_FOUND', `Insiden ${params.id} tidak ditemukan.`);
    }

    await updateIncident(params.id, patch as Record<string, unknown>);

    const after = (await listIncidents()).find((i) => i.id === params.id);

    await recordAudit({
      entity: 'safety_incident',
      entityId: params.id,
      action: 'update',
      actor: user,
      ip: getClientIp(req),
      oldJson: {
        status: before.status,
        severity: before.severity,
        assignee: before.assignee,
        dueDate: before.dueDate,
      },
      newJson: {
        status: after?.status ?? null,
        severity: after?.severity ?? null,
        assignee: after?.assignee ?? null,
        dueDate: after?.dueDate ?? null,
        changed: keys,
      },
    });

    return ok(after ?? before);
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const user = await requirePermission('safety:edit');

    const before = (await listIncidents()).find((i) => i.id === params.id);
    if (!before) {
      throw new ApiError(404, 'INCIDENT_NOT_FOUND', `Insiden ${params.id} tidak ditemukan.`);
    }

    const deleted = await softDeleteIncident(params.id);
    if (!deleted) {
      throw new ApiError(404, 'INCIDENT_NOT_FOUND', `Insiden ${params.id} tidak ditemukan.`);
    }

    await recordAudit({
      entity: 'safety_incident',
      entityId: params.id,
      action: 'delete',
      actor: user,
      ip: getClientIp(req),
      oldJson: {
        refNo: before.refNo,
        type: before.type,
        severity: before.severity,
        occurredAt: before.occurredAt,
        reportId: before.reportId,
        status: before.status,
        assignee: before.assignee,
      },
      newJson: { deleted: true },
    });

    return ok({ id: params.id, deleted: true });
  } catch (err) {
    return fail(err);
  }
}
