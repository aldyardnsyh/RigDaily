/**
 * SQLITE LOKAL (better-sqlite3, sinkron) - `app.getPath('userData')/app.db`.
 *
 * Prinsip:
 *  - Write-ahead log (WAL) + foreign_keys ON.
 *  - ANGKA WAKTU TIDAK DIHITUNG DI SINI DARI NOL: durasi baris memakai
 *    `rowDurationMinutes()` dan klasifikasi memakai `classifyTime()` dari
 *    `@rigdaily/shared` (kontrak §4 - layar & PDF harus identik).
 *  - Perubahan data lokal + enqueue outbox SELALU dalam satu transaksi, supaya
 *    tidak mungkin ada laporan tersimpan tanpa jejak sync (lihat `saveReportLocal`).
 */
import { app } from 'electron';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { classifyTime, payloadHash, rowDurationMinutes } from '@rigdaily/shared';

import type { LocalReport, LocalReportStatus, LocalTimeRow, OutboxCount, OutboxItem } from './types';

/**
 * Tipe baris SELECT mentah dari better-sqlite3. Structurally ini `unknown`, jadi
 * kita beri index signature lalu naruh `as Record` eksplisit di `nodeSqlite()` -
 * cukup untuk menghindari `any` di seluruh file ini.
 */
type SqlValue = string | number | bigint | Buffer | null;
type SqlRow = Record<string, SqlValue>;

/** Subset API better-sqlite3 yang dipakai (mengikuti bentuk `Statement` aslinya). */
type RunResult = { changes: number; lastInsertRowid: number | bigint };

type SqlStatement = {
  run: (...params: SqlValue[]) => RunResult;
  get: (...params: SqlValue[]) => SqlRow | undefined;
  all: (...params: SqlValue[]) => SqlRow[];
};

type SqlDatabase = {
  prepare: (sql: string) => SqlStatement;
  exec: (sql: string) => void;
  pragma: (source: string) => unknown;
  transaction: <A extends SqlValue[], R>(fn: (...args: A) => R) => (...args: A) => R;
  close: () => void;
};

let db: SqlDatabase | null = null;

/* ------------------------------------------------------------------ */
/* DDL                                                                 */
/* ------------------------------------------------------------------ */

const DDL = `
CREATE TABLE IF NOT EXISTS reports (
  local_id TEXT PRIMARY KEY,
  server_id TEXT,
  well_id TEXT NOT NULL,
  well_name TEXT,
  rig_id TEXT,
  report_date TEXT NOT NULL,
  report_no INTEGER,
  depth_md_start REAL,
  depth_md_end REAL,
  summary TEXT,
  plan_next TEXT,
  status TEXT NOT NULL,
  total_minutes INTEGER DEFAULT 0,
  npt_minutes INTEGER DEFAULT 0,
  wow_minutes INTEGER DEFAULT 0,
  productive_minutes INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL,
  dirty INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS time_rows (
  local_id TEXT PRIMARY KEY,
  report_local_id TEXT NOT NULL,
  sort_order INTEGER,
  start_hm TEXT,
  end_hm TEXT,
  duration_min INTEGER,
  iadc_code TEXT,
  iadc_subcode TEXT,
  vendor TEXT,
  npt_flag INTEGER,
  time_class TEXT,
  remarks TEXT
);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_mutation_id TEXT UNIQUE NOT NULL,
  entity TEXT NOT NULL,
  entity_local_id TEXT NOT NULL,
  entity_server_id TEXT,
  op TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  hash TEXT NOT NULL,
  base_server_updated_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_reports_date ON reports(report_date DESC);
CREATE INDEX IF NOT EXISTS idx_reports_server_id ON reports(server_id);
CREATE INDEX IF NOT EXISTS idx_time_rows_report ON time_rows(report_local_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status, id);
`;

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

export function getDbPath(): string {
  return join(app.getPath('userData'), 'app.db');
}

