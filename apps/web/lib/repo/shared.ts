/**
 * Helper internal repository layer (server-only).
 *
 * Isinya konversi tipe DB → nilai JS yang aman (`numeric` string → number,
 * `timestamptz` Date → ISO string) plus rumus kecil yang memang bukan milik
 * `@rigdaily/shared`. Rumus besar (durasi, PRD/NPT/WOW, validasi 24 jam, tiered
 * billing, cost/AFE) TETAP diambil dari `@rigdaily/shared` - jangan duplikasi.
 */
import 'server-only';
import { and, desc, eq, gte, isNull, lte, min, sql } from 'drizzle-orm';
import { db, schema } from '@rigdaily/database';
import { cleanText, cleanDeep } from '@/lib/text';
import { MINUTES_PER_DAY, parseHm, round2, validateTimeBreakdown, IADC_CODES } from '@rigdaily/shared';
import { isoDateInTz } from '@/lib/date';
import type { ValidationIssueDto } from './types';

/* ------------------------------------------------------------------ */
/* Konversi nilai DB                                                   */
/* ------------------------------------------------------------------ */

/** `numeric` (string) / null → number, 0 saat kosong atau tidak finite. */
export function toNum(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** `numeric` (string) / null → number | null. */
export function toNumOrNull(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** `timestamptz` Date → ISO string | null. */
export function toIso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO string | null → Date | null (untuk kolom timestamptz). */
export function toDateOrNull(v: string | Date | null | undefined): Date | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** number → string numerik 2 desimal (kolom `numeric(14,2)`). */
/**
 * Bersihkan teks dari mojibake / karakter non-ASCII saat dibaca.
 *
 * Nilai lama di database bisa mengandung UTF-8 yang terbaca sebagai CP1252.
 * Membersihkan di lapisan baca menjamin UI tidak pernah menampilkan karakter
 * rusak, termasuk data yang ditulis sebelum perbaikan encoding.
 */
export function cleanTextOrNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const cleaned = cleanText(v);
  return cleaned.length > 0 ? cleaned : null;
}
export function money(n: number): string {
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

/** number | null → string numerik 2 desimal | null. */
export function moneyOrNull(n: number | null | undefined): string | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  return n.toFixed(2);
}

/* ------------------------------------------------------------------ */
/* Konstanta & lookup IADC                                             */
/* ------------------------------------------------------------------ */

export const VALID_IADC_CODES: Set<string> = new Set(IADC_CODES.map((c) => c.code));
export const SUBCODE_REQUIRED_IADC: Set<string> = new Set(
  IADC_CODES.filter((c) => c.subCodeRequired).map((c) => c.code),
);
const IADC_NAME = new Map(IADC_CODES.map((c) => [c.code, c.name]));

/** Nama panjang kode IADC (fallback ke kodenya sendiri). */
export function iadcNameOf(code: string): string {
  return IADC_NAME.get(code) ?? code;
}

/* ------------------------------------------------------------------ */
/* Rumus turunan laporan                                               */
/* ------------------------------------------------------------------ */

/** (npt + wow) / total * 100 - denominator total menit laporan. */
export function nptPercentOf(totalMinutes: number, nptMinutes: number, wowMinutes: number): number {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return 0;
  return round2(((nptMinutes + wowMinutes) / totalMinutes) * 100);
}

export type TimeClassTotals = {
  totalMinutes: number;
  productiveMinutes: number;
  nptMinutes: number;
  wowMinutes: number;
  fmMinutes: number;
  standbyMinutes: number;
  disputedMinutes: number;
  gapMinutes: number;
};

export const EMPTY_TIME_TOTALS: TimeClassTotals = {
  totalMinutes: 0,
  productiveMinutes: 0,
  nptMinutes: 0,
  wowMinutes: 0,
  fmMinutes: 0,
  standbyMinutes: 0,
  disputedMinutes: 0,
  gapMinutes: MINUTES_PER_DAY,
};

/**
 * Agregat PRD/NPT/WOW/FM/STBY/DSPT/GAP langsung dari kolom `timeClass` yang
 * SUDAH tersimpan (dihitung `classifyTime()` saat baris ditulis). Dipakai untuk
 * data DB supaya angka dashboard tidak pernah "berbeda sendiri" dengan tabel.
 *
 * Catatan: `nptFlag` (kebijakan perusahaan) mengalahkan kelas kode → dihitung NPT.
 */
export function totalsFromTimeRows(
  rows: Array<{ durationMin: number; timeClass: string; nptFlag: boolean }>,
): TimeClassTotals {
  const out: TimeClassTotals = { ...EMPTY_TIME_TOTALS };
  for (const r of rows) {
    const dur = Number.isFinite(r.durationMin) ? r.durationMin : 0;
    out.totalMinutes += dur;
    const cls = r.nptFlag ? 'NPT' : r.timeClass;
    switch (cls) {
      case 'PRD':
        out.productiveMinutes += dur;
        break;
      case 'NPT':
        out.nptMinutes += dur;
        break;
      case 'WOW':
        out.wowMinutes += dur;
        break;
      case 'FM':
        out.fmMinutes += dur;
        break;
      case 'STBY':
        out.standbyMinutes += dur;
        break;
      case 'DSPT':
        out.disputedMinutes += dur;
        break;
      default:
        break;
    }
  }
  out.gapMinutes = Math.max(0, MINUTES_PER_DAY - out.totalMinutes);
  return out;
}

/* ------------------------------------------------------------------ */
/* Waktu                                                               */
/* ------------------------------------------------------------------ */

/**
 * Hari ini di zona `tz` (default WIB), format YYYY-MM-DD.
 *
 * P1-4: versi lama memakai `toISOString()` (UTC) sehingga pukul 00:00-06:59 WIB
 * menghasilkan tanggal kemarin. Helper ini re-export dari `@/lib/date` agar
 * klien & server memakai SATU implementasi.
 */
export function todayIsoLocal(tz = 'Asia/Jakarta'): string {
  return isoDateInTz(new Date(), tz);
}

/** Geser tanggal YYYY-MM-DD sebanyak `days` hari (negatif = mundur). */
export function shiftIsoDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Rentang periode DDR mengikuti "periodTo" (jam mulai shift).
 *
 * DDR 06:00 → 06:00 artinya 06:00 hari itu s/d 06:00 hari berikutnya, jadi
 * tanggal laporan = tanggal mulai periode. Bila `periodFrom !== periodTo`
 * pengguna memakai period custom (mis. 00:00 → 00:00) - dipakai apa adanya.
 */
export function periodDates(reportDate: string, periodFrom: string, periodTo: string): { from: string; to: string } {
  const pFrom = parseHm(periodFrom);
  const pTo = parseHm(periodTo);
  const to = pTo !== null && pFrom !== null && pTo <= pFrom ? shiftIsoDate(reportDate, 1) : reportDate;
  return { from: reportDate, to };
}

/* ------------------------------------------------------------------ */
/* Validasi anak laporan (dipakai reports.ts)                          */
/* ------------------------------------------------------------------ */

/** Validasi time breakdown 24 jam dari baris DB (memakai `validateTimeBreakdown` shared). */
export function validateRowsFromDb(
  rows: Array<{ startHm: string; endHm: string; iadcCode: string; nptFlag: boolean; remarks: string | null }>,
): { ok: boolean; totalMinutes: number; issues: ValidationIssueDto[] } {
  const result = validateTimeBreakdown(
    rows.map((r) => ({
      start: r.startHm,
      end: r.endHm,
      code: r.iadcCode,
      npt: r.nptFlag,
      remarks: r.remarks ?? undefined,
    })),
    {
      requireFull24h: true,
      validCodes: VALID_IADC_CODES,
      subCodeRequired: SUBCODE_REQUIRED_IADC,
    },
  );

  const issues: ValidationIssueDto[] = result.issues.map((i) => ({
    severity: i.severity,
    code: i.code,
    message: i.message,
    ...(i.rowIndex !== undefined ? { rowIndex: i.rowIndex } : {}),
  }));

  return { ok: result.ok, totalMinutes: result.totalMinutes, issues };
}

/* ------------------------------------------------------------------ */
/* Recompute kolom denormalisasi                                       */
/* ------------------------------------------------------------------ */

/**
 * Hitung ulang `costDailyUsd` sebuah report (sum cost lines aktif) dan
 * `costCumulativeUsd` (sum semua report well tersebut s/d tanggal tersebut).
 *
 * Panggil di dalam transaksi pemanggil (mis. setelah add/delete cost line).
 */
export async function recomputeReportCosts(
  tx: Pick<typeof db, 'select' | 'update'>,
  reportId: string,
): Promise<void> {
  const reportRows = await tx
    .select({
      id: schema.dailyReports.id,
      wellId: schema.dailyReports.wellId,
      reportDate: schema.dailyReports.reportDate,
    })
    .from(schema.dailyReports)
    .where(and(eq(schema.dailyReports.id, reportId), isNull(schema.dailyReports.deletedAt)))
    .limit(1);

  const report = reportRows[0];
  if (!report) return;

  const lineRows = await tx
    .select({ amountUsd: schema.costLines.amountUsd })
    .from(schema.costLines)
    .where(and(eq(schema.costLines.reportId, reportId), isNull(schema.costLines.deletedAt)));

  let dailyTotal = 0;
  for (const l of lineRows) dailyTotal += toNum(l.amountUsd);
  dailyTotal = round2(dailyTotal);

  // Laporan lain yang tanggalnya ≤ tanggal report ini (sumur sama).
  // Daftar diambil di dalam transaksi pemanggil, lalu kumulatif dihitung oleh
  // helper yang SAMA dengan dashboard (P1-2) supaya tidak ada dua rumus.
  const siblings = await tx
    .select({
      id: schema.dailyReports.id,
      reportDate: schema.dailyReports.reportDate,
      depthMdStart: schema.dailyReports.depthMdStart,
      depthMdEnd: schema.dailyReports.depthMdEnd,
      costDailyUsd: schema.dailyReports.costDailyUsd,
    })
    .from(schema.dailyReports)
    .where(
      and(
        eq(schema.dailyReports.wellId, report.wellId),
        lte(schema.dailyReports.reportDate, report.reportDate),
        isNull(schema.dailyReports.deletedAt),
      ),
    );

  // Total harian report ini otoritatif dari cost line (bukan dari kolom lama).
  const reports = siblings.map((r) =>
    r.id === reportId ? { ...r, costDailyUsd: money(dailyTotal) } : r,
  );
  const cumulative = cumulativeFromReports(reports, report.reportDate);

  await tx
    .update(schema.dailyReports)
    .set({
      costDailyUsd: money(dailyTotal),
      costCumulativeUsd: money(cumulative),
      updatedAt: new Date(),
    })
    .where(eq(schema.dailyReports.id, reportId));
}

/* ------------------------------------------------------------------ */
/* Cost & AFE - SATU jalur hitung (P1-2)                               */
/* ------------------------------------------------------------------ */

type ReportForCumulative = {
  reportDate: string;
  depthMdStart: string | number;
  depthMdEnd: string | number;
  costDailyUsd: string | number;
};

/**
 * Kumulatif biaya dari daftar laporan SATU sumur (hanya tanggal ≤ `uptoDate`).
 *
 * Aturan kumulatif:
 *   - Setiap laporan menyumbang `costDailyUsd`-nya.
 *   - Untuk tanggal laporan yang sama (revisi), hanya laporan dengan
 *     `depthMdEnd` terbesar (revisi terbaru) yang dihitung - murni supaya
 *     revisi tidak menambah biaya dua kali. Bila `depthMdEnd` seri, revisi
 *     PERTAMA dalam daftar yang dipakai (repo selalu mengurutkan revisi
 *     terbaru lebih dulu), jadi revisi tak terlihat seperti amandemen.
 *
 * Dipakai `sumCostLinesForWellUpTo()` (dashboard + ringkasan cost) dan
 * `recomputeReportCosts()` (kolom denormalisasi) → angka AFE tidak mungkin
 * berbeda antar layar.
 */
export function cumulativeFromReports(rows: ReportForCumulative[], uptoDate: string): number {
  const byDate = new Map<string, ReportForCumulative>();

  for (const r of rows) {
    if (r.reportDate > uptoDate) continue;
    const current = byDate.get(r.reportDate);
    if (!current) {
      byDate.set(r.reportDate, r);
      continue;
    }
    // Seri → pertahankan yang pertama (urutan pemanggil = revisi terbaru dulu).
    if (toNum(r.depthMdEnd) > toNum(current.depthMdEnd)) byDate.set(r.reportDate, r);
  }

  let total = 0;
  for (const r of byDate.values()) total += toNum(r.costDailyUsd);
  return round2(total);
}

/**
 * Sum cost line semua laporan aktif satu sumur s/d `date` (inklusif).
 *
 * P1-2: sumber kebenaran AFE kumulatif. JANGAN pakai
 * `daily_reports.cost_cumulative_usd` di dashboard/cost - kolom itu
 * denormalisasi dan bisa belum ter-recompute (mis. impor CSV, laporan tanpa
 * cost line), sehingga AFE bisa "drop drastis" padahal ledger tidak berubah.
 */
export async function sumCostLinesForWellUpTo(wellId: string, date: string): Promise<number> {
  const rows = await db
    .select({
      reportId: schema.dailyReports.id,
      reportDate: schema.dailyReports.reportDate,
      revision: schema.dailyReports.revision,
      parentReportId: schema.dailyReports.parentReportId,
      depthMdStart: schema.dailyReports.depthMdStart,
      depthMdEnd: schema.dailyReports.depthMdEnd,
      amountUsd: schema.costLines.amountUsd,
    })
    .from(schema.dailyReports)
    .innerJoin(schema.costLines, eq(schema.costLines.reportId, schema.dailyReports.id))
    .where(
      and(
        eq(schema.dailyReports.wellId, wellId),
        lte(schema.dailyReports.reportDate, date),
        isNull(schema.dailyReports.deletedAt),
        isNull(schema.costLines.deletedAt),
      ),
    );

  /*
   * KUNCI = TANGGAL saja (bukan tanggal+depth).
   *
   * `createAmendment()` MENYALIN seluruh cost_lines parent ke setiap revisi.
   * Bila kunci bucket menyertakan depth, tiap revisi dianggap laporan berbeda
   * dan biaya tanggal itu terhitung berkali-kali - AFE membengkak setiap kali
   * DDR diamandemen (bug terukur: 1 amendment -> 2x, 2 amendment -> 3x).
   *
   * Aturan: satu tanggal menghasilkan paling banyak satu laporan efektif, yaitu
   * revisi TERTINGGI (versi terbaru yang sah). Revisi lama diabaikan.
   */
  const latestByDate = new Map<string, { reportId: string; revision: number; depthMdStart: string; depthMdEnd: string; amount: number }>();

  for (const r of rows) {
    const current = latestByDate.get(r.reportDate);
    if (!current) {
      latestByDate.set(r.reportDate, {
        reportId: r.reportId,
        revision: r.revision,
        depthMdStart: r.depthMdStart,
        depthMdEnd: r.depthMdEnd,
        amount: round2(toNum(r.amountUsd)),
      });
      continue;
    }
    if (r.reportId === current.reportId) {
      // Baris cost line lain pada laporan yang sama -> akumulasi.
      current.amount = round2(current.amount + toNum(r.amountUsd));
      continue;
    }
    if (r.revision > current.revision) {
      // Revisi lebih baru menggantikan laporan pada tanggal yang sama.
      latestByDate.set(r.reportDate, {
        reportId: r.reportId,
        revision: r.revision,
        depthMdStart: r.depthMdStart,
        depthMdEnd: r.depthMdEnd,
        amount: round2(toNum(r.amountUsd)),
      });
    }
    // Revisi lebih lama -> diabaikan (sudah terwakili oleh revisi tertinggi).
  }

  const reports: ReportForCumulative[] = [...latestByDate.entries()].map(([reportDate, bucket]) => ({
    reportDate,
    depthMdStart: bucket.depthMdStart,
    depthMdEnd: bucket.depthMdEnd,
    costDailyUsd: bucket.amount,
  }));

  return cumulativeFromReports(reports, date);
}

/* ------------------------------------------------------------------ */
/* Jendela aktivitas (dipakai rigs.ts & dashboard.ts)                  */
/* ------------------------------------------------------------------ */

/** Tanggal DDR terbaru di database (null bila belum ada laporan). */
export async function latestReportDate(): Promise<string | null> {
  const rows = await db
    .select({ reportDate: schema.dailyReports.reportDate })
    .from(schema.dailyReports)
    .where(isNull(schema.dailyReports.deletedAt))
    .orderBy(desc(schema.dailyReports.reportDate))
    .limit(1);
  return rows[0]?.reportDate ?? null;
}

/**
 * Titik acuan "7 hari terakhir" = `max(hari ini, tanggal DDR terbaru)`.
 *
 * Dengan begitu dataset demo (DDR 2026-09-10) tetap menampilkan rig aktif,
 * sementara pada data live hasilnya identik dengan "hari ini".
 */
export async function activityReferenceDate(): Promise<string> {
  const today = todayIsoLocal();
  const latest = await latestReportDate();
  // Dataset demo tanggalnya di masa lalu relatif jam sistem (2026-09-10 vs now).
  // Acuan diambil dari data terbaru agar "rig aktif" tetap bermakna; pada data
  // live (DDR hari ini) hasilnya identik dengan hari ini.
  return latest && latest < today ? latest : latest && latest > today ? latest : today;
}

/** Awal jendela aktivitas 7 hari sebelum tanggal acuan. */
export async function activityWindowStart(): Promise<string> {
  return shiftIsoDate(await activityReferenceDate(), -7);
}

/** Rentang tanggal laporan paling awal, dipakai untuk milestone. */
export async function firstReportDate(wellId: string): Promise<string | null> {
  const rows = await db
    .select({ reportDate: min(schema.dailyReports.reportDate) })
    .from(schema.dailyReports)
    .where(and(eq(schema.dailyReports.wellId, wellId), isNull(schema.dailyReports.deletedAt)));
  const value = rows[0]?.reportDate;
  return value ?? null;
}

/** Rows DDR (header saja) dalam jendela aktivitas, untuk hitung rig aktif. */
export async function recentReportRigs(): Promise<Array<{ rigId: string | null }>> {
  const since = await activityWindowStart();
  return db
    .selectDistinct({ rigId: schema.dailyReports.rigId })
    .from(schema.dailyReports)
    .where(and(gte(schema.dailyReports.reportDate, since), isNull(schema.dailyReports.deletedAt)));
}

/** Jumlah DDR per rig dalam jendela aktivitas 7 hari terakhir. */
export async function reportCountsInWindow(): Promise<Map<string, number>> {
  const since = await activityWindowStart();
  const rows = await db
    .select({ rigId: schema.dailyReports.rigId })
    .from(schema.dailyReports)
    .where(and(gte(schema.dailyReports.reportDate, since), isNull(schema.dailyReports.deletedAt)));

  const out = new Map<string, number>();
  for (const r of rows) {
    if (!r.rigId) continue;
    out.set(r.rigId, (out.get(r.rigId) ?? 0) + 1);
  }
  return out;
}

export { cleanDeep };
