/**
 * Repository - Daily Drilling Report (DDR).
 *
 * SATU-SATUNYA tempat query Drizzle untuk `daily_reports` & anak-anaknya.
 * Semua angka (durasi baris, PRD/NPT/WOW, validasi 24 jam) dihitung oleh
 * `@rigdaily/shared` - jangan duplikasi logika di sini.
 */
import 'server-only';
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, lte, max, ne } from 'drizzle-orm';
import { db, schema } from '@rigdaily/database';
import { classifyTime, rowDurationMinutes, round2, summarizeTime, type TimeRowInput } from '@rigdaily/shared';
import type {
  BhaDto,
  CostLineDto,
  CrewDto,
  IncidentDto,
  MacDto,
  MudDto,
  ReportDetail,
  ReportListItem,
  SurveyDto,
  TimeRowDto,
} from './types';
import {
  iadcNameOf,
  money,
  moneyOrNull,
  nptPercentOf,
  recomputeReportCosts,
  toIso,
  toNum,
  toNumOrNull,
  validateRowsFromDb,
  cleanTextOrNull,
  cleanDeep,
} from './shared';

/* ------------------------------------------------------------------ */
/* Selection & mapper                                                  */
/* ------------------------------------------------------------------ */

const reportSelection = {
  report: schema.dailyReports,
  wellName: schema.wells.name,
  rigName: schema.rigs.name,
} as const;

type ReportRow = {
  report: typeof schema.dailyReports.$inferSelect;
  wellName: string;
  rigName: string | null;
};

function reportListItem(row: ReportRow): ReportListItem {
  const r = row.report;
  return {
    id: r.id,
    reportNo: r.reportNo,
    reportDate: r.reportDate,
    wellId: r.wellId,
    wellName: row.wellName,
    rigId: r.rigId,
    rigName: row.rigName,
    depthMdStart: toNum(r.depthMdStart),
    depthMdEnd: toNum(r.depthMdEnd),
    progress24h: toNum(r.progress24h),
    totalMinutes: r.totalMinutes,
    productiveMinutes: r.productiveMinutes,
    nptMinutes: r.nptMinutes,
    wowMinutes: r.wowMinutes,
    nptPercent: nptPercentOf(r.totalMinutes, r.nptMinutes, r.wowMinutes),
    costDailyUsd: toNum(r.costDailyUsd),
    status: r.status,
    updatedAt: toIso(r.updatedAt) ?? new Date(0).toISOString(),
  };
}

function baseQuery() {
  return db
    .select(reportSelection)
    .from(schema.dailyReports)
    .innerJoin(schema.wells, eq(schema.dailyReports.wellId, schema.wells.id))
    .leftJoin(schema.rigs, eq(schema.dailyReports.rigId, schema.rigs.id));
}

function reportWhere(filter: {
  wellId?: string;
  rigId?: string;
  status?: string;
  from?: string;
  to?: string;
}) {
  const parts = [isNull(schema.dailyReports.deletedAt), isNull(schema.wells.deletedAt)];
  if (filter.wellId) parts.push(eq(schema.dailyReports.wellId, filter.wellId));
  if (filter.rigId) parts.push(eq(schema.dailyReports.rigId, filter.rigId));
  if (filter.status && filter.status !== 'all') parts.push(eq(schema.dailyReports.status, filter.status));
  if (filter.from) parts.push(gte(schema.dailyReports.reportDate, filter.from));
  if (filter.to) parts.push(lte(schema.dailyReports.reportDate, filter.to));
  return and(...parts);
}

