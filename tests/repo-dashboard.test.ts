/**
 * Integrasi dashboard - KPI, tren, dan komposisi waktu dari DB nyata (seed ARUN-07).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { setupTestDb, teardownTestDb } from './helpers/db';
import { SEED } from './helpers/fixtures';

async function dashboardRepo() {
  return import('@/lib/repo/dashboard');
}

async function dbClient() {
  const { db, schema } = await import('@rigdaily/database');
  return { db, schema };
}

async function seedIds(): Promise<{ wellId: string; rigId: string; reportId: string }> {
  const { db, schema } = await dbClient();
  const wells = await db.select().from(schema.wells);
  const rigs = await db.select().from(schema.rigs);
  const well = wells.find((w) => w.name === SEED.wellName);
  const rig = rigs.find((r) => r.name === SEED.rigName);
  if (!well || !rig) throw new Error('Seed ARUN-07 / DEEP-HORIZON 04 tidak ditemukan.');

  const reports = await db
    .select({ id: schema.dailyReports.id, revision: schema.dailyReports.revision })
    .from(schema.dailyReports)
    .where(sql`${schema.dailyReports.wellId} = ${well.id} AND ${schema.dailyReports.reportDate} = ${SEED.reportDate}`);
  const seedReport = reports.find((r) => r.revision === 1);
  if (!seedReport) throw new Error('DDR #145 revision 1 tidak ada di seed.');

  return { wellId: well.id, rigId: rig.id, reportId: seedReport.id };
}

beforeAll(async () => {
  await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

describe('getDashboardKpi - seed ARUN-07', () => {
  it('depthToday = 2845', async () => {
    const { getDashboardKpi } = await dashboardRepo();
    const { wellId } = await seedIds();
    const kpi = await getDashboardKpi(wellId);

    expect(kpi.depthToday).toBe(2845);
  });

  it('depthDelta = 12 (progress 24 jam)', async () => {
    const { getDashboardKpi } = await dashboardRepo();
    const { wellId } = await seedIds();
    const kpi = await getDashboardKpi(wellId);

    expect(kpi.depthDelta).toBe(12);
  });

  it('nptPercent = 16.67', async () => {
    const { getDashboardKpi } = await dashboardRepo();
    const { wellId } = await seedIds();
    const kpi = await getDashboardKpi(wellId);

    expect(kpi.nptPercent).toBe(16.67);
  });

  it('dailyCost = 50250', async () => {
    const { getDashboardKpi } = await dashboardRepo();
    const { wellId } = await seedIds();
    const kpi = await getDashboardKpi(wellId);

    expect(kpi.dailyCost).toBe(50250);
  });

  // Judul diperbarui: seed v2 hanya punya DDR #145 untuk ARUN-07 → 50.250
  // (nilai lama 1.248.600 berasal dari prototype 1-sumur).
  it('afeBudget = 1600000 dan cumulativeCost = 50250 (seed ARUN-07)', async () => {
    const { getDashboardKpi } = await dashboardRepo();
    const { wellId } = await seedIds();
    const kpi = await getDashboardKpi(wellId);

    expect(kpi.afeBudget).toBe(1_600_000);
    expect(kpi.cumulativeCost).toBe(SEED.cumulativeCost);
  });

  /**
   * `getDashboardKpi()` tanpa `wellId` = tampilan GLOBAL (semua sumur aktif).
   *
   * Sebelumnya test ini mengunci angka 3.14 / 1.600.000, yaitu campuran yang
   * menyesatkan: `dailyCost` dari satu sumur tetapi AFE dari cakupan lain.
   * Perilaku kontrak saat ini: tanpa `wellId`, `afeBudget` dan `cumulativeCost`
   * SAMA-SAMA mencakup semua sumur aktif sehingga rasio AFE konsisten.
   *
   *   afeBudget      = 1.600.000 (ARUN-07) + 1.450.000 (ARUN-05) + 1.800.000 (ARUN-06)
   *                  = 4.850.000
   *   cumulativeCost = 50.250 (ARUN-07) + 40.060 (ARUN-05) + 68.500 (ARUN-06)
   *                  = 158.810
   *   158.810 / 4.850.000 * 100 = 3.2744... → round2 = 3.27
   */
  it('tanpa wellId: laporan terbaru global (#145) dengan AFE kumulatif SEMUA sumur', async () => {
    const { getDashboardKpi } = await dashboardRepo();
    const kpi = await getDashboardKpi();

    // Laporan terbaru global = DDR #145 (ARUN-07, 2026-09-10).
    expect(kpi.depthToday).toBe(2845);
    expect(kpi.depthDelta).toBe(12);
    expect(kpi.nptPercent).toBe(16.67);
    expect(kpi.dailyCost).toBe(50250);

    // AFE global = total semua sumur (bukan hanya budget 1 sumur).
    expect(kpi.afeBudget).toBe(4_850_000);
    expect(kpi.cumulativeCost).toBe(158_810);
    expect(kpi.afeConsumedPercent).toBe(3.27);
    expect(kpi.cumulativeCost).toBeGreaterThan(SEED.cumulativeCost); // > ARUN-07 saja
    expect(kpi.afeBudget).toBeGreaterThan(SEED.afeBudget);
  });

  /**
   * Diperbarui: nilai 78.04 berasal dari seed 1-sumur (kumulatif 1.248.600).
   * Seed v2: ARUN-07 hanya punya DDR #145 → kumulatif = 50.250.
   *   50.250 / 1.600.000 * 100 = 3.1406... → round2 = 3.14
   */
  it('afeConsumedPercent = 3.14 (50.250 / 1.600.000 * 100)', async () => {
    const { getDashboardKpi } = await dashboardRepo();
    const { wellId } = await seedIds();
    const kpi = await getDashboardKpi(wellId);

    expect(kpi.afeConsumedPercent).toBe(3.14);
  });

  it('activeRigs & totalRigs terisi (rig seed punya DDR dalam jendela 7 hari)', async () => {
    const { getDashboardKpi } = await dashboardRepo();
    const { wellId } = await seedIds();
    const kpi = await getDashboardKpi(wellId);

    expect(kpi.totalRigs).toBeGreaterThanOrEqual(1);
    expect(kpi.activeRigs).toBeGreaterThanOrEqual(1);
    expect(kpi.activeRigs).toBeLessThanOrEqual(kpi.totalRigs);
  });

  it('tanpa laporan (sumur baru) → semua angka 0 dan afeConsumedPercent null bila tanpa budget', async () => {
    const { getDashboardKpi } = await dashboardRepo();
    const { db, schema } = await dbClient();
    const [field] = await db.select().from(schema.fields).limit(1);

    const [emptyWell] = await db
      .insert(schema.wells)
      .values({ fieldId: field.id, name: `QA-EMPTY-${Date.now()}`, type: 'oil', phase: 'planning' })
      .returning({ id: schema.wells.id });

    const kpi = await getDashboardKpi(emptyWell.id);
    expect(kpi.depthToday).toBe(0);
    expect(kpi.nptPercent).toBe(0);
    expect(kpi.dailyCost).toBe(0);
    expect(kpi.afeConsumedPercent).toBeNull();
    expect(kpi.afeBudget).toBeNull();
  });
});

