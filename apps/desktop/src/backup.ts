/**
 * BACKUP BUNDLE (.json.gz) - jalur pemulihan bila SQLite/instalasi rusak.
 *
 * Tidak memakai dependency ZIP baru (kontrak §8: jangan tambah dependency).
 * Format: satu file gzip berisi JSON:
 *   { format, formatVersion, exportedAt, deviceId, config, reports, timeRows, outbox }
 *
 * Dipakai untuk:
 *  - backup harian otomatis ke `userData/backups/` (retenSI 14 file terakhir),
 *  - export manual lewat dialog "Save" (IPC `backup:export`),
 *  - import manual lewat dialog "Open" (IPC `backup:import`, durasi restore).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { getDbPath, getMeta, restoreSnapshot, setMeta, snapshotAll } from './db';
import type { BackupImportResult, DeviceConfig, LocalReport, LocalTimeRow, OutboxItem } from './types';

export const BACKUP_FORMAT = 'rigdaily-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_EXTENSION = '.json.gz';
/** Backup ditulis ulang bila yang terakhir lebih tua dari ini. */
export const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BACKUP_RETENTION = 14;

export type BackupBundle = {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  exportedAt: string;
  deviceId: string;
  config: DeviceConfig;
  reports: LocalReport[];
  timeRows: LocalTimeRow[];
  outbox: OutboxItem[];
};

export function buildBundle(config: DeviceConfig): BackupBundle {
  const snapshot = snapshotAll();
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    deviceId: config.deviceId,
    config,
    reports: snapshot.reports,
    timeRows: snapshot.timeRows,
    outbox: snapshot.outbox,
  };
}

/** Tulis bundle (gzip JSON) ke `targetPath`. Mengembalikan jumlah byte. */
export function writeBundleTo(targetPath: string, config: DeviceConfig): number {
  const bundle = buildBundle(config);
  const json = JSON.stringify(bundle);
  const gz = gzipSync(Buffer.from(json, 'utf8'), { level: 9 });
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, gz);
  return gz.byteLength;
}

