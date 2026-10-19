/**
 * Fixtures test - sumber angka HARUS sama dengan seed produksi demo.
 *
 * `SEED_TIME_ROWS` adalah salinan 1:1 dari `TIME_ROWS` di
 * `packages/database/src/seed.ts` (DDR #145, 2026-09-10). Kalaupun kita salin,
 * `tests/repo-*.test.ts` tetap memverifikasi hasil dari DB yang di-seed nyata,
 * jadi bila seed berubah, test integrasi akan menangkap drift-nya.
 */
import type { BillingTier, TimeRowInput } from '@rigdaily/shared';

/* ------------------------------------------------------------------ */
/* Konstanta dataset demo                                              */
/* ------------------------------------------------------------------ */

export const SEED = {
  wellName: 'ARUN-07',
  rigName: 'DEEP-HORIZON 04',
  rigCode: 'RIG-12',
  reportNo: 145,
  reportDate: '2026-09-10',
  depthStart: 2833,
  depthEnd: 2845,
  progress: 12,
  afeBudget: 1_600_000,
  dailyCost: 50_250,
  /**
   * Seed v2 (3 sumur): ARUN-07 hanya punya satu DDR (#145, 2026-09-10)
   * dengan total cost $50.250, sehingga cost kumulatif sumur ini = $50.250.
   * (Nilai lama 1.248.600 berasal dari prototype UI 1-sumur, bukan data nyata.)
   */
  cumulativeCost: 50_250,
  /** 2026-09 = bulan DDR #145 (dipakai test billing). */
  billingMonth: '2026-09',
} as const;

/* ------------------------------------------------------------------ */
/* Time breakdown seed (9 baris, total 1440 menit)                     */
/* ------------------------------------------------------------------ */

export type SeedRow = {
  start: string;
  end: string;
  code: string;
  sub: string;
  npt: boolean;
  remarks: string;
};

export const SEED_TIME_ROWS: SeedRow[] = [
  { start: '06:00', end: '08:30', code: '01', sub: 'BHA #6 8.5in PDC M19', npt: false, remarks: 'Drilling 2833-2835m. WOB 18k, RPM 120, SPP 3120psi.' },
  { start: '08:30', end: '11:30', code: '01', sub: 'BHA #6 MWD Survey', npt: false, remarks: 'Drilling ke 2838m dengan MWD gamma dan resistivity.' },
  { start: '11:30', end: '13:00', code: '08', sub: 'Top Drive Standpipe [NOV]', npt: true, remarks: 'Shutdown ganti hose manifold #2. O-ring replaced.' },
  { start: '13:00', end: '16:30', code: '10', sub: 'Mud Pumps #1 & #2 (12.4 ppg)', npt: false, remarks: 'Bottoms up di 2838m untuk sample. Condition mud.' },
  { start: '16:30', end: '19:30', code: '09', sub: '5in S-135 Drillpipe', npt: false, remarks: 'Slug 14.5 ppg pill. POOH 2838m ke 2410m shoe.' },
  { start: '19:30', end: '20:30', code: '08', sub: 'Mud Pump #2 [Gardner Denver]', npt: true, remarks: 'Vibrasi discharge valve. Ganti valve seat insert.' },
  { start: '20:30', end: '22:00', code: '27', sub: 'Crane & Derrick Ops', npt: false, remarks: 'Lightning squall. Derrick suspended per SOP.' },
  { start: '22:00', end: '04:30', code: '09', sub: 'BHA #6 Disassembly', npt: false, remarks: 'POOH ke surface. Inspect PDC cutting structure.' },
  { start: '04:30', end: '06:00', code: '14', sub: 'Shift handover (IADC 14)', npt: false, remarks: 'Handover shift, total genap 24.0h.' },
];

/** Bentuk `TimeRowInput` dari seed - siap dipakai `validateTimeBreakdown`/`summarizeTime`. */
export function seedTimeInputs(rows: SeedRow[] = SEED_TIME_ROWS): TimeRowInput[] {
  return rows.map((r) => ({ start: r.start, end: r.end, code: r.code, npt: r.npt, remarks: r.remarks }));
}

/** Bentuk input `replaceTimeRows()` dari seed. */
export function seedTimeRowPayload(rows: SeedRow[] = SEED_TIME_ROWS): Array<{
  start: string;
  end: string;
  iadcCode: string;
  iadcSubcode: string;
  nptFlag: boolean;
  remarks: string;
}> {
  return rows.map((r) => ({
    start: r.start,
    end: r.end,
    iadcCode: r.code,
    iadcSubcode: r.sub,
    nptFlag: r.npt,
    remarks: r.remarks,
  }));
}

/* ------------------------------------------------------------------ */
/* Cost lines seed (8 baris, total $50,250)                            */
/* ------------------------------------------------------------------ */

export type SeedCostLine = {
  category: string;
  description: string;
  vendor: string;
  afeCode: string;
  billingType: string;
  amount: number;
  rebillable: boolean;
};

