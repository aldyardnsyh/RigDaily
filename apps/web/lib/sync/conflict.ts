import 'server-only';

/**
 * RESOLVER KONFLIK SYNC (Sync Center).
 *
 * Aturan bisnis: laporan yang sudah `approved|distributed|locked` TIDAK pernah
 * ditimpa otomatis. Bila device mengirim perubahan untuk laporan seperti itu,
 * `handlePush` menulis baris `sync_conflicts` berstatus `open`. Administrator /
 * Company Man memilih salah satu keputusan di UI:
 *
 *  - `keep_rig`    → terapkan payload device ke server (revisi naik, tetap dari
 *                    device), lalu tandai konflik `resolved`.
 *  - `keep_server` → tidak menyentuh data server; versi server dipertahankan.
 *  - `merge`       → sama seperti keep_rig (tahap MVP: payload device diterima apa
 *                    adanya; catatan audit menyimpan payload server sebelumnya
 *                    untuk jejak) dan `resolution='merge'`.
 *
 * Semua keputusan WAJIB tercatat di `audit_log` (compliance 06-Blueprint §6).
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@rigdaily/database';
import { writeAudit } from '@/lib/repo';
import { ApiError } from '@/lib/api-response';
import type { SyncMutation } from '@rigdaily/shared';
import { applyMutation } from './engine';
import type { ConflictListItem, ConflictResolution } from './types';

const RESOLUTIONS: readonly ConflictResolution[] = ['keep_rig', 'keep_server', 'merge'] as const;

function isoOf(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Daftar konflik (default: semua status) untuk layar Sync Center. */
export async function listConflicts(status?: string): Promise<ConflictListItem[]> {
  const where = status && status !== 'all' ? eq(schema.syncConflicts.status, status) : undefined;

  const rows = await db
    .select()
    .from(schema.syncConflicts)
    .where(where)
    .orderBy(desc(schema.syncConflicts.createdAt))
    .limit(500);

  return rows.map((c) => ({
    id: c.id,
    deviceId: c.deviceId,
    entity: c.entity,
    entityServerId: c.entityServerId,
    entityLocalId: c.entityLocalId,
    clientMutationId: c.clientMutationId,
    rigPayload: (c.rigPayload ?? {}) as Record<string, unknown>,
    serverPayload: (c.serverPayload ?? {}) as Record<string, unknown>,
    reason: c.reason,
    status: c.status,
    resolution: c.resolution,
    resolvedBy: c.resolvedBy,
    resolvedAt: isoOf(c.resolvedAt),
    createdAt: isoOf(c.createdAt) ?? new Date(0).toISOString(),
  }));
}

function isConflictResolution(value: string): value is ConflictResolution {
  return (RESOLUTIONS as readonly string[]).includes(value);
}

/** Susun mutation yang bisa diterapkan ulang dari baris konflik. */
function mutationFromConflict(
  conflict: typeof schema.syncConflicts.$inferSelect,
): SyncMutation {
  // Payload device adalah objek JSON bebas; hash TIDAK diverifikasi ulang di sini
  // (resolusi manual = keputusan manusia, bukan replay protokol).
  return {
    clientMutationId: conflict.clientMutationId,
    deviceId: conflict.deviceId,
    entity: conflict.entity as SyncMutation['entity'],
    entityLocalId: conflict.entityLocalId ?? conflict.clientMutationId,
    entityServerId: conflict.entityServerId,
    // Konflik selalu muncul dari perubahan device (create/update), bukan dari delete
    // yang eksplisit - 'update' adalah op yang tepat untuk menerapkan ulang payload.
    op: 'update',
    updatedAt: new Date().toISOString(),
    hash: '',
    payload: (conflict.rigPayload ?? {}) as Record<string, unknown>,
    // Resolver memaksa penerapan; basis optimistic-lock sudah tidak relevan.
    baseServerUpdatedAt: null,
  };
}

/**
 * Selesaikan satu konflik.
 *
 * @throws ApiError 404 bila konflik tidak ada, 409 bila sudah pernah diselesaikan.
 */