/** `exportBackupZip` - nama historis dari brief; yang dihasilkan = bundle .json.gz. */
export function exportBackupZip(targetPath: string, config: DeviceConfig): { path: string; bytes: number } {
  const path = targetPath.endsWith(BACKUP_EXTENSION) ? targetPath : `${targetPath}${BACKUP_EXTENSION}`;
  const bytes = writeBundleTo(path, config);
  return { path, bytes };
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

export type BackupBundleError = { ok: false; error: string };
export type BackupBundleOk = { ok: true; bundle: BackupBundle };
export type BackupBundleParse = BackupBundleOk | BackupBundleError;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function optNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Validasi longgar (tidak percaya file): bentuk minimal diterima, sisanya dinormalkan. */
export function parseBundle(raw: string): BackupBundleParse {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Bundle bukan JSON yang valid.' };
  }
  if (!isRecord(json)) return { ok: false, error: 'Bundle harus berupa object JSON.' };
  if (json.format !== BACKUP_FORMAT) {
    return { ok: false, error: `Format tidak dikenal (${String(json.format ?? '-')}).` };
  }
  if (json.formatVersion !== BACKUP_FORMAT_VERSION) {
    return { ok: false, error: `Versi bundle ${String(json.formatVersion)} tidak didukung (harus ${BACKUP_FORMAT_VERSION}).` };
  }
  if (!isRecord(json.config) || !Array.isArray(json.reports) || !Array.isArray(json.timeRows)) {
    return { ok: false, error: 'Bundle tidak lengkap (config/reports/timeRows wajib ada).' };
  }

  const configRaw = json.config;
  const deviceId = optString(configRaw.deviceId) ?? optString(json.deviceId);
  if (!deviceId) return { ok: false, error: 'Bundle tidak memuat deviceId.' };

  const config: DeviceConfig = {
    deviceId,
    deviceName: optString(configRaw.deviceName) ?? 'rig-terminal',
    serverUrl: optString(configRaw.serverUrl) ?? 'http://localhost:3000',
    apiKey: optString(configRaw.apiKey),
    rigId: optString(configRaw.rigId),
  };

  const reports: LocalReport[] = [];
  for (const item of json.reports) {
    if (!isRecord(item)) continue;
    const localId = optString(item.localId);
    const wellId = optString(item.wellId);
    const reportDate = optString(item.reportDate);
    if (!localId || !wellId || !reportDate) continue;
    reports.push({
      localId,
      serverId: optString(item.serverId),
      wellId,
      wellName: optString(item.wellName) ?? '',
      rigId: optString(item.rigId),
      reportDate,
      reportNo: optNumber(item.reportNo),
      depthMdStart: optNumber(item.depthMdStart),
      depthMdEnd: optNumber(item.depthMdEnd),
      summary: optString(item.summary),
      planNext: optString(item.planNext),
      status: item.status === 'submitted' || item.status === 'approved' || item.status === 'distributed' || item.status === 'locked' ? item.status : 'draft',
      totalMinutes: optNumber(item.totalMinutes),
      nptMinutes: optNumber(item.nptMinutes),
      wowMinutes: optNumber(item.wowMinutes),
      productiveMinutes: optNumber(item.productiveMinutes),
      updatedAt: optString(item.updatedAt) ?? new Date(0).toISOString(),
      dirty: item.dirty === true,
    });
  }

  const timeRows: LocalTimeRow[] = [];
  for (const item of json.timeRows) {
    if (!isRecord(item)) continue;
    const localId = optString(item.localId);
    const reportLocalId = optString(item.reportLocalId);
    const start = optString(item.start);
    const end = optString(item.end);
    if (!localId || !reportLocalId || !start || !end) continue;
    timeRows.push({
      localId,
      reportLocalId,
      sortOrder: optNumber(item.sortOrder),
      start,
      end,
      durationMin: optNumber(item.durationMin),
      iadcCode: optString(item.iadcCode) ?? '01',
      iadcSubcode: optString(item.iadcSubcode),
      vendor: optString(item.vendor),
      nptFlag: item.nptFlag === true,
      timeClass: optString(item.timeClass) ?? 'PRD',
      remarks: optString(item.remarks),
    });
  }

  const outbox: OutboxItem[] = [];
  const outboxRaw = Array.isArray(json.outbox) ? json.outbox : [];
  for (const item of outboxRaw) {
    if (!isRecord(item)) continue;
    const clientMutationId = optString(item.clientMutationId);
    const entity = optString(item.entity);
    const entityLocalId = optString(item.entityLocalId);
    const payloadJson = optString(item.payloadJson);
    const hash = optString(item.hash);
    const createdAt = optString(item.createdAt);
    if (!clientMutationId || !entity || !entityLocalId || !payloadJson || !hash || !createdAt) continue;
    outbox.push({
      id: 0, // id AUTOINCREMENT dibuat ulang saat restore
      clientMutationId,
      entity,
      entityLocalId,
      entityServerId: optString(item.entityServerId),
      op: item.op === 'update' || item.op === 'delete' ? item.op : 'create',
      payloadJson,
      hash,
      baseServerUpdatedAt: optString(item.baseServerUpdatedAt),
      status:
        item.status === 'sent' ||
        item.status === 'acked' ||
        item.status === 'conflict' ||
        item.status === 'failed' ||
        item.status === 'dead_letter'
          ? item.status
          : 'pending',
      retryCount: optNumber(item.retryCount),
      lastError: optString(item.lastError),
      createdAt,
    });
  }

  return {
    ok: true,
    bundle: {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      exportedAt: optString(json.exportedAt) ?? new Date(0).toISOString(),
      deviceId,
      config,
      reports,
      timeRows,
      outbox,
    },
  };
}