/** Buka DB, set pragma, buat tabel (idempoten). Aman dipanggil sekali dari main. */
export function initDb(dbPath?: string): SqlDatabase {
  if (db) return db;

  const path = dbPath ?? getDbPath();
  mkdirSync(dirname(path), { recursive: true });

  try {
    // better-sqlite3: require() mengembalikan fungsi konstruktor.
    const handle = new Database(path);
    db = handle as unknown as SqlDatabase;

    // WAL: baca tidak memblokir tulis (laporan sering autosave saat shift berjalan).
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.exec(DDL);
  } catch (err) {
    db = null;
    // Jangan telan: bootstrap() menampilkan dialog fatal berisi pesan ini.
    // Tanpa ini, kegagalan init hanya jadi blank putih yang tidak bisa didiagnosis.
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    throw new Error(`Gagal membuka database lokal di ${path}. ${detail}`);
  }
  return db;
}

/** Handle DB aktif. Melempar error jelas bila `initDb()` belum dipanggil. */
export function getDb(): SqlDatabase {
  if (!db) throw new Error('Database belum diinisialisasi - panggil initDb() lebih dulu.');
  return db;
}

export function closeDb(): void {
  if (!db) return;
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (err) {
    console.warn('[db] checkpoint WAL gagal (diabaikan):', err);
  }
  db.close();
  db = null;
}

/* ------------------------------------------------------------------ */
/* Konversi baris                                                      */
/* ------------------------------------------------------------------ */

function str(row: SqlRow, key: string): string | null {
  const v = row[key];
  if (v === null || v === undefined) return null;
  return typeof v === 'string' ? v : String(v);
}

function strOr(row: SqlRow, key: string, fallback: string): string {
  return str(row, key) ?? fallback;
}

