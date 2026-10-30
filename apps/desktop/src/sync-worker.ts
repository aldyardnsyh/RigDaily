/**
 * SYNC WORKER (sisi RIG) - outbox push + delta pull.
 *
 * Kontrak (docs/KONTRAK-FROZEN.md + 06-Blueprint §5):
 *   outbox → POST /api/sync/push → ack idempoten → konflik MANUAL → GET /api/sync/pull.
 *
 * Prinsip yang dipegang:
 *  1. TIDAK ADA auto-overwrite. Ack `conflict` hanya menandai baris outbox
 *     `conflict` - resolve dilakukan Company Man di Sync Center kantor.
 *  2. Pull TIDAK menimpa laporan lokal yang masih `dirty = 1`; kejadian itu
 *     dicatat sebagai konflik lokal (`localConflictCount`) dan laporan tetap milik rig.
 *  3. Semua network call dibungkus try/catch + `AbortSignal.timeout(20s)`. Offline
 *     adalah kondisi normal di rig, bukan error fatal: worker tidak pernah throw keluar.
 *  4. `payloadHash()` dihitung ulang dari payload SEBELUM kirim; server memverifikasi.
 */
import {
  SYNC_BATCH_SIZE,
  SYNC_POLL_INTERVAL_MS,
  backoffForRetry,
  payloadHash,
  syncIndicator,
} from '@rigdaily/shared';

import {
  applyPulledReport,
  applyPulledReportDelete,
  countOutbox,
  findLocalIdByServerId,
  getMeta,
  listPendingOutbox,
  markOutboxAcked,
  markOutboxRetry,
  markOutboxStatus,
  setMeta,
} from './db';
import type { LocalReport, LocalTimeRow, OutboxItem, SyncState } from './types';

const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_CURSOR = '1970-01-01T00:00:00Z';

type SyncWorkerOptions = {
  deviceId: string;
  serverUrl: string;
  apiKey: string | null;
  onState: (s: SyncState) => void;
};

/** Ack dari `zSyncPushAck`. */
type PushAck = {
  clientMutationId: string;
  status: 'acked' | 'conflict' | 'rejected';
  entityServerId?: string | null;
  serverUpdatedAt?: string | null;
  conflictReason?: string | null;
  serverPayload?: Record<string, unknown> | null;
};

type PushResponse = {
  deviceId: string;
  serverTime: string;
  acks: PushAck[];
};

type PullChange = {
  entity: string;
  entityServerId: string;
  entityLocalId?: string | null;
  op: 'upsert' | 'delete';
  updatedAt: string;
  payload: Record<string, unknown>;
};

type PullResponse = {
  serverTime: string;
  changes: PullChange[];
  hasMore: boolean;
};

/* ------------------------------------------------------------------ */
/* Utilitas parsial payload (payload dari server = unknown)             */
/* ------------------------------------------------------------------ */

