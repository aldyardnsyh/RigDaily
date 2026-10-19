/**
 * POST /api/reports/import
 *
 * Impor CSV legacy (time breakdown) menjadi DDR untuk satu sumur.
 * Body: `{ csv: string, wellId: string, rigId?: string, fileName?: string }`
 *
 * Butuh `report:create` DAN `master:manage` (impor massal = operasi master).
 * Hasil: `{ batchId, rowCount, inserted, errorCount, errors }` + catatan
 * `import_batches`.
 */
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@rigdaily/database';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { importDailyReportsCsv } from '@/lib/reports/importer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zBody = z.object({
  csv: z.string().min(1, 'CSV kosong'),
  wellId: z.string().uuid('wellId harus UUID'),
  rigId: z.string().uuid('rigId harus UUID').nullable().optional(),
  fileName: z.string().trim().max(300).optional(),
});

/** Maksimal ukuran CSV yang diterima (1 MB) - cukup untuk satu sumur. */
const MAX_CSV_BYTES = 1_000_000;

export async function POST(req: Request): Promise<Response> {
  try {
    const user = await requirePermission('report:create');
    await requirePermission('master:manage');

    const body = parseBody(zBody, await readJson(req));

    if (body.csv.length > MAX_CSV_BYTES) {
      throw new ApiError(413, 'CSV_TOO_LARGE', `CSV melebihi batas ${MAX_CSV_BYTES} byte.`);
    }

    const wellRows = await db
      .select({ id: schema.wells.id })
      .from(schema.wells)
      .where(and(eq(schema.wells.id, body.wellId), isNull(schema.wells.deletedAt)))
      .limit(1);

    if (!wellRows[0]) {
      throw new ApiError(422, 'WELL_NOT_FOUND', `Sumur ${body.wellId} tidak ditemukan.`);
    }

    const result = await importDailyReportsCsv(body.csv, {
      wellId: body.wellId,
      rigId: body.rigId ?? null,
      actorId: user.id,
      fileName: body.fileName,
    });

    await recordAudit({
      entity: 'import_batch',
      entityId: result.batchId,
      action: 'import_csv',
      actor: user,
      ip: getClientIp(req),
      newJson: {
        wellId: body.wellId,
        rigId: body.rigId ?? null,
        rowCount: result.rowCount,
        inserted: result.inserted,
        errorCount: result.errorCount,
        costFilled: result.costFilled,
      },
    });

    return ok(result, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}
