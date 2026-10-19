/**
 * Integrasi repository DDR dengan DB nyata (PGlite in-memory + seed ARUN-07).
 *
 * Fokus: agregat 24 jam yang DISIMPAN di `daily_reports` harus identik dengan
 * hasil `@rigdaily/shared`, dan alur status/amendment tidak merusak data.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { setupTestDb, teardownTestDb } from './helpers/db';
import { round2 } from '@rigdaily/shared';
import { SEED, SEED_TIME_ROWS, seedTimeRowPayload } from './helpers/fixtures';
import type { ReportDetail } from '@/lib/repo/types';

async function repo() {
  return import('@/lib/repo/reports');
}

async function costsRepo() {
  return import('@/lib/repo/costs');
}

async function dbClient() {
  const { db, schema } = await import('@rigdaily/database');
  return { db, schema };
}

/** wellId + rigId dari dataset seed. */
async function seedIds(): Promise<{ wellId: string; rigId: string }> {
  const { db, schema } = await dbClient();
  const wells = await db.select().from(schema.wells);
  const rigs = await db.select().from(schema.rigs);
  const well = wells.find((w) => w.name === SEED.wellName);
  const rig = rigs.find((r) => r.name === SEED.rigName);
  if (!well || !rig) throw new Error('Seed ARUN-07 / DEEP-HORIZON 04 tidak ditemukan - setupTestDb gagal?');
  return { wellId: well.id, rigId: rig.id };
}

/** ID laporan seed DDR #145 (tanggal 2026-09-10, revisi terendah). */
async function seedReportId(): Promise<string> {
  const { db, schema } = await dbClient();
  const { wellId } = await seedIds();
  const rows = await db
    .select({ id: schema.dailyReports.id, revision: schema.dailyReports.revision })
    .from(schema.dailyReports)
    .where(sql`${schema.dailyReports.wellId} = ${wellId} AND ${schema.dailyReports.reportDate} = ${SEED.reportDate}`);

  const revisionOne = rows.find((r) => r.revision === 1);
  if (!revisionOne) throw new Error('DDR #145 (revision 1) tidak ditemukan di seed.');
  return revisionOne.id;
}

function findDetail(detail: ReportDetail): ReportDetail {
  expect(detail).not.toBeNull();
  return detail;
}

