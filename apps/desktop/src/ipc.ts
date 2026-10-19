/**
 * IPC HANDLERS - satu-satunya jembatan renderer → DB/sync.
 *
 * Keamanan:
 *  - Setiap argumen divalidasi zod sebelum menyentuh SQLite (`zHm`, `zIsoDate`,
 *    `zReportStatus` dari @rigdaily/shared agar aturan sama dengan server).
 *  - Renderer tidak punya Node (`contextIsolation: true`, `nodeIntegration: false`),
 *    jadi semua operasi file/dialog dilakukan di sini pada proses main.
 *  - Handler dibungkus: error dikembalikan sebagai `Error` bersih (bukan stack
 *    internal penuh) tapi tetap di-log ke konsol main untuk diagnosis.
 */
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';

import { zHm, zIsoDate, zReportStatus } from '@rigdaily/shared';

import {
  countOutbox,
  deleteReportTransaction,
  getDbPath,
  getLocalReport,
  getLocalTimeRows,
  listLocalReports,
  listOutboxByStatus,
  listPendingOutbox,
  saveReportLocal,
} from './db';
import { loadConfig, saveConfig } from './config';
import {
  BACKUP_EXTENSION,
  defaultBackupFileName,
  exportBackupZip,
  importBackupBundle,
  maybeDailyBackup,
} from './backup';
import type {
  AppInfo,
  BackupExportResult,
  BackupImportResult,
  DeleteReportResult,
  DeviceConfig,
  LocalReport,
  LocalReportDetail,
  LocalTimeRow,
  OutboxCount,
  OutboxItem,
  RigDailyApi,
  SaveReportResult,
  SyncState,
} from './types';

/* ------------------------------------------------------------------ */
/* Kontrak konteks                                                     */
/* ------------------------------------------------------------------ */

/** Subset API SyncWorker yang dipakai IPC (memudahkan test/fake). */
export type IpcSyncWorker = {
  runOnce: () => Promise<SyncState>;
  getState: () => SyncState;
  start: () => void;
  stop: () => void;
};

export type IpcContext = {
  getWindow: () => BrowserWindow | null;
  syncWorker: IpcSyncWorker;
};

/* ------------------------------------------------------------------ */
/* Schema validasi                                                     */
/* ------------------------------------------------------------------ */

const zUuid = z.string().uuid();
const zLocalReportStatus = zReportStatus;

const zLocalReport = z.object({
  // localId = UUID buatan device (boleh juga id server saat hasil pull).
  localId: zUuid,
  serverId: zUuid.nullable(),
  wellId: zUuid,
  wellName: z.string().max(200),
  rigId: zUuid.nullable(),
  reportDate: zIsoDate,
  reportNo: z.number().int().nonnegative(),
  depthMdStart: z.number().min(0).max(15000),
  depthMdEnd: z.number().min(0).max(15000),
  summary: z.string().max(8000).nullable(),
  planNext: z.string().max(4000).nullable(),
  status: zLocalReportStatus,
  totalMinutes: z.number().int().nonnegative(),
  nptMinutes: z.number().int().nonnegative(),
  wowMinutes: z.number().int().nonnegative(),
  productiveMinutes: z.number().int().nonnegative(),
  updatedAt: z.string().min(1),
  dirty: z.boolean(),
});

const zLocalTimeRow = z.object({
  localId: zUuid,
  reportLocalId: zUuid,
  sortOrder: z.number().int().nonnegative(),
  start: zHm,
  end: zHm,
  durationMin: z.number().int().nonnegative(),
  iadcCode: z.string().min(1).max(4),
  iadcSubcode: z.string().max(160).nullable(),
  vendor: z.string().max(160).nullable(),
  nptFlag: z.boolean(),
  timeClass: z.string().min(1).max(8),
  remarks: z.string().max(2000).nullable(),
});

const zLocalIdArg = z.object({ localId: zUuid });
const zSaveArg = z.object({
  report: zLocalReport,
  timeRows: z.array(zLocalTimeRow).max(200),
});
const zLimitArg = z.number().int().positive().max(500).optional();

const zConfigPatch = z
  .object({
    deviceId: z.string().min(1).max(80).optional(),
    deviceName: z.string().min(1).max(120).optional(),
    serverUrl: z.string().url().optional(),
    apiKey: z.string().max(400).nullable().optional(),
    rigId: z.string().uuid().nullable().optional(),
  })
  .strict();

