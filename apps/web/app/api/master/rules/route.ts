/**
 * GET    /api/master/rules            - aturan distribusi DDR + 20 log terakhir
 * POST   /api/master/rules            - buat aturan distribusi baru
 * PATCH  /api/master/rules            - shortcut toggle `active` satu rule: `{ id, active }`
 *
 * GET butuh `report:read`; POST/PATCH butuh `master:manage`. PATCH pada koleksi
 * sengaja hanya menerima `{ id, active }`; untuk field lain (jadwal cron,
 * penerima, nama) pakai `PATCH /api/master/rules/[id]`.
 *
 * Body POST: `{ name, reportType, recipientGroup, scheduleCron, templateId, active }`
 */
import { z } from 'zod';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import {
  createDistributionRule,
  listDeliveryLog,
  listDistributionRules,
  updateDistributionRule,
} from '@/lib/repo';
import { zCron5, zRecipientGroup } from './cron';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zBody = z
  .object({
    id: z.string().uuid('id rule harus UUID'),
    active: z.boolean(),
  })
  .strict();

const zCreate = z
  .object({
    name: z.string().trim().min(1, 'Nama rule wajib diisi').max(160, 'Nama rule maksimal 160 karakter'),
    reportType: z.string().trim().min(1, 'Jenis laporan wajib diisi').max(60),
    recipientGroup: zRecipientGroup,
    scheduleCron: zCron5,
    templateId: z.string().trim().min(1, 'Template wajib diisi').max(60),
    active: z.boolean().default(true),
  })
  .strict();

export async function GET(): Promise<Response> {
  try {
    await requirePermission('report:read');
    const [rules, deliveryLog] = await Promise.all([listDistributionRules(), listDeliveryLog(20)]);
    return ok({ rules, deliveryLog });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const user = await requirePermission('master:manage');
    const body = parseBody(zCreate, await readJson(req));
    const active = body.active ?? true;

    const created = await createDistributionRule({
      name: body.name,
      reportType: body.reportType,
      recipientGroup: body.recipientGroup,
      scheduleCron: body.scheduleCron,
      templateId: body.templateId,
      active,
    });

    await recordAudit({
      entity: 'distribution_rule',
      entityId: created.id,
      action: 'rule_create',
      actor: user,
      newJson: {
        name: body.name,
        reportType: body.reportType,
        recipientGroup: body.recipientGroup,
        scheduleCron: body.scheduleCron,
        templateId: body.templateId,
        active,
      },
      ip: getClientIp(req),
      terminal: req.headers.get('user-agent')?.slice(0, 300) ?? null,
    });

    return ok(created, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(req: Request): Promise<Response> {
  try {
    const user = await requirePermission('master:manage');
    const body = parseBody(zBody, await readJson(req));

    // Delegasi ke logika yang sama dengan PATCH /api/master/rules/[id]:
    // cari rule, patch `active` + updatedAt, lalu audit `rule_update`.
    const { before, after } = await updateDistributionRule(body.id, { active: body.active });
    if (!before || !after) {
      throw new ApiError(404, 'RULE_NOT_FOUND', `Aturan distribusi ${body.id} tidak ditemukan.`);
    }

    await recordAudit({
      entity: 'distribution_rule',
      entityId: body.id,
      action: 'rule_update',
      actor: user,
      oldJson: { active: before.active, name: before.name },
      newJson: { active: after.active, name: after.name },
      ip: getClientIp(req),
      terminal: req.headers.get('user-agent')?.slice(0, 300) ?? null,
    });

    return ok(after);
  } catch (err) {
    return fail(err);
  }
}
