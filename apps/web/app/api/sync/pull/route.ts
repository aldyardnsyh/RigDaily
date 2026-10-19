/**
 * GET /api/sync/pull?since=<ISO>&entities=daily_reports,time_breakdown
 *
 * Mengirim delta semua perubahan server sejak `since` (default 1970) untuk
 * device yang meminta. Butuh permission `sync:read`.
 *
 * `deviceId` diambil dari query, atau header `x-device-id` (device Electron),
 * atau ID user pemanggil sebagai fallback supaya `sync_devices.lastPulledAt`
 * tetap tercatat.
 */
import { z } from 'zod';
import { ApiError, fail, ok, parseBody } from '@/lib/api-response';
import { requirePermission } from '@/lib/auth';
import { queryToObject } from '@/lib/http-query';
import { handlePull } from '@/lib/sync/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zPullQuery = z.object({
  deviceId: z.string().min(1).max(80).optional(),
  since: z.string().min(1).max(40).optional(),
  entities: z.string().max(500).optional(),
});

export async function GET(req: Request): Promise<Response> {
  try {
    const user = await requirePermission('sync:read');
    const query = parseBody(zPullQuery, queryToObject(req.url));

    const deviceId =
      query.deviceId ?? req.headers.get('x-device-id')?.trim() ?? `user:${user.id}`;

    if (deviceId.length === 0) {
      throw new ApiError(400, 'MISSING_DEVICE_ID', 'Device ID tidak dapat ditentukan.');
    }

    const entities = query.entities
      ? query.entities
          .split(',')
          .map((e) => e.trim())
          .filter((e) => e.length > 0)
      : undefined;

    const result = await handlePull({
      deviceId: deviceId.slice(0, 80),
      since: query.since ?? null,
      entities,
    });

    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
