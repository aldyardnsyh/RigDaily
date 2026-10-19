/**
 * GET /api/insights?wellIds=<uuid,uuid>
 *
 * Satu panggilan untuk layar Insights: benchmark per sumur, perbandingan KPI
 * nyata vs baseline, dan definisi KPI aktif.
 *
 * `wellIds` opsional (comma-separated); tanpa filter → semua sumur. Dengan seed
 * demo (1 sumur ARUN-07) hasilnya tetap valid: 1 baris benchmark.
 * Butuh `dashboard:read`.
 */
import { z } from 'zod';
import { ApiError, fail, ok, parseBody } from '@/lib/api-response';
import { requirePermission } from '@/lib/auth';
import { queryToObject } from '@/lib/http-query';
import { compareAgainstBaseline, getWellBenchmark, listKpiBaselines } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zQuery = z.object({
  /** Comma-separated UUID; validasi per item dilakukan setelah split. */
  wellIds: z.string().trim().optional(),
});

/** "uuid,uuid" → string[] tervalidasi (400 bila ada yang bukan UUID). */
function parseWellIds(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (ids.length === 0) return undefined;
  for (const id of ids) {
    if (!z.string().uuid().safeParse(id).success) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'wellIds harus daftar UUID dipisah koma.', { invalid: id });
    }
  }
  return ids;
}

export async function GET(req: Request): Promise<Response> {
  try {
    await requirePermission('dashboard:read');
    const query = parseBody(zQuery, queryToObject(req.url));
    const wellIds = parseWellIds(query.wellIds);

    const [benchmark, baselines, kpiDefinitions] = await Promise.all([
      getWellBenchmark(wellIds),
      compareAgainstBaseline(wellIds),
      listKpiBaselines(),
    ]);

    return ok({ benchmark, baselines, kpiDefinitions });
  } catch (err) {
    return fail(err);
  }
}
