/**
 * PRELOAD - satu-satunya permukaan API yang dilihat renderer (`window.rigdaily`).
 *
 * Aturan keamanan:
 *  - `contextIsolation: true` + `nodeIntegration: false` → renderer TIDAK bisa
 *    `require()`; semua akses DB/filesystem lewat `ipcRenderer.invoke` yang sudah
 *    divalidasi zod di `ipc.ts`.
 *  - Tidak ada `ipcRenderer` mentah yang diekspos ke halaman (mencegah renderer
 *    memanggil channel sewenang-wenang).
 *  - Setiap method adalah fungsi tipis (tanpa logika bisnis) supaya mudah diuji.
 */
import { contextBridge, ipcRenderer } from 'electron';

import type {
  AppInfo,
  BackupExportResult,
  BackupImportResult,
  DeleteReportResult,
  DeviceConfig,
  DeviceConfigPatch,
  LocalReport,
  LocalReportDetail,
  OutboxCount,
  OutboxItem,
  RigDailyApi,
  SaveReportResult,
  SyncState,
} from './types';

const CHANNEL_SYNC_STATE = 'sync:state';

const api: RigDailyApi = {
  reports: {
    list: (): Promise<LocalReport[]> => ipcRenderer.invoke('db:reports:list') as Promise<LocalReport[]>,
    get: (localId: string): Promise<LocalReportDetail> =>
      ipcRenderer.invoke('db:reports:get', { localId }) as Promise<LocalReportDetail>,
    save: (input): Promise<SaveReportResult> => ipcRenderer.invoke('db:reports:save', input) as Promise<SaveReportResult>,
    remove: (localId: string): Promise<DeleteReportResult> =>
      ipcRenderer.invoke('db:reports:delete', { localId }) as Promise<DeleteReportResult>,
  },
  outbox: {
    pending: (limit?: number): Promise<OutboxItem[]> =>
      ipcRenderer.invoke('outbox:pending', limit) as Promise<OutboxItem[]>,
    stats: (): Promise<OutboxCount> => ipcRenderer.invoke('outbox:stats') as Promise<OutboxCount>,
  },
  sync: {
    run: (): Promise<SyncState> => ipcRenderer.invoke('sync:run') as Promise<SyncState>,
    state: (): Promise<SyncState> => ipcRenderer.invoke('sync:state') as Promise<SyncState>,
    onState: (handler: (state: SyncState) => void): (() => void) => {
      // Listener dibungkus supaya objek event Electron tidak bocor ke renderer.
      const listener = (_event: unknown, state: unknown): void => {
        handler(state as SyncState);
      };
      ipcRenderer.on(CHANNEL_SYNC_STATE, listener);
      return () => {
        ipcRenderer.removeListener(CHANNEL_SYNC_STATE, listener);
      };
    },
  },
  config: {
    get: (): Promise<DeviceConfig> => ipcRenderer.invoke('config:get') as Promise<DeviceConfig>,
    set: (patch: DeviceConfigPatch): Promise<DeviceConfig> =>
      ipcRenderer.invoke('config:set', patch) as Promise<DeviceConfig>,
  },
  backup: {
    export: (): Promise<BackupExportResult> => ipcRenderer.invoke('backup:export') as Promise<BackupExportResult>,
    import: (): Promise<BackupImportResult | null> =>
      ipcRenderer.invoke('backup:import') as Promise<BackupImportResult | null>,
  },
  app: {
    info: (): Promise<AppInfo> => ipcRenderer.invoke('app:info') as Promise<AppInfo>,
  },
};

contextBridge.exposeInMainWorld('rigdaily', api);

declare global {
  interface Window {
    rigdaily: RigDailyApi;
  }
}
