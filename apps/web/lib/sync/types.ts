/**
 * Tipe sync engine (server web).
 *
 * Semua tipe protokol berasal dari `@rigdaily/shared` (FROZEN) - file ini hanya
 * menambah tipe internal yang dipakai route handler & resolver konflik.
 */
import type { SyncPullResponse, SyncPushAck, SyncPushResponse } from '@rigdaily/shared';

/** Hasil `handlePush` - sama persis dengan kontrak respons. */
export type PushResult = { acks: SyncPushAck[] };

/** Hasil `handlePull` - sama persis dengan kontrak respons. */
export type PullResult = SyncPullResponse;

/** Baris konflik yang dikirim ke Sync Center (DTO, bukan row DB). */
export type ConflictListItem = {
  id: string;
  deviceId: string;
  entity: string;
  entityServerId: string | null;
  entityLocalId: string | null;
  clientMutationId: string;
  rigPayload: Record<string, unknown>;
  serverPayload: Record<string, unknown>;
  reason: string;
  status: string;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

/** Keputusan resolver (validasi di route memakai zod, ini tipe semantiknya). */
export type ConflictResolution = 'keep_rig' | 'keep_server' | 'merge';

/** Device + hitungan antrian konflik untuk dashboard Sync Center. */
export type SyncDeviceStatus = {
  id: string;
  deviceId: string;
  name: string;
  kind: string;
  rigId: string | null;
  lastSeenAt: string | null;
  lastPulledAt: string | null;
  pendingCount: number;
  active: boolean;
  openConflicts: number;
  pendingMutations: number;
};

export type { SyncPushResponse, SyncPullResponse, SyncPushAck };