/* ------------------------------------------------------------------ */
/* Helper pembungkus                                                   */
/* ------------------------------------------------------------------ */

function fail(channel: string, err: unknown): never {
  console.error(`[ipc] ${channel} gagal:`, err);
  if (err instanceof Error) throw new Error(err.message);
  throw new Error(typeof err === 'string' ? err : 'Terjadi kesalahan internal.');
}

/** Daftarkan handler dengan validasi argumen + logging seragam. */
function handle<A, R>(channel: string, schema: z.ZodType<A>, fn: (arg: A, event: IpcMainInvokeEvent) => R): void {
  ipcMain.handle(channel, (event, raw: unknown) => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
      console.warn(`[ipc] ${channel} argumen tidak valid - ${detail}`);
      throw new Error(`Argumen ${channel} tidak valid: ${detail}`);
    }
    try {
      return fn(parsed.data, event);
    } catch (err) {
      return fail(channel, err);
    }
  });
}

/** Handler tanpa argumen (read-only) - menerima argumen apa pun lalu diabaikan. */
function handleVoid<R>(channel: string, fn: () => R): void {
  ipcMain.handle(channel, () => {
    try {
      return fn();
    } catch (err) {
      return fail(channel, err);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Registrasi                                                          */
/* ------------------------------------------------------------------ */

export function registerIpcHandlers(ctx: IpcContext): void {
  const { getWindow, syncWorker } = ctx;

  /* ---------------- DDR lokal ---------------- */

  handleVoid<LocalReport[]>('db:reports:list', () => listLocalReports());

  handle<{ localId: string }, LocalReportDetail>('db:reports:get', zLocalIdArg, ({ localId }) => {
    const report = getLocalReport(localId);
    return { report, timeRows: report ? getLocalTimeRows(localId) : [] };
  });

  handle<z.infer<typeof zSaveArg>, SaveReportResult>('db:reports:save', zSaveArg, (input) => {
    const config = loadConfig();
    // Simpan data + enqueue outbox dalam SATU transaksi SQLite (lihat db.ts).
    const saved = saveReportLocal({
      report: input.report,
      timeRows: input.timeRows as LocalTimeRow[],
      deviceId: config.deviceId,
    });
    return {
      report: saved.report,
      timeRows: saved.timeRows,
      op: saved.op,
      timeMutationId: saved.timeMutationId,
    };
  });

  handle<{ localId: string }, DeleteReportResult>('db:reports:delete', zLocalIdArg, ({ localId }) => {
    const config = loadConfig();
    const res = deleteReportTransaction(localId, config.deviceId);
    return { localId, ...res };
  });

  /* ---------------- Outbox ---------------- */

  ipcMain.handle('outbox:pending', (_event, raw: unknown) => {
    try {
      const parsed = zLimitArg.safeParse(raw);
      return listPendingOutbox(parsed.success ? (parsed.data ?? 100) : 100);
    } catch (err) {
      return fail('outbox:pending', err);
    }
  });

  handleVoid<OutboxCount>('outbox:stats', () => countOutbox());

  /** Tambahan diagnostik: item yang konflik / dead letter (untuk layar Sync Center lokal). */
  handleVoid<OutboxItem[]>('outbox:problems', () => [
    ...listOutboxByStatus('conflict'),
    ...listOutboxByStatus('dead_letter'),
  ]);

  /* ---------------- Sync ---------------- */

  ipcMain.handle('sync:run', async () => {
    try {
      return await syncWorker.runOnce();
    } catch (err) {
      return fail('sync:run', err);
    }
  });

  handleVoid<SyncState>('sync:state', () => syncWorker.getState());

  /* ---------------- Config ---------------- */

  handleVoid<DeviceConfig>('config:get', () => loadConfig());

  handle<z.infer<typeof zConfigPatch>, DeviceConfig>('config:set', zConfigPatch, (patch) => {
    const next = saveConfig(patch);
    // URL/key baru berlaku pada siklus berikutnya; state dipancarkan ulang.
    getWindow()?.webContents.send('sync:state', syncWorker.getState());
    return next;
  });

  /* ---------------- Backup bundle ---------------- */

  ipcMain.handle('backup:export', async (): Promise<BackupExportResult> => {
    try {
      const config = loadConfig();
      const win = getWindow();
      const result = win
        ? await dialog.showSaveDialog(win, {
            title: 'Export backup bundle RigDaily',
            defaultPath: join(app.getPath('documents'), defaultBackupFileName()),
            filters: [{ name: 'RigDaily backup bundle', extensions: ['json.gz', 'gz'] }],
          })
        : await dialog.showSaveDialog({
            title: 'Export backup bundle RigDaily',
            defaultPath: join(app.getPath('documents'), defaultBackupFileName()),
            filters: [{ name: 'RigDaily backup bundle', extensions: ['json.gz', 'gz'] }],
          });
      if (result.canceled || !result.filePath) return { path: null, bytes: 0 };

      const written = exportBackupZip(result.filePath, config);
      return written;
    } catch (err) {
      return fail('backup:export', err);
    }
  });

  ipcMain.handle('backup:import', async (): Promise<BackupImportResult | null> => {
    try {
      const win = getWindow();
      const result = win
        ? await dialog.showOpenDialog(win, {
            title: 'Import backup bundle RigDaily',
            properties: ['openFile'],
            filters: [{ name: 'RigDaily backup bundle', extensions: ['gz', 'json', 'rigdaily-backup'] }],
          })
        : await dialog.showOpenDialog({
            title: 'Import backup bundle RigDaily',
            properties: ['openFile'],
            filters: [{ name: 'RigDaily backup bundle', extensions: ['gz', 'json', 'rigdaily-backup'] }],
          });
      const path = result.filePaths[0];
      if (result.canceled || !path) return null;

      const imported = importBackupBundle(path);
      const winAfter = getWindow();
      if (winAfter) {
        await dialog.showMessageBox(winAfter, {
          type: 'info',
          title: 'Restore selesai',
          message: 'Backup bundle berhasil dipulihkan.',
          detail: `Laporan: ${imported.restoredReports}, baris waktu: ${imported.restoredTimeRows}, outbox: ${imported.restoredOutbox}.\nBundle dibuat: ${imported.exportedAt}`,
        });
        winAfter.webContents.send('sync:state', syncWorker.getState());
      }
      return imported;
    } catch (err) {
      return fail('backup:import', err);
    }
  });

  /** Backup harian manual dari menu (tulis ke userData/backups tanpa dialog). */
  ipcMain.handle('backup:daily', () => {
    try {
      const config = loadConfig();
      return maybeDailyBackup(config, app.getPath('userData'));
    } catch (err) {
      return fail('backup:daily', err);
    }
  });

  /* ---------------- Info aplikasi ---------------- */

  handleVoid<AppInfo>('app:info', () => ({
    version: app.getVersion(),
    deviceId: loadConfig().deviceId,
    dbPath: getDbPath(),
    userData: app.getPath('userData'),
  }));
}

/**
 * Daftar channel yang diizinkan - dipakai preload untuk memastikan tidak ada
 * typo nama channel antara main & renderer.
 */
export const RIGDAILY_CHANNELS_LIST = [
  'db:reports:list',
  'db:reports:get',
  'db:reports:save',
  'db:reports:delete',
  'outbox:pending',
  'outbox:stats',
  'outbox:problems',
  'sync:run',
  'sync:state',
  'config:get',
  'config:set',
  'backup:export',
  'backup:import',
  'backup:daily',
  'app:info',
] as const;

export type RigDailyChannel = (typeof RIGDAILY_CHANNELS_LIST)[number];

/** Dipakai `preload.ts` untuk tipe API (type-only, hilang saat compile). */
export type { RigDailyApi };

/* ------------------------------------------------------------------ */
/* Utilitas kecil (dipakai main.ts / preload.ts)                       */
/* ------------------------------------------------------------------ */

/** UUID v4 lokal - dipakai renderer/offline page saat membuat DDR baru. */
export function newLocalId(): string {
  return randomUUID();
}

/** Nama file default dialog backup (untuk label di halaman offline). */
export function backupLabel(): string {
  return defaultBackupFileName();
}

/** Ekstensi bundle backup. */
export const BACKUP_SUFFIX = BACKUP_EXTENSION;
