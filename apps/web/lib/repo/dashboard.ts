/**
 * Repository - Dashboard.
 *
 * Angka diambil dari kolom denormalisasi laporan (sudah dihitung shared saat
 * baris ditulis) atau dari `timeClass` tersimpan - tidak ada rumus duplikat.
 */
import 'server-only';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@rigdaily/database';
import { round2 } from '@rigdaily/shared';
import { listReports } from './reports';
import { recentReportRigs, sumCostLinesForWellUpTo, toNum, totalsFromTimeRows } from './shared';
import type { DashboardKpi, ReportListItem, TimeMix, TrendPoint } from './types';

type ReportCore = {
  wellId: string;
  reportDate: string;
  depthMdEnd: string;
  progress24h: string | null;
  totalMinutes: number;
  nptMinutes: number;
  wowMinutes: number;
  costDailyUsd: string;
};

const coreColumns = {
  wellId: schema.dailyReports.wellId,
  reportDate: schema.dailyReports.reportDate,
  depthMdEnd: schema.dailyReports.depthMdEnd,
  progress24h: schema.dailyReports.progress24h,
  totalMinutes: schema.dailyReports.totalMinutes,
  nptMinutes: schema.dailyReports.nptMinutes,
  wowMinutes: schema.dailyReports.wowMinutes,
  costDailyUsd: schema.dailyReports.costDailyUsd,
} as const;

/** `take` laporan terbaru (opsional difilter satu sumur). */
async function recentReports(wellId: string | undefined, take: number): Promise<ReportCore[]> {
  const parts = [isNull(schema.dailyReports.deletedAt)];
  if (wellId) parts.push(eq(schema.dailyReports.wellId, wellId));

  return db
    .select(coreColumns)
    .from(schema.dailyReports)
    .where(and(...parts))
    .orderBy(
      desc(schema.dailyReports.reportDate),
      desc(schema.dailyReports.reportNo),
      desc(schema.dailyReports.revision),
    )
    .limit(take);
}

/** (npt + wow) / total * 100. */
function nptPercentOf(r: ReportCore): number {
  if (!r.totalMinutes || r.totalMinutes <= 0) return 0;
  return round2(((r.nptMinutes + r.wowMinutes) / r.totalMinutes) * 100);
}

/** Budget AFE: satu sumur bila `wellId`, selain itu total semua sumur aktif. */
async function afeBudgetFor(wellId: string | undefined): Promise<number | null> {
  const parts = [isNull(schema.wells.deletedAt)];
  if (wellId) parts.push(eq(schema.wells.id, wellId));

  const rows = await db
    .select({ afeBudgetUsd: schema.wells.afeBudgetUsd })
    .from(schema.wells)
    .where(and(...parts));

  if (rows.length === 0) return null;
  const total = round2(rows.reduce((acc, w) => acc + toNum(w.afeBudgetUsd), 0));
  return total > 0 ? total : null;
}

/**
 * Cost kumulatif (P1-2) - SELALU jumlah cost line, bukan kolom denormalisasi.
 *
 * Jalur lama (`latest.costCumulativeUsd`) dinyatakan salah oleh `repo/costs.ts`
 * sendiri: kolom itu bisa belum ter-recompute (impor CSV / laporan tanpa cost
 * line) sehingga AFE bisa turun drastis padahal ledger tidak berubah.
 *
 * - Dengan `wellId`: sum cost line sumur itu s/d tanggal laporan terbarunya.
 * - Tanpa `wellId`: sum untuk SEMUA sumur aktif (jumlah kumulatif per sumur).
 */