async function findReportRow(id: string): Promise<ReportRow | null> {
  const rows = await baseQuery()
    .where(and(eq(schema.dailyReports.id, id), isNull(schema.dailyReports.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* Baca laporan                                                        */
/* ------------------------------------------------------------------ */

export async function listReports(filter: {
  wellId?: string;
  rigId?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ items: ReportListItem[]; total: number }> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
  const offset = Math.max(filter.offset ?? 0, 0);
  const where = reportWhere(filter);

  const [rows, totalRows] = await Promise.all([
    baseQuery()
      .where(where)
      .orderBy(
        desc(schema.dailyReports.reportDate),
        desc(schema.dailyReports.reportNo),
        desc(schema.dailyReports.revision),
      )
      .limit(limit)
      .offset(offset),
    db
      .select({ n: count() })
      .from(schema.dailyReports)
      .innerJoin(schema.wells, eq(schema.dailyReports.wellId, schema.wells.id))
      .where(where),
  ]);

  return { items: rows.map(reportListItem), total: Number(totalRows[0]?.n ?? 0) };
}

export async function getReportById(id: string): Promise<ReportDetail | null> {
  const row = await findReportRow(id);
  if (!row) return null;

  const [timeRows, crew, mudRows, bha, costLines, incidents, survey, mac] = await Promise.all([
    db
      .select({ row: schema.timeBreakdown, vendorName: schema.vendors.name })
      .from(schema.timeBreakdown)
      .leftJoin(schema.vendors, eq(schema.timeBreakdown.vendorId, schema.vendors.id))
      .where(and(eq(schema.timeBreakdown.reportId, id), isNull(schema.timeBreakdown.deletedAt)))
      .orderBy(asc(schema.timeBreakdown.sortOrder), asc(schema.timeBreakdown.createdAt)),
    db
      .select()
      .from(schema.crewMembers)
      .where(and(eq(schema.crewMembers.reportId, id), isNull(schema.crewMembers.deletedAt)))
      .orderBy(asc(schema.crewMembers.createdAt)),
    db
      .select()
      .from(schema.mudRecords)
      .where(and(eq(schema.mudRecords.reportId, id), isNull(schema.mudRecords.deletedAt)))
      .limit(1),
    db
      .select()
      .from(schema.bhaComponents)
      .where(and(eq(schema.bhaComponents.reportId, id), isNull(schema.bhaComponents.deletedAt)))
      .orderBy(asc(schema.bhaComponents.sortOrder), asc(schema.bhaComponents.createdAt)),
    db
      .select()
      .from(schema.costLines)
      .where(and(eq(schema.costLines.reportId, id), isNull(schema.costLines.deletedAt)))
      .orderBy(asc(schema.costLines.createdAt)),
    db
      .select()
      .from(schema.safetyIncidents)
      .where(and(eq(schema.safetyIncidents.reportId, id), isNull(schema.safetyIncidents.deletedAt)))
      .orderBy(asc(schema.safetyIncidents.createdAt)),
    db
      .select()
      .from(schema.surveyStations)
      .where(and(eq(schema.surveyStations.reportId, id), isNull(schema.surveyStations.deletedAt)))
      .orderBy(asc(schema.surveyStations.md)),
    db
      .select()
      .from(schema.macActivities)
      .where(and(eq(schema.macActivities.reportId, id), isNull(schema.macActivities.deletedAt)))
      .orderBy(asc(schema.macActivities.createdAt)),
  ]);

  const timeRowsDto: TimeRowDto[] = timeRows.map(({ row: t, vendorName }) => ({
    id: t.id,
    sortOrder: t.sortOrder,
    start: t.startHm,
    end: t.endHm,
    durationMin: t.durationMin,
    iadcCode: t.iadcCode,
    iadcName: iadcNameOf(t.iadcCode),
    iadcSubcode: t.iadcSubcode,
    vendor: vendorName,
    nptFlag: t.nptFlag,
    timeClass: t.timeClass,
    remarks: t.remarks,
  }));

  const crewDto: CrewDto[] = crew.map((c) => ({
    id: c.id,
    name: c.name,
    position: c.position,
    company: c.company,
    shift: c.shift,
    hours: toNum(c.hours),
    pobStatus: c.pobStatus,
    musterStation: c.musterStation,
  }));

  const mudRow = mudRows[0];
  const mudDto: MudDto | null = mudRow
    ? {
        weightPpg: toNumOrNull(mudRow.weightPpg),
        viscositySecQt: toNumOrNull(mudRow.viscositySecQt),
        ph: toNumOrNull(mudRow.ph),
        pv: toNumOrNull(mudRow.pv),
        yp: toNumOrNull(mudRow.yp),
        chemicalsAdded: mudRow.chemicalsAdded,
        costUsd: toNumOrNull(mudRow.costUsd),
      }
    : null;

  const bhaDto: BhaDto[] = bha.map((b) => ({
    id: b.id,
    sortOrder: b.sortOrder,
    component: b.component,
    odIn: toNumOrNull(b.odIn),
    lengthM: toNumOrNull(b.lengthM),
    hours: toNumOrNull(b.hours),
  }));

  const costLineDto: CostLineDto[] = costLines.map((c) => ({
    id: c.id,
    category: c.category,
    description: c.description,
    vendor: c.vendor,
    afeCode: c.afeCode,
    billingType: c.billingType,
    amount: toNum(c.amountUsd),
    rebillable: c.rebillable,
  }));

  const incidentDto: IncidentDto[] = incidents.map((i) => ({
    id: i.id,
    refNo: i.refNo,
    type: i.type,
    severity: i.severity,
    occurredAt: toIso(i.occurredAt),
    location: i.location,
    description: i.description,
    immediateAction: i.immediateAction,
    correctiveAction: i.correctiveAction,
    assignee: i.assignee,
    dueDate: i.dueDate,
    status: i.status,
  }));

  const surveyDto: SurveyDto[] = survey.map((s) => ({
    id: s.id,
    md: toNum(s.md),
    inclination: toNumOrNull(s.inclination),
    azimuth: toNumOrNull(s.azimuth),
    tvd: toNumOrNull(s.tvd),
  }));

  const macDto: MacDto[] = mac.map((m) => ({
    id: m.id,
    activityCenter: m.activityCenter,
    operation: m.operation,
    hours: toNum(m.hours),
    billable: m.billable,
  }));

  const validation = validateRowsFromDb(timeRows.map((t) => t.row));

  return {
    ...reportListItem(row),
    periodFrom: row.report.periodFrom,
    periodTo: row.report.periodTo,
    depthTvd: toNumOrNull(row.report.depthTvd),
    /*
     * Sanitasi teks: nilai lama di DB bisa mengandung mojibake (UTF-8 yang
     * terbaca sebagai CP1252). Dibersihkan saat dibaca agar UI tidak pernah
     * menampilkan karakter rusak, termasuk data yang ditulis sebelum
     * perbaikan encoding.
     */
    summary: cleanTextOrNull(row.report.summary),
    planNext: cleanTextOrNull(row.report.planNext),
    geologyNotes: cleanTextOrNull(row.report.geologyNotes),
    equipmentStatus: row.report.equipmentStatus
      ? cleanDeep(row.report.equipmentStatus)
      : null,
    costCumulativeUsd: toNum(row.report.costCumulativeUsd),
    signatureName: row.report.signatureName,
    submittedAt: toIso(row.report.submittedAt),
    approvedAt: toIso(row.report.approvedAt),
    revision: row.report.revision,
    parentReportId: row.report.parentReportId,
    timeRows: timeRowsDto,
    crew: crewDto,
    mud: mudDto,
    bha: bhaDto,
    costLines: costLineDto,
    incidents: incidentDto,
    survey: surveyDto,
    mac: macDto,
    validation,
  };
}

export async function getReportByWellAndDate(wellId: string, date: string): Promise<ReportDetail | null> {
  const rows = await db
    .select({ id: schema.dailyReports.id })
    .from(schema.dailyReports)
    .where(
      and(
        eq(schema.dailyReports.wellId, wellId),
        eq(schema.dailyReports.reportDate, date),
        isNull(schema.dailyReports.deletedAt),
      ),
    )
    .orderBy(desc(schema.dailyReports.revision), desc(schema.dailyReports.updatedAt))
    .limit(1);

  return rows[0] ? getReportById(rows[0].id) : null;
}

/** Laporan terakhir sebelum tanggal tertentu - untuk copy-forward DDR. */
export async function getPreviousReport(wellId: string, beforeDate: string): Promise<ReportDetail | null> {
  const rows = await db
    .select({ id: schema.dailyReports.id })
    .from(schema.dailyReports)
    .where(
      and(
        eq(schema.dailyReports.wellId, wellId),
        lt(schema.dailyReports.reportDate, beforeDate),
        isNull(schema.dailyReports.deletedAt),
      ),
    )
    .orderBy(desc(schema.dailyReports.reportDate), desc(schema.dailyReports.reportNo))
    .limit(1);

  return rows[0] ? getReportById(rows[0].id) : null;
}

/* ------------------------------------------------------------------ */
/* Tulis laporan                                                       */
/* ------------------------------------------------------------------ */

/** Nomor DDR berikutnya untuk satu sumur (max + 1, termasuk yang soft-deleted). */
export async function nextReportNo(wellId: string): Promise<number> {
  const rows = await db
    .select({ maxNo: max(schema.dailyReports.reportNo) })
    .from(schema.dailyReports)
    .where(eq(schema.dailyReports.wellId, wellId));
  const current = toNumOrNull(rows[0]?.maxNo);
  return (current ?? 0) + 1;
}

export async function createReport(input: {
  wellId: string;
  rigId?: string | null;
  reportDate: string;
  reportNo?: number;
  depthMdStart: number;
  depthMdEnd: number;
  summary?: string | null;
  planNext?: string | null;
  createdBy?: string | null;
}): Promise<{ id: string; reportNo: number }> {
  const reportNo = input.reportNo ?? (await nextReportNo(input.wellId));
  const progress24h = round2(input.depthMdEnd - input.depthMdStart);

  // Saldo kumulatif "berjalan": total harian semua DDR SEBELUM tanggal ini.
  // Report baru belum punya cost line, jadi costCumulativeUsd = saldo berjalan.
  const beforeRows = await db
    .select({ costDailyUsd: schema.dailyReports.costDailyUsd })
    .from(schema.dailyReports)
    .where(
      and(
        eq(schema.dailyReports.wellId, input.wellId),
        lt(schema.dailyReports.reportDate, input.reportDate),
        isNull(schema.dailyReports.deletedAt),
      ),
    );

  let carriedCumulative = 0;
  for (const r of beforeRows) carriedCumulative += toNum(r.costDailyUsd);
  carriedCumulative = round2(carriedCumulative);

  const [inserted] = await db
    .insert(schema.dailyReports)
    .values({
      wellId: input.wellId,
      rigId: input.rigId ?? null,
      reportDate: input.reportDate,
      reportNo,
      depthMdStart: money(input.depthMdStart),
      depthMdEnd: money(input.depthMdEnd),
      progress24h: money(progress24h),
      summary: input.summary ?? null,
      planNext: input.planNext ?? null,
      costDailyUsd: '0',
      costCumulativeUsd: money(carriedCumulative),
      status: 'draft',
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: schema.dailyReports.id, reportNo: schema.dailyReports.reportNo });

  return { id: inserted.id, reportNo: inserted.reportNo };
}

export async function updateReportHeader(
  id: string,
  patch: {
    depthMdStart?: number;
    depthMdEnd?: number;
    depthTvd?: number | null;
    summary?: string | null;
    planNext?: string | null;
    geologyNotes?: string | null;
    equipmentStatus?: Record<string, string> | null;
    periodFrom?: string;
    periodTo?: string;
  },
): Promise<void> {
  const current = await db
    .select({
      depthMdStart: schema.dailyReports.depthMdStart,
      depthMdEnd: schema.dailyReports.depthMdEnd,
    })
    .from(schema.dailyReports)
    .where(and(eq(schema.dailyReports.id, id), isNull(schema.dailyReports.deletedAt)))
    .limit(1);

  const set: Partial<typeof schema.dailyReports.$inferInsert> = { updatedAt: new Date() };

  if (patch.depthMdStart !== undefined) set.depthMdStart = money(patch.depthMdStart);
  if (patch.depthMdEnd !== undefined) set.depthMdEnd = money(patch.depthMdEnd);
  if (patch.depthTvd !== undefined) set.depthTvd = moneyOrNull(patch.depthTvd);
  if (patch.summary !== undefined) set.summary = patch.summary;
  if (patch.planNext !== undefined) set.planNext = patch.planNext;
  if (patch.geologyNotes !== undefined) set.geologyNotes = patch.geologyNotes;
  if (patch.equipmentStatus !== undefined) set.equipmentStatus = patch.equipmentStatus;
  if (patch.periodFrom !== undefined) set.periodFrom = patch.periodFrom;
  if (patch.periodTo !== undefined) set.periodTo = patch.periodTo;

  // progress24h selalu diturunkan dari depth (parity dengan createReport).
  if (patch.depthMdStart !== undefined || patch.depthMdEnd !== undefined) {
    const start = patch.depthMdStart !== undefined ? patch.depthMdStart : toNum(current[0]?.depthMdStart);
    const end = patch.depthMdEnd !== undefined ? patch.depthMdEnd : toNum(current[0]?.depthMdEnd);
    set.progress24h = money(round2(end - start));
  }

  await db.update(schema.dailyReports).set(set).where(eq(schema.dailyReports.id, id));
}

export async function replaceTimeRows(
  reportId: string,
  rows: Array<{
    start: string;
    end: string;
    iadcCode: string;
    iadcSubcode?: string | null;
    vendor?: string | null;
    nptFlag?: boolean;
    remarks?: string | null;
  }>,
): Promise<void> {
  // Durasi & klasifikasi WAJIB dari shared (parity layar â†” PDF).
  const prepared = rows.map((r, i) => {
    const durationMin = rowDurationMinutes(r.start, r.end);
    if (durationMin === null) {
      throw new Error(`Baris ${i + 1}: format waktu tidak valid (${r.start} - ${r.end}). Gunakan HH:MM.`);
    }
    const nptFlag = r.nptFlag ?? false;
    return {
      sortOrder: i + 1,
      startHm: r.start,
      endHm: r.end,
      durationMin,
      iadcCode: r.iadcCode,
      iadcSubcode: r.iadcSubcode ?? null,
      vendor: r.vendor ?? null,
      nptFlag,
      timeClass: nptFlag ? 'NPT' : classifyTime(r.iadcCode),
      remarks: r.remarks ?? null,
    };
  });

  // Ringkasan dari shared - jangan hitung manual.
  const summaryInput: TimeRowInput[] = prepared.map((r) => ({
    start: r.startHm,
    end: r.endHm,
    code: r.iadcCode,
    npt: r.nptFlag,
    remarks: r.remarks ?? undefined,
  }));
  const summary = summarizeTime(summaryInput, classifyTime);

  await db.transaction(async (tx) => {
    /**
     * VENDOR: nama → `vendor_id` (master `vendors`).
     *
     * Kontrak data (P0-4):
     *  - `time_breakdown.iadc_subcode` HANYA berisi sub-code IADC (mis. pemecah
     *    Code 08). Sebelumnya kode ini menimpa sub-code dengan NAMA VENDOR bila
     *    vendor belum terdaftar - user lalu melihat nama vendor di kolom Sub-code
     *    dan sub-code aslinya hilang. Perilaku itu dihapus.
     *  - Nama vendor di-resolve ke `vendors.id`. Bila belum terdaftar, baris
     *    master `vendors` baru dibuat (upsert by name, case-insensitive) lalu id-nya
     *    dipakai. `remarks` TIDAK dipakai sebagai tempat menyimpan nama vendor.
     */
    const vendorNames = [
      ...new Set(
        prepared.map((r) => (r.vendor ?? '').trim()).filter((v) => v.length > 0),
      ),
    ];
    const vendorByName = new Map<string, string>();

    if (vendorNames.length > 0) {
      const existingVendors = await tx
        .select({ id: schema.vendors.id, name: schema.vendors.name })
        .from(schema.vendors)
        .where(and(inArray(schema.vendors.name, vendorNames), isNull(schema.vendors.deletedAt)));
      for (const v of existingVendors) vendorByName.set(v.name.trim().toLowerCase(), v.id);

      const missing = vendorNames.filter((name) => !vendorByName.has(name.toLowerCase()));
      if (missing.length > 0) {
        const createdVendors = await tx
          .insert(schema.vendors)
          .values(missing.map((name) => ({ name })))
          .returning({ id: schema.vendors.id, name: schema.vendors.name });
        for (const v of createdVendors) vendorByName.set(v.name.trim().toLowerCase(), v.id);
      }
    }

    // REPLACE: hard delete baris lama (cascade menghapus billing flags baris tsb).
    await tx.delete(schema.timeBreakdown).where(eq(schema.timeBreakdown.reportId, reportId));

    if (prepared.length > 0) {
      await tx.insert(schema.timeBreakdown).values(
        prepared.map((r) => {
          const vendorName = (r.vendor ?? '').trim();
          return {
            reportId,
            sortOrder: r.sortOrder,
            startHm: r.startHm,
            endHm: r.endHm,
            durationMin: r.durationMin,
            iadcCode: r.iadcCode,
            // Sub-code murni dari input user - jangan pernah ditimpa nama vendor.
            iadcSubcode: r.iadcSubcode,
            vendorId: vendorName ? vendorByName.get(vendorName.toLowerCase()) ?? null : null,
            nptFlag: r.nptFlag,
            timeClass: r.timeClass,
            remarks: r.remarks,
          };
        }),
      );
    }

    await tx
      .update(schema.dailyReports)
      .set({
        totalMinutes: summary.totalMinutes,
        productiveMinutes: summary.productiveMinutes,
        nptMinutes: summary.nptMinutes,
        wowMinutes: summary.wowMinutes,
        updatedAt: new Date(),
      })
      .where(eq(schema.dailyReports.id, reportId));
  });
}

export async function replaceCrew(
  reportId: string,
  crew: Array<{
    name: string;
    position: string;
    company?: string | null;
    shift: string;
    hours: number;
    pobStatus?: string;
    musterStation?: string | null;
  }>,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(schema.crewMembers).where(eq(schema.crewMembers.reportId, reportId));

    if (crew.length > 0) {
      await tx.insert(schema.crewMembers).values(
        crew.map((c) => ({
          reportId,
          name: c.name,
          position: c.position || 'Crew',
          company: c.company ?? null,
          shift: c.shift || 'Day',
          hours: money(c.hours ?? 0),
          pobStatus: c.pobStatus ?? 'in',
          musterStation: c.musterStation ?? null,
        })),
      );
    }

    await tx
      .update(schema.dailyReports)
      .set({ updatedAt: new Date() })
      .where(eq(schema.dailyReports.id, reportId));
  });
}

export async function replaceCostLines(
  reportId: string,
  lines: Array<{
    category: string;
    description: string;
    vendor?: string | null;
    afeCode?: string | null;
    billingType?: string | null;
    amount: number;
    rebillable?: boolean;
  }>,
): Promise<void> {
  await db.transaction(async (tx) => {
    const reportRows = await tx
      .select({ wellId: schema.dailyReports.wellId })
      .from(schema.dailyReports)
      .where(eq(schema.dailyReports.id, reportId))
      .limit(1);
    const wellId = reportRows[0]?.wellId ?? null;

    await tx.delete(schema.costLines).where(eq(schema.costLines.reportId, reportId));

    if (lines.length > 0) {
      await tx.insert(schema.costLines).values(
        lines.map((l) => ({
          reportId,
          wellId,
          category: l.category,
          description: l.description,
          vendor: l.vendor ?? null,
          afeCode: l.afeCode ?? null,
          billingType: l.billingType ?? null,
          amountUsd: money(Number(l.amount)),
          rebillable: l.rebillable ?? false,
        })),
      );
    }

    // Total harian + kumulatif diturunkan dari cost lines (fungsi bersama).
    await recomputeReportCosts(tx, reportId);
  });
}

const MUD_COLUMNS = ['weightPpg', 'viscositySecQt', 'ph', 'pv', 'yp', 'chemicalsAdded', 'costUsd'] as const;

export async function upsertMud(
  reportId: string,
  mud: {
    weightPpg?: number | null;
    viscositySecQt?: number | null;
    ph?: number | null;
    pv?: number | null;
    yp?: number | null;
    chemicalsAdded?: string | null;
    costUsd?: number | null;
  },
): Promise<void> {
  const numeric = new Set<string>(['weightPpg', 'viscositySecQt', 'ph', 'pv', 'yp', 'costUsd']);
  const value: Record<string, string | null> = {};
  for (const key of MUD_COLUMNS) {
    if (mud[key] === undefined) continue;
    const v = mud[key];
    if (numeric.has(key)) value[key] = v === null ? null : money(Number(v));
    else value[key] = v === null ? null : String(v);
  }

  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: schema.mudRecords.id })
      .from(schema.mudRecords)
      .where(eq(schema.mudRecords.reportId, reportId))
      .limit(1);

    if (existing[0]) {
      await tx
        .update(schema.mudRecords)
        .set({ ...value, updatedAt: new Date() })
        .where(eq(schema.mudRecords.reportId, reportId));
    } else {
      await tx.insert(schema.mudRecords).values({ reportId, ...value });
    }

    await tx
      .update(schema.dailyReports)
      .set({ updatedAt: new Date() })
      .where(eq(schema.dailyReports.id, reportId));
  });
}