function obj(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim().length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function boolOf(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

/** `date` server → `YYYY-MM-DD` (server bisa mengirim ISO timestamp penuh). */
function isoDate(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  const match = /^\d{4}-\d{2}-\d{2}/.exec(s);
  return match ? match[0] : null;
}

const REPORT_STATUSES = ['draft', 'submitted', 'approved', 'distributed', 'locked'] as const;
type ReportStatus = (typeof REPORT_STATUSES)[number];

function reportStatus(value: unknown): ReportStatus {
  return REPORT_STATUSES.find((s) => s === value) ?? 'draft';
}

/** Waktu lokal yang bisa dipakai sebagai `updatedAt` lokal (ISO). */
function isoOrNow(value: unknown): string {
  const s = str(value);
  if (!s) return new Date().toISOString();
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** UUID v4 cukup untuk `time_rows.local_id` (PK lokal). */
function localRowId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  const uuid = g.crypto?.randomUUID?.();
  if (uuid) return uuid;
  // Fallback deterministik-ish (hanya dipakai bila crypto tidak tersedia).
  return `row-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.name === 'TimeoutError' ? 'Request timeout (20s)' : err.message;
  return String(err);
}

/* ------------------------------------------------------------------ */
/* Worker                                                              */
/* ------------------------------------------------------------------ */

export class SyncWorker {
  private readonly deviceId: string;
  private serverUrl: string;
  private readonly apiKey: string | null;
  private readonly onState: (s: SyncState) => void;

  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Timer retry tercepat yang dijadwalkan setelah kegagalan (backoff). */
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private inFlight: Promise<SyncState> | null = null;
  private stopped = true;

  private online = true;
  private lastSyncAt: string | null = null;
  private lastError: string | null = null;
  private localConflictCount = 0;
  private runCount = 0;

  constructor(opts: SyncWorkerOptions) {
    this.deviceId = opts.deviceId;
    this.serverUrl = trimSlash(opts.serverUrl);
    this.apiKey = opts.apiKey;
    this.onState = opts.onState;
  }

  /** Ganti server target saat runtime (dipakai menu "Ganti Server"). */
  setServerUrl(url: string): void {
    this.serverUrl = trimSlash(url);
    this.online = true;
    this.lastError = null;
  }

  /** Mulai polling: interval `SYNC_POLL_INTERVAL_MS` + satu siklus segera. */
  start(): void {    if (this.running) return;
    this.running = true;
    this.stopped = false;
    void this.runOnce();
    this.scheduleNext(SYNC_POLL_INTERVAL_MS);
  }

  stop(): void {
    this.running = false;
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /** State terkini (dihitung dari outbox + hasil siklus terakhir). */
  getState(): SyncState {
    const counts = this.safeCount();
    const failed = counts.failed;
    const indicator = syncIndicator({
      pending: counts.pending,
      failed,
      online: this.online,
      lastError: this.lastError,
    });
    return {
      online: this.online,
      pending: counts.pending,
      failed,
      conflicts: counts.conflict + this.localConflictCount,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
      indicator,
    };
  }

  /**
   * Satu siklus penuh: push → ack → pull → simpan kursor.
   * Tidak pernah throw; semua kegagalan menjadi `lastError` + status `pending`/`dead_letter`.
   */
  async runOnce(): Promise<SyncState> {
    // Hindari siklus ganda (interval + tombol "Sync Now" bersamaan).
    if (this.inFlight) return this.inFlight;

    const task = this.cycle();
    this.inFlight = task;
    try {
      return await task;
    } finally {
      this.inFlight = null;
    }
  }

  private async cycle(): Promise<SyncState> {
    this.runCount += 1;
    this.localConflictCount = 0;
    let earliestRetryMs: number | null = null;
    let reachedServer = false;

    // Kontrak: cycle TIDAK PERNAH throw. DB belum siap, disk penuh, atau bug
    // internal semuanya menjadi lastError + emit state, bukan crash main process.
    // (Sebelumnya listPendingOutbox() melempar saat DB belum init dan
    // menjatuhkan aplikasi ke unhandledRejection.)
    try {
      const batch = listPendingOutbox(SYNC_BATCH_SIZE);

      if (batch.length > 0) {
        const result = await this.push(batch);
        if (result.ok) {
          this.applyAcks(batch, result.response.acks);
          reachedServer = true;
        } else {
          this.online = false;
          this.lastError = result.error;
          for (const item of batch) {
            markOutboxRetry(item.id, result.error);
            // Retry tercepat menentukan kapan siklus berikutnya dijalankan.
            const delay = backoffForRetry(item.retryCount + 1);
            earliestRetryMs = earliestRetryMs === null ? delay : Math.min(earliestRetryMs, delay);
          }
        }
      }

      // Pull tetap dicoba walau push gagal (hanya baca - data kantor bisa bertambah).
      const pull = await this.pull();
      if (pull.ok) {
        reachedServer = true;
      } else {
        this.online = false;
        this.lastError = pull.error;
      }

      if (reachedServer) {
        this.online = true;
        this.lastError = null;
        this.lastSyncAt = new Date().toISOString();
      }
    } catch (err) {
      // Jaring pengaman: worker tidak boleh menggagalkan proses main.
      this.online = false;
      this.lastError = errorMessage(err);
    }

    // getState()/emit() juga tidak boleh melempar: bila perhitungan state
    // sendiri gagal (mis. bug di formatter), kirim state darurat.
    let state: SyncState;
    try {
      state = this.getState();
    } catch (err) {
      console.error('[sync] getState gagal, memakai state darurat:', err);
      state = {
        online: false,
        pending: 0,
        failed: 0,
        conflicts: 0,
        lastSyncAt: this.lastSyncAt,
        lastError: errorMessage(err),
        indicator: 'red' as const,
      };
    }
    this.emit(state);

    // Sinyal ditangkap lagi: jadwalkan retry lebih cepat dari interval normal.
    if (this.running && earliestRetryMs !== null) {
      this.scheduleRetry(earliestRetryMs);
    }

    return state;
  }

  /* ---------------- PUSH ---------------- */

  private async push(batch: OutboxItem[]): Promise<{ ok: true; response: PushResponse } | { ok: false; error: string }> {
    const mutations = batch.map((item) => {
      const parsed = parsePayload(item.payloadJson);
      return {
        clientMutationId: item.clientMutationId,
        deviceId: this.deviceId,
        entity: item.entity,
        entityLocalId: item.entityLocalId,
        entityServerId: item.entityServerId,
        op: item.op,
        updatedAt: item.createdAt,
        // Hash DIHITUNG ULANG dari payload (bukan sekadar salinan kolom) agar
        // server bisa mendeteksi drift secara independen.
        hash: payloadHash(parsed),
        payload: parsed,
        baseServerUpdatedAt: item.baseServerUpdatedAt,
      };
    });

    const body = { deviceId: this.deviceId, mutations };

    try {
      const res = await fetch(`${this.serverUrl}/api/sync/push`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) {
        const detail = await safeText(res);
        return { ok: false, error: `push HTTP ${res.status}${detail ? ` - ${detail}` : ''}` };
      }

      const parsed = readEnvelope(await res.json());
      const response = parsePushResponse(parsed);
      if (!response) return { ok: false, error: 'push: respons server tidak sesuai kontrak' };
      return { ok: true, response };
    } catch (err) {
      return { ok: false, error: `push gagal: ${errorMessage(err)}` };
    }
  }

  private applyAcks(batch: OutboxItem[], acks: PushAck[]): void {
    const byMutation = new Map<string, PushAck>();
    for (const ack of acks) byMutation.set(ack.clientMutationId, ack);

    for (const item of batch) {
      const ack = byMutation.get(item.clientMutationId);

      if (!ack) {
        // Server tidak menyebut mutation ini - anggap belum diproses, retry nanti.
        markOutboxRetry(item.id, 'ACK_MISSING');
        continue;
      }

      switch (ack.status) {
        case 'acked':
          markOutboxAcked(item.id, ack.entityServerId ?? null);
          break;
        case 'conflict':
          // Manual resolve di Sync Center - JANGAN auto-overwrite.
          markOutboxStatus(item.id, 'conflict', ack.conflictReason ?? 'SYNC_CONFLICT');
          break;
        case 'rejected':
          markOutboxStatus(item.id, 'dead_letter', ack.conflictReason ?? 'REJECTED');
          break;
      }
    }
  }

  /* ---------------- PULL ---------------- */

  private async pull(): Promise<{ ok: true } | { ok: false; error: string }> {
    const since = getMeta('lastPulledAt') ?? DEFAULT_CURSOR;
    const url = `${this.serverUrl}/api/sync/pull?deviceId=${encodeURIComponent(this.deviceId)}&since=${encodeURIComponent(since)}`;

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: this.headers(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) {
        const detail = await safeText(res);
        return { ok: false, error: `pull HTTP ${res.status}${detail ? ` - ${detail}` : ''}` };
      }

      const parsed = readEnvelope(await res.json());
      const response = parsePullResponse(parsed);
      if (!response) return { ok: false, error: 'pull: respons server tidak sesuai kontrak' };

      for (const change of response.changes) {
        try {
          this.applyChange(change);
        } catch (err) {
          console.warn('[sync] gagal menerapkan perubahan pull:', change.entity, change.entityServerId, err);
          this.localConflictCount += 1;
        }
      }

      setMeta('lastPulledAt', response.serverTime);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `pull gagal: ${errorMessage(err)}` };
    }
  }

  private applyChange(change: PullChange): void {
    if (change.entity === 'daily_reports') {
      const report = reportFromPayload(change);
      if (!report) return;

      if (change.op === 'delete') {
        const res = applyPulledReportDelete(report.localId);
        if (res.skippedDirty) this.localConflictCount += 1;
        return;
      }

      // Server bisa menyertakan grid waktu di payload report; kalau tidak ada,
      // grid lokal dibiarkan apa adanya (argumen `undefined`).
      const grid = Array.isArray(change.payload.timeRows) ? parseTimeRows(change.payload) : undefined;
      const res = applyPulledReport(report, grid);
      if (res.skippedDirty) {
        // Rig punya edit lokal yang belum terkirim: versi rig dipertahankan.
        this.localConflictCount += 1;
      }
      return;
    }

    // Entity lain (time_breakdown terpisah, wells, rigs, cost_lines, crew_members)
    // belum disimpan lokal di versi ini - diabaikan dengan sengaja, bukan error.
  }

  /* ---------------- jadwal & pembantu ---------------- */

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.runOnce().finally(() => this.scheduleNext(SYNC_POLL_INTERVAL_MS));
    }, delayMs);
    // Jangan menahan proses tetap hidup hanya karena timer sync.
    unrefTimer(this.timer);
  }

  private scheduleRetry(delayMs: number): void {
    if (!this.running || this.stopped) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.runOnce();
    }, delayMs);
    unrefTimer(this.retryTimer);
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-device-id': this.deviceId,
    };
    if (this.apiKey) {
      // Server (apps/web/app/api/sync/push) membaca `x-device-key`; `Authorization`
      // dikirim juga agar kompatibel dengan deployment yang memakai gateway.
      headers['x-device-key'] = this.apiKey;
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private safeCount(): { pending: number; failed: number; conflict: number } {
    try {
      const c = countOutbox();
      return { pending: c.pending, failed: c.failed, conflict: c.conflict };
    } catch (err) {
      console.warn('[sync] gagal menghitung outbox:', err);
      return { pending: 0, failed: 0, conflict: 0 };
    }
  }

  private emit(state: SyncState): void {
    try {
      this.onState(state);
    } catch (err) {
      console.warn('[sync] onState handler gagal:', err);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Fungsi murni pembantu                                               */
/* ------------------------------------------------------------------ */

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  const t = timer as unknown as { unref?: () => void };
  t.unref?.();
}

function parsePayload(json: string): Record<string, unknown> {
  try {
    return obj(JSON.parse(json)) ?? {};
  } catch {
    return {};
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '';
  }
}

/**
 * Unwrap envelope `{ data: T }` (apps/web `ok()`), tapi terima juga respons polos
 * (beberapa proxy/gateway mengembalikan body apa adanya).
 */
function readEnvelope(json: unknown): unknown {
  const asObj = obj(json);
  if (asObj && 'data' in asObj) return asObj.data;
  return json;
}

function parsePushResponse(raw: unknown): PushResponse | null {
  const o = obj(raw);
  if (!o) return null;
  const acksRaw = Array.isArray(o.acks) ? o.acks : null;
  if (!acksRaw) return null;

  const acks: PushAck[] = [];
  for (const item of acksRaw) {
    const a = obj(item);
    if (!a) continue;
    const clientMutationId = str(a.clientMutationId);
    const status = a.status === 'acked' || a.status === 'conflict' || a.status === 'rejected' ? a.status : null;
    if (!clientMutationId || !status) continue;
    acks.push({
      clientMutationId,
      status,
      entityServerId: str(a.entityServerId),
      serverUpdatedAt: str(a.serverUpdatedAt),
      conflictReason: str(a.conflictReason),
      serverPayload: obj(a.serverPayload),
    });
  }

  return {
    deviceId: str(o.deviceId) ?? '',
    serverTime: str(o.serverTime) ?? new Date().toISOString(),
    acks,
  };
}

function parsePullResponse(raw: unknown): PullResponse | null {
  const o = obj(raw);
  if (!o) return null;
  const changesRaw = Array.isArray(o.changes) ? o.changes : null;
  if (!changesRaw) return null;

  const changes: PullChange[] = [];
  for (const item of changesRaw) {
    const c = obj(item);
    if (!c) continue;
    const entity = str(c.entity);
    const entityServerId = str(c.entityServerId);
    const op = c.op === 'upsert' || c.op === 'delete' ? c.op : null;
    if (!entity || !entityServerId || !op) continue;
    changes.push({
      entity,
      entityServerId,
      entityLocalId: str(c.entityLocalId),
      op,
      updatedAt: str(c.updatedAt) ?? new Date().toISOString(),
      payload: obj(c.payload) ?? {},
    });
  }

  return {
    serverTime: str(o.serverTime) ?? new Date().toISOString(),
    changes,
    hasMore: o.hasMore === true,
  };
}

/**
 * Payload `daily_reports` dari server (`reportRowToObject`) → `LocalReport`.
 * `localId` = `entityLocalId` server (server selalu memakai UUID report sebagai
 * local id device), fallback ke `entityServerId`.
 */
export function reportFromPayload(change: PullChange): LocalReport | null {
  const p = change.payload;
  const reportDate = isoDate(p.reportDate);
  // server memakai UUID report sebagai entityLocalId device; fallback ke baris lokal
  // yang sudah mencatat serverId ini, lalu ke serverId itu sendiri.
  const localId = change.entityLocalId ?? findLocalIdByServerId(change.entityServerId) ?? change.entityServerId;
  const wellId = str(p.wellId);

  // wellId & reportDate wajib ada agar baris lokal valid (NOT NULL di SQLite).
  if (!wellId || !reportDate) return null;

  return {
    localId,
    serverId: change.entityServerId,
    wellId,
    wellName: str(p.wellName) ?? '',
    rigId: str(p.rigId),
    reportDate,
    reportNo: num(p.reportNo) ?? 0,
    depthMdStart: num(p.depthMdStart) ?? 0,
    depthMdEnd: num(p.depthMdEnd) ?? 0,
    summary: str(p.summary),
    planNext: str(p.planNext),
    status: reportStatus(p.status),
    totalMinutes: num(p.totalMinutes) ?? 0,
    nptMinutes: num(p.nptMinutes) ?? 0,
    wowMinutes: num(p.wowMinutes) ?? 0,
    productiveMinutes: num(p.productiveMinutes) ?? 0,
    updatedAt: isoOrNow(p.updatedAt ?? change.updatedAt),
    dirty: false,
  };
}

/**
 * Grid waktu dalam payload report (bila server menyertakannya).
 * `localId` baris = id baris dari server supaya pull berulang tidak menduplikasi.
 */
export function parseTimeRows(payload: Record<string, unknown>): LocalTimeRow[] {
  const raw = Array.isArray(payload.timeRows) ? payload.timeRows : [];
  const rows: LocalTimeRow[] = [];
  raw.forEach((item, index) => {
    const r = obj(item);
    if (!r) return;
    const start = str(r.start);
    const end = str(r.end);
    if (!start || !end) return;
    rows.push({
      localId: str(r.id) ?? localRowId(),
      reportLocalId: '',
      sortOrder: num(r.sortOrder) ?? index,
      start,
      end,
      durationMin: num(r.durationMin) ?? 0,
      iadcCode: str(r.iadcCode) ?? '01',
      iadcSubcode: str(r.iadcSubcode),
      vendor: str(r.vendor),
      nptFlag: boolOf(r.nptFlag),
      timeClass: str(r.timeClass) ?? 'PRD',
      remarks: str(r.remarks),
    });
  });
  return rows;
}

