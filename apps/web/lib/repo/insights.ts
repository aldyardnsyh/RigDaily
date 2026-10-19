/**
 * Repository - Insights & benchmarking (multi-well).
 *
 * Semua angka diturunkan dari kolom yang SUDAH tersimpan di `daily_reports`
 * (denormalisasi hasil `summarizeTime()`/`summarizeCost()` shared saat baris
 * ditulis), jadi tidak ada rumus duplikat dan nilai layar = nilai PDF.
 *
 * Rumus (sesuai brief agent BACKEND-COMPLETE):
 * - `avgNptPercent` = rata-rata `(nptMinutes + wowMinutes) / totalMinutes * 100`
 * - `avgRopMHr`     = rata-rata `progress24h / 24` (meter per jam)
 * - `avgDailyCost`  = rata-rata `costDailyUsd`
 * - `daysDrilling`  = jumlah DDR well tersebut
 *
 * CATATAN DATA: seed demo hanya berisi SATU sumur (ARUN-07). Fungsi di sini
 * tetap benar untuk 1 sumur (mengembalikan 1 baris), tetapi benchmarking baru
 * bermakna setelah sumur tambahan masuk lewat import CSV
 * (`POST /api/reports/import`) atau seed manual. `packages/database` FROZEN,
 * jadi tidak ada data multi-well yang ditambahkan dari agent ini.
 */
import 'server-only';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db, schema } from '@rigdaily/database';
import { round2 } from '@rigdaily/shared';
import { toNum, toNumOrNull } from './shared';

/* ------------------------------------------------------------------ */
/* Tipe                                                                */
/* ------------------------------------------------------------------ */

export type WellBenchmarkRow = {
  wellId: string;
  wellName: string;
  wellType: string;
  phase: string;
  reportCount: number;
  avgDepthProgress: number;
  avgNptPercent: number;
  avgDailyCost: number;
  totalCost: number;
  daysDrilling: number;
  avgRopMHr: number;
  lastReportDate: string | null;
};

export type TrendSeries = {
  metric: string;
  points: Array<{ date: string; value: number; wellName: string }>;
};

export type KpiBaseline = {
  id: string;
  name: string;
  formula: string;
  baseline: number | null;
  unit: string | null;
  category: string | null;
};

export type BaselineComparison = {
  name: string;
  actual: number;
  baseline: number | null;
  deltaPercent: number | null;
  unit: string | null;
};

export type TrendMetric = 'npt' | 'cost' | 'depth' | 'rop';

/* ------------------------------------------------------------------ */
/* Konstanta & rumus kecil                                             */
/* ------------------------------------------------------------------ */

/** Label metrik pada hasil `getMetricTrend` (kolom asal / turunannya). */
const METRIC_LABEL: Record<TrendMetric, string> = {
  npt: 'nptPercent',
  cost: 'dailyCostUsd',
  depth: 'depthProgressM',
  rop: 'ropMHr',
};

/** Rata-rata aman (0 saat himpunan kosong). */
function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** (npt + wow) / total * 100 - denominator total menit laporan. */
function nptPercent(nptMinutes: number, wowMinutes: number, totalMinutes: number): number {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return 0;
  return ((nptMinutes + wowMinutes) / totalMinutes) * 100;
}

/** ROP meter/jam dari progres 24 jam. */
function ropOf(progress24h: number): number {
  return progress24h > 0 ? progress24h / 24 : 0;
}

/** Delta % terhadap baseline: `(actual - baseline) / baseline * 100`. */
function deltaPercentOf(actual: number, baseline: number | null): number | null {
  if (baseline === null || !Number.isFinite(baseline) || baseline === 0) return null;
  return round2(((actual - baseline) / baseline) * 100);
}

/* ------------------------------------------------------------------ */
/* Fakta DDR (1 query untuk semua perhitungan)                         */
/* ------------------------------------------------------------------ */

type ReportFact = {
  wellId: string;
  wellName: string;
  wellType: string;
  phase: string;
  reportDate: string;
  progress24h: number;
  totalMinutes: number;
  nptMinutes: number;
  wowMinutes: number;
  costDailyUsd: number;
};

type WellMeta = { id: string; name: string; type: string; phase: string };

/**
 * Ambil fakta DDR (header + sumur) untuk sumur yang diminta.
 * Tanpa `wellIds` → SEMUA sumur dengan DDR. Urut tanggal desc (laporan terbaru
 * lebih dulu) supaya `facts[0]` per sumur = laporan terakhir.
 */