/* ------------------------------------------------------------------ */
/* BHA components                                                      */
/* ------------------------------------------------------------------ */

/**
 * Daftar komponen BHA satu DDR, urut `sortOrder`.
 *
 * Sengaja mengembalikan bentuk yang sama dengan `BhaDto` di `ReportDetail`
 * supaya UI bisa memakai satu tipe untuk baca & tulis.
 */
export async function listBha(reportId: string): Promise<BhaDto[]> {
  const rows = await db
    .select()
    .from(schema.bhaComponents)
    .where(and(eq(schema.bhaComponents.reportId, reportId), isNull(schema.bhaComponents.deletedAt)))
    .orderBy(asc(schema.bhaComponents.sortOrder), asc(schema.bhaComponents.createdAt));

  return rows.map((b) => ({
    id: b.id,
    sortOrder: b.sortOrder,
    component: b.component,
    odIn: toNumOrNull(b.odIn),
    lengthM: toNumOrNull(b.lengthM),
    hours: toNumOrNull(b.hours),
  }));
}

/**
 * Ganti SELURUH komponen BHA satu DDR - pola identik `replaceTimeRows` dan
 * `replaceCrew`: hard delete lalu insert ulang di dalam SATU transaksi, supaya
 * tidak pernah ada kondisi "separuh tersimpan" bila insert gagal.
 *
 * `sortOrder` diturunkan dari urutan array (1..n) - urutan tabel di UI = urutan
 * tampil di PDF.
 */
