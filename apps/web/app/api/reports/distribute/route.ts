/**
 * POST /api/reports/distribute
 *
 * Jalankan distribusi DDR otomatis (rules → delivery log → email).
 * Body: `{ dryRun?: boolean, reportId?: string }`
 *
 * Butuh `report:distribute`. Tanpa `SMTP_URL`, laporan tetap antre (`queued`) dan
 * `distributedAt` TIDAK diubah - pengiriman manual dilakukan dari Delivery Log.
 */
import { z } from 'zod';
import { fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { runDistribution } from '@/lib/reports/distributor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zBody = z.object({
  dryRun: z.boolean().optional(),
  reportId: z.string().uuid('reportId harus UUID').optional(),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const user = await requirePermission('report:distribute');
    const body = parseBody(zBody, await readJson(req));

    const result = await runDistribution({ dryRun: body.dryRun === true, reportId: body.reportId });

    // Audit ringkas di route (distributor juga menulis `distribute_run` detail).
    await recordAudit({
      entity: 'distribution_rule',
      entityId: null,
      action: 'distribute_request',
      actor: user,
      ip: getClientIp(req),
      newJson: {
        dryRun: body.dryRun === true,
        reportId: body.reportId ?? null,
        queued: result.queued,
        sent: result.sent,
        failed: result.failed,
      },
    });

    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