function num(row: SqlRow, key: string, fallback = 0): number {
  const v = row[key];
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function bool(row: SqlRow, key: string): boolean {
  return num(row, key, 0) !== 0;
}

const REPORT_STATUSES: readonly LocalReportStatus[] = ['draft', 'submitted', 'approved', 'distributed', 'locked'];

function asStatus(value: string | null): LocalReportStatus {
  return REPORT_STATUSES.find((s) => s === value) ?? 'draft';
}

const OUTBOX_STATUSES: readonly OutboxItem['status'][] = [
  'pending',
  'sent',
  'acked',
  'conflict',
  'failed',
  'dead_letter',
];

function asOutboxStatus(value: string | null): OutboxItem['status'] {
  return OUTBOX_STATUSES.find((s) => s === value) ?? 'pending';
}

function asOp(value: string | null): OutboxItem['op'] {
  return value === 'update' || value === 'delete' ? value : 'create';
}

function rowToReport(row: SqlRow): LocalReport {
  return {
    localId: strOr(row, 'local_id', ''),
    serverId: str(row, 'server_id'),
    wellId: strOr(row, 'well_id', ''),
    wellName: strOr(row, 'well_name', ''),
    rigId: str(row, 'rig_id'),
    reportDate: strOr(row, 'report_date', ''),
    reportNo: num(row, 'report_no'),
    depthMdStart: num(row, 'depth_md_start'),
    depthMdEnd: num(row, 'depth_md_end'),
    summary: str(row, 'summary'),
    planNext: str(row, 'plan_next'),
    status: asStatus(str(row, 'status')),
    totalMinutes: num(row, 'total_minutes'),
    nptMinutes: num(row, 'npt_minutes'),
    wowMinutes: num(row, 'wow_minutes'),
    productiveMinutes: num(row, 'productive_minutes'),
    updatedAt: strOr(row, 'updated_at', new Date(0).toISOString()),
    dirty: bool(row, 'dirty'),
  };
}

function rowToTimeRow(row: SqlRow): LocalTimeRow {
  return {
    localId: strOr(row, 'local_id', ''),
    reportLocalId: strOr(row, 'report_local_id', ''),
    sortOrder: num(row, 'sort_order'),
    start: strOr(row, 'start_hm', ''),
    end: strOr(row, 'end_hm', ''),
    durationMin: num(row, 'duration_min'),
    iadcCode: strOr(row, 'iadc_code', ''),
    iadcSubcode: str(row, 'iadc_subcode'),
    vendor: str(row, 'vendor'),
    nptFlag: bool(row, 'npt_flag'),
    timeClass: strOr(row, 'time_class', 'PRD'),
    remarks: str(row, 'remarks'),
  };
}

function rowToOutbox(row: SqlRow): OutboxItem {
  return {
    id: num(row, 'id'),
    clientMutationId: strOr(row, 'client_mutation_id', ''),
    entity: strOr(row, 'entity', ''),
    entityLocalId: strOr(row, 'entity_local_id', ''),
    entityServerId: str(row, 'entity_server_id'),
    op: asOp(str(row, 'op')),
    payloadJson: strOr(row, 'payload_json', '{}'),
    hash: strOr(row, 'hash', ''),
    baseServerUpdatedAt: str(row, 'base_server_updated_at'),
    status: asOutboxStatus(str(row, 'status')),
    retryCount: num(row, 'retry_count'),
    lastError: str(row, 'last_error'),
    createdAt: strOr(row, 'created_at', new Date(0).toISOString()),
  };
}

/* ------------------------------------------------------------------ */
/* Helpers DDR                                                         */
/* ------------------------------------------------------------------ */

export function listLocalReports(): LocalReport[] {
  if (!db) return [];
  const rows = getDb()
    .prepare(
      `SELECT * FROM reports
       ORDER BY report_date DESC, report_no DESC, local_id`,
    )
    .all();
  return rows.map(rowToReport);
}

export function getLocalReport(localId: string): LocalReport | null {
  const row = getDb().prepare('SELECT * FROM reports WHERE local_id = ?').get(localId);
  return row ? rowToReport(row) : null;
}

export function getLocalTimeRows(reportLocalId: string): LocalTimeRow[] {
  const rows = getDb()
    .prepare('SELECT * FROM time_rows WHERE report_local_id = ? ORDER BY sort_order, local_id')
    .all(reportLocalId);
  return rows.map(rowToTimeRow);
}

/** Cari localId dari serverId (dipakai pull untuk map perubahan server → baris lokal). */
export function findLocalIdByServerId(serverId: string): string | null {
  const row = getDb().prepare('SELECT local_id FROM reports WHERE server_id = ? LIMIT 1').get(serverId);
  return row ? str(row, 'local_id') : null;
}

function writeReportRow(row: LocalReport): void {
  getDb()
    .prepare(
      `INSERT INTO reports (
         local_id, server_id, well_id, well_name, rig_id, report_date, report_no,
         depth_md_start, depth_md_end, summary, plan_next, status,
         total_minutes, npt_minutes, wow_minutes, productive_minutes, updated_at, dirty
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(local_id) DO UPDATE SET
         server_id = excluded.server_id,
         well_id = excluded.well_id,
         well_name = excluded.well_name,
         rig_id = excluded.rig_id,
         report_date = excluded.report_date,
         report_no = excluded.report_no,
         depth_md_start = excluded.depth_md_start,
         depth_md_end = excluded.depth_md_end,
         summary = excluded.summary,
         plan_next = excluded.plan_next,
         status = excluded.status,
         total_minutes = excluded.total_minutes,
         npt_minutes = excluded.npt_minutes,
         wow_minutes = excluded.wow_minutes,
         productive_minutes = excluded.productive_minutes,
         updated_at = excluded.updated_at,
         dirty = excluded.dirty`,
    )
    .run(
      row.localId,
      row.serverId,
      row.wellId,
      row.wellName,
      row.rigId,
      row.reportDate,
      row.reportNo,
      row.depthMdStart,
      row.depthMdEnd,
      row.summary,
      row.planNext,
      row.status,
      row.totalMinutes,
      row.nptMinutes,
      row.wowMinutes,
      row.productiveMinutes,
      row.updatedAt,
      row.dirty ? 1 : 0,
    );
}

function writeTimeRow(row: LocalTimeRow): void {
  getDb()
    .prepare(
      `INSERT INTO time_rows (
         local_id, report_local_id, sort_order, start_hm, end_hm, duration_min,
         iadc_code, iadc_subcode, vendor, npt_flag, time_class, remarks
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(local_id) DO UPDATE SET
         report_local_id = excluded.report_local_id,
         sort_order = excluded.sort_order,
         start_hm = excluded.start_hm,
         end_hm = excluded.end_hm,
         duration_min = excluded.duration_min,
         iadc_code = excluded.iadc_code,
         iadc_subcode = excluded.iadc_subcode,
         vendor = excluded.vendor,
         npt_flag = excluded.npt_flag,
         time_class = excluded.time_class,
         remarks = excluded.remarks`,
    )
    .run(
      row.localId,
      row.reportLocalId,
      row.sortOrder,
      row.start,
      row.end,
      row.durationMin,
      row.iadcCode,
      row.iadcSubcode,
      row.vendor,
      row.nptFlag ? 1 : 0,
      row.timeClass,
      row.remarks,
    );
}

/**
 * Simpan header report. `dirty` dipertahankan sesuai argumen (pemanggil yang tahu
 * apakah ini edit lokal - `true` - atau hasil pull server - `false`).
 */
export function upsertLocalReport(row: LocalReport): LocalReport {
  writeReportRow(row);
  return row;
}

/**
 * Ganti SELURUH baris time breakdown sebuah report (delete + insert dalam satu
 * transaksi). Ini juga menormalkan `durationMin` dan `timeClass`:
 *  - `durationMin = rowDurationMinutes(start, end)` (null → 0, format salah),
 *  - `timeClass  = nptFlag ? 'NPT' : classifyTime(iadcCode)` - sama persis dengan
 *    yang dilakukan server di `applyTimeBreakdown`.
 * `sortOrder` dipaksa urut dari array (stabil di semua device).
 */
export function replaceLocalTimeRows(reportLocalId: string, rows: LocalTimeRow[]): LocalTimeRow[] {
  const database = getDb();
  const normalized: LocalTimeRow[] = rows.map((row, index) => {
    const durationMin = rowDurationMinutes(row.start, row.end) ?? 0;
    return {
      ...row,
      reportLocalId,
      sortOrder: index,
      durationMin,
      timeClass: row.nptFlag ? 'NPT' : classifyTime(row.iadcCode),
    };
  });

  const apply = database.transaction(() => {
    database.prepare('DELETE FROM time_rows WHERE report_local_id = ?').run(reportLocalId);
    for (const row of normalized) writeTimeRow(row);
  });
  apply();

  return normalized;
}

/** Hapus report + baris waktunya (hard delete lokal; outbox delete dibuat pemanggil). */
export function deleteLocalReport(localId: string): boolean {
  const database = getDb();
  const apply = database.transaction(() => {
    database.prepare('DELETE FROM time_rows WHERE report_local_id = ?').run(localId);
    const res = database.prepare('DELETE FROM reports WHERE local_id = ?').run(localId);
    return res.changes;
  });
  return apply() > 0;
}

/* ------------------------------------------------------------------ */
/* Helpers outbox                                                      */
/* ------------------------------------------------------------------ */

export type OutboxDraft = {
  clientMutationId: string;
  entity: string;
  entityLocalId: string;
  entityServerId: string | null;
  op: OutboxItem['op'];
  payload: Record<string, unknown>;
  baseServerUpdatedAt: string | null;
  createdAt?: string;
};

/**
 * Masukkan satu mutation ke outbox. `hash` dihitung dari payload kanonik
 * (`payloadHash` dari shared) - server memverifikasi ulang hash ini.
 *
 * CATATAN: bila dipanggil di luar transaksi lain, ia langsung commit. Untuk
 * atomisitas dengan perubahan data, pakai `saveReportLocal()` / `deleteReportTransaction()`.
 */
export function enqueueOutbox(item: OutboxDraft): OutboxItem {
  const createdAt = item.createdAt ?? new Date().toISOString();
  const payloadJson = JSON.stringify(item.payload);
  const hash = payloadHash(item.payload);

  const res = getDb()
    .prepare(
      `INSERT INTO outbox (
         client_mutation_id, entity, entity_local_id, entity_server_id, op,
         payload_json, hash, base_server_updated_at, status, retry_count, last_error, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?)`,
    )
    .run(
      item.clientMutationId,
      item.entity,
      item.entityLocalId,
      item.entityServerId,
      item.op,
      payloadJson,
      hash,
      item.baseServerUpdatedAt,
      createdAt,
    );

  return {
    id: Number(res.lastInsertRowid),
    clientMutationId: item.clientMutationId,
    entity: item.entity,
    entityLocalId: item.entityLocalId,
    entityServerId: item.entityServerId,
    op: item.op,
    payloadJson,
    hash,
    baseServerUpdatedAt: item.baseServerUpdatedAt,
    status: 'pending',
    retryCount: 0,
    lastError: null,
    createdAt,
  };
}

/** Ambil outbox yang menunggu kirim (`pending`, atau `failed` yang sudah siap retry). */
export function listPendingOutbox(limit: number): OutboxItem[] {
  const take = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 100;
  const rows = getDb()
    .prepare(
      `SELECT * FROM outbox
       WHERE status = 'pending'
       ORDER BY id
       LIMIT ?`,
    )
    .all(take);
  return rows.map(rowToOutbox);
}

/** ACK dari server: status `acked`, simpan serverId, dan tandai report lokal bersih. */
export function markOutboxAcked(id: number, serverId: string | null): void {
  const database = getDb();
  const apply = database.transaction(() => {
    database
      .prepare("UPDATE outbox SET status = 'acked', last_error = NULL, entity_server_id = COALESCE(?, entity_server_id) WHERE id = ?")
      .run(serverId, id);

    if (serverId) {
      const row = database.prepare('SELECT entity, entity_local_id FROM outbox WHERE id = ?').get(id);
      if (row && str(row, 'entity') === 'daily_report') {
        database
          .prepare('UPDATE reports SET server_id = ?, dirty = 0 WHERE local_id = ?')
          .run(serverId, strOr(row, 'entity_local_id', ''));
      }
    }
  });
  apply();
}

/**
 * Batas retry sebelum mutation dipindah ke `dead_letter`.
 * Selaras dengan `SYNC_MAX_RETRY` di `@rigdaily/shared` (5) dan panjang
 * `SYNC_BACKOFF_MS` (5 langkah): 5s, 15s, 45s, 135s, 405s.
 */
export const OUTBOX_MAX_RETRY = 5;

/** Server tidak terjangkau / 5xx: tambah retryCount dan simpan pesan terakhir. */
export function markOutboxRetry(id: number, error: string): void {
  getDb()
    .prepare(
      `UPDATE outbox
       SET retry_count = retry_count + 1,
           status = CASE WHEN retry_count + 1 >= ? THEN 'dead_letter' ELSE 'pending' END,
           last_error = ?
       WHERE id = ?`,
    )
    .run(OUTBOX_MAX_RETRY, error.slice(0, 2000), id);
}

export function markOutboxStatus(id: number, status: OutboxItem['status'], error?: string | null): void {
  getDb()
    .prepare('UPDATE outbox SET status = ?, last_error = ? WHERE id = ?')
    .run(status, error ? error.slice(0, 2000) : null, id);
}

export function listOutboxByStatus(status: OutboxItem['status'], limit = 200): OutboxItem[] {
  const rows = getDb()
    .prepare('SELECT * FROM outbox WHERE status = ? ORDER BY id LIMIT ?')
    .all(status, Math.max(1, Math.floor(limit)));
  return rows.map(rowToOutbox);
}

export function getOutboxItem(id: number): OutboxItem | null {
  const row = getDb().prepare('SELECT * FROM outbox WHERE id = ?').get(id);
  return row ? rowToOutbox(row) : null;
}

export function countOutbox(): OutboxCount {
  const rows = getDb().prepare('SELECT status, COUNT(*) AS n FROM outbox GROUP BY status').all();
  const result: OutboxCount = { pending: 0, sent: 0, acked: 0, conflict: 0, failed: 0, deadLetter: 0, total: 0 };
  for (const row of rows) {
    const n = num(row, 'n');
    const status = asOutboxStatus(str(row, 'status'));
    result.total += n;
    switch (status) {
      case 'pending':
        result.pending += n;
        break;
      case 'sent':
        result.sent += n;
        break;
      case 'acked':
        result.acked += n;
        break;
      case 'conflict':
        result.conflict += n;
        break;
      case 'failed':
        result.failed += n;
        break;
      case 'dead_letter':
        result.deadLetter += n;
        break;
    }
  }
  result.failed += result.deadLetter;
  return result;
}

/* ------------------------------------------------------------------ */
/* Transaksi gabungan (data lokal + outbox) - SATU transaksi            */
/* ------------------------------------------------------------------ */

/** Payload mutation `daily_report` - bentuk camelCase yang dibaca `applyDailyReport` server. */
export function reportMutationPayload(report: LocalReport): Record<string, unknown> {
  return {
    id: report.serverId ?? report.localId,
    wellId: report.wellId,
    rigId: report.rigId,
    reportDate: report.reportDate,
    reportNo: report.reportNo,
    depthMdStart: report.depthMdStart,
    depthMdEnd: report.depthMdEnd,
    summary: report.summary,
    planNext: report.planNext,
    status: report.status,
  };
}

/**
 * Payload mutation `time_breakdown`. Server mengganti SEMUA baris report dengan
 * isi `rows`, jadi payload ini selalu membawa seluruh grid.
 */
export function timeBreakdownPayload(reportLocalId: string, serverId: string | null, rows: LocalTimeRow[]): Record<string, unknown> {
  return {
    reportId: serverId ?? reportLocalId,
    rows: rows.map((r, index) => ({
      id: r.localId,
      sortOrder: index,
      start: r.start,
      end: r.end,
      iadcCode: r.iadcCode,
      iadcSubcode: r.iadcSubcode,
      vendor: r.vendor,
      nptFlag: r.nptFlag,
      remarks: r.remarks,
    })),
  };
}

/** Ringkasan waktu untuk kolom denormalisasi `reports.*_minutes`. */
function summarizeRows(rows: LocalTimeRow[]): {
  totalMinutes: number;
  nptMinutes: number;
  wowMinutes: number;
  productiveMinutes: number;
} {
  let totalMinutes = 0;
  let nptMinutes = 0;
  let wowMinutes = 0;
  let productiveMinutes = 0;
  for (const row of rows) {
    totalMinutes += row.durationMin;
    if (row.timeClass === 'NPT') nptMinutes += row.durationMin;
    else if (row.timeClass === 'WOW') wowMinutes += row.durationMin;
    else if (row.timeClass === 'PRD') productiveMinutes += row.durationMin;
  }
  return { totalMinutes, nptMinutes, wowMinutes, productiveMinutes };
}

/** Baris time yang diubah tetapi tidak dikirimkan? true bila lokal = server. */
function sameRows(a: LocalTimeRow[], b: LocalTimeRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (
      x.localId !== y.localId ||
      x.start !== y.start ||
      x.end !== y.end ||
      x.durationMin !== y.durationMin ||
      x.iadcCode !== y.iadcCode ||
      x.iadcSubcode !== y.iadcSubcode ||
      x.vendor !== y.vendor ||
      x.nptFlag !== y.nptFlag ||
      x.remarks !== y.remarks
    ) {
      return false;
    }
  }
  return true;
}