async function reportFacts(wellIds?: string[]): Promise<ReportFact[]> {
  const parts = [isNull(schema.dailyReports.deletedAt), isNull(schema.wells.deletedAt)];
  if (wellIds && wellIds.length > 0) parts.push(inArray(schema.dailyReports.wellId, wellIds));

  const rows = await db
    .select({
      wellId: schema.wells.id,
      wellName: schema.wells.name,
      wellType: schema.wells.type,
      phase: schema.wells.phase,
      reportDate: schema.dailyReports.reportDate,
      reportNo: schema.dailyReports.reportNo,
      progress24h: schema.dailyReports.progress24h,
      totalMinutes: schema.dailyReports.totalMinutes,
      nptMinutes: schema.dailyReports.nptMinutes,
      wowMinutes: schema.dailyReports.wowMinutes,
      costDailyUsd: schema.dailyReports.costDailyUsd,
    })
    .from(schema.dailyReports)
    .innerJoin(schema.wells, eq(schema.dailyReports.wellId, schema.wells.id))
    .where(and(...parts))
    .orderBy(
      desc(schema.dailyReports.reportDate),
      desc(schema.dailyReports.reportNo),
      desc(schema.dailyReports.revision),
    );

  return rows.map((r) => ({
    wellId: r.wellId,
    wellName: r.wellName,
    wellType: r.wellType,
    phase: r.phase,
    reportDate: r.reportDate,
    progress24h: toNum(r.progress24h),
    totalMinutes: r.totalMinutes,
    nptMinutes: r.nptMinutes,
    wowMinutes: r.wowMinutes,
    costDailyUsd: toNum(r.costDailyUsd),
  }));
}

/** Metadata sumur (dipakai untuk sumur tanpa DDR di `getWellBenchmark`). */
async function wellMeta(wellIds?: string[]): Promise<WellMeta[]> {
  const parts = [isNull(schema.wells.deletedAt)];
  if (wellIds && wellIds.length > 0) parts.push(inArray(schema.wells.id, wellIds));

  return db
    .select({ id: schema.wells.id, name: schema.wells.name, type: schema.wells.type, phase: schema.wells.phase })
    .from(schema.wells)
    .where(and(...parts))
    .orderBy(asc(schema.wells.name));
}

/* ------------------------------------------------------------------ */
/* Benchmark per well                                                  */
/* ------------------------------------------------------------------ */

/**
 * Satu baris ringkasan per sumur.
 *
 * Sumur yang ada di DB tetapi belum punya DDR tetap muncul dengan angka 0 dan
 * `lastReportDate: null` - supaya layar menampilkan "belum ada data" alih-alih
 * menghilangkan sumur dari tabel perbandingan. Dengan seed 1 sumur, hasilnya
 * tepat satu baris (ARUN-07) dan fungsi tidak crash.
 */
export async function getWellBenchmark(wellIds?: string[]): Promise<WellBenchmarkRow[]> {
  const [facts, wells] = await Promise.all([reportFacts(wellIds), wellMeta(wellIds)]);

  const byWell = new Map<string, ReportFact[]>();
  for (const f of facts) {
    const bucket = byWell.get(f.wellId);
    if (bucket) bucket.push(f);
    else byWell.set(f.wellId, [f]);
  }

  const out: WellBenchmarkRow[] = [];

  for (const w of wells) {
    const reports = byWell.get(w.id) ?? [];
    const latest = reports[0] ?? null; // urut tanggal desc → laporan terakhir

    const dailyCosts = reports.map((r) => r.costDailyUsd);
    const latestDate = reports.reduce<string | null>(
      (acc, r) => (acc === null || r.reportDate > acc ? r.reportDate : acc),
      null,
    );

    out.push({
      wellId: w.id,
      wellName: w.name,
      wellType: w.type,
      phase: w.phase,
      reportCount: reports.length,
      avgDepthProgress: round2(avg(reports.map((r) => r.progress24h))),
      avgNptPercent: round2(avg(reports.map((r) => nptPercent(r.nptMinutes, r.wowMinutes, r.totalMinutes)))),
      avgDailyCost: round2(avg(dailyCosts)),
      totalCost: round2(dailyCosts.reduce((a, b) => a + b, 0)),
      daysDrilling: reports.length,
      avgRopMHr: round2(avg(reports.map((r) => ropOf(r.progress24h)))),
      lastReportDate: latest?.reportDate ?? latestDate,
    });
  }

  return out.sort((a, b) => a.wellName.localeCompare(b.wellName));
}