export async function replaceBha(
  reportId: string,
  rows: Array<{
    component: string;
    odIn?: number | null;
    lengthM?: number | null;
    hours?: number | null;
  }>,
): Promise<void> {
  const prepared = rows.map((r, i) => ({
    sortOrder: i + 1,
    component: r.component,
    odIn: moneyOrNull(r.odIn ?? null),
    lengthM: moneyOrNull(r.lengthM ?? null),
    hours: moneyOrNull(r.hours ?? null),
  }));

  await db.transaction(async (tx) => {
    await tx.delete(schema.bhaComponents).where(eq(schema.bhaComponents.reportId, reportId));

    if (prepared.length > 0) {
      await tx.insert(schema.bhaComponents).values(prepared.map((r) => ({ reportId, ...r })));
    }

    await tx
      .update(schema.dailyReports)
      .set({ updatedAt: new Date() })
      .where(eq(schema.dailyReports.id, reportId));
  });
}

export async function updateReportStatus(
  id: string,
  status: string,
  actorId?: string | null,
  extra?: { signatureName?: string; approvedBy?: string | null },
): Promise<void> {
  const now = new Date();
  const set: Partial<typeof schema.dailyReports.$inferInsert> = { status, updatedAt: now };

  if (status === 'submitted') {
    set.submittedAt = now;
    if (actorId) set.submittedBy = actorId;
  } else if (status === 'approved') {
    set.approvedAt = now;
    set.lockedAt = now;
    const approver = extra?.approvedBy !== undefined ? extra.approvedBy : actorId ?? null;
    if (approver) set.approvedBy = approver;
    if (extra?.signatureName) {
      set.signatureName = extra.signatureName;
      set.signedAt = now;
    }
  } else if (status === 'distributed') {
    set.distributedAt = now;
  } else if (status === 'locked') {
    set.lockedAt = now;
  }

  await db.update(schema.dailyReports).set(set).where(eq(schema.dailyReports.id, id));
}