export type SaveReportInput = {
  report: LocalReport;
  timeRows: LocalTimeRow[];
  /** deviceId aktor (dictat di payload untuk audit server). */
  deviceId: string;
};

/**
 * Simpan DDR LOKAL + antre outbox dalam SATU transaksi SQLite.
 *
 * Yang dijamin atomik:
 *  1. `reports` di-upsert (dirty = 1).
 *  2. `time_rows` diganti seluruhnya (durasi & timeClass dinormalisasi).
 *  3. Outbox `daily_report` (create bila belum punya serverId, update bila sudah).
 *  4. Outbox `time_breakdown` bila grid benar-benar berubah.
 *
 * Bila salah satu langkah gagal, SQLite rollback semuanya - tidak ada laporan
 * yang "hilang dari outbox" walau app crash tepat setelah simpan.
 */
export function saveReportLocal(input: SaveReportInput): {
  report: LocalReport;
  timeRows: LocalTimeRow[];
  op: 'create' | 'update';
  timeMutationId: string | null;
} {
  const database = getDb();
  const now = new Date().toISOString();
  const existing = getLocalReport(input.report.localId);
  const previousRows = existing ? getLocalTimeRows(existing.localId) : [];

  const op: 'create' | 'update' = existing && existing.serverId ? 'update' : 'create';
  // Base server version: hanya ada bila report sudah pernah synced.
  const baseServerUpdatedAt = existing?.serverId ? existing.updatedAt : null;

  const normalized: LocalTimeRow[] = input.timeRows.map((row, index) => ({
    ...row,
    reportLocalId: input.report.localId,
    sortOrder: index,
    durationMin: rowDurationMinutes(row.start, row.end) ?? 0,
    timeClass: row.nptFlag ? 'NPT' : classifyTime(row.iadcCode),
  }));

  const totals = summarizeRows(normalized);
  const report: LocalReport = {
    ...input.report,
    serverId: existing?.serverId ?? input.report.serverId ?? null,
    status: existing?.status ?? input.report.status,
    ...totals,
    updatedAt: now,
    dirty: true,
  };

  const apply = database.transaction(() => {
    writeReportRow(report);

    database.prepare('DELETE FROM time_rows WHERE report_local_id = ?').run(report.localId);
    for (const row of normalized) writeTimeRow(row);

    enqueueOutbox({
      clientMutationId: randomUUID(),
      entity: 'daily_report',
      entityLocalId: report.localId,
      entityServerId: report.serverId,
      op,
      payload: { ...reportMutationPayload(report), deviceId: input.deviceId },
      baseServerUpdatedAt,
      createdAt: now,
    });

    // Hanya antre time_breakdown bila grid berubah (atau laporan baru).
    let timeMutationId: string | null = null;
    if (!existing || !sameRows(previousRows, normalized)) {
      timeMutationId = randomUUID();
      enqueueOutbox({
        clientMutationId: timeMutationId,
        entity: 'time_breakdown',
        entityLocalId: report.localId,
        entityServerId: report.serverId,
        op: report.serverId ? 'update' : 'create',
        payload: { ...timeBreakdownPayload(report.localId, report.serverId, normalized), deviceId: input.deviceId },
        baseServerUpdatedAt,
        createdAt: now,
      });
    }

    return timeMutationId;
  });

  const timeMutationId = apply();
  return { report, timeRows: normalized, op, timeMutationId };
}

