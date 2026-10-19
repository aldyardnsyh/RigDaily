/**
 * Ringkasan biaya harian & AFE - memakai `CostAggregateInput` (tipe baru di
 * `packages/shared/src/calc.ts`).
 */
import { describe, expect, it } from 'vitest';
import { summarizeCost, type CostAggregateInput } from '@rigdaily/shared';
import { EXPECTED, SEED, SEED_COST_LINES } from './helpers/fixtures';

const INPUT: CostAggregateInput[] = SEED_COST_LINES.map((l) => ({
  category: l.category,
  amount: l.amount,
  afeCode: l.afeCode,
  rebillable: l.rebillable,
}));

describe('summarizeCost - 8 cost line seed', () => {
  const summary = summarizeCost(INPUT, SEED.afeBudget);

  it('dailyTotal = 50250', () => {
    expect(summary.dailyTotal).toBe(50250);
  });

  it('byCategory berisi 8 kategori dengan nilai benar', () => {
    expect(summary.byCategory).toEqual(EXPECTED.costByCategory);
  });

  it('byCategory: Rig Spread 28500', () => {
    expect(summary.byCategory['Rig Spread']).toBe(28500);
  });

  it('byCategory: Fuel & Power 6882.5', () => {
    expect(summary.byCategory['Fuel & Power']).toBe(6882.5);
  });

  it('byCategory: Standby Adjust. negatif -687.5 (kredit WOW)', () => {
    expect(summary.byCategory['Standby Adjust.']).toBe(-687.5);
  });

  it('jumlah seluruh byCategory = dailyTotal (tidak ada biaya hilang)', () => {
    const sum = Object.values(summary.byCategory).reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 100) / 100).toBe(summary.dailyTotal);
  });

  it('afeConsumedPercent = 3.14 (50250 / 1600000 * 100)', () => {
    expect(summary.afeConsumedPercent).toBe(3.14);
  });

  it('afeRemaining = 1549750', () => {
    expect(summary.afeRemaining).toBe(1549750);
  });

  it('rebillableTotal = 4850 + 1420 = 6270', () => {
    expect(summary.rebillableTotal).toBe(6270);
  });
});

describe('summarizeCost - tanpa budget AFE', () => {
  it('afeBudget null → afeConsumedPercent null & afeRemaining null', () => {
    const summary = summarizeCost(INPUT, null);

    expect(summary.afeConsumedPercent).toBeNull();
    expect(summary.afeRemaining).toBeNull();
    expect(summary.dailyTotal).toBe(50250);
  });

  it('afeBudget tidak diisi → juga null', () => {
    const summary = summarizeCost(INPUT);
    expect(summary.afeConsumedPercent).toBeNull();
    expect(summary.afeRemaining).toBeNull();
  });

  it('afeBudget 0 dianggap tidak ada budget (hindari bagi nol)', () => {
    const summary = summarizeCost(INPUT, 0);
    expect(summary.afeConsumedPercent).toBeNull();
    expect(summary.afeRemaining).toBeNull();
  });
});

describe('summarizeCost - agregasi kategori', () => {
  it('kategori sama dijumlahkan', () => {
    const lines: CostAggregateInput[] = [
      { category: 'Rig Spread', amount: 1000 },
      { category: 'Rig Spread', amount: 250.5 },
    ];
    const summary = summarizeCost(lines);

    expect(summary.byCategory['Rig Spread']).toBe(1250.5);
    expect(summary.dailyTotal).toBe(1250.5);
  });

  it('tanpa cost line → total 0, byCategory kosong', () => {
    const summary = summarizeCost([]);

    expect(summary.dailyTotal).toBe(0);
    expect(summary.byCategory).toEqual({});
    expect(summary.rebillableTotal).toBe(0);
  });

  it('rebillable hanya menghitung baris yang ditandai', () => {
    const lines: CostAggregateInput[] = [
      { category: 'A', amount: 100, rebillable: true },
      { category: 'B', amount: 900, rebillable: false },
      { category: 'C', amount: 50, rebillable: true },
    ];
    expect(summarizeCost(lines).rebillableTotal).toBe(150);
  });

  it('afeConsumedPercent dibulatkan 2 desimal', () => {
    const summary = summarizeCost([{ category: 'A', amount: 12345.67 }], 500_000);
    expect(summary.afeConsumedPercent).toBe(2.47);
  });
});