export const SEED_COST_LINES: SeedCostLine[] = [
  { category: 'Rig Spread', description: 'Rig 12 Operating Dayrate (24.0h operating spread)', vendor: 'Nabors Drilling', afeCode: 'AFE-101.02', billingType: 'Operator Direct', amount: 28500, rebillable: false },
  { category: 'Mud & Chems', description: '12.4 ppg WBM Barite Addition (180 sx) + Biocide', vendor: 'M-I SWACO', afeCode: 'AFE-204.11', billingType: 'Operator Direct', amount: 6800, rebillable: false },
  { category: 'Fuel & Power', description: 'Rig Power Generation #2 Diesel (1,995 gal @ $3.45/gal)', vendor: 'Pertamina Patra Niaga', afeCode: 'AFE-105.08', billingType: 'JV Split (60/40)', amount: 6882.5, rebillable: false },
  { category: 'Directional / RSS', description: 'AutoTrak Rotary Steerable System & MWD Telemetry', vendor: 'Baker Hughes', afeCode: 'AFE-308.15', billingType: 'Rebill Contractor', amount: 4850, rebillable: true },
  { category: 'NPT Repair & Tech', description: 'Top Drive O-Ring Replacement & Specialist Tech', vendor: 'National Oilwell Varco', afeCode: 'AFE-401.09', billingType: 'Vendor Rebill', amount: 1420, rebillable: true },
  { category: 'Standby Adjust.', description: 'Severe Lightning Squall Standby Credit (1.5 hrs @ WOW Rate)', vendor: 'Nabors Drilling Contract Cl. 14.2 Weather Rate', afeCode: 'AFE-101.03', billingType: 'Contract Rate', amount: -687.5, rebillable: false },
  { category: 'Waste & Solids', description: 'Centrifuge Cuttings Drying & Eco-Disposal Shaker Screens', vendor: 'NOV Brandt', afeCode: 'AFE-502.04', billingType: 'Operator Direct', amount: 1225, rebillable: false },
  { category: 'Mud Logging', description: 'Pressurized Mud Logging Cabin & Continuous Degasser Sensor', vendor: 'Geolog International', afeCode: 'AFE-301.05', billingType: 'Operator Direct', amount: 1260, rebillable: false },
];

/* ------------------------------------------------------------------ */
/* Rate cards (billing tiered)                                         */
/* ------------------------------------------------------------------ */

export const TIER_01: BillingTier[] = [
  { fromHour: 0, toHour: 12, ratePerHour: 1187.5, label: 'Standard 0-12h' },
  { fromHour: 12, toHour: 24, ratePerHour: 1050, label: 'Extended 12-24h' },
  { fromHour: 24, toHour: null, ratePerHour: 950, label: 'Deep day >24h' },
];

export const TIER_08: BillingTier[] = [
  { fromHour: 0, toHour: 2, ratePerHour: 1187.5, label: 'First 2h full rate' },
  { fromHour: 2, toHour: null, ratePerHour: 750, label: 'Repair rate after 2h' },
];

/**
 * Salinan 1:1 blok `rate_cards` di `packages/database/src/seed.ts`.
 *
 * Seed v2 menanam **11** kartu untuk RIG-12 (bukan lagi 6) agar kode yang hanya
 * muncul pada sumur ARUN-06 (`11`/`12`/`13`/`16`) dan ARUN-05 (`24`) punya tarif.
 * Urutan di sini sengaja mengikuti urutan di seed; `listRateCards()` mengembalikan
 * urut kode sehingga test integrasi tetap membandingkan lewat himpunan kode.
 */
export const SEED_RATE_CARDS: Array<{ activityCode: string; label: string; tiers: BillingTier[] }> = [
  { activityCode: '01', label: 'Rotary Drilling', tiers: TIER_01 },
  { activityCode: '09', label: 'Tripping', tiers: [{ fromHour: 0, toHour: null, ratePerHour: 1187.5, label: 'Operating rate' }] },
  { activityCode: '08', label: 'Repair Rig', tiers: TIER_08 },
  { activityCode: '27', label: 'Wait on Weather', tiers: [{ fromHour: 0, toHour: null, ratePerHour: 687.5, label: 'WOW rate (Cl. 14.2)' }] },
  { activityCode: '14', label: 'Rig Service', tiers: [{ fromHour: 0, toHour: null, ratePerHour: 0, label: 'Non-chargeable' }] },
  { activityCode: '10', label: 'Circulate & Condition', tiers: [{ fromHour: 0, toHour: null, ratePerHour: 1187.5, label: 'Operating rate' }] },
  { activityCode: '11', label: 'Casing & Liner', tiers: [{ fromHour: 0, toHour: null, ratePerHour: 1187.5 }] },
  { activityCode: '12', label: 'Cementing', tiers: [{ fromHour: 0, toHour: null, ratePerHour: 1187.5 }] },
  { activityCode: '13', label: 'Logging', tiers: [{ fromHour: 0, toHour: null, ratePerHour: 1187.5 }] },
  { activityCode: '16', label: 'Completion', tiers: [{ fromHour: 0, toHour: null, ratePerHour: 1187.5 }] },
  { activityCode: '24', label: 'NPT', tiers: [{ fromHour: 0, toHour: null, ratePerHour: 900 }] },
];

/** Kode rate card RIG-12 di seed, sudah terurut - dipakai test integrasi billing. */
export const SEED_RATE_CARD_CODES = ['01', '08', '09', '10', '11', '12', '13', '14', '16', '24', '27'] as const;

/* ------------------------------------------------------------------ */
/* Ekspektasi turunan seed                                             */
/* ------------------------------------------------------------------ */

export const EXPECTED = {
  // summarizeTime(seed, classifyTime)
  productiveMinutes: 1200,
  nptMinutes: 150,
  wowMinutes: 90,
  standbyMinutes: 0,
  disputedMinutes: 0,
  fmMinutes: 0,
  totalMinutes: 1440,
  gapMinutes: 0,
  // (npt + wow) / 1440 * 100
  nptPercent: 16.67,
  // cost
  costByCategory: {
    'Rig Spread': 28500,
    'Mud & Chems': 6800,
    'Fuel & Power': 6882.5,
    'Directional / RSS': 4850,
    'NPT Repair & Tech': 1420,
    'Standby Adjust.': -687.5,
    'Waste & Solids': 1225,
    'Mud Logging': 1260,
  } as Record<string, number>,
  rebillableTotal: 6270,
  afeConsumedPercent: 3.14,
  afeRemaining: 1_549_750,
} as const;