/**
 * Hapus report lokal + antre outbox `delete` dalam satu transaksi.
 * Server melakukan soft delete (`deletedAt`), jadi payload cukup identitas.
 */
export function deleteReportTransaction(localId: string, deviceId: string): {
  deleted: boolean;
  op: 'delete' | 'none';
  clientMutationId: string | null;
} {
  const existing = getLocalReport(localId);
  if (!existing) return { deleted: false, op: 'none', clientMutationId: null };

  const database = getDb();
  const now = new Date().toISOString();
  const clientMutationId = randomUUID();

  const apply = database.transaction(() => {
    // Outbox untuk create/update yang masih pending tidak relevan lagi.
    database
      .prepare(
        `UPDATE outbox SET status = 'failed', last_error = 'SUPERSEDED_BY_DELETE'
         WHERE entity_local_id = ? AND entity = 'daily_report'
           AND status IN ('pending', 'sent', 'failed')`,
      )
      .run(localId);

    database.prepare('DELETE FROM time_rows WHERE report_local_id = ?').run(localId);
    database.prepare('DELETE FROM reports WHERE local_id = ?').run(localId);

    enqueueOutbox({
      clientMutationId,
      entity: 'daily_report',
      entityLocalId: localId,
      entityServerId: existing.serverId,
      op: 'delete',
      payload: {
        id: existing.serverId ?? localId,
        reportId: existing.serverId ?? localId,
        reportDate: existing.reportDate,
        reportNo: existing.reportNo,
        wellId: existing.wellId,
        deletedAt: now,
        deviceId,
      },
      baseServerUpdatedAt: existing.serverId ? existing.updatedAt : null,
      createdAt: now,
    });
  });
  apply();

  return { deleted: true, op: 'delete', clientMutationId };
}