beforeAll(async () => {
  await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

/* ------------------------------------------------------------------ */
/* Baca laporan seed                                                   */
/* ------------------------------------------------------------------ */

describe('getReportById - DDR #145 seed', () => {
  it('mengembalikan detail lengkap dengan nomor 145', async () => {
    const { getReportById } = await repo();
    const detail = findDetail(await getReportById(await seedReportId()));

    expect(detail.reportNo).toBe(145);
    expect(detail.reportDate).toBe(SEED.reportDate);
    expect(detail.wellName).toBe(SEED.wellName);
    expect(detail.rigName).toBe(SEED.rigName);
  });

  it('timeRows berisi 9 baris seed', async () => {
    const { getReportById } = await repo();
    const detail = findDetail(await getReportById(await seedReportId()));
    expect(detail.timeRows).toHaveLength(9);
  });

  it('validation.ok === true untuk 24 jam lengkap', async () => {
    const { getReportById } = await repo();
    const detail = findDetail(await getReportById(await seedReportId()));

    expect(detail.validation.totalMinutes).toBe(1440);
    expect(detail.validation.issues).toEqual([]);
    expect(detail.validation.ok).toBe(true);
  });

  it('agregat tersimpan: total 1440 / PRD 1200 / NPT 150 / WOW 90', async () => {
    const { getReportById } = await repo();
    const detail = findDetail(await getReportById(await seedReportId()));

    expect(detail.totalMinutes).toBe(1440);
    expect(detail.productiveMinutes).toBe(1200);
    expect(detail.nptMinutes).toBe(150);
    expect(detail.wowMinutes).toBe(90);
  });

  it('nptPercent = 16.67', async () => {
    const { getReportById } = await repo();
    const detail = findDetail(await getReportById(await seedReportId()));
    expect(detail.nptPercent).toBe(16.67);
  });

  it('laporan tidak dikenal â†’ null', async () => {
    const { getReportById } = await repo();
    expect(await getReportById('00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* nextReportNo / createReport                                         */
/* ------------------------------------------------------------------ */

describe('createReport & nextReportNo', () => {
  it('nextReportNo menaik setelah ada laporan baru', async () => {
    const { createReport, nextReportNo } = await repo();
    const { wellId, rigId } = await seedIds();

    const before = await nextReportNo(wellId);
    expect(before).toBe(146); // seed DDR #145 â†’ berikutnya 146

    const created = await createReport({
      wellId,
      rigId,
      reportDate: '2026-09-11',
      depthMdStart: 2845,
      depthMdEnd: 2857,
    });

    expect(created.reportNo).toBe(146);
    expect(await nextReportNo(wellId)).toBe(147);
  });

  it('createReport otomatis memberi reportNo dan progress24h dari depth', async () => {
    const { createReport, getReportById } = await repo();
    const { wellId, rigId } = await seedIds();

    const created = await createReport({
      wellId,
      rigId,
      reportDate: '2026-09-12',
      depthMdStart: 2857,
      depthMdEnd: 2872.5,
    });

    const detail = findDetail(await getReportById(created.id));
    expect(detail.reportNo).toBeGreaterThan(0);
    expect(detail.reportDate).toBe('2026-09-12');
    expect(detail.progress24h).toBe(15.5);
    expect(detail.status).toBe('draft');
    expect(detail.totalMinutes).toBe(0);
  });

  it('laporan baru tanpa time rows â†’ validation.ok false (TIME_GAP)', async () => {
    const { createReport, getReportById } = await repo();
    const { wellId, rigId } = await seedIds();

    const created = await createReport({ wellId, rigId, reportDate: '2026-09-13', depthMdStart: 2872.5, depthMdEnd: 2880 });
    const detail = findDetail(await getReportById(created.id));

    expect(detail.validation.ok).toBe(false);
    expect(detail.validation.issues.map((i) => i.code)).toContain('TIME_GAP');
  });
});

/* ------------------------------------------------------------------ */
/* replaceTimeRows                                                     */
/* ------------------------------------------------------------------ */

describe('replaceTimeRows', () => {
  it('9 baris seed â†’ agregat di DB 1440 / 1200 / 150 / 90', async () => {
    const { createReport, replaceTimeRows, getReportById } = await repo();
    const { wellId, rigId } = await seedIds();

    const created = await createReport({ wellId, rigId, reportDate: '2026-09-14', depthMdStart: 2880, depthMdEnd: 2892 });
    await replaceTimeRows(created.id, seedTimeRowPayload());

    const detail = findDetail(await getReportById(created.id));
    expect(detail.totalMinutes).toBe(1440);
    expect(detail.productiveMinutes).toBe(1200);
    expect(detail.nptMinutes).toBe(150);
    expect(detail.wowMinutes).toBe(90);
    expect(detail.validation.ok).toBe(true);
  });

  it('baris tersimpan dengan durasi & kelas waktu yang benar (lintas midnight 390 menit)', async () => {
    const { createReport, replaceTimeRows, getReportById } = await repo();
    const { wellId, rigId } = await seedIds();

    const created = await createReport({ wellId, rigId, reportDate: '2026-09-15', depthMdStart: 2892, depthMdEnd: 2900 });
    await replaceTimeRows(created.id, seedTimeRowPayload());

    const detail = findDetail(await getReportById(created.id));
    const midnightRow = detail.timeRows.find((t) => t.start === '22:00');
    expect(midnightRow?.end).toBe('04:30');
    expect(midnightRow?.durationMin).toBe(390);

    const wowRow = detail.timeRows.find((t) => t.iadcCode === '27');
    expect(wowRow?.timeClass).toBe('WOW');
    expect(wowRow?.durationMin).toBe(90);
  });

  it('replace menimpa baris lama (bukan menambah)', async () => {
    const { createReport, replaceTimeRows, getReportById } = await repo();
    const { wellId, rigId } = await seedIds();

    const created = await createReport({ wellId, rigId, reportDate: '2026-09-16', depthMdStart: 2900, depthMdEnd: 2910 });
    await replaceTimeRows(created.id, seedTimeRowPayload());
    await replaceTimeRows(created.id, seedTimeRowPayload());

    const detail = findDetail(await getReportById(created.id));
    expect(detail.timeRows).toHaveLength(9);
    expect(detail.totalMinutes).toBe(1440);
  });

  it('dengan gap â†’ agregat dihitung apa adanya (1350, bukan dipaksa 1440)', async () => {
    const { createReport, replaceTimeRows, getReportById } = await repo();
    const { wellId, rigId } = await seedIds();
    const { SEED_TIME_ROWS: rows } = await import('./helpers/fixtures');

    const created = await createReport({ wellId, rigId, reportDate: '2026-09-17', depthMdStart: 2910, depthMdEnd: 2920 });
    // Buang baris 11:30-13:00 (90 menit NPT)
    const withGap = seedTimeRowPayload(rows.filter((_, i) => i !== 2));
    await replaceTimeRows(created.id, withGap);

    const detail = findDetail(await getReportById(created.id));
    expect(detail.totalMinutes).toBe(1350);
    expect(detail.nptMinutes).toBe(60); // hanya 19:30-20:30 tersisa (60 menit)
  });

  it('gap â†’ validation.ok === false dengan issue TIME_GAP', async () => {
    const { createReport, replaceTimeRows, getReportById } = await repo();
    const { wellId, rigId } = await seedIds();

    const created = await createReport({ wellId, rigId, reportDate: '2026-09-18', depthMdStart: 2920, depthMdEnd: 2930 });
    await replaceTimeRows(created.id, seedTimeRowPayload(SEED_TIME_ROWS.filter((_, i) => i !== 2)));

    const detail = findDetail(await getReportById(created.id));
    expect(detail.validation.ok).toBe(false);
    const gap = detail.validation.issues.find((i) => i.code === 'TIME_GAP');
    expect(gap).toBeDefined();
    expect(gap?.message).toContain('1.50h');
  });

  it('overlap â†’ validation.ok false dengan TIME_OVERLAP', async () => {
    const { createReport, replaceTimeRows, getReportById } = await repo();
    const { wellId, rigId } = await seedIds();

    const created = await createReport({ wellId, rigId, reportDate: '2026-09-19', depthMdStart: 2930, depthMdEnd: 2940 });
    await replaceTimeRows(created.id, [
      { start: '06:00', end: '08:30', iadcCode: '01' },
      { start: '08:00', end: '09:00', iadcCode: '01' },
    ]);

    const detail = findDetail(await getReportById(created.id));
    expect(detail.validation.ok).toBe(false);
    expect(detail.validation.issues.map((i) => i.code)).toContain('TIME_OVERLAP');
  });

  it('format waktu tidak valid â†’ throw (tidak menyimpan data sampah)', async () => {
    const { createReport, replaceTimeRows } = await repo();
    const { wellId, rigId } = await seedIds();

    const created = await createReport({ wellId, rigId, reportDate: '2026-09-20', depthMdStart: 2940, depthMdEnd: 2950 });
    await expect(replaceTimeRows(created.id, [{ start: 'abc', end: '09:00', iadcCode: '01' }])).rejects.toThrow(/format waktu/i);
  });
});

/* ------------------------------------------------------------------ */
/* Status & amendment                                                  */
/* ------------------------------------------------------------------ */

describe('updateReportStatus', () => {
  it("status 'approved' â†’ approvedAt & lockedAt terisi, approvedBy diset", async () => {
    const { createReport, updateReportStatus, getReportById } = await repo();
    const { wellId, rigId } = await seedIds();

    const created = await createReport({ wellId, rigId, reportDate: '2026-09-21', depthMdStart: 2950, depthMdEnd: 2960 });
    await updateReportStatus(created.id, 'approved', null, { signatureName: 'Dave Miller' });

    const detail = findDetail(await getReportById(created.id));
    expect(detail.status).toBe('approved');
    expect(detail.approvedAt).toBeTypeOf('string');
    expect(detail.signatureName).toBe('Dave Miller');

    const { db, schema } = await dbClient();
    const rows = await db.select().from(schema.dailyReports).where(sql`${schema.dailyReports.id} = ${created.id}`);
    expect(rows[0].lockedAt).toBeInstanceOf(Date);
    expect(rows[0].signedAt).toBeInstanceOf(Date);
  });

  it("status 'submitted' â†’ submittedAt terisi, lockedAt tetap null", async () => {
    const { createReport, updateReportStatus } = await repo();
    const { wellId, rigId } = await seedIds();

    const created = await createReport({ wellId, rigId, reportDate: '2026-09-22', depthMdStart: 2960, depthMdEnd: 2970 });
    await updateReportStatus(created.id, 'submitted');

    const { db, schema } = await dbClient();
    const rows = await db.select().from(schema.dailyReports).where(sql`${schema.dailyReports.id} = ${created.id}`);
    expect(rows[0].status).toBe('submitted');
    expect(rows[0].submittedAt).toBeInstanceOf(Date);
    expect(rows[0].lockedAt).toBeNull();
  });
});

describe('createAmendment', () => {
  it('revision +1 dan parentReportId terisi', async () => {
    const { createAmendment, getReportById } = await repo();
    const parentId = await seedReportId();
    const parent = findDetail(await getReportById(parentId));

    const amendment = await createAmendment(parentId, 'Koreksi NPT Code 08 setelah verifikasi toolpusher.');
    const child = findDetail(await getReportById(amendment.id));

    expect(child.revision).toBe(parent.revision + 1);
    expect(child.revision).toBe(2);
    expect(child.parentReportId).toBe(parentId);
    expect(child.reportNo).toBe(parent.reportNo);
    expect(child.status).toBe('draft');
  });

  /**
   * Dulu bug: `createAmendment()` hanya menyalin time rows, crew, mud dan cost
   * lines - `bha_components`, `survey_stations` dan `mac_activities` tidak ikut,
   * sehingga DDR revisi kehilangan BHA/Survey/MAC padahal PDF revisi harus
   * lengkap. Test lama mengunci perilaku bug itu.
   *
   * Sekarang benar: repo menyalin ketiga tabel tersebut juga. Seed v2 menanam
   * untuk setiap laporan: 3 komponen BHA dan 2 survey station; `mac_activities`
   * memang tidak di-seed (0 baris) - jadi yang diuji adalah "revisi identik
   * dengan parent", bukan angka hard-code lama (5/4/3).
   */
  it('anak-anak tersalin lengkap: time rows, crew, mud, cost lines, bha, survey, mac', async () => {
    const { createAmendment, getReportById } = await repo();
    const parentId = await seedReportId();
    const parent = findDetail(await getReportById(parentId));

    const amendment = await createAmendment(parentId, 'Salin ulang seluruh data operasional untuk revisi.');
    const child = findDetail(await getReportById(amendment.id));

    // Prasyarat data seed (lihat packages/database/src/seed.ts).
    expect(parent.timeRows).toHaveLength(9);
    expect(parent.crew).toHaveLength(6);
    expect(parent.costLines).toHaveLength(8);
    expect(parent.bha).toHaveLength(3);
    expect(parent.survey).toHaveLength(2);
    expect(parent.mac).toHaveLength(0); // seed tidak menanam MAC activity

    expect(child.timeRows).toHaveLength(parent.timeRows.length);
    expect(child.crew).toHaveLength(parent.crew.length);
    expect(child.costLines).toHaveLength(parent.costLines.length);
    expect(child.bha).toHaveLength(parent.bha.length);
    expect(child.survey).toHaveLength(parent.survey.length);
    expect(child.mac).toHaveLength(parent.mac.length);
    expect(child.totalMinutes).toBe(1440);
    expect(child.mud?.weightPpg).toBe(12.4);
  });

  it('amendment menyalin bha, survey dan mac dari parent', async () => {
    const { createAmendment, getReportById } = await repo();
    const parentId = await seedReportId();
    const parent = findDetail(await getReportById(parentId));

    const amendment = await createAmendment(parentId, 'Cek data teknis BHA/survey/MAC pada revisi.');
    const child = findDetail(await getReportById(amendment.id));

    // Revisi wajib identik dengan parent agar PDF revisi lengkap.
    // Parent: 3 komponen BHA + 2 survey station; mac kosong (tidak di-seed).
    expect(parent.bha).toHaveLength(3);
    expect(parent.survey).toHaveLength(2);
    expect(parent.mac).toHaveLength(0);

    expect(child.bha).toHaveLength(parent.bha.length);
    expect(child.survey).toHaveLength(parent.survey.length);
    expect(child.mac).toHaveLength(parent.mac.length);

    expect(child.bha.map((b) => b.component)).toEqual(parent.bha.map((b) => b.component));
    expect(child.bha.map((b) => b.sortOrder)).toEqual(parent.bha.map((b) => b.sortOrder));
    expect(child.survey.map((x) => x.md)).toEqual(parent.survey.map((x) => x.md));
    expect(child.survey.map((x) => x.inclination)).toEqual(parent.survey.map((x) => x.inclination));
  });


  it('parent tidak diubah oleh amendment (jejak audit utuh)', async () => {
    const { getReportById } = await repo();
    const parentId = await seedReportId();
    const parent = findDetail(await getReportById(parentId));

    expect(parent.revision).toBe(1);
    expect(parent.parentReportId).toBeNull();
    expect(parent.status).toBe('submitted');
  });

  it('amendment kedua untuk tanggal sama tetap bisa dibuat (revisi lanjut, bukan tabrakan unique index)', async () => {
    const { createAmendment, getReportById } = await repo();
    const parentId = await seedReportId();
    const parent = findDetail(await getReportById(parentId));

    const second = await createAmendment(parentId, 'Amendment kedua pada tanggal yang sama.');
    const child = findDetail(await getReportById(second.id));

    // Revisi diambil dari revisi TERTINGGI tanggal tsb + 1 (bukan parent.revision + 1),
    // jadi nilainya bergantung pada amendment yang sudah ada di DB test ini.
    const { db, schema } = await dbClient();
    const sameDate = await db
      .select({ revision: schema.dailyReports.revision })
      .from(schema.dailyReports)
      .where(sql`${schema.dailyReports.wellId} = ${parent.wellId} AND ${schema.dailyReports.reportDate} = ${parent.reportDate}`);
    const highestBefore = Math.max(parent.revision, ...sameDate.map((r) => r.revision));

    expect(child.revision).toBeGreaterThan(parent.revision);
    expect(child.revision).toBeLessThanOrEqual(highestBefore + 1);
    expect(child.parentReportId).toBe(parentId);

    // Tidak ada dua laporan dengan tanggal + revisi sama (unique index dijaga).
    const revisions = sameDate.map((r) => r.revision);
    expect(new Set(revisions).size).toBe(revisions.length);
  });

  it('laporan tidak dikenal â†’ throw', async () => {
    const { createAmendment } = await repo();
    await expect(createAmendment('00000000-0000-4000-8000-000000000000', 'Alasan yang panjang.')).rejects.toThrow();
  });
});


/* ------------------------------------------------------------------ */
/* Cost lines - isolasi penuh (snapshot tidak bergantung test lain)    */
/* ------------------------------------------------------------------ */

/**
 * Pembanding query "manual" untuk kumulatif biaya: jumlah cost line (`LEDGER`)
 * satu laporan per tanggal (revisi tertinggi menang) - persis definisi
 * "kumulatif" yang dijanjikan kode (`cumulativeFromReports`, `createAmendment`,
 * `getCostSummary`).
 *
 * Revisi TIDAK boleh menambah biaya: `createAmendment()` menyalin cost line
 * parent ke laporan revisi, jadi menjumlah semua revisi = biaya hari itu
 * terhitung berkali-kali (lihat bug yang diungkap test di blok ini).
 */
async function costDailySumBefore(wellId: string, beforeDate: string): Promise<{ sum: number; count: number }> {
  const { db, schema } = await dbClient();
  const rows = await db
    .select({
      reportId: schema.dailyReports.id,
      reportDate: schema.dailyReports.reportDate,
      revision: schema.dailyReports.revision,
      amountUsd: schema.costLines.amountUsd,
    })
    .from(schema.dailyReports)
    .innerJoin(schema.costLines, eq(schema.costLines.reportId, schema.dailyReports.id))
    .where(
      and(
        eq(schema.dailyReports.wellId, wellId),
        lt(schema.dailyReports.reportDate, beforeDate),
        isNull(schema.dailyReports.deletedAt),
        isNull(schema.costLines.deletedAt),
      ),
    );

  // Jumlahkan cost line per LAPORAN (satu laporan = beberapa cost line).
  const perReport = new Map<string, { reportDate: string; revision: number; amount: number }>();
  for (const r of rows) {
    const cur = perReport.get(r.reportId);
    if (cur) cur.amount = round2(cur.amount + Number(r.amountUsd));
    else perReport.set(r.reportId, { reportDate: r.reportDate, revision: r.revision, amount: round2(Number(r.amountUsd)) });
  }

  // Satu laporan per tanggal: revisi tertinggi menang (revisi bukan biaya baru).
  const perDate = new Map<string, { revision: number; amount: number }>();
  for (const v of perReport.values()) {
    const cur = perDate.get(v.reportDate);
    if (!cur || v.revision > cur.revision) perDate.set(v.reportDate, { revision: v.revision, amount: v.amount });
  }

  let sum = 0;
  for (const v of perDate.values()) sum += v.amount;
  return { sum: round2(sum), count: perDate.size };
}


const SEED_COST_LINES_INPUT = [
  { category: 'Rig Spread', description: 'Dayrate', amount: 28500 },
  { category: 'Mud & Chems', description: 'Barite', amount: 6800 },
  { category: 'Fuel & Power', description: 'Diesel', amount: 6882.5 },
  { category: 'Directional / RSS', description: 'RSS', amount: 4850, rebillable: true },
  { category: 'NPT Repair & Tech', description: 'NPT tech', amount: 1420, rebillable: true },
  { category: 'Standby Adjust.', description: 'WOW credit', amount: -687.5 },
  { category: 'Waste & Solids', description: 'Cuttings', amount: 1225 },
  { category: 'Mud Logging', description: 'Mud logging', amount: 1260 },
];

describe('replaceCostLines + getCostSummary (skenario biaya)', () => {
  /**
   * Semua test cost dimulai dengan mendaratkan laporan 8 cost line pada tanggal
   * TERAKHIR di DB (setelah semua laporan yang dipakai test lain), sehingga
   * `getCostSummary` (yang memakai laporan terbaru) melihatnya secara deterministik.
   */
  const COST_DATE = '2026-09-26';
  let costReportId = '';

  beforeAll(async () => {
    const { createReport, replaceCostLines } = await repo();
    const { wellId, rigId } = await seedIds();
    const created = await createReport({ wellId, rigId, reportDate: COST_DATE, depthMdStart: 3500, depthMdEnd: 3510 });
    costReportId = created.id;
    await replaceCostLines(
      created.id,
      SEED_COST_LINES_INPUT.map((l) => ({ category: l.category, description: l.description, amount: l.amount, rebillable: l.rebillable })),
    );
  });

  it('dailyTotal sesuai sum cost lines yang disimpan (8 baris seed = 50250)', async () => {
    const { getReportById } = await repo();
    const { getCostSummary } = await costsRepo();
    const { wellId } = await seedIds();

    const detail = findDetail(await getReportById(costReportId));
    expect(detail.costDailyUsd).toBe(50250);
    expect(detail.costLines).toHaveLength(8);

    const summary = await getCostSummary(wellId);
    expect(summary.dailyTotal).toBe(50250);
  });

  it('byCategory pada ringkasan repo memakai summarizeCost (Rig Spread terbesar)', async () => {
    const { getCostSummary } = await costsRepo();
    const { wellId } = await seedIds();

    const summary = await getCostSummary(wellId);
    const byCat = Object.fromEntries(summary.byCategory.map((c) => [c.category, c.amount]));

    expect(byCat['Rig Spread']).toBe(28500);
    expect(byCat['Fuel & Power']).toBe(6882.5);
    expect(byCat['Standby Adjust.']).toBe(-687.5);
    expect(summary.byCategory[0].category).toBe('Rig Spread'); // terurut desc
    expect(summary.byCategory[0].percent).toBe(56.72); // 28500 / 50250 * 100
  });

  /**
   * MENGUNCI BUG PRODUKSI yang masih terbuka (bukan test usang).
   *
   * Bug: `sumCostLinesForWellUpTo()` (apps/web/lib/repo/shared.ts) menjumlah
   * `cost_lines.amount_usd` SEMUA laporan, termasuk SEMUA revisi hasil
   * `createAmendment()` yang menyalin cost line parent. Akibatnya biaya satu
   * tanggal terhitung N kali (N = jumlah revisi).
   *
   * Bukti terukur (probe terpisah, ARUN-07):
   *   sebelum amendment : getCostSummary.cumulativeTotal = 50.250
   *   setelah 2 amendment: getCostSummary.cumulativeTotal = 150.750  (3 x 50.250)
   *   padahal `cumulativeFromReports()` (jalur yang dijanjikan kode) = 50.250,
   *   dan komentar `createAmendment()` sendiri menyatakan "total harian tanggal
   *   ini terhitung berulang tiap revisi" itu SALAH.
   *
   * EXPECTED (perilaku benar): kumulatif laporan baru = saldo berjalan ledger
   * (satu laporan per tanggal) + daily laporan ini.
   */
  it('costCumulativeUsd = carried + total harian (tidak double count)', async () => {
    const { createReport, replaceCostLines, getReportById } = await repo();
    const { wellId, rigId } = await seedIds();

    const reportDate = '2026-09-25';
    const snapshot = await costDailySumBefore(wellId, reportDate);
    expect(snapshot.sum).toBeGreaterThanOrEqual(SEED.cumulativeCost);

    const created = await createReport({ wellId, rigId, reportDate, depthMdStart: 3600, depthMdEnd: 3610 });
    await replaceCostLines(created.id, [{ category: 'Rig Spread', description: 'Dayrate', amount: 1000 }]);

    const detail = findDetail(await getReportById(created.id));
    expect(detail.costDailyUsd).toBe(1000);
    expect(detail.costCumulativeUsd).toBe(snapshot.sum + 1000);
  });


  it('recomputeReportCosts idempoten: replaceCostLines dua kali â†’ nilai sama', async () => {
    const { replaceCostLines, getReportById } = await repo();
    const { wellId } = await seedIds();
    const { db, schema } = await dbClient();

    const rows = await db
      .select({ id: schema.dailyReports.id })
      .from(schema.dailyReports)
      .where(sql`${schema.dailyReports.wellId} = ${wellId} AND ${schema.dailyReports.reportDate} = '2026-09-25'`);
    const reportId = rows[0].id;

    const first = findDetail(await getReportById(reportId)).costCumulativeUsd;
    await replaceCostLines(reportId, [{ category: 'Rig Spread', description: 'Dayrate', amount: 1000 }]);
    const second = findDetail(await getReportById(reportId)).costCumulativeUsd;

    expect(second).toBe(first);
  });

  /**
   * `getCostSummary()` mengunci perilaku BENAR: `cumulativeTotal` = sum cost line
   * otoritatif semua laporan sumur s/d tanggal laporan terbaru (jalur bersama
   * `sumCostLinesForWellUpTo()` dengan dashboard), BUKAN kolom denormalisasi
   * `cost_cumulative_usd` yang bisa basi/dobel (lihat bug di test terakhir).
   *
   * Ekspektasi diturunkan dari LEDGER NYATA, bukan angka hard-code yang
   * bergantung jumlah laporan uji sebelumnya:
   *
   *   EXPECTED cumulativeTotal = sum(daily laporan lain s/d COST_DATE) + 50.250
   *   (demo seed saja: 50.250 (DDR #145) + 50.250 (laporan ini) = 100.500)
   */
  it('regresi (bug B): getCostSummary memakai sum cost line otoritatif, bukan kolom denormalisasi', async () => {
    const { getCostSummary } = await costsRepo();
    const { wellId } = await seedIds();

    const summary = await getCostSummary(wellId);
    expect(summary.dailyTotal).toBe(50_250);
    expect(summary.afeBudget).toBe(1_600_000);

    // Nilai benar tidak pernah lebih kecil dari riwayat AFE seed.
    expect(summary.cumulativeTotal).toBeGreaterThanOrEqual(SEED.cumulativeCost);

    // carried = query ledger laporan lain (satu laporan per tanggal); + daily laporan terbaru.
    const carried = await costDailySumBefore(wellId, COST_DATE);
    expect(carried.sum).toBeGreaterThanOrEqual(SEED.cumulativeCost);
    expect(summary.cumulativeTotal).toBe(carried.sum + 50_250);
    expect(summary.afeConsumedPercent).toBe(round2((summary.cumulativeTotal / 1_600_000) * 100));
  });


  it('replaceCostLines menimpa, bukan menambah baris', async () => {
    const { createReport, replaceCostLines } = await repo();
    const { listCostLines } = await costsRepo();
    const { wellId, rigId } = await seedIds();

    const created = await createReport({ wellId, rigId, reportDate: '2026-09-23', depthMdStart: 3700, depthMdEnd: 3710 });
    await replaceCostLines(created.id, [{ category: 'Rig Spread', description: 'Dayrate', amount: 1000 }]);
    await replaceCostLines(created.id, [{ category: 'Rig Spread', description: 'Dayrate', amount: 2000 }]);

    const lines = await listCostLines(created.id);
    expect(lines).toHaveLength(1);
    expect(lines[0].amount).toBe(2000);
  });

  it('cost line negatif (kredit WOW) dihitung apa adanya', async () => {
    const { createReport, replaceCostLines, getReportById } = await repo();
    const { wellId, rigId } = await seedIds();

    const created = await createReport({ wellId, rigId, reportDate: '2026-09-24', depthMdStart: 3710, depthMdEnd: 3720 });
    await replaceCostLines(created.id, [
      { category: 'Rig Spread', description: 'Dayrate', amount: 1000 },
      { category: 'Standby Adjust.', description: 'WOW credit', amount: -687.5 },
    ]);

    const detail = findDetail(await getReportById(created.id));
    expect(detail.costDailyUsd).toBe(312.5);
  });
});

describe('getCostSummary - ringkasan biaya sumur (deterministik)', () => {
  /**
   * `getCostSummary` memakai laporan TERBARU sumur sebagai "hari ini".
   * Di sini laporan itu dibuat dengan 8 cost line seed, jadi angka bisa
   * dibandingkan deterministik (tanpa bergantung test lain di file ini) -
   * asalkan tanggalnya lebih besar dari semua tanggal yang dipakai test tersebut
   * (test file ini memakai tanggal paling jauh 2026-09-22).
   */
  const SUMMARY_REPORT_DATE = '2026-09-27';
  let summaryReportId = '';

  beforeAll(async () => {
    const { createReport, replaceCostLines } = await repo();
    const { wellId, rigId } = await seedIds();
    const created = await createReport({ wellId, rigId, reportDate: SUMMARY_REPORT_DATE, depthMdStart: 3800, depthMdEnd: 3810 });
    summaryReportId = created.id;
    await replaceCostLines(
      created.id,
      SEED_COST_LINES_INPUT.map((l) => ({ category: l.category, description: l.description, amount: l.amount, rebillable: l.rebillable })),
    );
  });

  it('dailyTotal = 50250 dan byCategory memakai summarizeCost (Rig Spread 56.72%)', async () => {
    const { getReportById } = await repo();
    const { getCostSummary } = await costsRepo();
    const { wellId } = await seedIds();

    const detail = findDetail(await getReportById(summaryReportId));
    expect(detail.costDailyUsd).toBe(50250);
    expect(detail.costLines).toHaveLength(8);

    const summary = await getCostSummary(wellId);
    expect(summary.dailyTotal).toBe(50250);

    const byCat = Object.fromEntries(summary.byCategory.map((c) => [c.category, c.amount]));
    expect(byCat['Rig Spread']).toBe(28500);
    expect(byCat['Fuel & Power']).toBe(6882.5);
    expect(byCat['Standby Adjust.']).toBe(-687.5);
    expect(summary.byCategory[0].category).toBe('Rig Spread'); // terurut desc
    expect(summary.byCategory[0].percent).toBe(56.72); // 28500 / 50250 * 100
  });

  /**
   * `getCostSummary().cumulativeTotal` harus = sum LEDGER dengan SATU laporan
   * per tanggal (revisi tidak menambah biaya).
   *
   * MENGUNCI BUG PRODUKSI (lihat juga test `costCumulativeUsd = carried + ...`):
   * `sumCostLinesForWellUpTo()` menjumlah cost line SEMUA revisi, padahal
   * `createAmendment()` menyalin cost line parent. Sejak blok `createAmendment`
   * di file ini membuat 5 revisi DDR #145, biaya 2026-09-10 terhitung 5x
   * (5 x 50.250 = 251.250, bukan 50.250).
   *
   * EXPECTED = carried (ledger, 1 laporan/tanggal) + 50.250.
   */
  it('regresi: getCostSummary memakai sum cost line otoritatif, tanpa menghitung revisi berulang', async () => {
    const { getCostSummary } = await costsRepo();
    const { wellId } = await seedIds();

    const carried = await costDailySumBefore(wellId, SUMMARY_REPORT_DATE);
    const summary = await getCostSummary(wellId);

    expect(summary.afeBudget).toBe(1_600_000);
    // Riwayat seed ARUN-07 (DDR #145) wajib ikut terhitung, tidak boleh hilang.
    expect(carried.sum).toBeGreaterThanOrEqual(SEED.cumulativeCost);
    // EXPECTED (perilaku benar): sekali per tanggal + daily laporan terbaru.
    expect(summary.cumulativeTotal).toBe(carried.sum + 50_250);
    expect(summary.afeConsumedPercent).toBe(round2((summary.cumulativeTotal / 1_600_000) * 100));
  });

});

describe('recomputeReportCosts - kumulatif berbasis cost line', () => {
  /**
   * Laporan PERTAMA pada sumur baru (tidak ada laporan lain):
   *   createReport → belum ada cost line → cum = 0
   *   replaceCostLines(1.000) → cum = 0 (laporan lain) + 1.000 = 1.000
   *
   * Nilai ini BENAR dan stabil (tidak bergantung urutan baris).
   */
  it('sumur baru: cum = daily laporan itu sendiri (0 → 1.000)', async () => {

    const { createReport, replaceCostLines, getReportById } = await repo();
    const { db, schema } = await dbClient();

    const [company] = await db.select().from(schema.companies).limit(1);
    const [field] = await db.select().from(schema.fields).limit(1);

    const [newWell] = await db
      .insert(schema.wells)
      .values({ fieldId: field.id, name: `QA-ISOLATED-${Date.now()}`, type: 'oil', phase: 'drilling' })
      .returning({ id: schema.wells.id });
    expect(company.id).toBeTruthy();

    const created = await createReport({
      wellId: newWell.id,
      reportDate: '2026-09-10',
      depthMdStart: 0,
      depthMdEnd: 500,
    });
    // Laporan pertama: cum harus 0 (belum ada laporan lain).
    const before = findDetail(await getReportById(created.id));
    expect(before.costCumulativeUsd).toBe(0);

    await replaceCostLines(created.id, [{ category: 'Rig Spread', description: 'Dayrate', amount: 1000 }]);

    const after = findDetail(await getReportById(created.id));
    expect(after.costDailyUsd).toBe(1000);
    expect(after.costCumulativeUsd).toBe(1000);
  });

});


