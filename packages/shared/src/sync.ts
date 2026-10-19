/**
 * SYNC ENGINE PRIMITIVES - FROZEN CONTRACT.
 * Dipakai oleh Electron (rig) dan API (kantor). Lihat 06-Blueprint §5.
 *
 * Pola: Outbox + delta + idempotent ack + conflict manual (TIDAK ADA auto-overwrite
 * untuk laporan Approved/Locked).
 */

export type SyncOp = 'create' | 'update' | 'delete';
export type SyncEntity =
  | 'daily_report'
  | 'time_breakdown'
  | 'cost_line'
  | 'crew'
  | 'mud'
  | 'safety_incident'
  | 'well'
  | 'rig';

export type OutboxStatus = 'pending' | 'sent' | 'acked' | 'conflict' | 'failed' | 'dead_letter';

export type OutboxRow = {
  id: number;
  clientMutationId: string;
  deviceId: string;
  entity: SyncEntity;
  entityLocalId: string;
  entityServerId: string | null;
  op: SyncOp;
  payloadJson: string;
  hash: string;
  baseServerUpdatedAt: string | null;
  status: OutboxStatus;
  retryCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Backoff exponential: 5s, 15s, 45s, 135s, 405s (cap 10 menit). */
export const SYNC_BACKOFF_MS = [5_000, 15_000, 45_000, 135_000, 405_000] as const;
export const SYNC_MAX_RETRY = 5;
export const SYNC_BATCH_SIZE = 100;
export const SYNC_POLL_INTERVAL_MS = 60_000;

export function backoffForRetry(retryCount: number): number {
  const safe = Number.isFinite(retryCount) ? Math.max(0, Math.floor(retryCount)) : 0;
  const idx = Math.min(safe, SYNC_BACKOFF_MS.length - 1);
  return SYNC_BACKOFF_MS[idx];
}

/**
 * Entitas yang boleh di-sync dari rig.
 * DDR berstatus approved/locked TIDAK boleh ditimpa - harus lewat amendment.
 */
export const SYNC_LOCKED_STATUSES = ['approved', 'distributed', 'locked'] as const;

export function isSyncLocked(status: string): boolean {
  return (SYNC_LOCKED_STATUSES as readonly string[]).includes(status);
}

/** Indikator 3 warna di UI rig. */
export type SyncIndicator = 'green' | 'amber' | 'red';

export function syncIndicator(input: { pending: number; failed: number; online: boolean; lastError?: string | null }): SyncIndicator {
  if (input.failed > 0 || input.lastError) return 'red';
  if (!input.online || input.pending > 0) return 'amber';
  return 'green';
}

export function syncIndicatorLabel(ind: SyncIndicator, pending: number): string {
  switch (ind) {
    case 'green':
      return 'Synced';
    case 'amber':
      return pending > 0 ? `Pending ${pending}` : 'Offline - saving locally';
    case 'red':
      return 'Sync error - check Sync Center';
  }
}

/**
 * Stable stringify: kunci diurutkan rekursif agar hash konsisten antar device.
 * WAJIB dipakai sebelum hashing payload.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/**
 * Hash payload kanonik. Implementasi FNV-1a 64-bit hex (cukup untuk deteksi drift,
 * bukan security). Electron & Node sama-sama bisa jalankan tanpa dependency native.
 */
export function payloadHash(payload: unknown): string {
  const str = stableStringify(payload);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < str.length; i += 1) {
    const c = str.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (h2 + c) >>> 0;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  const hex = (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  return `${hex}${hex}`.slice(0, 32);
}

/** Apakah konflik perlu resolver manual (server lebih baru & terkunci). */
export function requiresManualResolve(input: {
  serverStatus: string;
  serverUpdatedAt: string;
  baseServerUpdatedAt?: string | null;
}): boolean {
  if (!isSyncLocked(input.serverStatus)) return false;
  if (!input.baseServerUpdatedAt) return true;
  return new Date(input.serverUpdatedAt).getTime() > new Date(input.baseServerUpdatedAt).getTime();
}