/* ------------------------------------------------------------------ */
/* Apply perubahan dari server (PULL)                                  */
/* ------------------------------------------------------------------ */

/**
 * Tulis report hasil pull. Report lokal yang `dirty = 1` TIDAK ditimpa (dilaporkan
 * `skipped: true` supaya worker bisa mencatat konflik lokal).
 *
 * Bila `timeRows` diberikan (server menyertakan grid di payload), grid lokal ikut
 * diganti dalam transaksi yang sama - tapi HANYA kalau report lokal tidak dirty.
 */
export function applyPulledReport(
  report: LocalReport,
  timeRows?: LocalTimeRow[],
): { applied: boolean; skippedDirty: boolean } {
  const database = getDb();
  const existing = getLocalReport(report.localId);
  if (existing?.dirty) return { applied: false, skippedDirty: true };

  const normalized: LocalTimeRow[] = (timeRows ?? []).map((row, index) => {
    const durationMin = rowDurationMinutes(row.start, row.end) ?? 0;
    return {
      ...row,
      reportLocalId: report.localId,
      sortOrder: index,
      durationMin,
      timeClass: row.nptFlag ? 'NPT' : classifyTime(row.iadcCode),
    };
  });

  const apply = database.transaction(() => {
    writeReportRow({ ...report, dirty: false });
    if (timeRows !== undefined) {
      database.prepare('DELETE FROM time_rows WHERE report_local_id = ?').run(report.localId);
      for (const row of normalized) writeTimeRow(row);
    }
  });
  apply();

  return { applied: true, skippedDirty: false };
}