/**
 * Amendment: buat DDR BARU (revisi parent + 1) dan salin seluruh anak.
 * Parent TIDAK diubah - jejak revisi tetap utuh untuk audit.
 */
export async function createAmendment(
  reportId: string,
  reason: string,
  actorId?: string | null,
): Promise<{ id: string; reportNo: number }> {
  const parent = await db
    .select()
    .from(schema.dailyReports)
    .where(and(eq(schema.dailyReports.id, reportId), isNull(schema.dailyReports.deletedAt)))
    .limit(1);

  if (!parent[0]) {
    throw new Error(`Laporan ${reportId} tidak ditemukan - tidak bisa membuat amendment.`);
  }

  const p = parent[0];

  /**
   * Revisi = parent.revision + 1.
   *
   * Unique index `daily_reports_well_date_uq (well_id, report_date, revision)`
   * membuat amendment kedua untuk hari yang sama (parent masih rev 1, tapi rev 2
   * sudah dipakai) gagal. Karena itu rentang revisi diambil dari revisi tertinggi
   * yang sudah ada pada tanggal itu; pada kasus normal nilainya identik dengan
   * `parent.revision + 1`.
   */
  const sameDates = await db
    .select({ revision: schema.dailyReports.revision })
    .from(schema.dailyReports)
    .where(
      and(
        eq(schema.dailyReports.wellId, p.wellId),
        eq(schema.dailyReports.reportDate, p.reportDate),
        isNull(schema.dailyReports.deletedAt),
      ),
    );

  const highestRevision = sameDates.reduce((acc, r) => Math.max(acc, r.revision), p.revision);
  const revision = highestRevision + 1;

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.dailyReports)
      .values({
        wellId: p.wellId,
        rigId: p.rigId,
        reportDate: p.reportDate,
        reportNo: p.reportNo,
        periodFrom: p.periodFrom,
        periodTo: p.periodTo,
        depthMdStart: p.depthMdStart,
        depthMdEnd: p.depthMdEnd,
        depthTvd: p.depthTvd,
        progress24h: p.progress24h,
        summary: p.summary,
        planNext: p.planNext,
        geologyNotes: p.geologyNotes,
        equipmentStatus: p.equipmentStatus,
        totalMinutes: p.totalMinutes,
        productiveMinutes: p.productiveMinutes,
        nptMinutes: p.nptMinutes,
        wowMinutes: p.wowMinutes,
        costDailyUsd: money(toNum(p.costDailyUsd)),
        // Kumulatif report baru = total harian SEMUA report lain well ini s/d tanggal
        // yang sama, KECUALI dirinya sendiri. Menyalin p.costCumulativeUsd apa adanya
        // membuat total harian tanggal ini terhitung berulang tiap revisi.
        costCumulativeUsd: money(
          await (async () => {
            const rows = await tx
              .select({ costDailyUsd: schema.dailyReports.costDailyUsd })
              .from(schema.dailyReports)
              .where(
                and(
                  eq(schema.dailyReports.wellId, p.wellId),
                  lte(schema.dailyReports.reportDate, p.reportDate),
                  ne(schema.dailyReports.id, p.id),
                  isNull(schema.dailyReports.deletedAt),
                ),
              );
            const carried = rows.reduce((acc, r) => acc + toNum(r.costDailyUsd), 0);
            return round2(carried + toNum(p.costDailyUsd));
          })(),
        ),
        status: 'draft',
        parentReportId: p.id,
        amendmentReason: reason,
        revision,
        createdBy: actorId ?? p.createdBy,
      })
      .returning({ id: schema.dailyReports.id, reportNo: schema.dailyReports.reportNo });

    const newId = created.id;

    // --- Salin time breakdown (pertahankan klasifikasi & durasi tersimpan) ---
    const timeRows = await tx
      .select()
      .from(schema.timeBreakdown)
      .where(and(eq(schema.timeBreakdown.reportId, p.id), isNull(schema.timeBreakdown.deletedAt)))
      .orderBy(asc(schema.timeBreakdown.sortOrder));

    if (timeRows.length > 0) {
      await tx.insert(schema.timeBreakdown).values(
        timeRows.map((t) => ({
          reportId: newId,
          sortOrder: t.sortOrder,
          startHm: t.startHm,
          endHm: t.endHm,
          durationMin: t.durationMin,
          iadcCode: t.iadcCode,
          iadcSubcode: t.iadcSubcode,
          equipmentId: t.equipmentId,
          vendorId: t.vendorId,
          nptFlag: t.nptFlag,
          timeClass: t.timeClass,
          remarks: t.remarks,
        })),
      );
    }

    // --- Salin crew ---
    const crewRows = await tx
      .select()
      .from(schema.crewMembers)
      .where(and(eq(schema.crewMembers.reportId, p.id), isNull(schema.crewMembers.deletedAt)));

    if (crewRows.length > 0) {
      await tx.insert(schema.crewMembers).values(
        crewRows.map((c) => ({
          reportId: newId,
          name: c.name,
          position: c.position,
          company: c.company,
          shift: c.shift,
          hours: c.hours,
          pobStatus: c.pobStatus,
          musterStation: c.musterStation,
        })),
      );
    }

    // --- Salin mud (unique per report) ---
    const mudRows = await tx
      .select()
      .from(schema.mudRecords)
      .where(and(eq(schema.mudRecords.reportId, p.id), isNull(schema.mudRecords.deletedAt)))
      .limit(1);

    if (mudRows[0]) {
      const m = mudRows[0];
      await tx.insert(schema.mudRecords).values({
        reportId: newId,
        weightPpg: m.weightPpg,
        viscositySecQt: m.viscositySecQt,
        ph: m.ph,
        pv: m.pv,
        yp: m.yp,
        chemicalsAdded: m.chemicalsAdded,
        costUsd: m.costUsd,
      });
    }

    // --- Salin cost lines ---
    const lineRows = await tx
      .select()
      .from(schema.costLines)
      .where(and(eq(schema.costLines.reportId, p.id), isNull(schema.costLines.deletedAt)));

    if (lineRows.length > 0) {
      await tx.insert(schema.costLines).values(
        lineRows.map((l) => ({
          reportId: newId,
          wellId: l.wellId,
          category: l.category,
          description: l.description,
          vendor: l.vendor,
          afeCode: l.afeCode,
          billingType: l.billingType,
          amountUsd: l.amountUsd,
          rebillable: l.rebillable,
        })),
      );
    }

    // --- Salin BHA components (wajib: PDF revisi harus menampilkan BHA) ---
    const bhaRows = await tx
      .select()
      .from(schema.bhaComponents)
      .where(and(eq(schema.bhaComponents.reportId, p.id), isNull(schema.bhaComponents.deletedAt)))
      .orderBy(asc(schema.bhaComponents.sortOrder));

    if (bhaRows.length > 0) {
      await tx.insert(schema.bhaComponents).values(
        bhaRows.map((b) => ({
          reportId: newId,
          sortOrder: b.sortOrder,
          component: b.component,
          odIn: b.odIn,
          lengthM: b.lengthM,
          hours: b.hours,
        })),
      );
    }

    // --- Salin directional survey stations ---
    const surveyRows = await tx
      .select()
      .from(schema.surveyStations)
      .where(and(eq(schema.surveyStations.reportId, p.id), isNull(schema.surveyStations.deletedAt)))
      .orderBy(asc(schema.surveyStations.md));

    if (surveyRows.length > 0) {
      await tx.insert(schema.surveyStations).values(
        surveyRows.map((x) => ({
          reportId: newId,
          md: x.md,
          inclination: x.inclination,
          azimuth: x.azimuth,
          tvd: x.tvd,
        })),
      );
    }

    // --- Salin MAC activities (dual derrick / parallel ops) ---
    const macRows = await tx
      .select()
      .from(schema.macActivities)
      .where(and(eq(schema.macActivities.reportId, p.id), isNull(schema.macActivities.deletedAt)));

    if (macRows.length > 0) {
      await tx.insert(schema.macActivities).values(
        macRows.map((m) => ({
          reportId: newId,
          activityCenter: m.activityCenter,
          operation: m.operation,
          hours: m.hours,
          billable: m.billable,
        })),
      );
    }

    return { id: created.id, reportNo: created.reportNo };
  });
}

