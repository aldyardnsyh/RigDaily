/**
 * Integrasi billing bulanan (rate card tiered) di atas data seed DDR #145.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { setupTestDb, teardownTestDb } from './helpers/db';
import { SEED, SEED_RATE_CARD_CODES, SEED_RATE_CARDS } from './helpers/fixtures';

async function billingRepo() {
  return import('@/lib/repo/billing');
}

async function dbClient() {
  const { db, schema } = await import('@rigdaily/database');
  return { db, schema };
}

async function seedRigId(): Promise<string> {
  const { db, schema } = await dbClient();
  const rigs = await db.select().from(schema.rigs);
  const rig = rigs.find((r) => r.name === SEED.rigName);
  if (!rig) throw new Error('Rig DEEP-HORIZON 04 tidak ditemukan - seed gagal?');
  return rig.id;
}

beforeAll(async () => {
  await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

describe('listRateCards', () => {
  it('rig seed punya 11 rate card', async () => {
    const { listRateCards } = await billingRepo();
    const rigId = await seedRigId();

    const cards = await listRateCards(rigId);
    expect(cards).toHaveLength(11);
  });

  it('kode rate card sesuai seed (01, 08, 09, 10, 14, 27) dan terurut', async () => {
    const { listRateCards } = await billingRepo();
    const rigId = await seedRigId();

    const codes = (await listRateCards(rigId)).map((c) => c.activityCode);
    expect(codes).toEqual(['01', '08', '09', '10', '11', '12', '13', '14', '16', '24', '27']);
  });

  it('tier kode 01 sesuai kontrak (1187.5 / 1050 / 950)', async () => {
    const { listRateCards } = await billingRepo();
    const rigId = await seedRigId();

    const card = (await listRateCards(rigId)).find((c) => c.activityCode === '01');
    expect(card?.tiers.map((t) => t.ratePerHour)).toEqual([1187.5, 1050, 950]);
    expect(card?.tiers[2].toHour).toBeNull();
  });

  it('tier kode 08: 1187.5 untuk 2 jam pertama lalu 750', async () => {
    const { listRateCards } = await billingRepo();
    const rigId = await seedRigId();

    const card = (await listRateCards(rigId)).find((c) => c.activityCode === '08');
    expect(card?.tiers).toHaveLength(2);
    expect(card?.tiers[1].ratePerHour).toBe(750);
  });

  it('kode 14 non-chargeable (rate 0)', async () => {
    const { listRateCards } = await billingRepo();
    const rigId = await seedRigId();

    const card = (await listRateCards(rigId)).find((c) => c.activityCode === '14');
    expect(card?.tiers[0].ratePerHour).toBe(0);
  });

  /**
   * Diperbarui: seed v2 menanam 11 rate card (bukan 6) untuk RIG-12.
   * Diverifikasi langsung dari `rate_cards` setelah `seed()`: 11 baris, semua
   * `rig_id = RIG-12`, tidak ada kartu global (`rig_id IS NULL`), tidak ada yang
   * soft-deleted - jadi `listRateCards()` tanpa argumen wajib mengembalikan 11.
   */
  it('tanpa rigId mengembalikan seluruh rate card aktif di DB (11)', async () => {
    const { listRateCards } = await billingRepo();
    const cards = await listRateCards();
    expect(cards).toHaveLength(11);
    expect(cards.length).toBe(SEED_RATE_CARDS.length);
    expect(cards.map((c) => c.activityCode).sort()).toEqual([...SEED_RATE_CARD_CODES]);
  });
});