/**
 * Baca bundle dari disk dan pulihkan isinya ke DB lokal (idempoten: baris dengan
 * PK sama ditimpa / diabaikan). Outbox di-INSERT OR IGNORE berdasarkan
 * `client_mutation_id` supaya tidak ada mutation dobel.
 */
export function importBackupBundle(path: string): BackupImportResult {
  if (!existsSync(path)) throw new Error(`File backup tidak ditemukan: ${path}`);

  const buffer = readFileSync(path);
  const text = path.endsWith(BACKUP_EXTENSION) ? gunzipSync(buffer).toString('utf8') : buffer.toString('utf8');
  const parsed = parseBundle(text);
  if (!parsed.ok) throw new Error(`Bundle tidak valid: ${parsed.error}`);

  const restored = restoreSnapshot({
    reports: parsed.bundle.reports,
    timeRows: parsed.bundle.timeRows,
    outbox: parsed.bundle.outbox,
  });

  return {
    restoredReports: restored.reports,
    restoredTimeRows: restored.timeRows,
    restoredOutbox: restored.outbox,
    exportedAt: parsed.bundle.exportedAt,
    deviceId: parsed.bundle.deviceId,
  };
}

/* ------------------------------------------------------------------ */
/* Backup otomatis harian                                              */
/* ------------------------------------------------------------------ */

export function backupsDir(userData: string): string {
  return join(userData, 'backups');
}

function stamp(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)}T${iso.slice(11, 19).replace(/:/g, '')}Z`;
}

/**
 * Backup otomatis: tulis bundle ke `userData/backups/` bila `meta.lastBackupAt`
 * lebih tua dari 24 jam (atau belum pernah). Mengembalikan path file baru / yang
 * terakhir dibuat, atau `null` bila belum waktunya.
 */
export function maybeDailyBackup(config: DeviceConfig, userData: string, now: Date = new Date()): string | null {
  let last: number = Number.NaN;
  try {
    const raw = getMeta('lastBackupAt');
    last = raw ? new Date(raw).getTime() : Number.NaN;
  } catch (err) {
    console.warn('[backup] gagal membaca meta.lastBackupAt:', err);
  }

  if (Number.isFinite(last) && now.getTime() - last < BACKUP_INTERVAL_MS) return null;

  try {
    const dir = backupsDir(userData);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `rigdaily-${stamp(now)}${BACKUP_EXTENSION}`);
    writeBundleTo(path, config);
    setMeta('lastBackupAt', now.toISOString());
    pruneOldBackups(dir);
    return path;
  } catch (err) {
    // Backup gagal TIDAK boleh menghalangi start aplikasi.
    console.error('[backup] backup harian gagal:', err);
    return null;
  }
}

/** Hapus backup tertua, sisakan `BACKUP_RETENTION` file terbaru. */
export function pruneOldBackups(dir: string): void {
  try {
    const files = readdirSync(dir)
      .filter((name) => name.endsWith(BACKUP_EXTENSION))
      .map((name) => {
        const full = join(dir, name);
        let mtime = 0;
        try {
          mtime = statSync(full).mtimeMs;
        } catch {
          mtime = 0;
        }
        return { full, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);

    for (const file of files.slice(BACKUP_RETENTION)) {
      rmSync(file.full, { force: true });
    }
  } catch (err) {
    console.warn('[backup] prune backup gagal (diabaikan):', err);
  }
}

/** Nama file default untuk dialog Save (dipakai IPC `backup:export`). */
export function defaultBackupFileName(now: Date = new Date()): string {
  return `rigdaily-backup-${stamp(now)}${BACKUP_EXTENSION}`;
}

/** Backup otomatis terbaru (menu "Restore backup harian"). */
export function latestAutoBackup(userData: string): string | null {
  const dir = backupsDir(userData);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(BACKUP_EXTENSION))
    .sort();
  const last = files[files.length - 1];
  return last ? join(dir, last) : null;
}

/** Path DB lokal (untuk ditampilkan di menu About / diagnostik). */
export function dbFileForBundle(): string {
  return getDbPath();
}
