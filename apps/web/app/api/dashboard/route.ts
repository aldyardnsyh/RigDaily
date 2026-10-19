/**
 * GET /api/dashboard?wellId=<uuid>&days=14
 *
 * Satu panggilan untuk layar dashboard: KPI hari ini, 6 laporan terbaru, tren
 * `days` laporan terakhir (default 14), dan komposisi waktu laporan terbaru.
 *
 * `getTrend()` dari repo WAJIB diberi wellId (tren selalu per sumur). Tanpa
 * `wellId` dipakai sumur laporan terbaru; bila database belum punya laporan,
 * tren kosong (bukan error).
 *
 * P1-3: `days` diteruskan APA ADANYA ke `getTrend(wellId, days)`. Sebelumnya
 * route memakai konstanta 14 sementara `/cost` memotong lagi di klien (slicing
 * ganda). Konsumen kini cukup meminta jumlah yang diinginkan di sini.
 */
import { z } from 'zod';
import { fail, ok, parseBody } from '@/lib/api-response';
import { requirePermission } from '@/lib/auth';
import { queryToObject } from '@/lib/http-query';
import {
  getDashboardKpi,
  getReportById,
  getReportsSummary,
  getTimeMix,
  getTrend,
} from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zQuery = z.object({
  wellId: z.string().uuid('wellId harus UUID').optional(),
  days: z.coerce.number().int().min(1).max(365).default(14),
});

export async function GET(req: Request): Promise<Response> {
  try {
    await requirePermission('dashboard:read');
    const query = parseBody(zQuery, queryToObject(req.url));

    /*
     * PARALELISASI (optimasi latensi)
     *
     * Sebelumnya query dijalankan berurutan (waterfall):
     *   kpi + reports -> trend -> report detail -> timeMix
     * Empat tahap berurutan berarti latensi = jumlah seluruh query, sehingga
     * endpoint ini menjadi yang paling lambat dimuat.
     *
     * Sekarang tiga query pertama dijalankan BERSAMAAN. Hanya `timeMix` yang
     * masih bergantung pada id laporan terbaru, dan itu pun bisa memakai
     * `reports[0].id` tanpa perlu mengambil detail laporan lebih dulu.
     */
    const [kpi, reports] = await Promise.all([getDashboardKpi(query.wellId), getReportsSummary(6)]);

    const trendWellId = query.wellId ?? reports[0]?.wellId ?? null;
    const latest = reports[0] ?? null;

    // `timeMix` hanya butuh id laporan; tidak perlu `getReportById`.
    const timeMixAllowed = latest && (!query.wellId || latest.wellId === query.wellId);

    const [trend, timeMix] = await Promise.all([
      trendWellId ? getTrend(trendWellId, query.days) : Promise.resolve([]),
      timeMixAllowed ? getTimeMix(latest.id) : Promise.resolve(null),
    ]);

    return ok({
      kpi,
      reports,
      trend,
      trendDays: query.days,
      timeMix,
      wellId: query.wellId ?? trendWellId,
    });
  } catch (err) {
    return fail(err);
  }
}
