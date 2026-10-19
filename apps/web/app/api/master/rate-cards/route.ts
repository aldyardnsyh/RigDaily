/**
 * GET    /api/master/rate-cards?rigId=<uuid>  → daftar rate card detail (semua tier)
 * POST   /api/master/rate-cards               → buat / perbarui rate card
 * PATCH  /api/master/rate-cards               → ubah satu rate card
 * DELETE /api/master/rate-cards?id=<uuid>     → soft delete rate card
 *
 * Body POST: `{ rigId?, activityCode, label?, tiers: [{ fromHour, toHour, ratePerHour, label? }], effectiveDate? }`
 * Body PATCH: `{ id, label?, tiers?, effectiveDate?, active? }`
 *   - `activityCode`: 2 digit angka (mis. `01`, `08`, `27`)
 *   - `toHour: null` = tarif berlaku tanpa batas atas
 *
 * GET butuh `billing:read`; POST/PATCH/DELETE butuh `billing:manage`.
 */
import { z } from 'zod';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { queryToObject } from '@/lib/http-query';
import {
  getRateCardById,
  listRateCardsDetailed,
  softDeleteRateCard,
  updateRateCard,
  upsertRateCard,
} from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zQuery = z.object({
  rigId: z.string().uuid('rigId harus UUID').optional(),
});

const zDeleteQuery = z.object({
  id: z.string().uuid('id harus UUID'),
});

const zTier = z.object({
  fromHour: z.number().min(0, 'fromHour minimal 0').max(1000),
  toHour: z.number().min(0).max(1000).nullable(),
  ratePerHour: z.number().min(0, 'rate tidak boleh negatif').max(10_000_000),
  label: z.string().trim().max(120).optional(),
});

/** Tier harus naik: `toHour` > `fromHour` (atau null = tanpa batas atas). */
function tiersAscending(tiers: Array<{ fromHour: number; toHour: number | null }>): boolean {
  return tiers.every((t) => t.toHour === null || t.toHour > t.fromHour);
}

const zBody = z
  .object({
    rigId: z.string().uuid('rigId harus UUID').nullable().optional(),
    activityCode: z
      .string()
      .trim()
      .regex(/^\d{1,4}$/, 'Kode aktivitas harus 1-4 digit angka (mis. 01, 08, 27)'),
    label: z.string().trim().max(120).nullable().optional(),
    tiers: z.array(zTier).min(1, 'Minimal satu tier tarif').max(20, 'Maksimal 20 tier'),
    effectiveDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD')
      .nullable()
      .optional(),
  })
  .refine((v) => tiersAscending(v.tiers), {
    message: 'toHour setiap tier harus lebih besar dari fromHour (atau null).',
    path: ['tiers'],
  });

const zPatch = z
  .object({
    id: z.string().uuid('id harus UUID'),
    label: z.string().trim().max(120).nullable().optional(),
    tiers: z.array(zTier).min(1, 'Minimal satu tier tarif').max(20, 'Maksimal 20 tier').optional(),
    effectiveDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD')
      .nullable()
      .optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.label !== undefined || v.tiers !== undefined || v.effectiveDate !== undefined || v.active !== undefined,
    { message: 'Isi minimal satu dari: label, tiers, effectiveDate, active' },
  )
  .refine((v) => v.tiers === undefined || tiersAscending(v.tiers), {
    message: 'toHour setiap tier harus lebih besar dari fromHour (atau null).',
    path: ['tiers'],
  });

export async function GET(req: Request): Promise<Response> {
  try {
    await requirePermission('billing:read');
    const query = parseBody(zQuery, queryToObject(req.url));
    return ok(await listRateCardsDetailed(query.rigId));
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const user = await requirePermission('billing:manage');
    const body = parseBody(zBody, await readJson(req));

    const created = await upsertRateCard({
      rigId: body.rigId ?? null,
      activityCode: body.activityCode,
      label: body.label ?? null,
      tiers: body.tiers.map((t) => ({
        fromHour: t.fromHour,
        toHour: t.toHour,
        ratePerHour: t.ratePerHour,
        ...(t.label && t.label.trim() ? { label: t.label.trim() } : {}),
      })),
      effectiveDate: body.effectiveDate ?? null,
    });

    await recordAudit({
      entity: 'rate_card',
      entityId: created.id,
      action: 'upsert',
      actor: user,
      ip: getClientIp(req),
      newJson: {
        rigId: body.rigId ?? null,
        activityCode: body.activityCode,
        label: body.label ?? null,
        tiers: body.tiers,
        effectiveDate: body.effectiveDate ?? null,
      },
    });

    return ok(created, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(req: Request): Promise<Response> {
  try {
    const user = await requirePermission('billing:manage');
    const body = parseBody(zPatch, await readJson(req));

    const { before, after } = await updateRateCard(body.id, {
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.tiers !== undefined
        ? {
            tiers: body.tiers.map((t) => ({
              fromHour: t.fromHour,
              toHour: t.toHour,
              ratePerHour: t.ratePerHour,
              ...(t.label && t.label.trim() ? { label: t.label.trim() } : {}),
            })),
          }
        : {}),
      ...(body.effectiveDate !== undefined ? { effectiveDate: body.effectiveDate } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
    });

    if (!before || !after) {
      throw new ApiError(404, 'NOT_FOUND', `Rate card ${body.id} tidak ditemukan.`);
    }

    await recordAudit({
      entity: 'rate_card',
      entityId: body.id,
      action: 'update',
      actor: user,
      ip: getClientIp(req),
      oldJson: {
        label: before.label,
        tiers: before.tiers,
        effectiveDate: before.effectiveDate,
        active: before.active,
      },
      newJson: {
        label: after.label,
        tiers: after.tiers,
        effectiveDate: after.effectiveDate,
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
    const user = await requirePermission('billing:manage');
    const { id } = parseBody(zDeleteQuery, queryToObject(req.url));

    const before = await getRateCardById(id);
    if (!before) {
      throw new ApiError(404, 'NOT_FOUND', `Rate card ${id} tidak ditemukan.`);
    }

    const removed = await softDeleteRateCard(id);
    if (!removed) {
      throw new ApiError(404, 'NOT_FOUND', `Rate card ${id} tidak ditemukan.`);
    }

    await recordAudit({
      entity: 'rate_card',
      entityId: id,
      action: 'delete',
      actor: user,
      ip: getClientIp(req),
      oldJson: {
        rigId: removed.rigId,
        activityCode: removed.activityCode,
        label: removed.label,
        tiers: removed.tiers,
        effectiveDate: removed.effectiveDate,
        active: removed.active,
      },
      newJson: { deleted: true },
    });

    return ok({ id, deleted: true });
  } catch (err) {
    return fail(err);
  }
}
