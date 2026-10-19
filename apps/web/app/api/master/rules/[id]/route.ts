/**
 * PATCH  /api/master/rules/[id] → ubah satu aturan distribusi DDR
 * DELETE /api/master/rules/[id] → soft delete aturan distribusi DDR
 *
 * Body PATCH (semua opsional, minimal satu):
 *   { active?, scheduleCron?, recipientGroup?, name?, reportType?, templateId? }
 *
 * Validasi:
 * - `scheduleCron`  : cron 5 field (menit jam hari-bulan bulan hari-minggu).
 * - `recipientGroup`: array string (RoleId atau email), maksimum 50 item.
 *
 * Butuh `master:manage`. Setiap perubahan dicatat ke `audit_log` dengan
 * `action: 'rule_update'` (oldJson vs newJson) agar siapa mematikan distribusi
 * email bisa ditelusuri. `rule_delete` untuk penghapusan. 404 bila rule tidak ada.
 */
import { z } from 'zod';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { softDeleteDistributionRule, updateDistributionRule } from '@/lib/repo';
import { zCron5, zRecipientGroup } from '../cron';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zPatch = z
  .object({
    active: z.boolean().optional(),
    scheduleCron: zCron5.optional(),
    recipientGroup: zRecipientGroup.optional(),
    name: z.string().trim().min(1, 'Nama rule wajib diisi').max(160, 'Nama rule maksimal 160 karakter').optional(),
    reportType: z.string().trim().min(1, 'Jenis laporan wajib diisi').max(60).optional(),
    templateId: z.string().trim().min(1, 'Template wajib diisi').max(60).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.active !== undefined ||
      v.scheduleCron !== undefined ||
      v.recipientGroup !== undefined ||
      v.name !== undefined ||
      v.reportType !== undefined ||
      v.templateId !== undefined,
    { message: 'Isi minimal satu dari: active, scheduleCron, recipientGroup, name, reportType, templateId' },
  );

function ruleId(raw: string | undefined): string {
  const id = decodeURIComponent(raw ?? '').trim();
  if (!id) throw new ApiError(400, 'INVALID_ID', 'id rule wajib diisi.');
  return id;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const user = await requirePermission('master:manage');
    const id = ruleId(params.id);

    const patch = parseBody(zPatch, await readJson(req));

    const { before, after } = await updateDistributionRule(id, patch);
    if (!before || !after) {
      throw new ApiError(404, 'RULE_NOT_FOUND', `Aturan distribusi ${id} tidak ditemukan.`);
    }

    await recordAudit({
      entity: 'distribution_rule',
      entityId: id,
      action: 'rule_update',
      actor: user,
      oldJson: {
        name: before.name,
        active: before.active,
        scheduleCron: before.scheduleCron,
        recipientGroup: before.recipientGroup,
        reportType: before.reportType,
        templateId: before.templateId,
      },
      newJson: {
        name: after.name,
        active: after.active,
        scheduleCron: after.scheduleCron,
        recipientGroup: after.recipientGroup,
        reportType: after.reportType,
        templateId: after.templateId,
        changed: Object.keys(patch),
      },
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
    const user = await requirePermission('master:manage');
    const id = ruleId(params.id);

    const removed = await softDeleteDistributionRule(id);
    if (!removed) {
      throw new ApiError(404, 'RULE_NOT_FOUND', `Aturan distribusi ${id} tidak ditemukan.`);
    }

    await recordAudit({
      entity: 'distribution_rule',
      entityId: id,
      action: 'rule_delete',
      actor: user,
      oldJson: {
        name: removed.name,
        active: removed.active,
        scheduleCron: removed.scheduleCron,
        recipientGroup: removed.recipientGroup,
        reportType: removed.reportType,
        templateId: removed.templateId,
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