describe('getMonthlyBilling - 2026-09', () => {
  it('rows > 0, billableHours > 0, amount > 0', async () => {
    const { getMonthlyBilling } = await billingRepo();
    const rigId = await seedRigId();

    const result = await getMonthlyBilling(rigId, SEED.billingMonth);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.totals.billableHours).toBeGreaterThan(0);
    expect(result.totals.amount).toBeGreaterThan(0);
  });

  /**
   * Diperbarui: RIG-12 kini dipakai DUA sumur seed - ARUN-07 (DDR #145,
   * 2026-09-10) dan ARUN-06 (DDR #201, 2026-09-05). ARUN-05 ada di RIG-08.
   * Jadi jam September untuk RIG-12 = 24.0h (#145) + 24.0h (#201) = 48.0h.
   * (Verifikasi: SUM(time_breakdown.duration_min) / 60 untuk kedua DDR.)
   */
  it('total jam = 48.0h (DDR #145 ARUN-07 + DDR #201 ARUN-06, keduanya RIG-12)', async () => {
    const { getMonthlyBilling } = await billingRepo();
    const rigId = await seedRigId();

    const result = await getMonthlyBilling(rigId, SEED.billingMonth);
    expect(result.totals.billableHours).toBe(48);
  });

  /**
   * Diperbarui: baris billing = group per (reportDate, iadcCode) untuk SEMUA DDR
   * rig itu di bulan tsb.
   *
   *   DDR #201 (ARUN-06, 2026-09-05) → 08, 11, 12, 13, 14, 16      = 6 baris
   *   DDR #145 (ARUN-07, 2026-09-10) → 01, 08, 09, 10, 14, 27      = 6 baris
   *                                                          total = 12 baris
   */
  it('12 baris = 6 kode DDR #201 (ARUN-06) + 6 kode DDR #145 (ARUN-07)', async () => {
    const { getMonthlyBilling } = await billingRepo();
    const rigId = await seedRigId();

    const result = await getMonthlyBilling(rigId, SEED.billingMonth);
    expect(result.rows).toHaveLength(12);

    const arun06 = result.rows.filter((r) => r.date === '2026-09-05');
    const arun07 = result.rows.filter((r) => r.date === SEED.reportDate);

    expect(arun06.map((r) => r.iadcCode)).toEqual(['08', '11', '12', '13', '14', '16']);
    expect(arun06.every((r) => r.reportNo === 201)).toBe(true);
    expect(arun07.map((r) => r.iadcCode)).toEqual(['01', '08', '09', '10', '14', '27']);
    expect(arun07.every((r) => r.reportNo === SEED.reportNo)).toBe(true);
    expect(result.rows).toHaveLength(arun06.length + arun07.length);
  });

  it('jumlah amount baris = totals.amount', async () => {
    const { getMonthlyBilling } = await billingRepo();
    const rigId = await seedRigId();

    const result = await getMonthlyBilling(rigId, SEED.billingMonth);
    const sum = result.rows.reduce((acc, r) => acc + r.amount, 0);
    expect(Math.round(sum * 100) / 100).toBe(result.totals.amount);
  });

  /**
   * Diperbarui: kode 14 muncul di KEDUA DDR RIG-12, dan barisnya digabung per
   * (tanggal, kode):
   *   #201 (2026-09-05) 02:00-06:00 = 4.0h
   *   #145 (2026-09-10) 04:30-06:00 = 1.5h
   * Rate card `14` = 0 (non-chargeable) → amount 0 di kedua baris.
   */
  it('baris kode 14 (Rig Service) jam 4.0h (#201) & 1.5h (#145), amount 0 (non-chargeable)', async () => {
    const { getMonthlyBilling } = await billingRepo();
    const rigId = await seedRigId();

    const result = await getMonthlyBilling(rigId, SEED.billingMonth);
    const rigService = result.rows.filter((r) => r.iadcCode === '14');
    expect(rigService).toHaveLength(2);

    const byDate = Object.fromEntries(rigService.map((r) => [r.date, r]));
    expect(byDate['2026-09-05'].hours).toBe(4);
    expect(byDate[SEED.reportDate].hours).toBe(1.5);
    expect(rigService.every((r) => r.amount === 0)).toBe(true);
  });

  it('baris kode 27 (WOW) memakai rate 687.5', async () => {
    const { getMonthlyBilling } = await billingRepo();
    const rigId = await seedRigId();

    const result = await getMonthlyBilling(rigId, SEED.billingMonth);
    const wow = result.rows.find((r) => r.iadcCode === '27');
    expect(wow?.date).toBe(SEED.reportDate); // kode 27 hanya ada di DDR #145
    expect(wow?.hours).toBe(1.5);
    expect(wow?.amount).toBe(1031.25); // 1.5 * 687.5
  });

  it('baris menyertakan nama IADC yang bisa dibaca', async () => {
    const { getMonthlyBilling } = await billingRepo();
    const rigId = await seedRigId();

    const result = await getMonthlyBilling(rigId, SEED.billingMonth);
    expect(result.rows.find((r) => r.iadcCode === '01')?.iadcName).toBe('Rotary Drilling');
  });

  it('tidak ada jam force majeure / disputed / rebillable pada seed', async () => {
    const { getMonthlyBilling } = await billingRepo();
    const rigId = await seedRigId();

    const result = await getMonthlyBilling(rigId, SEED.billingMonth);
    expect(result.totals.forceMajeureHours).toBe(0);
    expect(result.totals.disputedHours).toBe(0);
    expect(result.totals.rebillableAmount).toBe(0);
  });

  it('bulan tanpa data → rows kosong, totals nol', async () => {
    const { getMonthlyBilling } = await billingRepo();
    const rigId = await seedRigId();

    const result = await getMonthlyBilling(rigId, '2026-01');
    expect(result.rows).toEqual([]);
    expect(result.totals.billableHours).toBe(0);
    expect(result.totals.amount).toBe(0);
  });

  it('rig tidak dikenal → rows kosong', async () => {
    const { getMonthlyBilling } = await billingRepo();
    const result = await getMonthlyBilling('00000000-0000-4000-8000-000000000000', SEED.billingMonth);
    expect(result.rows).toEqual([]);
  });

  it('format bulan tidak valid → throw', async () => {
    const { getMonthlyBilling } = await billingRepo();
    const rigId = await seedRigId();

    await expect(getMonthlyBilling(rigId, '2026-9')).rejects.toThrow(/YYYY-MM/);
    await expect(getMonthlyBilling(rigId, '2026-13')).rejects.toThrow();
  });
});