async function cumulativeCostFor(wellId: string | undefined): Promise<number> {
  if (wellId) {
    const latest = await recentReports(wellId, 1);
    const upto = latest[0]?.reportDate;
    if (!upto) return 0;
    return sumCostLinesForWellUpTo(wellId, upto);
  }

  const wellRows = await db
    .select({ id: schema.wells.id })
    .from(schema.wells)
    .where(isNull(schema.wells.deletedAt));

  const perWell = await Promise.all(
    wellRows.map(async (w) => {
      const latest = await recentReports(w.id, 1);
      const upto = latest[0]?.reportDate;
      return upto ? sumCostLinesForWellUpTo(w.id, upto) : 0;
    }),
  );

  return round2(perWell.reduce((acc, v) => acc + v, 0));
}

/** Rig dengan DDR dalam 7 hari terakhir (jendela aktivitas). */
async function rigActivity(): Promise<{ activeRigs: number; totalRigs: number }> {
  const [recent, rigRows] = await Promise.all([
    recentReportRigs(),
    db.select({ id: schema.rigs.id }).from(schema.rigs).where(isNull(schema.rigs.deletedAt)),
  ]);

  return { activeRigs: recent.filter((r) => r.rigId !== null).length, totalRigs: rigRows.length };
}

export async function getDashboardKpi(wellId?: string): Promise<DashboardKpi> {
  const [reports, rigs, afeBudget, cumulativeCost] = await Promise.all([
    recentReports(wellId, 2),
    rigActivity(),
    afeBudgetFor(wellId),
    cumulativeCostFor(wellId),
  ]);

  const latest = reports[0] ?? null;
  const previous = reports[1] ?? null;

  const depthToday = latest ? toNum(latest.depthMdEnd) : 0;
  const depthDelta = latest ? toNum(latest.progress24h) : 0;

  const currentNptPercent = latest ? nptPercentOf(latest) : 0;
  const previousNptPercent = previous ? nptPercentOf(previous) : currentNptPercent;

  const dailyCost = latest ? toNum(latest.costDailyUsd) : 0;
  const previousDailyCost = previous ? toNum(previous.costDailyUsd) : dailyCost;

  return {
    depthToday,
    depthDelta,
    nptPercent: currentNptPercent,
    nptDelta: round2(currentNptPercent - previousNptPercent),
    dailyCost,
    dailyCostDelta: round2(dailyCost - previousDailyCost),
    afeConsumedPercent:
      afeBudget !== null && afeBudget > 0 ? round2((cumulativeCost / afeBudget) * 100) : null,
    afeBudget,
    cumulativeCost,
    activeRigs: rigs.activeRigs,
    totalRigs: rigs.totalRigs,
  };
}

/** Tren N hari terakhir (urut naik berdasarkan tanggal). */
export async function getTrend(wellId: string, days = 30): Promise<TrendPoint[]> {
  const take = Math.min(Math.max(days, 1), 365);
  const rows = await recentReports(wellId, take);

  return rows.reverse().map((r) => ({
    date: r.reportDate,
    depthMd: toNum(r.depthMdEnd),
    nptPercent: nptPercentOf(r),
    dailyCost: toNum(r.costDailyUsd),
  }));
}

/** Komposisi waktu (menit) - dihitung dari kolom `timeClass` tersimpan. */
export async function getTimeMix(reportId: string): Promise<TimeMix> {
  const rows = await db
    .select({
      durationMin: schema.timeBreakdown.durationMin,
      timeClass: schema.timeBreakdown.timeClass,
      nptFlag: schema.timeBreakdown.nptFlag,
    })
    .from(schema.timeBreakdown)
    .where(and(eq(schema.timeBreakdown.reportId, reportId), isNull(schema.timeBreakdown.deletedAt)))
    .orderBy(asc(schema.timeBreakdown.sortOrder));

  const totals = totalsFromTimeRows(rows);

  return {
    productive: totals.productiveMinutes,
    npt: totals.nptMinutes,
    wow: totals.wowMinutes,
    standby: totals.standbyMinutes,
    disputed: totals.disputedMinutes,
    gap: totals.gapMinutes,
  };
}

export async function getReportsSummary(limit = 10): Promise<ReportListItem[]> {
  const { items } = await listReports({ limit });
  return items;
}