describe('getTrend', () => {
  it('minimal 1 titik dengan depthMd 2845', async () => {
    const { getTrend } = await dashboardRepo();
    const { wellId } = await seedIds();

    const trend = await getTrend(wellId, 30);
    expect(trend.length).toBeGreaterThanOrEqual(1);
    expect(trend.some((p) => p.depthMd === 2845)).toBe(true);
  });

  it('titik tren memakai tanggal & nptPercent yang benar untuk DDR #145', async () => {
    const { getTrend } = await dashboardRepo();
    const { wellId } = await seedIds();

    const point = (await getTrend(wellId, 30)).find((p) => p.date === SEED.reportDate);
    expect(point).toBeDefined();
    expect(point?.depthMd).toBe(2845);
    expect(point?.nptPercent).toBe(16.67);
    expect(point?.dailyCost).toBe(50250);
  });

  it('tren diurutkan naik berdasarkan tanggal', async () => {
    const { getTrend } = await dashboardRepo();
    const { wellId } = await seedIds();

    const dates = (await getTrend(wellId, 30)).map((p) => p.date);
    const sorted = [...dates].sort();
    expect(dates).toEqual(sorted);
  });

  it('days <= 0 dijepit menjadi 1 titik', async () => {
    const { getTrend } = await dashboardRepo();
    const { wellId } = await seedIds();

    const trend = await getTrend(wellId, 0);
    expect(trend.length).toBe(1);
  });
});

describe('getTimeMix - komposisi menit', () => {
  it('productive 1200, npt 150, wow 90, gap 0', async () => {
    const { getTimeMix } = await dashboardRepo();
    const { reportId } = await seedIds();

    const mix = await getTimeMix(reportId);
    expect(mix.productive).toBe(1200);
    expect(mix.npt).toBe(150);
    expect(mix.wow).toBe(90);
    expect(mix.gap).toBe(0);
  });

  it('standby & disputed 0 pada seed', async () => {
    const { getTimeMix } = await dashboardRepo();
    const { reportId } = await seedIds();

    const mix = await getTimeMix(reportId);
    expect(mix.standby).toBe(0);
    expect(mix.disputed).toBe(0);
  });

  it('laporan tidak dikenal → semua 0 dengan gap 1440', async () => {
    const { getTimeMix } = await dashboardRepo();

    const mix = await getTimeMix('00000000-0000-4000-8000-000000000000');
    expect(mix.productive).toBe(0);
    expect(mix.npt).toBe(0);
    expect(mix.wow).toBe(0);
    expect(mix.gap).toBe(1440);
  });
});

describe('getReportsSummary', () => {
  it('mengembalikan daftar laporan (minimal DDR #145)', async () => {
    const { getReportsSummary } = await dashboardRepo();

    const items = await getReportsSummary(10);
    expect(items.length).toBeGreaterThanOrEqual(1);
    const seeded = items.find((i) => i.reportNo === 145);
    expect(seeded).toBeDefined();
    expect(seeded?.wellName).toBe(SEED.wellName);
    expect(seeded?.nptPercent).toBe(16.67);
  });
});
