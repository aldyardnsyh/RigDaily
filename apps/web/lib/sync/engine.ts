import 'server-only';

/**
 * SYNC ENGINE - sisi server (kantor).
 *
 * Pola (lihat docs/KONTRAK-FROZEN.md §3 dan 06-Blueprint §5):
 *   Outbox device → push delta → ack idempoten → konflik MANUAL untuk laporan
 *   yang sudah approved/distributed/locked (`requiresManualResolve()`).
 *
 * Prinsip yang dipegang di file ini:
 *  1. Idempoten - `clientMutationId` dicatat di `sync_mutation_log`; mutation yang
 *     sudah pernah diproses TIDAK dieksekusi ulang (dikembalikan ack `acked`).
 *  2. Tidak ada auto-overwrite - laporan terkunci yang versi servernya lebih baru
 *     dari `baseServerUpdatedAt` device menghasilkan baris `sync_conflicts`.
 *  3. Device tidak boleh mengubah status/persetujuan (`status`, `approved_at`,
 *     `approved_by`) - hanya kolom header yang diizinkan.
 *
 * CATATAN LAYER: route handler lain memakai `@/lib/repo`; engine ini butuh
 * transaksi atomik lintas tabel (log idempotensi + mutasi + ack), jadi ia
 * memakai Drizzle langsung.
 */
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@rigdaily/database';
import {
  classifyTime,
  payloadHash,
  requiresManualResolve,
  round2,
  rowDurationMinutes,
  validateTimeBreakdown,
  type SyncMutation,
  type SyncPushAck,
  type SyncPushResponse,
} from '@rigdaily/shared';
import { ApiError } from '@/lib/api-response';
import { money, recomputeReportCosts, toNum, toNumOrNull } from '@/lib/repo/shared';
import type { PullResult, PushResult } from './types';

/** Batas jumlah baris per halaman pull (kontrak: limit 500). */
export const PULL_PAGE_SIZE = 500;

const DEFAULT_PULL_SINCE = '1970-01-01T00:00:00.000Z';

/** Kolom header DDR yang BOLEH ditulis device (status & approval tidak termasuk). */
export const REPORT_HEADER_COLUMNS = [
  'depthMdStart',
  'depthMdEnd',
  'depthTvd',
  'summary',
  'planNext',
  'geologyNotes',
  'equipmentStatus',
] as const;

type Payload = Record<string, unknown>;

type ReportRow = typeof schema.dailyReports.$inferSelect;

/* ------------------------------------------------------------------ */
/* Utilitas payload                                                    */
/* ------------------------------------------------------------------ */

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

function asString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

/** Number | null dari payload (`numeric` boleh datang sebagai string). */
function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function asBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

/** `date` (YYYY-MM-DD) atau ISO timestamp → `YYYY-MM-DD`. */
function asDateOnly(value: unknown): string | null {
  const s = asString(value);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s.trim());
  return m ? m[1] : null;
}