/** Hapus report lokal karena server bilang `delete`. Dirty lokal dipertahankan. */
export function applyPulledReportDelete(localId: string): { deleted: boolean; skippedDirty: boolean } {
  const existing = getLocalReport(localId);
  if (!existing) return { deleted: false, skippedDirty: false };
  if (existing.dirty) return { deleted: false, skippedDirty: true };
  return { deleted: deleteLocalReport(localId), skippedDirty: false };
}

/* ------------------------------------------------------------------ */
/* Meta (key/value) - lastPulledAt, lastBackupAt, dsb.                 */
/* ------------------------------------------------------------------ */

export function getMeta(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? str(row, 'value') : null;
}

export function setMeta(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

/* ------------------------------------------------------------------ */
/* Backup / restore bundle                                             */
/* ------------------------------------------------------------------ */

export type BackupSnapshot = {
  reports: LocalReport[];
  timeRows: LocalTimeRow[];
  outbox: OutboxItem[];
};

export function snapshotAll(): BackupSnapshot {
  const database = getDb();
  const reports = database.prepare('SELECT * FROM reports ORDER BY local_id').all().map(rowToReport);
  const timeRows = database.prepare('SELECT * FROM time_rows ORDER BY report_local_id, sort_order').all().map(rowToTimeRow);
  const outbox = database.prepare('SELECT * FROM outbox ORDER BY id').all().map(rowToOutbox);
  return { reports, timeRows, outbox };
}

/** Restore snapshot ke DB kosong/berjalan. Semua dalam satu transaksi. */
export function restoreSnapshot(snapshot: BackupSnapshot): { reports: number; timeRows: number; outbox: number } {
  const database = getDb();
  const apply = database.transaction(() => {
    for (const row of snapshot.reports) writeReportRow(row);
    for (const row of snapshot.timeRows) writeTimeRow(row);
    for (const item of snapshot.outbox) {
      database
        .prepare(
          `INSERT OR IGNORE INTO outbox (
             client_mutation_id, entity, entity_local_id, entity_server_id, op,
             payload_json, hash, base_server_updated_at, status, retry_count, last_error, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          item.clientMutationId,
          item.entity,
          item.entityLocalId,
          item.entityServerId,
          item.op,
          item.payloadJson,
          item.hash,
          item.baseServerUpdatedAt,
          item.status,
          item.retryCount,
          item.lastError,
          item.createdAt,
        );
    }
  });
  apply();
  return { reports: snapshot.reports.length, timeRows: snapshot.timeRows.length, outbox: snapshot.outbox.length };
}

/** Jalankan beberapa operasi dalam satu transaksi (dipakai worker untuk pull batch). */
export function runTransaction<R>(fn: () => R): R {
  const apply = getDb().transaction(fn);
  return apply();
}