/* ------------------------------------------------------------------ */
/* Tren metrik                                                         */
/* ------------------------------------------------------------------ */

/** Nilai satu titik tren sesuai metrik (tanpa duplikasi di route). */
function trendValueOf(fact: ReportFact, metric: TrendMetric): number {
  switch (metric) {
    case 'cost':
      return round2(fact.costDailyUsd);
    case 'depth':
      return round2(fact.progress24h);
    case 'rop':
      return round2(ropOf(fact.progress24h));
    case 'npt':
    default:
      return round2(nptPercent(fact.nptMinutes, fact.wowMinutes, fact.totalMinutes));
  }
}

/**
 * Tren satu metrik dari `days` DDR TERAKHIR PER SUMUR (jendela bergerak per
 * sumur, bukan global) sehingga sumur dengan laporan lebih tua tetap ikut
 * dibandingkan. Titik diurutkan naik per tanggal, lalu nama sumur.
 */
export async function getMetricTrend(
  metric: TrendMetric,
  wellIds?: string[],
  days = 30,
): Promise<TrendSeries> {
  const take = Math.min(Math.max(Number.isFinite(days) ? Math.trunc(days) : 30, 1), 365);
  const facts = await reportFacts(wellIds);

  const perWell = new Map<string, ReportFact[]>();
  for (const f of facts) {
    const bucket = perWell.get(f.wellId);
    if (!bucket) {
      perWell.set(f.wellId, [f]);
    } else if (bucket.length < take) {
      bucket.push(f);
    }
  }

  const points: TrendSeries['points'] = [];
  for (const reports of perWell.values()) {
    for (const r of reports) {
      points.push({ date: r.reportDate, value: trendValueOf(r, metric), wellName: r.wellName });
    }
  }

  points.sort((a, b) => a.date.localeCompare(b.date) || a.wellName.localeCompare(b.wellName));

  return { metric: METRIC_LABEL[metric], points };
}

/* ------------------------------------------------------------------ */
/* KPI baseline                                                        */
/* ------------------------------------------------------------------ */

export async function listKpiBaselines(): Promise<KpiBaseline[]> {
  const rows = await db
    .select()
    .from(schema.kpiDefinitions)
    .where(and(isNull(schema.kpiDefinitions.deletedAt), eq(schema.kpiDefinitions.active, true)))
    .orderBy(asc(schema.kpiDefinitions.category), asc(schema.kpiDefinitions.name));

  return rows.map((k) => ({
    id: k.id,
    name: k.name,
    formula: k.formula,
    baseline: toNumOrNull(k.baseline),
    unit: k.unit,
    category: k.category,
  }));
}

/**
 * Bandingkan KPI nyata terhadap `kpi_definitions.baseline`.
 *
 * Pemetaan (hanya KPI yang bisa diturunkan dari DDR):
 * - "NPT %"          → rata-rata NPT% seluruh laporan
 * - "Rig Uptime %"   → 100 − rata-rata NPT%
 * - "Cost per Meter" → sum(costDailyUsd) / sum(progress24h)
 *
 * KPI dengan formula `manual` (mis. "Rig Move Time") dilewati - lebih baik
 * hilang dari daftar daripada menampilkan angka palsu.
 */
export async function compareAgainstBaseline(wellIds?: string[]): Promise<BaselineComparison[]> {
  const [facts, kpis] = await Promise.all([reportFacts(wellIds), listKpiBaselines()]);

  const avgNpt = round2(avg(facts.map((f) => nptPercent(f.nptMinutes, f.wowMinutes, f.totalMinutes))));
  const rigUptime = round2(Math.max(0, Math.min(100, 100 - avgNpt)));

  const totalCost = facts.reduce((a, f) => a + f.costDailyUsd, 0);
  const totalProgress = facts.reduce((a, f) => a + f.progress24h, 0);
  const costPerMeter = totalProgress > 0 ? round2(totalCost / totalProgress) : 0;

  const actualByName = new Map<string, number>([
    ['NPT %', avgNpt],
    ['Rig Uptime %', rigUptime],
    ['Cost per Meter', costPerMeter],
  ]);

  const out: BaselineComparison[] = [];
  for (const kpi of kpis) {
    const actual = actualByName.get(kpi.name);
    if (actual === undefined) continue;
    out.push({
      name: kpi.name,
      actual,
      baseline: kpi.baseline,
      deltaPercent: deltaPercentOf(actual, kpi.baseline),
      unit: kpi.unit,
    });
  }

  return out;
}