function asTimestampOrNull(value: unknown): Date | null {
  const s = asString(value);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Nilai kolom DB → JSON-safe (Date → ISO, numeric string → number untuk uang). */
function toIsoOrNull(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  const s = asString(value);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Row DDR → object untuk `serverPayload` / payload pull (numeric → number). */
function reportRowToObject(row: ReportRow): Record<string, unknown> {
  return {
    id: row.id,
    wellId: row.wellId,
    rigId: row.rigId,
    reportDate: row.reportDate,
    reportNo: row.reportNo,
    periodFrom: row.periodFrom,
    periodTo: row.periodTo,
    depthMdStart: toNum(row.depthMdStart),
    depthMdEnd: toNum(row.depthMdEnd),
    depthTvd: toNumOrNull(row.depthTvd),
    progress24h: toNumOrNull(row.progress24h),
    summary: row.summary,
    planNext: row.planNext,
    geologyNotes: row.geologyNotes,
    equipmentStatus: row.equipmentStatus ?? null,
    totalMinutes: row.totalMinutes,
    productiveMinutes: row.productiveMinutes,
    nptMinutes: row.nptMinutes,
    wowMinutes: row.wowMinutes,
    costDailyUsd: toNum(row.costDailyUsd),
    costCumulativeUsd: toNum(row.costCumulativeUsd),
    status: row.status,
    parentReportId: row.parentReportId,
    lockedAt: toIsoOrNull(row.lockedAt),
    submittedAt: toIsoOrNull(row.submittedAt),
    approvedAt: toIsoOrNull(row.approvedAt),
    signatureName: row.signatureName,
    originDeviceId: row.originDeviceId,
    revision: row.revision,
    deletedAt: toIsoOrNull(row.deletedAt),
    createdAt: toIsoOrNull(row.createdAt),
    updatedAt: toIsoOrNull(row.updatedAt),
  };
}

/* ------------------------------------------------------------------ */
/* Konteks mutation (report induk)                                     */
/* ------------------------------------------------------------------ */

type MutationContext = {
  /** Baris report yang dituju mutation (null bila belum ada di server). */
  report: ReportRow | null;
  /** Report induk untuk entity anak = report tempat entitas menempel. */
  parentReport: ReportRow | null;
};

async function findReportById(id: string): Promise<ReportRow | null> {
  const rows = await db
    .select()
    .from(schema.dailyReports)
    .where(eq(schema.dailyReports.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Cari report induk sebuah entitas anak berdasarkan payload:
 * `payload.reportId` (UUID), atau `payload.reportNo` + `payload.reportDate`.
 */
async function findParentReport(payload: Payload): Promise<ReportRow | null> {
  if (isUuid(payload.reportId)) {
    const byId = await findReportById(payload.reportId);
    if (byId) return byId;
  }

  const reportNo = asNumberOrNull(payload.reportNo);
  const reportDate = asDateOnly(payload.reportDate);
  if (reportNo !== null && reportDate) {
    const rows = await db
      .select()
      .from(schema.dailyReports)
      .where(
        and(
          eq(schema.dailyReports.reportNo, reportNo),
          eq(schema.dailyReports.reportDate, reportDate),
          isNull(schema.dailyReports.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  return null;
}

async function resolveContext(mutation: SyncMutation): Promise<MutationContext> {
  const payload = mutation.payload as Payload;

  if (mutation.entity === 'daily_report') {
    const targetId = mutation.entityServerId ?? mutation.entityLocalId;
    const report = await findReportById(targetId);
    return { report, parentReport: report };
  }

  const parentReport = await findParentReport(payload);
  return { report: null, parentReport };
}

/**
 * Apakah mutation ini memicu konflik manual?
 *
 * Aturan kontrak: entitas `daily_report` (atau anak dari laporan) yang di server
 * sudah `approved|distributed|locked` DAN `updatedAt` server lebih baru dari
 * versi yang dipegang device → jangan timpa, minta resolusi manual.
 */
function conflictReason(input: {
  entity: SyncMutation['entity'];
  report: ReportRow | null;
  baseServerUpdatedAt?: string | null;
}): string | null {
  if (!input.report) return null;
  if (input.report.deletedAt) return null;

  const serverUpdatedAt = (
    input.report.updatedAt instanceof Date ? input.report.updatedAt : new Date(input.report.updatedAt)
  ).toISOString();

  const locked = requiresManualResolve({
    serverStatus: input.report.status,
    serverUpdatedAt,
    baseServerUpdatedAt: input.baseServerUpdatedAt ?? null,
  });

  if (!locked) return null;

  return `Laporan DDR #${input.report.reportNo} sudah berstatus "${input.report.status}" di server dan versi server lebih baru (${serverUpdatedAt}) daripada basis device${
    input.baseServerUpdatedAt ? ` (${input.baseServerUpdatedAt})` : ''
  }. Perubahan dari device (${input.entity}) TIDAK diterapkan - resolusi manual di Sync Center diperlukan, atau koreksi lewat amendment.`;
}

/* ------------------------------------------------------------------ */
/* Penerapan mutation - daily_report                                   */
/* ------------------------------------------------------------------ */

/**
 * Terapkan mutation `daily_report` (create/update/delete).
 *
 * Kolom yang boleh berubah HANYA header yang diizinkan (`REPORT_HEADER_COLUMNS`:
 * depth, summary, planNext, geologyNotes, equipmentStatus, dst.).
 * `status`, `approvedAt`, `approvedBy`, `signatureName` tidak pernah ditulis dari
 * device - status hanya berubah lewat endpoint submit/approve.
 * Mengembalikan ID server + updatedAt terbaru.
 */
async function applyDailyReport(
  mutation: SyncMutation,
  report: ReportRow | null,
  deviceId: string,
): Promise<{ serverId: string | null; updatedAt: string | null }> {
  const payload = mutation.payload as Payload;
  const now = new Date();
  const targetId = mutation.entityServerId ?? mutation.entityLocalId;

  /* ---------------- delete: soft delete ---------------- */
  if (mutation.op === 'delete') {
    if (!report) return { serverId: targetId, updatedAt: null };
    await db
      .update(schema.dailyReports)
      .set({ deletedAt: now, updatedAt: now, originDeviceId: deviceId })
      .where(eq(schema.dailyReports.id, report.id));
    return { serverId: report.id, updatedAt: now.toISOString() };
  }

  /* ---------------- create tanpa baris server: butuh minimal header ---------------- */
  if (!report) {
    const wellId = asUuidOrNull(payload.wellId);
    const reportDate = asDateOnly(payload.reportDate);
    const depthMdStart = asNumberOrNull(payload.depthMdStart);
    const depthMdEnd = asNumberOrNull(payload.depthMdEnd);

    if (!wellId || !reportDate || depthMdStart === null || depthMdEnd === null) {
      // Laporan tidak ada & payload tidak cukup untuk membuat - reject.
      throw new ApiError(
        422,
        'REPORT_NOT_FOUND',
        `Laporan ${targetId} tidak ada di server dan payload mutation tidak memuat wellId/reportDate/depth yang cukup untuk membuatnya.`,
      );
    }

    const reportNo = await nextReportNo(wellId);
    const inserted = await db
      .insert(schema.dailyReports)
      .values({
        id: targetId,
        wellId,
        rigId: asUuidOrNull(payload.rigId) ?? null,
        reportDate,
        reportNo,
        periodFrom: asString(payload.periodFrom) ?? '06:00',
        periodTo: asString(payload.periodTo) ?? '06:00',
        depthMdStart: money(depthMdStart),
        depthMdEnd: money(depthMdEnd),
        depthTvd: moneyOrNullValue(payload.depthTvd),
        progress24h: money(round2(depthMdEnd - depthMdStart)),
        summary: asString(payload.summary) ?? null,
        planNext: asString(payload.planNext) ?? null,
        geologyNotes: asString(payload.geologyNotes) ?? null,
        equipmentStatus: equipmentStatusOf(payload.equipmentStatus),
        // Server selalu mulai dari draft; status tidak pernah diambil dari device.
        status: 'draft',
        originDeviceId: deviceId,
        revision: 1,
      })
      .returning({ id: schema.dailyReports.id, updatedAt: schema.dailyReports.updatedAt });

    return { serverId: inserted[0]?.id ?? targetId, updatedAt: toIsoOrNull(inserted[0]?.updatedAt) };
  }

  /* ---------------- update header ---------------- */
  /**
   * HANYA kolom header yang diizinkan (REPORT_HEADER_COLUMNS) yang masuk `set`.
   * Nilai dari payload untuk `status`/`approvedAt`/`approvedBy`/`signatureName`
   * dsb. tidak pernah dibaca - status hanya berubah via endpoint submit/approve.
   */
  const set: Partial<typeof schema.dailyReports.$inferInsert> = {};

  if (payload.depthMdStart !== undefined || payload.depth_md_start !== undefined) {
    const v = asNumberOrNull(payload.depthMdStart ?? payload.depth_md_start);
    if (v !== null) set.depthMdStart = money(v);
  }
  if (payload.depthMdEnd !== undefined || payload.depth_md_end !== undefined) {
    const v = asNumberOrNull(payload.depthMdEnd ?? payload.depth_md_end);
    if (v !== null) set.depthMdEnd = money(v);
  }
  if (payload.depthTvd !== undefined) set.depthTvd = moneyOrNullValue(payload.depthTvd);
  if (payload.summary !== undefined) set.summary = asString(payload.summary) ?? null;
  if (payload.planNext !== undefined || payload.plan_next !== undefined) {
    set.planNext = asString(payload.planNext ?? payload.plan_next) ?? null;
  }
  if (payload.geologyNotes !== undefined || payload.geology_notes !== undefined) {
    set.geologyNotes = asString(payload.geologyNotes ?? payload.geology_notes) ?? null;
  }
  if (payload.equipmentStatus !== undefined) set.equipmentStatus = equipmentStatusOf(payload.equipmentStatus);

  // progress24h selalu diturunkan dari depth (parity dengan updateReportHeader).
  if (set.depthMdStart !== undefined || set.depthMdEnd !== undefined) {
    const start = set.depthMdStart !== undefined ? Number(set.depthMdStart) : toNum(report.depthMdStart);
    const end = set.depthMdEnd !== undefined ? Number(set.depthMdEnd) : toNum(report.depthMdEnd);
    set.progress24h = money(round2(end - start));
  }

  // Kolom sync standar: revision naik 1, updatedAt = now, originDeviceId = device.
  await db
    .update(schema.dailyReports)
    .set({
      ...set,
      originDeviceId: deviceId,
      revision: sql`${schema.dailyReports.revision} + 1`,
      updatedAt: now,
    })
    .where(eq(schema.dailyReports.id, report.id));

  // `status`, `approvedAt`, `approvedBy` di baris TIDAK disentuh di sini (tetap milik
  // server; device melihatnya lagi lewat pull) - sesuai aturan "no auto-overwrite".
  return { serverId: report.id, updatedAt: now.toISOString() };
}

function moneyOrNullValue(n: unknown): string | null {
  const v = asNumberOrNull(n);
  return v === null ? null : v.toFixed(2);
}

function asUuidOrNull(value: unknown): string | null {
  return isUuid(value) ? value : null;
}

function equipmentStatusOf(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = asString(v) ?? '';
  }
  return out;
}

async function nextReportNo(wellId: string): Promise<number> {
  const rows = await db
    .select({ reportNo: schema.dailyReports.reportNo })
    .from(schema.dailyReports)
    .where(eq(schema.dailyReports.wellId, wellId))
    .orderBy(sql`${schema.dailyReports.reportNo} DESC`)
    .limit(1);
  return (rows[0]?.reportNo ?? 0) + 1;
}

/* ------------------------------------------------------------------ */
/* Penerapan mutation - entity anak                                    */
/* ------------------------------------------------------------------ */

type ChildContext = { reportId: string; deviceId: string };

async function applyTimeBreakdown(mutation: SyncMutation, ctx: ChildContext): Promise<string | null> {
  const payload = mutation.payload as Payload;
  const rows = Array.isArray(payload.rows)
    ? payload.rows
    : Array.isArray(payload.timeRows)
      ? payload.timeRows
      : [payload];

  const prepared = rows
    .filter((r): r is Payload => !!r && typeof r === 'object')
    .map((r, i) => {
      const start = asString(r.start) ?? '';
      const end = asString(r.end) ?? '';
      const iadcCode = asString(r.iadcCode) ?? asString(r.code) ?? '';
      const durationMin = rowDurationMinutes(start, end);
      if (durationMin === null) {
        throw new ApiError(
          422,
          'SYNC_ROW_INVALID',
          `Baris ${i + 1}: format waktu tidak valid (${start} - ${end}).`,
        );
      }
      const nptFlag = asBool(r.nptFlag ?? r.npt, false);
      return {
        reportId: ctx.reportId,
        sortOrder: i + 1,
        startHm: start,
        endHm: end,
        durationMin,
        iadcCode,
        iadcSubcode: asString(r.iadcSubcode ?? r.subcode) ?? null,
        vendor: asString(r.vendor) ?? null,
        nptFlag,
        timeClass: nptFlag ? 'NPT' : classifyTime(iadcCode),
        remarks: asString(r.remarks) ?? null,
        originDeviceId: ctx.deviceId,
      };
    });

  const result = validateTimeBreakdown(
    prepared.map((r) => ({
      start: r.startHm,
      end: r.endHm,
      code: r.iadcCode,
      npt: r.nptFlag,
      remarks: r.remarks ?? undefined,
    })),
    { requireFull24h: false },
  );

  if (!result.ok) {
    throw new ApiError(422, 'VALIDATION_FAILED', 'Time breakdown dari device tidak valid.', result.issues);
  }

  await db.transaction(async (tx) => {
    await tx.delete(schema.timeBreakdown).where(eq(schema.timeBreakdown.reportId, ctx.reportId));
    if (prepared.length > 0) await tx.insert(schema.timeBreakdown).values(prepared);

    await tx
      .update(schema.dailyReports)
      .set({
        totalMinutes: result.totalMinutes,
        updatedAt: new Date(),
        originDeviceId: ctx.deviceId,
      })
      .where(eq(schema.dailyReports.id, ctx.reportId));
  });

  return createdRowId(mutation);
}

async function applyCostLine(mutation: SyncMutation, ctx: ChildContext): Promise<string | null> {
  const payload = mutation.payload as Payload;
  const now = new Date();

  // delete → soft delete baris yang dimaksud (atau seluruh baris laporan bila payload kosong).
  if (mutation.op === 'delete') {
    const rowId = mutation.entityServerId ?? asUuidOrNull(payload.id) ?? mutation.entityLocalId;
    await db.transaction(async (tx) => {
      if (isUuid(rowId)) {
        await tx
          .update(schema.costLines)
          .set({ deletedAt: now, updatedAt: now, originDeviceId: ctx.deviceId })
          .where(and(eq(schema.costLines.id, rowId), eq(schema.costLines.reportId, ctx.reportId)));
      } else {
        await tx
          .update(schema.costLines)
          .set({ deletedAt: now, updatedAt: now, originDeviceId: ctx.deviceId })
          .where(and(eq(schema.costLines.reportId, ctx.reportId), isNull(schema.costLines.deletedAt)));
      }
      await recomputeReportCosts(tx as Parameters<typeof recomputeReportCosts>[0], ctx.reportId);
    });
    return rowId;
  }

  const amount = asNumberOrNull(payload.amount) ?? asNumberOrNull(payload.amountUsd) ?? 0;
  const rowId = isUuid(mutation.entityServerId) ? mutation.entityServerId : isUuid(payload.id) ? payload.id : null;

  const inserted = await db.transaction(async (tx) => {
    const reportRows = await tx
      .select({ wellId: schema.dailyReports.wellId })
      .from(schema.dailyReports)
      .where(eq(schema.dailyReports.id, ctx.reportId))
      .limit(1);

    const values = {
      reportId: ctx.reportId,
      wellId: reportRows[0]?.wellId ?? null,
      category: asString(payload.category) ?? 'Uncategorized',
      description: asString(payload.description) ?? '',
      vendor: asString(payload.vendor) ?? null,
      afeCode: asString(payload.afeCode) ?? null,
      billingType: asString(payload.billingType) ?? null,
      amountUsd: money(amount),
      rebillable: asBool(payload.rebillable, false),
      originDeviceId: ctx.deviceId,
      updatedAt: now,
    };

    let id: string | null = null;

    if (rowId) {
      const updated = await tx
        .update(schema.costLines)
        .set(values)
        .where(eq(schema.costLines.id, rowId))
        .returning({ id: schema.costLines.id });
      id = updated[0]?.id ?? null;
    }

    if (!id) {
      const rows = await tx
        .insert(schema.costLines)
        .values({ ...values, id: rowId ?? undefined })
        .returning({ id: schema.costLines.id });
      id = rows[0]?.id ?? null;
    }

    await recomputeReportCosts(tx as Parameters<typeof recomputeReportCosts>[0], ctx.reportId);
    return id;
  });

  return inserted;
}

async function applyCrew(mutation: SyncMutation, ctx: ChildContext): Promise<string | null> {
  const payload = mutation.payload as Payload;
  const now = new Date();
  const rowId = isUuid(mutation.entityServerId) ? mutation.entityServerId : isUuid(payload.id) ? payload.id : null;

  if (mutation.op === 'delete') {
    await db
      .update(schema.crewMembers)
      .set({ deletedAt: now, updatedAt: now, originDeviceId: ctx.deviceId })
      .where(
        rowId
          ? and(eq(schema.crewMembers.reportId, ctx.reportId), eq(schema.crewMembers.id, rowId))
          : eq(schema.crewMembers.reportId, ctx.reportId),
      );
    return rowId;
  }

  const values = {
    reportId: ctx.reportId,
    name: asString(payload.name) ?? '',
    position: asString(payload.position) ?? 'Crew',
    company: asString(payload.company) ?? null,
    shift: asString(payload.shift) ?? 'Day',
    hours: money(asNumberOrNull(payload.hours) ?? 12),
    pobStatus: asString(payload.pobStatus) ?? 'in',
    musterStation: asString(payload.musterStation) ?? null,
    originDeviceId: ctx.deviceId,
    updatedAt: now,
  };

  if (rowId) {
    const updated = await db
      .update(schema.crewMembers)
      .set(values)
      .where(eq(schema.crewMembers.id, rowId))
      .returning({ id: schema.crewMembers.id });
    if (updated[0]) return updated[0].id;
  }

  const inserted = await db
    .insert(schema.crewMembers)
    .values({ ...values, id: rowId ?? undefined })
    .returning({ id: schema.crewMembers.id });
  return inserted[0]?.id ?? null;
}

async function applyMud(mutation: SyncMutation, ctx: ChildContext): Promise<string | null> {
  const payload = mutation.payload as Payload;
  const now = new Date();

  const num = (key: string) => (payload[key] === undefined ? undefined : moneyOrNullValue(payload[key]));
  const text = (key: string) => (payload[key] === undefined ? undefined : asString(payload[key]) ?? null);

  const patch: Record<string, unknown> = { updatedAt: now, originDeviceId: ctx.deviceId };
  for (const key of ['weightPpg', 'viscositySecQt', 'ph', 'pv', 'yp', 'costUsd'] as const) {
    const v = num(key);
    if (v !== undefined) patch[key] = v;
  }
  for (const key of ['chemicalsAdded'] as const) {
    const v = text(key);
    if (v !== undefined) patch[key] = v;
  }

  const existing = await db
    .select({ id: schema.mudRecords.id })
    .from(schema.mudRecords)
    .where(eq(schema.mudRecords.reportId, ctx.reportId))
    .limit(1);

  if (existing[0]) {
    if (mutation.op === 'delete') {
      await db
        .update(schema.mudRecords)
        .set({ deletedAt: now, updatedAt: now, originDeviceId: ctx.deviceId })
        .where(eq(schema.mudRecords.reportId, ctx.reportId));
      return existing[0].id;
    }
    await db.update(schema.mudRecords).set(patch).where(eq(schema.mudRecords.reportId, ctx.reportId));
    return existing[0].id;
  }

  if (mutation.op === 'delete') return null;

  const inserted = await db
    .insert(schema.mudRecords)
    .values({ reportId: ctx.reportId, ...patch })
    .returning({ id: schema.mudRecords.id });
  return inserted[0]?.id ?? null;
}

async function applySafetyIncident(mutation: SyncMutation, ctx: ChildContext): Promise<string | null> {
  const payload = mutation.payload as Payload;
  const now = new Date();
  const rowId = isUuid(mutation.entityServerId) ? mutation.entityServerId : isUuid(payload.id) ? payload.id : null;

  if (mutation.op === 'delete') {
    if (!rowId) return null;
    await db
      .update(schema.safetyIncidents)
      .set({ deletedAt: now, updatedAt: now, originDeviceId: ctx.deviceId })
      .where(and(eq(schema.safetyIncidents.id, rowId), eq(schema.safetyIncidents.reportId, ctx.reportId)));
    return rowId;
  }

  const values = {
    reportId: ctx.reportId,
    refNo: asString(payload.refNo) ?? null,
    type: asString(payload.type) ?? 'Incident',
    severity: asString(payload.severity) ?? 'medium',
    occurredAt: asTimestampOrNull(payload.occurredAt),
    location: asString(payload.location) ?? null,
    description: asString(payload.description) ?? '',
    immediateAction: asString(payload.immediateAction) ?? null,
    correctiveAction: asString(payload.correctiveAction) ?? null,
    assignee: asString(payload.assignee) ?? null,
    dueDate: asDateOnly(payload.dueDate),
    status: asString(payload.status) ?? 'open',
    originDeviceId: ctx.deviceId,
    updatedAt: now,
  };

  if (rowId) {
    const updated = await db
      .update(schema.safetyIncidents)
      .set(values)
      .where(eq(schema.safetyIncidents.id, rowId))
      .returning({ id: schema.safetyIncidents.id });
    if (updated[0]) return updated[0].id;
  }

  const inserted = await db
    .insert(schema.safetyIncidents)
    .values({ ...values, id: rowId ?? undefined })
    .returning({ id: schema.safetyIncidents.id });
  return inserted[0]?.id ?? null;
}

/** Fallback ID untuk ack bila operasi tidak menghasilkan baris baru. */
function createdRowId(mutation: SyncMutation): string | null {
  return mutation.entityServerId ?? mutation.entityLocalId ?? null;
}

/* ------------------------------------------------------------------ */
/* Penerapan mutation - orchestrator (dipakai juga resolver konflik)   */
/* ------------------------------------------------------------------ */

export type ApplyMutationOptions = {
  /** Resolver konflik memakai ini agar catatan audit menyebut aktor nyata. */
  deviceId: string;
  /**
   * Paksa terapkan walau laporan terkunci (dipakai resolver konflik
   * `keep_rig` / `merge`, dan oleh `handlePush` SETELAH device lulus aturan
   * konflik - supaya ack `conflict` tercatat tepat sekali).
   */
  force?: boolean;
};

/**
 * Terapkan SATU mutation ke database (tanpa mencatat `sync_mutation_log`).
 * Error strategis dilempar sebagai `ApiError` dengan `code` yang stabil.
 */
export async function applyMutation(
  mutation: SyncMutation,
  options: ApplyMutationOptions,
): Promise<{ serverId: string | null; updatedAt: string | null }> {
  const ctx = await resolveContext(mutation);

  if (mutation.entity === 'daily_report') {
    if (!options.force) {
      const reason = conflictReason({
        entity: mutation.entity,
        report: ctx.report,
        baseServerUpdatedAt: mutation.baseServerUpdatedAt ?? null,
      });
      if (reason) throw new ApiError(409, 'SYNC_CONFLICT', reason, { reportId: ctx.report?.id ?? null });
    }
    const applied = await applyDailyReport(mutation, ctx.report, options.deviceId);
    return { serverId: applied.serverId, updatedAt: applied.updatedAt };
  }

  const parent = ctx.parentReport;
  if (!parent) {
    throw new ApiError(
      422,
      'PARENT_REPORT_NOT_FOUND',
      `Report induk untuk entitas ${mutation.entity} tidak ditemukan (payload.reportId / reportNo+reportDate).`,
    );
  }

  if (!options.force) {
    const reason = conflictReason({
      entity: mutation.entity,
      report: parent,
      baseServerUpdatedAt: mutation.baseServerUpdatedAt ?? null,
    });
    if (reason) throw new ApiError(409, 'SYNC_CONFLICT', reason, { reportId: parent.id });
  }

  const childCtx: ChildContext = { reportId: parent.id, deviceId: options.deviceId };
  const now = new Date().toISOString();

  switch (mutation.entity) {
    case 'time_breakdown': {
      const id = await applyTimeBreakdown(mutation, childCtx);
      return { serverId: id, updatedAt: now };
    }
    case 'cost_line': {
      const id = await applyCostLine(mutation, childCtx);
      return { serverId: id, updatedAt: now };
    }
    case 'crew': {
      const id = await applyCrew(mutation, childCtx);
      return { serverId: id, updatedAt: now };
    }
    case 'mud': {
      const id = await applyMud(mutation, childCtx);
      return { serverId: id, updatedAt: now };
    }
    case 'safety_incident': {
      const id = await applySafetyIncident(mutation, childCtx);
      return { serverId: id, updatedAt: now };
    }
    case 'well':
    case 'rig':
      // Well/rig adalah master data kantor - device tidak menulis ke sini pada MVP.
      return { serverId: mutation.entityServerId ?? mutation.entityLocalId, updatedAt: null };
    default: {
      const exhaustive: never = mutation.entity;
      throw new ApiError(400, 'SYNC_ENTITY_UNKNOWN', `Entitas sync tidak dikenal: ${String(exhaustive)}.`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Device bookkeeping                                                  */
/* ------------------------------------------------------------------ */

async function touchDevice(deviceId: string, patch: { lastSeenAt?: Date; lastPulledAt?: Date }): Promise<void> {
  await db
    .update(schema.syncDevices)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.syncDevices.deviceId, deviceId));
}

/* ------------------------------------------------------------------ */
/* PUSH                                                                */
/* ------------------------------------------------------------------ */

async function idempotentAck(mutation: SyncMutation): Promise<SyncPushAck | null> {
  const rows = await db
    .select({
      entityServerId: schema.syncMutationLog.entityServerId,
      result: schema.syncMutationLog.result,
    })
    .from(schema.syncMutationLog)
    .where(eq(schema.syncMutationLog.clientMutationId, mutation.clientMutationId))
    .limit(1);

  const existing = rows[0];
  if (!existing) return null;

  // Hasil `rejected` tidak punya efek samping → boleh dicoba ulang device.
  if (existing.result === 'rejected') return null;

  // Akses ulang setelah device memperbaiki IDs lokal tidak menandai baris log sebagai reject.
  const status = existing.result === 'conflict' ? 'conflict' : 'acked';

  return {
    clientMutationId: mutation.clientMutationId,
    status,
    entityServerId: existing.entityServerId ?? mutation.entityServerId ?? mutation.entityLocalId,
    serverUpdatedAt: null,
    conflictReason: status === 'conflict' ? 'DUPLICATE_CONFLICT' : null,
    serverPayload: null,
  };
}

async function logMutation(
  mutation: SyncMutation,
  deviceId: string,
  result: 'acked' | 'conflict' | 'rejected',
  entityServerId: string | null,
): Promise<void> {
  await db
    .insert(schema.syncMutationLog)
    .values({
      clientMutationId: mutation.clientMutationId,
      deviceId,
      entity: mutation.entity,
      entityServerId: isUuid(entityServerId) ? entityServerId : null,
      result,
    })
    .onConflictDoNothing({ target: schema.syncMutationLog.clientMutationId });
}

async function recordConflict(
  mutation: SyncMutation,
  deviceId: string,
  report: ReportRow,
  reason: string,
): Promise<void> {
  await db.insert(schema.syncConflicts).values({
    deviceId,
    entity: mutation.entity,
    entityServerId: isUuid(mutation.entityServerId) ? mutation.entityServerId : report.id,
    entityLocalId: isUuid(mutation.entityLocalId) ? mutation.entityLocalId : null,
    clientMutationId: mutation.clientMutationId,
    rigPayload: mutation.payload as Payload,
    serverPayload: reportRowToObject(report),
    reason,
    status: 'open',
  });
}

/**
 * Proses batch push dari device (max 500 mutation - divalidasi schema request).
 *
 * Urutan per mutation: idempotensi → verifikasi hash → lookup entitas →
 * aturan konflik → terapkan → catat log. Satu mutation gagal tidak pernah
 * menggagalkan mutation lain di batch yang sama.
 */
export async function handlePush(body: { deviceId: string; mutations: SyncMutation[] }): Promise<SyncPushResponse> {
  const acks: SyncPushAck[] = [];
  const deviceId = body.deviceId;

  for (const mutation of body.mutations) {
    // 1. Idempotensi - mutation yang sudah pernah diproses tidak diulang.
    const duplicate = await idempotentAck(mutation);
    if (duplicate) {
      acks.push(duplicate);
      continue;
    }

    const reject = async (reason: string, entityServerId: string | null = null): Promise<void> => {
      await logMutation(mutation, deviceId, 'rejected', entityServerId);
      acks.push({
        clientMutationId: mutation.clientMutationId,
        status: 'rejected',
        entityServerId,
        conflictReason: reason,
      });
    };

    // 2. Verifikasi hash payload (skip bila kosong - toleran terhadap device lama).
    if (mutation.hash && mutation.hash.trim().length > 0) {
      const actual = payloadHash(mutation.payload);
      if (actual !== mutation.hash.trim()) {
        await reject('PAYLOAD_HASH_MISMATCH');
        continue;
      }
    }

    try {
      // 3-5. Lookup entitas target + aturan konflik + terapkan.
      // `applyMutation` sendiri yang menolak laporan terkunci (throws SYNC_CONFLICT
      // berisi reportId) - sehingga ack `conflict` tercatat maksimal sekali.
      const applied = await applyMutation(mutation, { deviceId });

      // 6. Catat ledger idempotensi.
      await logMutation(mutation, deviceId, 'acked', applied.serverId);

      acks.push({
        clientMutationId: mutation.clientMutationId,
        status: 'acked',
        entityServerId: applied.serverId,
        serverUpdatedAt: applied.updatedAt,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SYNC_CONFLICT') {
        // 4. Konflik: jangan timpa - catat untuk resolusi manual.
        const conflictReportId = (err.details as { reportId?: string | null } | undefined)?.reportId ?? null;
        const target = conflictReportId ? await findReportById(conflictReportId) : null;

        if (target) {
          await recordConflict(mutation, deviceId, target, err.message);
          await logMutation(mutation, deviceId, 'conflict', target.id);
          acks.push({
            clientMutationId: mutation.clientMutationId,
            status: 'conflict',
            entityServerId: target.id,
            serverUpdatedAt: toIsoOrNull(target.updatedAt),
            conflictReason: err.message,
            serverPayload: reportRowToObject(target),
          });
        } else {
          await reject('SYNC_CONFLICT', conflictReportId);
        }
        continue;
      }

      if (err instanceof ApiError) {
        await reject(err.code, null);
        continue;
      }

      console.error('[sync/push] mutation gagal:', mutation.clientMutationId, err);
      await reject('INTERNAL_ERROR');
    }
  }

  // 7. Tandai device terlihat.
  await touchDevice(deviceId, { lastSeenAt: new Date() });

  return { deviceId, serverTime: new Date().toISOString(), acks };
}

/* ------------------------------------------------------------------ */
/* PULL                                                                */
/* ------------------------------------------------------------------ */

type PullChange = {
  entity: string;
  entityServerId: string;
  entityLocalId?: string | null;
  op: 'upsert' | 'delete';
  updatedAt: string;
  payload: Record<string, unknown>;
};

function isoOf(value: unknown): string {
  return toIsoOrNull(value) ?? DEFAULT_PULL_SINCE;
}

/**
 * Ambil perubahan sejak `since` untuk satu entity (limit page).
 *
 * Include baris `deletedAt != null` dengan op `delete` supaya device tahu harus
 * menghapus lokal. `updatedAt` dipakai sebagai kursor (bukan `deletedAt`).
 */
async function pullEntity(
  entity: string,
  since: string,
  limit: number,
): Promise<PullChange[]> {
  const sinceDate = new Date(since);
  const take = limit + 1; // +1 untuk deteksi hasMore

  const mapRow = (
    row: { id: string; updatedAt: Date; deletedAt: Date | null } & Record<string, unknown>,
    payload: Record<string, unknown>,
  ): PullChange => ({
    entity,
    entityServerId: row.id,
    entityLocalId: row.id,
    op: row.deletedAt ? 'delete' : 'upsert',
    updatedAt: isoOf(row.updatedAt),
    payload,
  });

  switch (entity) {
    case 'wells': {
      const rows = await db
        .select()
        .from(schema.wells)
        .where(gt(schema.wells.updatedAt, sinceDate))
        .orderBy(asc(schema.wells.updatedAt))
        .limit(take);
      return rows.map((r) =>
        mapRow(r, {
          id: r.id,
          name: r.name,
          apiNo: r.apiNo,
          type: r.type,
          phase: r.phase,
          spudDate: r.spudDate,
          tdPlannedM: toNumOrNull(r.tdPlannedM),
          lat: toNumOrNull(r.lat),
          lon: toNumOrNull(r.lon),
          afeBudgetUsd: toNumOrNull(r.afeBudgetUsd),
          operator: r.operator,
          fieldId: r.fieldId,
          revision: r.revision,
          updatedAt: isoOf(r.updatedAt),
          deletedAt: toIsoOrNull(r.deletedAt),
        }),
      );
    }
    case 'rigs': {
      const rows = await db
        .select()
        .from(schema.rigs)
        .where(gt(schema.rigs.updatedAt, sinceDate))
        .orderBy(asc(schema.rigs.updatedAt))
        .limit(take);
      return rows.map((r) =>
        mapRow(r, {
          id: r.id,
          name: r.name,
          code: r.code,
          type: r.type,
          contractor: r.contractor,
          contractRef: r.contractRef,
          revision: r.revision,
          updatedAt: isoOf(r.updatedAt),
          deletedAt: toIsoOrNull(r.deletedAt),
        }),
      );
    }
    case 'daily_reports': {
      const rows = await db
        .select()
        .from(schema.dailyReports)
        .where(gt(schema.dailyReports.updatedAt, sinceDate))
        .orderBy(asc(schema.dailyReports.updatedAt))
        .limit(take);
      return rows.map((r) => mapRow(r, reportRowToObject(r)));
    }
    case 'time_breakdown': {
      const rows = await db
        .select()
        .from(schema.timeBreakdown)
        .where(gt(schema.timeBreakdown.updatedAt, sinceDate))
        .orderBy(asc(schema.timeBreakdown.updatedAt))
        .limit(take);
      return rows.map((r) =>
        mapRow(r, {
          id: r.id,
          reportId: r.reportId,
          sortOrder: r.sortOrder,
          start: r.startHm,
          end: r.endHm,
          durationMin: r.durationMin,
          iadcCode: r.iadcCode,
          iadcSubcode: r.iadcSubcode,
          vendorId: r.vendorId,
          nptFlag: r.nptFlag,
          timeClass: r.timeClass,
          remarks: r.remarks,
          updatedAt: isoOf(r.updatedAt),
          deletedAt: toIsoOrNull(r.deletedAt),
        }),
      );
    }
    case 'crew_members': {
      const rows = await db
        .select()
        .from(schema.crewMembers)
        .where(gt(schema.crewMembers.updatedAt, sinceDate))
        .orderBy(asc(schema.crewMembers.updatedAt))
        .limit(take);
      return rows.map((r) =>
        mapRow(r, {
          id: r.id,
          reportId: r.reportId,
          name: r.name,
          position: r.position,
          company: r.company,
          shift: r.shift,
          hours: toNum(r.hours),
          pobStatus: r.pobStatus,
          musterStation: r.musterStation,
          updatedAt: isoOf(r.updatedAt),
          deletedAt: toIsoOrNull(r.deletedAt),
        }),
      );
    }
    case 'cost_lines': {
      const rows = await db
        .select()
        .from(schema.costLines)
        .where(gt(schema.costLines.updatedAt, sinceDate))
        .orderBy(asc(schema.costLines.updatedAt))
        .limit(take);
      return rows.map((r) =>
        mapRow(r, {
          id: r.id,
          reportId: r.reportId,
          wellId: r.wellId,
          category: r.category,
          description: r.description,
          vendor: r.vendor,
          afeCode: r.afeCode,
          billingType: r.billingType,
          amount: toNum(r.amountUsd),
          rebillable: r.rebillable,
          updatedAt: isoOf(r.updatedAt),
          deletedAt: toIsoOrNull(r.deletedAt),
        }),
      );
    }
    default:
      return [];
  }
}

const PULL_ENTITIES = ['wells', 'rigs', 'daily_reports', 'time_breakdown', 'crew_members', 'cost_lines'] as const;

/** Delta pull untuk device: semua tabel operasional sejak `since`. */
export async function handlePull(params: {
  deviceId: string;
  since?: string | null;
  entities?: string[];
}): Promise<PullResult> {
  const since = params.since && params.since.trim().length > 0 ? params.since.trim() : DEFAULT_PULL_SINCE;

  if (Number.isNaN(new Date(since).getTime())) {
    throw new ApiError(400, 'INVALID_SINCE', `Format "since" tidak valid (${since}). Gunakan ISO timestamp.`);
  }

  const requested = params.entities?.length ? params.entities : [...PULL_ENTITIES];
  const selected = requested.filter((e): e is (typeof PULL_ENTITIES)[number] =>
    (PULL_ENTITIES as readonly string[]).includes(e),
  );

  const perEntity = await Promise.all(selected.map((entity) => pullEntity(entity, since, PULL_PAGE_SIZE)));

  // Deteksi hasMore per entity lalu potong ke PULL_PAGE_SIZE secara adil (round-robin per tabel).
  const hasMore = perEntity.some((rows) => rows.length > PULL_PAGE_SIZE);
  let changes: PullChange[] = [];
  for (const rows of perEntity) {
    changes = changes.concat(rows.slice(0, PULL_PAGE_SIZE));
  }

  if (changes.length > PULL_PAGE_SIZE) {
    changes = changes
      .slice()
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      .slice(0, PULL_PAGE_SIZE);
  }

  await touchDevice(params.deviceId, { lastSeenAt: new Date(), lastPulledAt: new Date() });

  return {
    serverTime: new Date().toISOString(),
    changes,
    hasMore,
  };
}
