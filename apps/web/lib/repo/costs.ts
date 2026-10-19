/**
 * Repository - Cost lines & ringkasan AFE.
 *
 * Agregasi WAJIB lewat `summarizeCost()` dari @rigdaily/shared supaya angka
 * layar Cost & PDF identik. Setiap mutasi cost me-recompute kolom
 * `daily_reports.costDailyUsd` & `costCumulativeUsd` (denormalisasi untuk
 * dashboard), lihat `recomputeReportCosts()`.
 */
import 'server-only';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@rigdaily/database';
import { round2, summarizeCost } from '@rigdaily/shared';
import type { CostLineDto, CostSummary } from './types';
import { money, recomputeReportCosts, sumCostLinesForWellUpTo, toNum, toNumOrNull } from './shared';

export async function listCostLines(reportId: string): Promise<CostLineDto[]> {
  const rows = await db
    .select()
    .from(schema.costLines)
    .where(and(eq(schema.costLines.reportId, reportId), isNull(schema.costLines.deletedAt)))
    .orderBy(asc(schema.costLines.createdAt));

  return rows.map((c) => ({
    id: c.id,
    category: c.category,
    description: c.description,
    vendor: c.vendor,
    afeCode: c.afeCode,
    billingType: c.billingType,
    amount: toNum(c.amountUsd),
    rebillable: c.rebillable,
  }));
}

export async function addCostLine(
  reportId: string,
  line: {
    category: string;
    description: string;
    vendor?: string | null;
    afeCode?: string | null;
    billingType?: string | null;
    amount: number;
    rebillable?: boolean;
  },
): Promise<{ id: string }> {
  const id = await db.transaction(async (tx) => {
    const reportRows = await tx
      .select({ wellId: schema.dailyReports.wellId })
      .from(schema.dailyReports)
      .where(and(eq(schema.dailyReports.id, reportId), isNull(schema.dailyReports.deletedAt)))
      .limit(1);

    const [row] = await tx
      .insert(schema.costLines)
      .values({
        reportId,
        wellId: reportRows[0]?.wellId ?? null,
        category: line.category,
        description: line.description,
        vendor: line.vendor ?? null,
        afeCode: line.afeCode ?? null,
        billingType: line.billingType ?? null,
        amountUsd: money(Number(line.amount)),
        rebillable: line.rebillable ?? false,
      })
      .returning({ id: schema.costLines.id });

    await recomputeReportCosts(tx, reportId);
    return row.id;
  });

  return { id };
}

export async function deleteCostLine(id: string): Promise<void> {
  const now = new Date();

  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ reportId: schema.costLines.reportId })
      .from(schema.costLines)
      .where(and(eq(schema.costLines.id, id), isNull(schema.costLines.deletedAt)))
      .limit(1);

    const reportId = rows[0]?.reportId ?? null;

    // Soft delete: jejak cost line tetap ada untuk audit.
    await tx
      .update(schema.costLines)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(schema.costLines.id, id));

    if (reportId) await recomputeReportCosts(tx, reportId);
  });
}

export async function getCostSummary(wellId: string): Promise<CostSummary> {
  const wellRows = await db
    .select({ afeBudgetUsd: schema.wells.afeBudgetUsd })
    .from(schema.wells)
    .where(and(eq(schema.wells.id, wellId), isNull(schema.wells.deletedAt)))
    .limit(1);
  const afeBudget = toNumOrNull(wellRows[0]?.afeBudgetUsd);

  // Laporan terbaru = "hari ini" untuk ringkasan biaya.
  const latestRows = await db
    .select({
      id: schema.dailyReports.id,
      reportDate: schema.dailyReports.reportDate,
    })
    .from(schema.dailyReports)
    .where(and(eq(schema.dailyReports.wellId, wellId), isNull(schema.dailyReports.deletedAt)))
    .orderBy(
      desc(schema.dailyReports.reportDate),
      desc(schema.dailyReports.reportNo),
      desc(schema.dailyReports.revision),
    )
    .limit(1);
  const latest = latestRows[0] ?? null;

  const lines = latest ? await listCostLines(latest.id) : [];
  const summary = summarizeCost(
    lines.map((l) => ({ category: l.category, amount: l.amount, afeCode: l.afeCode, rebillable: l.rebillable })),
    afeBudget,
  );

  // Kumulatif: SELALU jumlah cost line semua report well s/d laporan terbaru.
  // Jangan pakai nilai denormalisasi `latest.costCumulativeUsd` karena laporan
  // terbaru bisa saja belum punya cost line sehingga kolomnya belum ter-recompute
  // (menyebabkan AFE kumulatif drop drastis). Sum langsung bersifat otoritatif.
  //
  // P1-2: dihitung lewat helper BERSAMA `sumCostLinesForWellUpTo()` - jalur yang
  // sama dipakai dashboard, sehingga AFE di layar Cost dan Dashboard tidak
  // mungkin berbeda.
  const cumulativeTotal = latest ? await sumCostLinesForWellUpTo(wellId, latest.reportDate) : 0;

  const byCategory = Object.entries(summary.byCategory)
    .map(([category, amount]) => ({
      category,
      amount,
      percent: summary.dailyTotal > 0 ? round2((amount / summary.dailyTotal) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    dailyTotal: summary.dailyTotal,
    cumulativeTotal,
    afeBudget,
    afeConsumedPercent: afeBudget && afeBudget > 0 ? round2((cumulativeTotal / afeBudget) * 100) : null,
    byCategory,
  };
}
