/**
 * POST /api/sync/push
 *
 * Body: `zSyncPushRequest` (`deviceId` + max 500 mutation).
 *
 * KREDENSIAL (MVP):
 *  - Sesi user web dengan permission `sync:run`, ATAU
 *  - Header `x-device-key` yang hash SHA-256-nya cocok dengan
 *    `sync_devices.api_key_hash` milik device aktif (dipakai Electron di rig).
 *
 * Tanpa salah satu kredensial → 401. `deviceId` di body WAJIB sama dengan
 * device pemilik API key, supaya satu key tidak bisa menulis atas nama rig lain.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { can, zSyncPushRequest, type SyncPushRequest } from '@rigdaily/shared';
import { db, schema, sha256Hex } from '@rigdaily/database';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { getSessionUser, recordAudit, type SessionUser } from '@/lib/auth';
import { handlePush } from '@/lib/sync/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEVICE_KEY_HEADER = 'x-device-key';

type PushCaller = { kind: 'user'; actor: SessionUser } | { kind: 'device'; deviceId: string };

/** Cocokkan header `x-device-key` dengan hash tersimpan (device aktif). */
async function deviceFromApiKey(apiKey: string, deviceId: string): Promise<PushCaller | null> {
  const keyHash = sha256Hex(apiKey.trim());
  const rows = await db
    .select({ deviceId: schema.syncDevices.deviceId })
    .from(schema.syncDevices)
    .where(
      and(
        eq(schema.syncDevices.apiKeyHash, keyHash),
        eq(schema.syncDevices.deviceId, deviceId),
        eq(schema.syncDevices.active, true),
        isNull(schema.syncDevices.deletedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  return row ? { kind: 'device', deviceId: row.deviceId } : null;
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = parseBody(zSyncPushRequest, await readJson(req)) as SyncPushRequest;

    const apiKey = req.headers.get(DEVICE_KEY_HEADER);
    let caller: PushCaller | null = apiKey && apiKey.trim().length > 0 ? await deviceFromApiKey(apiKey, body.deviceId) : null;

    if (!caller) {
      const user = await getSessionUser();
      if (!user) {
        throw new ApiError(
          401,
          'UNAUTHENTICATED',
          'Sync memerlukan sesi login atau header x-device-key yang valid.',
        );
      }
      if (!can(user.role, 'sync:run')) {
        throw new ApiError(403, 'FORBIDDEN', 'Anda tidak memiliki izin "sync:run" untuk mengirim perubahan.');
      }
      caller = { kind: 'user', actor: user };
    }

    const result = await handlePush({ deviceId: body.deviceId, mutations: body.mutations });

    const acked = result.acks.filter((a) => a.status === 'acked').length;
    const conflicted = result.acks.filter((a) => a.status === 'conflict').length;
    const rejected = result.acks.filter((a) => a.status === 'rejected').length;

    await recordAudit({
      entity: 'sync',
      entityId: caller.kind === 'device' ? caller.deviceId : caller.actor.id,
      action: 'sync_push',
      actor: caller.kind === 'user' ? caller.actor : null,
      ip: getClientIp(req),
      newJson: {
        deviceId: body.deviceId,
        via: caller.kind,
        mutations: body.mutations.length,
        acked,
        conflicted,
        rejected,
      },
    });

    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
