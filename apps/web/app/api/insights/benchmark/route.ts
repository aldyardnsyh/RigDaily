/**
 * GET /api/insights/benchmark?metric=npt&wellIds=<uuid,uuid>&days=30
 *
 * Seri tren satu metrik untuk perbandingan antar sumur:
 * - `npt`   → NPT% harian ((npt+wow)/total*100)
 * - `cost`  → biaya harian USD
 * - `depth` → progres 24 jam (meter)
 * - `rop`   → meter per jam (progress24h / 24)
 *
 * `metric` default `npt`, `days` default 30 (maks 365). Butuh `dashboard:read`.
 */
import { z } from 'zod';
import { ApiError, fail, ok, parseBody } from '@/lib/api-response';
import { requirePermission } from '@/lib/auth';
import { queryToObject } from '@/lib/http-query';
import { getMetricTrend } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zQuery = z.object({
  metric: z.string().trim().min(1).optional(),
  days: z.coerce.number().int().min(1).max(365).optional(),
  /** Comma-separated UUID; validasi per item dilakukan setelah split. */
  wellIds: z.string().trim().optional(),
});

const METRICS = ['npt', 'cost', 'depth', 'rop'] as const;
type Metric = (typeof METRICS)[number];

const DEFAULT_METRIC: Metric = 'npt';
const DEFAULT_DAYS = 30;

function isMetric(value: string | undefined): value is Metric {
  return value !== undefined && (METRICS as readonly string[]).includes(value);
}

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

    if (query.metric !== undefined && !isMetric(query.metric)) {
      throw new ApiError(400, 'VALIDATION_ERROR', `metric harus salah satu dari: ${METRICS.join(', ')}.`);
    }

    const metric: Metric = isMetric(query.metric) ? query.metric : DEFAULT_METRIC;
    const days = query.days ?? DEFAULT_DAYS;
    const wellIds = parseWellIds(query.wellIds);

    const series = await getMetricTrend(metric, wellIds, days);

    return ok(series);
  } catch (err) {
    return fail(err);
  }
}
