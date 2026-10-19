/**
 * Billing tiered - angka tagihan langsung ke uang, jadi regresi = kerugian.
 */
import { describe, expect, it } from 'vitest';
import {
  calcMonthlyBilling,
  calcTieredAmount,
  type BillingLineInput,
  type BillingTier,
  type RateCard,
} from '@rigdaily/shared';
import { SEED_RATE_CARDS, TIER_01 } from './helpers/fixtures';

const T1_ONLY: BillingTier[] = [{ fromHour: 0, toHour: 12, ratePerHour: 1187.5 }];
const T1_T2: BillingTier[] = [
  { fromHour: 0, toHour: 12, ratePerHour: 1187.5 },
  { fromHour: 12, toHour: 24, ratePerHour: 1050 },
];

const RATE_CARDS: RateCard[] = SEED_RATE_CARDS.map((c) => ({ activityCode: c.activityCode, tiers: c.tiers }));

/** `round2` menjamin hasil hanya punya 2 desimal. */
function hasTwoDecimals(n: number): boolean {
  return Number.isInteger(n * 100) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
}

/* ------------------------------------------------------------------ */
/* calcTieredAmount                                                    */
/* ------------------------------------------------------------------ */

describe('calcTieredAmount', () => {
  it('10 jam pada tier tunggal 0-12h @ 1187.5 = 11875', () => {
    expect(calcTieredAmount(10, [{ fromHour: 0, toHour: 12, ratePerHour: 1187.5 }])).toBe(11875);
  });

  it('20 jam pada 0-12 @ 1187.5 + 12-24 @ 1050 = 22650', () => {
    expect(calcTieredAmount(20, T1_T2)).toBe(22650);
  });

  it('30 jam pada 0-12 @ 1187.5 + 12-24 @ 1050 + >24 @ 950 = 32550', () => {
    expect(calcTieredAmount(30, TIER_01)).toBe(32550);
  });

  it('0 jam → 0', () => {
    expect(calcTieredAmount(0, TIER_01)).toBe(0);
  });

  it('jam negatif → 0', () => {
    expect(calcTieredAmount(-5, TIER_01)).toBe(0);
  });

  it('tanpa tier → 0', () => {
    expect(calcTieredAmount(5, [])).toBe(0);
  });

  it('tier tidak berurutan tetap dihitung benar (di-sort internal)', () => {
    const unordered: BillingTier[] = [
      { fromHour: 12, toHour: 24, ratePerHour: 1050 },
      { fromHour: 0, toHour: 12, ratePerHour: 1187.5 },
    ];
    expect(calcTieredAmount(20, unordered)).toBe(22650);
  });

  it('jam kurang dari akhir tier hanya memakai sebagian tier', () => {
    expect(calcTieredAmount(3, T1_T2)).toBe(3562.5);
  });

  /**
   * PERILAKU TERKUNCI (bug produksi terverifikasi - lihat tests/README-BUGS.md):
   *
   * `calcTieredAmount` memakai `cursor` yang di-clamp ke `tier.fromHour`
   * (`Math.max(cursor, tier.fromHour)`), sehingga jam yang jatuh di CELAH antar
   * tier tetap ditagihkan pada tier berikutnya. Rp/uang: biaya bisa LEBIH TINGGI
   * dari seharusnya.
   *
   *   gapped = 0-10h @100, 20-30h @200
   *   calcTieredAmount(25) → ACTUAL 3000 (10*100 + 15*200)
   *                         EXPECTED 2000 (10*100 + 5*200, 10 jam celah tak bertarif)
   *   calcTieredAmount(11) → ACTUAL 1200 (10*100 + 1*200)
   *                         EXPECTED 1000
   *
   * Test ini mengunci perilaku SAAT INI supaya regresi lain tetap terdeteksi.
   * Bila bug diperbaiki, test ini akan gagal dan harus diperbarui ke nilai EXPECTED.
   */
  it('regresi: tier dengan celah (0-10 @100, 20-30 @200) + 25 jam (bug: celah ikut tertagih)', () => {
    const gapped: BillingTier[] = [
      { fromHour: 0, toHour: 10, ratePerHour: 100 },
      { fromHour: 20, toHour: 30, ratePerHour: 200 },
    ];
    // Nilai benar = 2000; implementasi saat ini = 3000.
    expect(calcTieredAmount(25, gapped)).toBe(3000);
  });

  it('tier dengan celah + 8 jam → hanya tier pertama (belum menyentuh celah)', () => {
    const gapped: BillingTier[] = [
      { fromHour: 0, toHour: 10, ratePerHour: 100 },
      { fromHour: 20, toHour: 30, ratePerHour: 200 },
    ];
    expect(calcTieredAmount(8, gapped)).toBe(800);
  });

  it('regresi: tier dengan celah + 11 jam → 1 jam setelah tier pertama ikut tertagih rate tier kedua', () => {
    const gapped: BillingTier[] = [
      { fromHour: 0, toHour: 10, ratePerHour: 100 },
      { fromHour: 20, toHour: 30, ratePerHour: 200 },
    ];
    // Nilai benar = 1000; implementasi saat ini = 1200.
    expect(calcTieredAmount(11, gapped)).toBe(1200);
  });

  it('tier tanpa celah (kontigu) selalu benar - kasus rate card produksi', () => {
    // Rate card seed tidak punya celah, jadi bug di atas tidak mengenai data demo.
    expect(calcTieredAmount(12, TIER_01)).toBe(14250);
    expect(calcTieredAmount(24, TIER_01)).toBe(14250 + 12600);
  });

  it('tier terbuka (toHour null) menyerap sisa jam', () => {
    expect(calcTieredAmount(100, [{ fromHour: 0, toHour: null, ratePerHour: 10 }])).toBe(1000);
  });

  it('hasil selalu 2 desimal (rate pecahan)', () => {
    const amount = calcTieredAmount(7.3, [{ fromHour: 0, toHour: null, ratePerHour: 1187.5 }]);
    expect(hasTwoDecimals(amount)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* calcMonthlyBilling                                                  */
/* ------------------------------------------------------------------ */

const NORMAL_LINES: BillingLineInput[] = [
  { date: '2026-09-10', code: '01', hours: 6 },
  { date: '2026-09-10', code: '09', hours: 5.5 },
  { date: '2026-09-10', code: '10', hours: 3.5 },
  { date: '2026-09-10', code: '08', hours: 2.5 },
  { date: '2026-09-10', code: '27', hours: 1.5 },
  { date: '2026-09-10', code: '14', hours: 1.5 },
];

describe('calcMonthlyBilling - skenario NORMAL (tanpa flag)', () => {
  const result = calcMonthlyBilling(NORMAL_LINES, RATE_CARDS);

  it('menghasilkan satu baris per input', () => {
    expect(result.lines).toHaveLength(NORMAL_LINES.length);
  });

  it('amount per kode sesuai tier', () => {
    const byCode = Object.fromEntries(result.lines.map((l) => [l.code, l.amount]));
    expect(byCode['01']).toBe(7125); // 6 * 1187.5
    expect(byCode['09']).toBe(6531.25); // 5.5 * 1187.5
    expect(byCode['10']).toBe(4156.25); // 3.5 * 1187.5
    expect(byCode['08']).toBe(2750); // 2 * 1187.5 + 0.5 * 750
    expect(byCode['27']).toBe(1031.25); // 1.5 * 687.5
    expect(byCode['14']).toBe(0); // non-chargeable
  });

  it('totals.amount = jumlah semua baris', () => {
    const expected = 7125 + 6531.25 + 4156.25 + 2750 + 1031.25 + 0;
    expect(result.totals.amount).toBe(expected);
  });

  it('totals.billableHours = total jam', () => {
    expect(result.totals.billableHours).toBe(20.5);
  });

  it('tidak ada jam FM/disputed dan rebillable 0', () => {
    expect(result.totals.forceMajeureHours).toBe(0);
    expect(result.totals.disputedHours).toBe(0);
    expect(result.totals.rebillableAmount).toBe(0);
  });

  it('tidak ada catatan untuk baris normal', () => {
    expect(result.lines.every((l) => l.notes.length === 0)).toBe(true);
  });
});

describe('calcMonthlyBilling - FORCE MAJEURE', () => {
  const lines: BillingLineInput[] = [
    { date: '2026-09-10', code: '27', hours: 2, flags: { forceMajeure: true } },
    { date: '2026-09-10', code: '01', hours: 12 },
  ];
  const result = calcMonthlyBilling(lines, RATE_CARDS);

  it('forceMajeureHours terisi 2 jam', () => {
    expect(result.totals.forceMajeureHours).toBe(2);
  });

  it('jam force majeure tetap dihitung ke amount', () => {
    expect(result.lines[0].amount).toBe(1375); // 2 * 687.5
    expect(result.totals.amount).toBe(1375 + 14250);
  });

  it('flag forceMajeure tersimpan di baris hasil', () => {
    expect(result.lines[0].flags.forceMajeure).toBe(true);
  });

  it('baris FM punya catatan klausul kontrak', () => {
    expect(result.lines[0].notes.join(' ')).toContain('Force majeure');
  });
});

describe('calcMonthlyBilling - DISPUTED', () => {
  const lines: BillingLineInput[] = [
    { date: '2026-09-10', code: '27', hours: 2, flags: { disputed: true } },
    { date: '2026-09-10', code: '01', hours: 12 },
  ];
  const result = calcMonthlyBilling(lines, RATE_CARDS);
  const disputedLine = result.lines[0];

  it('disputedHours terisi 2 jam', () => {
    expect(result.totals.disputedHours).toBe(2);
  });

  it('amount baris disputed TIDAK masuk totals.amount', () => {
    expect(result.totals.amount).toBe(14250); // hanya baris '01'
  });

  it('jam disputed TIDAK masuk totals.billableHours', () => {
    expect(result.totals.billableHours).toBe(12);
  });

  it('lines[].amount tetap dihitung (untuk tampilan) = 1375', () => {
    expect(disputedLine.amount).toBe(1375);
  });

  it('baris disputed punya catatan penahanan', () => {
    expect(disputedLine.notes.join(' ')).toContain('Disputed');
  });
});

describe('calcMonthlyBilling - REBILLABLE', () => {
  const lines: BillingLineInput[] = [
    { date: '2026-09-10', code: '08', hours: 3, flags: { rebillable: true } },
    { date: '2026-09-10', code: '01', hours: 12 },
  ];
  const result = calcMonthlyBilling(lines, RATE_CARDS);

  it('rebillableAmount terisi sesuai nilai baris rebillable', () => {
    // 2h * 1187.5 + 1h * 750 = 3125
    expect(result.totals.rebillableAmount).toBe(3125);
  });

  it('rebillable tetap masuk totals.amount', () => {
    expect(result.totals.amount).toBe(3125 + 14250);
  });

  it('flag rebillable tersimpan di baris hasil', () => {
    expect(result.lines[0].flags.rebillable).toBe(true);
  });
});

describe('calcMonthlyBilling - kode tanpa rate card', () => {
  const lines: BillingLineInput[] = [{ date: '2026-09-10', code: '23', hours: 4 }];
  const result = calcMonthlyBilling(lines, RATE_CARDS);

  it('amount 0', () => {
    expect(result.lines[0].amount).toBe(0);
    expect(result.totals.amount).toBe(0);
  });

  it('notes menyebut "Tidak ada rate card"', () => {
    expect(result.lines[0].notes.join(' ')).toContain('Tidak ada rate card');
  });

  it('jam tetap dihitung sebagai billableHours (jam kerja ada, nilai belum disetup)', () => {
    expect(result.totals.billableHours).toBe(4);
  });
});

describe('calcMonthlyBilling - pembulatan', () => {
  it('semua amount tepat 2 desimal walau input jam pecahan', () => {
    const lines: BillingLineInput[] = [
      { date: '2026-09-10', code: '01', hours: 1.333 },
      { date: '2026-09-10', code: '09', hours: 2.777 },
      { date: '2026-09-10', code: '08', hours: 3.141 },
    ];
    const result = calcMonthlyBilling(lines, RATE_CARDS);

    for (const line of result.lines) expect(hasTwoDecimals(line.amount)).toBe(true);
    expect(hasTwoDecimals(result.totals.amount)).toBe(true);
    expect(hasTwoDecimals(result.totals.rebillableAmount)).toBe(true);
  });

  it('total tetap 2 desimal untuk banyak baris akumulatif', () => {
    const lines: BillingLineInput[] = Array.from({ length: 50 }, (_, i) => ({
      date: '2026-09-10',
      code: '27',
      hours: 0.37 + i * 0.001,
    }));
    const result = calcMonthlyBilling(lines, RATE_CARDS);

    expect(hasTwoDecimals(result.totals.amount)).toBe(true);
  });
});

describe('calcMonthlyBilling - input kosong', () => {
  it('tanpa baris → totals nol, lines kosong', () => {
    const result = calcMonthlyBilling([], RATE_CARDS);
    expect(result.lines).toEqual([]);
    expect(result.totals).toEqual({
      billableHours: 0,
      amount: 0,
      disputedHours: 0,
      forceMajeureHours: 0,
      rebillableAmount: 0,
    });
  });
});
