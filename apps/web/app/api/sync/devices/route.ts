/**
 * GET /api/sync/devices
 *
 * Status semua device terdaftar + hitungan antrian:
 *  - `openConflicts`   : baris `sync_conflicts` berstatus open
 *  - `pendingMutations`: mutation di ledger yang hasilnya `conflict` (belum selesai)
 *
 * Butuh permission `sync:read`.
 */
import { isNull } from 'drizzle-orm';
import { db, schema } from '@rigdaily/database';
import { fail, ok } from '@/lib/api-response';
import { requirePermission } from '@/lib/auth';
import { listSyncDevices } from '@/lib/repo';
import { openConflictCounts, pendingMutationCounts } from '@/lib/sync/conflict';
import type { SyncDeviceStatus } from '@/lib/sync/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isoOf(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function GET(): Promise<Response> {
  try {
    await requirePermission('sync:read');

    const devices = await listSyncDevices();
    const ids = devices.map((d) => d.deviceId);

    const [openConflicts, pendingMutations, pulled] = await Promise.all([
      openConflictCounts(ids),
      pendingMutationCounts(ids),
      db
        .select({
          deviceId: schema.syncDevices.deviceId,
          lastPulledAt: schema.syncDevices.lastPulledAt,
        })
        .from(schema.syncDevices)
        .where(isNull(schema.syncDevices.deletedAt)),
    ]);

    const lastPulledByDevice = new Map(pulled.map((p) => [p.deviceId, isoOf(p.lastPulledAt)]));

    const items: SyncDeviceStatus[] = devices.map((d) => ({
      id: d.id,
      deviceId: d.deviceId,
      name: d.name,
      kind: d.kind,
      rigId: d.rigId,
      lastSeenAt: d.lastSeenAt,
      lastPulledAt: lastPulledByDevice.get(d.deviceId) ?? null,
      pendingCount: d.pendingCount,
      active: d.active,
      openConflicts: openConflicts.get(d.deviceId) ?? 0,
      pendingMutations: pendingMutations.get(d.deviceId) ?? 0,
    }));

    return ok({
      devices: items,
      totals: {
        devices: items.length,
        active: items.filter((d) => d.active).length,
        openConflicts: items.reduce((acc, d) => acc + d.openConflicts, 0),
        pendingMutations: items.reduce((acc, d) => acc + d.pendingMutations, 0),
      },
    });
  } catch (err) {
    return fail(err);
  }
}