describe('getMonthlyBilling - flag billing', () => {
  /** Tambah laporan uji + flag, lalu pastikan pengaruhnya terlihat di ringkasan. */
  async function addFlaggedDay(opts: {
    reportDate: string;
    disputed?: boolean;
  }): Promise<void> {
    const { db, schema } = await dbClient();
    const rigId = await seedRigId();
    const [well] = await db.select().from(schema.wells).limit(1);

    const [report] = await db
      .insert(schema.dailyReports)
      .values({
        wellId: well.id,
        rigId,
        reportDate: opts.reportDate,
        reportNo: 900,
        depthMdStart: '0.00',
        depthMdEnd: '0.00',
        status: 'submitted',
      })
      .returning({ id: schema.dailyReports.id });

    await db.insert(schema.timeBreakdown).values({
      reportId: report.id,
      sortOrder: 1,
      startHm: '06:00',
      endHm: '12:00',
      durationMin: 360,
      iadcCode: '27',
      nptFlag: false,
      timeClass: 'WOW',
    });

    await db.insert(schema.billingFlags).values({
      reportId: report.id,
      forceMajeure: false,
      disputed: opts.disputed ?? false,
      rebillable: false,
      note: 'QA test flag',
    });
  }

  it('disputed → jam tidak masuk billableHours dan amount ditahan', async () => {
    const { getMonthlyBilling } = await billingRepo();
    const rigId = await seedRigId();

    await addFlaggedDay({ reportDate: '2026-09-28', disputed: true });

    const result = await getMonthlyBilling(rigId, SEED.billingMonth);
    expect(result.totals.disputedHours).toBe(6);
    // Diperbarui: baseline billable September RIG-12 = 48h (DDR #201 + #145),
    // bukan 24h. Disputed 6h ditahan → 48h tetap billable.
    expect(result.totals.billableHours).toBe(48); // flag hanya untuk hari uji
    expect(result.rows.some((r) => r.date === '2026-09-28' && r.disputed)).toBe(true);
  });

  it('baris disputed tetap menampilkan amount (untuk side-by-side), tapi tidak masuk total', async () => {
    const { getMonthlyBilling } = await billingRepo();
    const rigId = await seedRigId();

    const result = await getMonthlyBilling(rigId, SEED.billingMonth);
    const disputedRow = result.rows.find((r) => r.date === '2026-09-28');
    expect(disputedRow?.amount).toBe(4125); // 6 * 687.5

    const sumAll = result.rows.reduce((acc, r) => acc + r.amount, 0);
    expect(Math.round(sumAll * 100) / 100).toBeGreaterThan(result.totals.amount);
  });

  it('semua angka tetap 2 desimal', async () => {
    const { getMonthlyBilling } = await billingRepo();
    const rigId = await seedRigId();

    const result = await getMonthlyBilling(rigId, SEED.billingMonth);
    for (const row of result.rows) {
      expect(Number.isInteger(Math.round(row.amount * 100))).toBe(true);
      expect(Math.abs(row.amount * 100 - Math.round(row.amount * 100))).toBeLessThan(1e-6);
    }
    expect(Math.abs(result.totals.amount * 100 - Math.round(result.totals.amount * 100))).toBeLessThan(1e-6);
  });

  it('rate card tanpa kode → jam tetap dihitung, amount 0 (baris 23 tidak punya kartu)', async () => {
    const { db, schema } = await dbClient();
    const rigId = await seedRigId();
    const [well] = await db.select().from(schema.wells).limit(1);

    const [report] = await db
      .insert(schema.dailyReports)
      .values({
        wellId: well.id,
        rigId,
        reportDate: '2026-09-29',
        reportNo: 901,
        depthMdStart: '0.00',
        depthMdEnd: '0.00',
        status: 'submitted',
      })
      .returning({ id: schema.dailyReports.id });

    await db.insert(schema.timeBreakdown).values({
      reportId: report.id,
      sortOrder: 1,
      startHm: '06:00',
      endHm: '08:00',
      durationMin: 120,
      iadcCode: '23',
      nptFlag: false,
      timeClass: 'PRD',
    });

    const { getMonthlyBilling } = await billingRepo();
    const result = await getMonthlyBilling(rigId, SEED.billingMonth);
    const row = result.rows.find((r) => r.iadcCode === '23' && r.date === '2026-09-29');

    expect(row?.hours).toBe(2);
    expect(row?.amount).toBe(0);
    // Diperbarui: baseline billable September RIG-12 = 48h (DDR #201 + #145);
    // + 2 jam kode 23 tanpa rate card = 50h (jam tetap dihitung, amount 0).
    expect(result.totals.billableHours).toBe(50); // 48 seed + 2 jam tanpa rate card
  });
});
