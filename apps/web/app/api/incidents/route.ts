/**
 * GET  /api/incidents                → register insiden safety
 *                                     (`?reportId=` → hanya laporan itu,
 *                                     tanpa filter → SEMUA insiden terbaru dulu)
 * POST /api/incidents                → catat insiden baru (`refNo` otomatis
 *                                     `IR-YYYY-NNN` bila tidak dikirim)
 *
 * GET butuh `safety:read`; POST butuh `safety:edit`.
 */
import { z } from 'zod';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { queryToObject } from '@/lib/http-query';
import { createIncident, getReportById, listIncidents } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zQuery = z.object({
  reportId: z.string().uuid('reportId harus UUID').optional(),
});

/**
 * `occurredAt`: tanggal+jam lokal rig (`YYYY-MM-DDTHH:MM`) atau ISO penuh.
 * Disimpan sebagai timestamptz; string yang tidak bisa diparse ditolak.
 */
const zOccurredAt = z
  .string()
  .trim()
  .min(1)
  .nullable()
  .optional()
  .refine((v) => v === null || v === undefined || !Number.isNaN(new Date(v).getTime()), {
    message: 'Format tanggal/jam insiden tidak valid.',
  });

const zBody = z.object({
  reportId: z.string().uuid('reportId harus UUID').nullable().optional(),
  refNo: z.string().trim().max(60).nullable().optional(),
  type: z.string().trim().min(1, 'Tipe insiden wajib diisi').max(80),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  occurredAt: zOccurredAt,
  location: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().min(1, 'Deskripsi wajib diisi').max(4000),
  immediateAction: z.string().max(4000).nullable().optional(),
  correctiveAction: z.string().max(4000).nullable().optional(),
  assignee: z.string().trim().max(160).nullable().optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD')
    .nullable()
    .optional(),
  status: z.enum(['draft', 'open', 'closed']).optional(),
});

export async function GET(req: Request): Promise<Response> {
  try {
    await requirePermission('safety:read');
    const query = parseBody(zQuery, queryToObject(req.url));
    return ok(await listIncidents(query.reportId));
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const user = await requirePermission('safety:edit');
    const body = parseBody(zBody, await readJson(req));

    // Validasi referensi: laporan yang ditautkan harus ada (422, bukan FK error).
    if (body.reportId) {
      const report = await getReportById(body.reportId);
      if (!report) {
        throw new ApiError(422, 'REPORT_NOT_FOUND', `Laporan ${body.reportId} tidak ditemukan.`);
      }
    }

    const created = await createIncident({
      reportId: body.reportId ?? null,
      refNo: body.refNo ?? null,
      type: body.type,
      severity: body.severity,
      occurredAt: body.occurredAt ?? null,
      location: body.location ?? null,
      description: body.description,
      immediateAction: body.immediateAction ?? null,
      correctiveAction: body.correctiveAction ?? null,
      assignee: body.assignee ?? null,
      dueDate: body.dueDate ?? null,
      status: body.status ?? 'open',
    });

    await recordAudit({
      entity: 'safety_incident',
      entityId: created.id,
      action: 'create',
      actor: user,
      ip: getClientIp(req),
      newJson: {
        refNo: created.refNo,
        reportId: body.reportId ?? null,
        type: body.type,
        severity: body.severity,
        status: body.status ?? 'open',
      },
    });

    return ok(created, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}
