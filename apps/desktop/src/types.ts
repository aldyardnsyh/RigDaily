/**
 * TIPE LOKAL DESKTOP (rig, offline-first).
 *
 * Tipe protokol sync (`SyncMutation`, `SyncPushResponse`, ...) TIDAK didefinisikan
 * di sini - ambil dari `@rigdaily/shared` (FROZEN). File ini hanya memuat bentuk
 * baris SQLite lokal, state worker, dan surface API preload.
 */

export type LocalReportStatus = 'draft' | 'submitted' | 'approved' | 'distributed' | 'locked';

/** Baris `reports` di SQLite lokal (nama field camelCase, kolom snake_case). */
export type LocalReport = {
  localId: string;
  serverId: string | null;
  wellId: string;
  wellName: string;
  rigId: string | null;
  reportDate: string;
  reportNo: number;
  depthMdStart: number;
  depthMdEnd: number;
  summary: string | null;
  planNext: string | null;
  status: LocalReportStatus;
  totalMinutes: number;
  nptMinutes: number;
  wowMinutes: number;
  productiveMinutes: number;
  updatedAt: string;
  dirty: boolean;
};

/** Baris `time_rows` di SQLite lokal. `start`/`end` format "HH:MM". */
export type LocalTimeRow = {
  localId: string;
  reportLocalId: string;
  sortOrder: number;
  start: string;
  end: string;
  durationMin: number;
  iadcCode: string;
  iadcSubcode: string | null;
  vendor: string | null;
  nptFlag: boolean;
  timeClass: string;
  remarks: string | null;
};

export type OutboxItem = {
  id: number;
  clientMutationId: string;
  entity: string;
  entityLocalId: string;
  entityServerId: string | null;
  op: 'create' | 'update' | 'delete';
  payloadJson: string;
  hash: string;
  baseServerUpdatedAt: string | null;
  status: 'pending' | 'sent' | 'acked' | 'conflict' | 'failed' | 'dead_letter';
  retryCount: number;
  lastError: string | null;
  createdAt: string;
};

export type SyncState = {
  online: boolean;
  pending: number;
  failed: number;
  conflicts: number;
  lastSyncAt: string | null;
  lastError: string | null;
  indicator: 'green' | 'amber' | 'red';
};

export type DeviceConfig = {
  deviceId: string;
  deviceName: string;
  serverUrl: string;
  apiKey: string | null;
  rigId: string | null;
};

/** Hasil `db:reports:get` - header + baris time breakdown. */
export type LocalReportDetail = {
  report: LocalReport | null;
  timeRows: LocalTimeRow[];
};

/** Hasil `db:reports:save` - apa yang benar-benar ditulis ke outbox. */
export type SaveReportResult = {
  report: LocalReport;
  timeRows: LocalTimeRow[];
  /** `create` bila report belum pernah ada / belum punya serverId, `update` bila sudah. */
  op: 'create' | 'update';
  /** `clientMutationId` untuk entitas `time_breakdown` (bisa null bila tidak ada baris). */
  timeMutationId: string | null;
};

export type DeleteReportResult = {
  localId: string;
  deleted: boolean;
  op: 'delete' | 'none';
  clientMutationId: string | null;
};

export type OutboxCount = {
  pending: number;
  sent: number;
  acked: number;
  conflict: number;
  failed: number;
  deadLetter: number;
  total: number;
};

export type AppInfo = {
  version: string;
  deviceId: string;
  dbPath: string;
  userData: string;
};

export type BackupExportResult = {
  /** `null` bila pengguna membatalkan dialog simpan. */
  path: string | null;
  bytes: number;
};

export type BackupImportResult = {
  restoredReports: number;
  restoredTimeRows: number;
  restoredOutbox: number;
  exportedAt: string;
  deviceId: string;
};

/** Payload `config:set` (parsial). */
export type DeviceConfigPatch = Partial<DeviceConfig>;

/**
 * Surface API yang diekspos `preload.ts` ke renderer sebagai `window.rigdaily`.
 * Renderer TIDAK punya akses Node (contextIsolation + sandbox).
 */
export type RigDailyApi = {
  reports: {
    list: () => Promise<LocalReport[]>;
    get: (localId: string) => Promise<LocalReportDetail>;
    save: (input: { report: LocalReport; timeRows: LocalTimeRow[] }) => Promise<SaveReportResult>;
    remove: (localId: string) => Promise<DeleteReportResult>;
  };
  outbox: {
    pending: (limit?: number) => Promise<OutboxItem[]>;
    stats: () => Promise<OutboxCount>;
  };
  sync: {
    run: () => Promise<SyncState>;
    state: () => Promise<SyncState>;
    /** Langganan state; mengembalikan fungsi unsubscribe. */
    onState: (handler: (state: SyncState) => void) => () => void;
  };
  config: {
    get: () => Promise<DeviceConfig>;
    set: (patch: DeviceConfigPatch) => Promise<DeviceConfig>;
  };
  backup: {
    export: () => Promise<BackupExportResult>;
    import: () => Promise<BackupImportResult | null>;
  };
  app: {
    info: () => Promise<AppInfo>;
  };
};