export async function resolveConflict(
  id: string,
  resolution: string,
  actorId: string,
): Promise<void> {
  if (!isConflictResolution(resolution)) {
    throw new ApiError(400, 'INVALID_RESOLUTION', `Resolution harus salah satu dari: keep_rig, keep_server, merge.`);
  }

  const rows = await db.select().from(schema.syncConflicts).where(eq(schema.syncConflicts.id, id)).limit(1);
  const conflict = rows[0];

  if (!conflict) {
    throw new ApiError(404, 'CONFLICT_NOT_FOUND', `Konflik ${id} tidak ditemukan.`);
  }

  if (conflict.status !== 'open') {
    throw new ApiError(
      409,
      'CONFLICT_ALREADY_RESOLVED',
      `Konflik ${id} sudah berstatus "${conflict.status}" (resolution: ${conflict.resolution ?? '-'}).`,
    );
  }

  const now = new Date();

  if (resolution === 'keep_rig' || resolution === 'merge') {
    const mutation = mutationFromConflict(conflict);
    const applied = await applyMutation(mutation, { deviceId: conflict.deviceId, force: true });

    // Ledger idempotensi: mutation device yang tadinya `conflict` sekarang menjadi
    // `acked` agar device yang mengirim ulang tidak memicu konflik baru.
    if (!mutation.entityServerId || applied.serverId) {
      await db
        .update(schema.syncMutationLog)
        .set({ result: 'acked', entityServerId: applied.serverId, processedAt: now })
        .where(eq(schema.syncMutationLog.clientMutationId, conflict.clientMutationId));
    }
  }

  await db
    .update(schema.syncConflicts)
    .set({
      status: 'resolved',
      resolution,
      resolvedBy: actorId,
      resolvedAt: now,
    })
    .where(and(eq(schema.syncConflicts.id, id), eq(schema.syncConflicts.status, 'open')));

  await writeAudit({
    entity: 'sync_conflict',
    entityId: conflict.id,
    actorId,
    action: 'resolve',
    oldJson: {
      status: conflict.status,
      entity: conflict.entity,
      deviceId: conflict.deviceId,
      clientMutationId: conflict.clientMutationId,
      serverPayload: conflict.serverPayload,
    },
    newJson: {
      status: 'resolved',
      resolution,
      rigPayload: conflict.rigPayload,
      note:
        resolution === 'keep_server'
          ? 'Versi server dipertahankan; payload device diabaikan.'
          : resolution === 'merge'
            ? 'Payload device diterima apa adanya (merge); payload server sebelumnya disimpan di oldJson.'
            : 'Payload device diterapkan ke server.',
    },
  });
}

/** Hitung konflik `open` per device (untuk kartu status device). */
export async function openConflictCounts(deviceIds: string[]): Promise<Map<string, number>> {
  if (deviceIds.length === 0) return new Map();

  const rows = await db
    .select({ deviceId: schema.syncConflicts.deviceId })
    .from(schema.syncConflicts)
    .where(
      and(inArray(schema.syncConflicts.deviceId, deviceIds), eq(schema.syncConflicts.status, 'open')),
    );

  const out = new Map<string, number>();
  for (const r of rows) out.set(r.deviceId, (out.get(r.deviceId) ?? 0) + 1);
  return out;
}

/** Hitung mutation `conflict` yang belum selesai per device (pending). */
export async function pendingMutationCounts(deviceIds: string[]): Promise<Map<string, number>> {
  if (deviceIds.length === 0) return new Map();

  const rows = await db
    .select({ deviceId: schema.syncMutationLog.deviceId })
    .from(schema.syncMutationLog)
    .where(
      and(inArray(schema.syncMutationLog.deviceId, deviceIds), eq(schema.syncMutationLog.result, 'conflict')),
    );

  const out = new Map<string, number>();
  for (const r of rows) out.set(r.deviceId, (out.get(r.deviceId) ?? 0) + 1);
  return out;
}
