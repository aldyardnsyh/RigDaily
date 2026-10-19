/**
 * Seed tambahan: dataset 3 sumur yang BENAR-BENAR BERBEDA.
 *
 * Tujuan: saat user mengganti sumur di topbar, setiap sumur menampilkan
 * gambaran operasi yang berbeda (bukan salinan). Perbedaan dirancang agar
 * setiap fitur punya sesuatu untuk ditampilkan:
 *
 *  ARUN-07 - sumur "bermasalah"
 *    oil, drilling, TD 3200 m, AFE $1.60M, rig jackup DEEP-HORIZON 04
 *    Progres 89%, NPT tinggi (16.7%), 4 DDR (multi-hari), 2 insiden,
 *    completion belum mulai. Ini sumur acuan demo utama.
 *
 *  ARUN-05 - sumur "efisien"
 *    gas, drilling, TD 2950 m, AFE $1.45M, rig land ARUN PRIDE 08
 *    Progres 97%, NPT rendah (~4%), 3 DDR berurutan, tanpa insiden,
 *    ROP tinggi. Menjadi pembanding positif di Insights.
 *
 *  ARUN-06 - sumur "fase lanjut"
 *    oil, completion, TD 3100 m, AFE $1.80M, rig DEEP-HORIZON 04
 *    Kedalaman sudah TD (tidak ada aktivitas bor lagi), 2 DDR completion,
 *    1 insiden low, biaya per hari paling tinggi (cementing/tubulars).
 *
 * Idempotent: hanya menambah laporan yang belum ada.
 *
 * Jalankan: npx tsx packages/database/src/seed-variants.ts
 * (dipanggil juga oleh `npm run db:seed` lewat seed utama)
 */
import { and, eq } from 'drizzle-orm';
import { closeDb, db } from './client';
import * as s from './schema';
import { classifyTime, rowDurationMinutes, round2 } from '@rigdaily/shared';
import { migrate } from './migrate';

type Row = { start: string; end: string; code: string; sub: string; npt: boolean; remarks: string };
type Cost = { category: string; description: string; vendor: string; afeCode: string; billingType: string; amountUsd: number; rebillable: boolean };
type Report = {
  reportDate: string;
  reportNo: number;
  depthStart: number;
  depthEnd: number;
  depthTvd: number;
  status: 'draft' | 'submitted' | 'approved' | 'distributed';
  summary: string;
  planNext: string;
  geology: string;
  rows: Row[];
  costs: Cost[];
  mud: { w: number; v: number; ph: number; pv: number; yp: number; chem: string; cost: number };
  crew: number;
};

/* ---------------- Helper: susun 24 jam dari segmen ---------------- */
function build24(segments: Array<{ code: string; sub: string; hours: number; npt: boolean; remarks: string }>): Row[] {
  const out: Row[] = [];
  let cursor = 6 * 60;
  const fmt = (m: number) => {
    const x = ((m % 1440) + 1440) % 1440;
    return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
  };
  for (const seg of segments) {
    const mins = Math.round(seg.hours * 60);
    if (mins <= 0) continue;
    out.push({ start: fmt(cursor), end: fmt(cursor + mins), code: seg.code, sub: seg.sub, npt: seg.npt, remarks: seg.remarks });
    cursor += mins;
  }
  // tutup ke 24 jam bila kurang
  if (cursor < 6 * 60 + 1440) {
    out.push({
      start: fmt(cursor),
      end: fmt(6 * 60 + 1440),
      code: '14',
      sub: 'Shift handover (IADC 14)',
      npt: false,
      remarks: 'Handover shift, total 24.0 jam.',
    });
  }
  return out;
}

/* ---------------- Definisi data per sumur ---------------- */

/** ARUN-05: sumur efisien (gas, drilling, NPT rendah). 3 DDR berurutan. */
const ARUN05_REPORTS: Report[] = [
  {
    reportDate: '2026-09-06',
    reportNo: 86,
    depthStart: 2500,
    depthEnd: 2556,
    depthTvd: 2444,
    status: 'distributed',
    summary:
      'Drilled 8-1/2in section 2500-2556 m at 3.4 m/hr average. Mud stable 11.6 ppg. No downtime. Cuttings return normal.',
    planNext: 'Continue to 2610 m, then wipe trip to verify hole condition.',
    geology: 'Clean sandstone, good porosity. Gas 20-55 units. No losses.',
    rows: build24([
      { code: '01', sub: 'BHA #3 PDC 8.5in', hours: 16, npt: false, remarks: 'Drilling 2500-2550 m, ROP 3.2-3.6 m/hr.' },
      { code: '10', sub: 'Mud Pumps #1 & #2', hours: 4, npt: false, remarks: 'Circulate bottoms up, sample collection.' },
      { code: '09', sub: 'Drillpipe 5in S-135', hours: 2, npt: false, remarks: 'Wiper trip partial, ream back to bottom.' },
      { code: '14', sub: 'Shift handover', hours: 2, npt: false, remarks: 'Handover shift.' },
    ]),
    costs: [
      { category: 'Rig Spread', description: 'Land Rig 08 Dayrate', vendor: 'Nabors Drilling, #RC-2025-908', afeCode: 'AFE-101.02', billingType: 'Operator Direct', amountUsd: 22400, rebillable: false },
      { category: 'Mud & Chems', description: 'WBM 11.6 ppg maintenance', vendor: 'Halliburton Baroid', afeCode: 'AFE-204.11', billingType: 'Operator Direct', amountUsd: 3600, rebillable: false },
      { category: 'Fuel & Power', description: 'Diesel rig power', vendor: 'Pertamina Patra Niaga', afeCode: 'AFE-105.08', billingType: 'JV Split', amountUsd: 5400, rebillable: false },
      { category: 'Directional / RSS', description: 'MWD telemetry', vendor: 'Halliburton Sperry', afeCode: 'AFE-308.15', billingType: 'Rebill Contractor', amountUsd: 2900, rebillable: true },
      { category: 'Waste & Solids', description: 'Cuttings handling', vendor: 'NOV Brandt', afeCode: 'AFE-502.04', billingType: 'Operator Direct', amountUsd: 880, rebillable: false },
      { category: 'Mud Logging', description: 'Mud logging service', vendor: 'Geolog International', afeCode: 'AFE-301.05', billingType: 'Operator Direct', amountUsd: 1100, rebillable: false },
    ],
    mud: { w: 11.6, v: 46, ph: 9.1, pv: 15, yp: 17, chem: 'Barite 55 sx, PAC-LV 4 sx', cost: 3600 },
    crew: 5,
  },
  {
    reportDate: '2026-09-07',
    reportNo: 87,
    depthStart: 2556,
    depthEnd: 2604,
    depthTvd: 2496,
    status: 'approved',
    summary:
      'Continued drilling 2556-2604 m at 3.2 m/hr. One short connection delay 0.5h. Mud weight held 11.7 ppg.',
    planNext: 'Drill to 2610 m and perform wiper trip.',
    geology: 'Sandstone with thin shale streaks. Gas 30-70 units. Minor seepage controlled with LCM.',
    rows: build24([
      { code: '01', sub: 'BHA #3 PDC 8.5in', hours: 15, npt: false, remarks: 'Drilling 2556-2600 m.' },
      { code: '24', sub: 'Lost circulation [LCM]', hours: 1, npt: true, remarks: 'Seepage at 2580 m, LCM pill 15 bbl.' },
      { code: '10', sub: 'Mud Pumps #1', hours: 5, npt: false, remarks: 'Condition mud and circulate.' },
      { code: '14', sub: 'Shift handover', hours: 3, npt: false, remarks: 'Handover shift.' },
    ]),
    costs: [
      { category: 'Rig Spread', description: 'Land Rig 08 Dayrate', vendor: 'Nabors Drilling, #RC-2025-908', afeCode: 'AFE-101.02', billingType: 'Operator Direct', amountUsd: 22400, rebillable: false },
      { category: 'Mud & Chems', description: 'WBM + LCM treatment', vendor: 'Halliburton Baroid', afeCode: 'AFE-204.11', billingType: 'Operator Direct', amountUsd: 4300, rebillable: false },
      { category: 'Fuel & Power', description: 'Diesel rig power', vendor: 'Pertamina Patra Niaga', afeCode: 'AFE-105.08', billingType: 'JV Split', amountUsd: 5500, rebillable: false },
      { category: 'NPT Repair & Tech', description: 'LCM spotting service', vendor: 'Halliburton, #HAL-LCM-22', afeCode: 'AFE-401.09', billingType: 'Vendor Rebill', amountUsd: 1450, rebillable: true },
      { category: 'Waste & Solids', description: 'Cuttings handling', vendor: 'NOV Brandt', afeCode: 'AFE-502.04', billingType: 'Operator Direct', amountUsd: 900, rebillable: false },
      { category: 'Mud Logging', description: 'Mud logging service', vendor: 'Geolog International', afeCode: 'AFE-301.05', billingType: 'Operator Direct', amountUsd: 1100, rebillable: false },
    ],
    mud: { w: 11.7, v: 47, ph: 9.1, pv: 15, yp: 18, chem: 'Barite 60 sx, LCM 15 sx', cost: 4300 },
    crew: 5,
  },
  {
    reportDate: '2026-09-08',
    reportNo: 88,
    depthStart: 2604,
    depthEnd: 2648,
    depthTvd: 2540,
    status: 'submitted',
    summary:
      'Drilled 8-1/2in hole 2604-2648 m at 3.1 m/hr average. No downtime. Mud properties stable. Gas peaks 60 units at 2631 m.',
    planNext: 'Continue drilling to 2680 m, then run 7in liner.',
    geology: 'Predominantly clean sandstone with thin shale interbeds. Good reservoir quality. Gas 25-60 units.',
    rows: build24([
      { code: '01', sub: 'BHA #4 PDC 8.5in', hours: 8, npt: false, remarks: 'Drilling 2604-2631 m, ROP 3.0-3.4 m/hr.' },
      { code: '24', sub: 'Seepage control [LCM]', hours: 1, npt: true, remarks: 'Minor seepage at 2631 m, LCM pill.' },
      { code: '01', sub: 'BHA #4 PDC 8.5in', hours: 8.5, npt: false, remarks: 'Drilling 2631-2648 m after treatment.' },
      { code: '10', sub: 'Mud Pumps #1', hours: 4.5, npt: false, remarks: 'Circulate bottoms up, sample collection.' },
      { code: '14', sub: 'Shift handover', hours: 2, npt: false, remarks: 'Handover shift.' },
    ]),
    costs: [
      { category: 'Rig Spread', description: 'Land Rig 08 Dayrate', vendor: 'Nabors Drilling, #RC-2025-908', afeCode: 'AFE-101.02', billingType: 'Operator Direct', amountUsd: 22400, rebillable: false },
      { category: 'Mud & Chems', description: 'WBM + LCM pill', vendor: 'Halliburton Baroid', afeCode: 'AFE-204.11', billingType: 'Operator Direct', amountUsd: 4100, rebillable: false },
      { category: 'Fuel & Power', description: 'Diesel rig power', vendor: 'Pertamina Patra Niaga', afeCode: 'AFE-105.08', billingType: 'JV Split', amountUsd: 5400, rebillable: false },
      { category: 'Directional / RSS', description: 'MWD telemetry', vendor: 'Halliburton Sperry', afeCode: 'AFE-308.15', billingType: 'Rebill Contractor', amountUsd: 3100, rebillable: true },
      { category: 'Waste & Solids', description: 'Cuttings handling', vendor: 'NOV Brandt', afeCode: 'AFE-502.04', billingType: 'Operator Direct', amountUsd: 980, rebillable: false },
      { category: 'Mud Logging', description: 'Mud logging service', vendor: 'Geolog International', afeCode: 'AFE-301.05', billingType: 'Operator Direct', amountUsd: 1180, rebillable: false },
    ],
    mud: { w: 11.8, v: 48, ph: 9.2, pv: 16, yp: 18, chem: 'Barite 60 sx, LCM 12 sx', cost: 4100 },
    crew: 5,
  },
];

/** ARUN-06: sumur fase completion (kedalaman sudah TD). 2 DDR. */
const ARUN06_REPORTS: Report[] = [
  {
    reportDate: '2026-09-04',
    reportNo: 200,
    depthStart: 3100,
    depthEnd: 3100,
    depthTvd: 3021,
    status: 'approved',
    summary:
      'Ran 4-1/2in production liner 42 joints to 3100 m. Cemented with 160 sx lead/tail. Plug bumped, no losses.',
    planNext: 'Run cement bond log, perforate target interval.',
    geology: 'Target reservoir at 3095 m. Good porosity on LWD. No losses during cementing.',
    rows: build24([
      { code: '11', sub: '4-1/2in liner 42 joints', hours: 9, npt: false, remarks: 'RIH liner to 3100 m.' },
      { code: '12', sub: 'Cementing unit', hours: 4, npt: false, remarks: 'Cement liner 160 sx, plug bumped.' },
      { code: '16', sub: 'Completion prep', hours: 8, npt: false, remarks: 'Prepare completion string, displace to brine.' },
      { code: '14', sub: 'Shift handover', hours: 3, npt: false, remarks: 'Handover shift.' },
    ]),
    costs: [
      { category: 'Rig Spread', description: 'Jackup completion dayrate', vendor: 'Nabors Drilling, #RC-2025-912', afeCode: 'AFE-101.02', billingType: 'Operator Direct', amountUsd: 26100, rebillable: false },
      { category: 'Cementing', description: 'Liner cement job 4-1/2in (160 sx)', vendor: 'Halliburton, #HAL-CEM-441', afeCode: 'AFE-206.02', billingType: 'Operator Direct', amountUsd: 9400, rebillable: false },
      { category: 'Tubulars', description: '4-1/2in production liner (42 joints)', vendor: 'Tenaris, PO #TN-9921', afeCode: 'AFE-207.01', billingType: 'Operator Direct', amountUsd: 18500, rebillable: false },
      { category: 'Logging', description: 'Cement bond log', vendor: 'Schlumberger, #SLB-CBL-118', afeCode: 'AFE-309.04', billingType: 'Rebill Contractor', amountUsd: 7200, rebillable: true },
      { category: 'Mud & Chems', description: 'Completion brine 9.5 ppg', vendor: 'M-I SWACO', afeCode: 'AFE-204.11', billingType: 'Operator Direct', amountUsd: 5200, rebillable: false },
    ],
    mud: { w: 9.5, v: 42, ph: 8.8, pv: 14, yp: 15, chem: 'Completion brine 9.5 ppg, biocide', cost: 5200 },
    crew: 5,
  },
  {
    reportDate: '2026-09-05',
    reportNo: 201,
    depthStart: 3100,
    depthEnd: 3100,
    depthTvd: 3021,
    status: 'distributed',
    summary:
      'Perforated 3095-3100 m (12 shots), installed surface wellhead. Well displaced to 9.5 ppg brine, ready for cleanup flow.',
    planNext: 'Run completion string, install tree, prepare cleanup flow.',
    geology: 'Reservoir confirmed. No losses. Good cement bond indicated.',
    rows: build24([
      { code: '13', sub: 'Perforation tool', hours: 6, npt: false, remarks: 'Perforate 3095-3100 m, 12 shots.' },
      { code: '08', sub: 'Wellhead [NOV] thread repair', hours: 2, npt: true, remarks: 'Wellhead thread damage, machinist called.' },
      { code: '16', sub: 'Completion string prep', hours: 9, npt: false, remarks: 'Make up completion string.' },
      { code: '11', sub: 'Surface wellhead', hours: 4, npt: false, remarks: 'Install surface wellhead and test.' },
      { code: '14', sub: 'Shift handover', hours: 3, npt: false, remarks: 'Handover shift.' },
    ]),
    costs: [
      { category: 'Rig Spread', description: 'Jackup completion dayrate', vendor: 'Nabors Drilling, #RC-2025-912', afeCode: 'AFE-101.02', billingType: 'Operator Direct', amountUsd: 26100, rebillable: false },
      { category: 'Logging', description: 'Perforating guns & service', vendor: 'Schlumberger, #SLB-PERF-77', afeCode: 'AFE-309.04', billingType: 'Rebill Contractor', amountUsd: 8600, rebillable: true },
      { category: 'NPT Repair & Tech', description: 'Wellhead thread repair', vendor: 'NOV, #NC-901', afeCode: 'AFE-401.09', billingType: 'Vendor Rebill', amountUsd: 2100, rebillable: true },
      { category: 'Tubulars', description: 'Completion accessories', vendor: 'Tenaris', afeCode: 'AFE-207.01', billingType: 'Operator Direct', amountUsd: 9800, rebillable: false },
      { category: 'Mud & Chems', description: 'Brine top-up', vendor: 'M-I SWACO', afeCode: 'AFE-204.11', billingType: 'Operator Direct', amountUsd: 1800, rebillable: false },
    ],
    mud: { w: 9.5, v: 42, ph: 8.8, pv: 14, yp: 15, chem: 'Brine, biocide', cost: 1800 },
    crew: 5,
  },
];

/** ARUN-07: tambahan histori agar multi-hari (sumur utama demo). */
const ARUN07_REPORTS: Report[] = [
  {
    reportDate: '2026-09-08',
    reportNo: 143,
    depthStart: 2790,
    depthEnd: 2808,
    depthTvd: 2718,
    status: 'distributed',
    summary: 'Drilled 2790-2808 m. One 1.0h NPT for mud pump valve. Mud weight increased to 12.2 ppg.',
    planNext: 'Drill to 2833 m, then circulate and survey.',
    geology: 'Interbedded shale and sandstone. Gas 15-35 units.',
    rows: build24([
      { code: '01', sub: 'BHA #5 PDC 8.5in', hours: 14, npt: false, remarks: 'Drilling 2790-2805 m.' },
      { code: '08', sub: 'Mud pump valve [GD]', hours: 1, npt: true, remarks: 'Replace discharge valve seat.' },
      { code: '10', sub: 'Mud Pumps #1 & #2', hours: 6, npt: false, remarks: 'Weight up mud and circulate.' },
      { code: '14', sub: 'Shift handover', hours: 3, npt: false, remarks: 'Handover shift.' },
    ]),
    costs: [
      { category: 'Rig Spread', description: 'Rig 12 operating dayrate', vendor: 'Nabors Drilling, #RC-2025-912', afeCode: 'AFE-101.02', billingType: 'Operator Direct', amountUsd: 28500, rebillable: false },
      { category: 'Mud & Chems', description: 'WBM weight up to 12.2 ppg', vendor: 'M-I SWACO', afeCode: 'AFE-204.11', billingType: 'Operator Direct', amountUsd: 6200, rebillable: false },
      { category: 'Fuel & Power', description: 'Diesel rig power', vendor: 'Pertamina Patra Niaga', afeCode: 'AFE-105.08', billingType: 'JV Split', amountUsd: 6900, rebillable: false },
      { category: 'NPT Repair & Tech', description: 'Pump valve replacement', vendor: 'Gardner Denver, #GD-221', afeCode: 'AFE-401.09', billingType: 'Vendor Rebill', amountUsd: 980, rebillable: true },
      { category: 'Directional / RSS', description: 'MWD telemetry', vendor: 'Baker Hughes', afeCode: 'AFE-308.15', billingType: 'Rebill Contractor', amountUsd: 4600, rebillable: true },
      { category: 'Mud Logging', description: 'Mud logging service', vendor: 'Geolog International', afeCode: 'AFE-301.05', billingType: 'Operator Direct', amountUsd: 1260, rebillable: false },
    ],
    mud: { w: 12.2, v: 52, ph: 9.5, pv: 18, yp: 21, chem: 'Barite 70 sx, PAC-LV 6 sx', cost: 6200 },
    crew: 6,
  },
  {
    reportDate: '2026-09-09',
    reportNo: 144,
    depthStart: 2808,
    depthEnd: 2833,
    depthTvd: 2759,
    status: 'approved',
    summary: 'Drilled 2808-2833 m. 2.0h NPT top drive repair. Bit graded 2-3-WT. Mud 12.3 ppg.',
    planNext: 'Continue to 2845 m, then POOH for bit change.',
    geology: 'Shale with siltstone. Gas 20-40 units. No shows.',
    rows: build24([
      { code: '01', sub: 'BHA #5 PDC 8.5in', hours: 13, npt: false, remarks: 'Drilling 2808-2830 m.' },
      { code: '08', sub: 'Top drive [NOV]', hours: 2, npt: true, remarks: 'Top drive seal replacement.' },
      { code: '09', sub: 'Drillpipe 5in', hours: 5, npt: false, remarks: 'Short trip for hole cleaning.' },
      { code: '14', sub: 'Shift handover', hours: 4, npt: false, remarks: 'Handover shift.' },
    ]),
    costs: [
      { category: 'Rig Spread', description: 'Rig 12 operating dayrate', vendor: 'Nabors Drilling, #RC-2025-912', afeCode: 'AFE-101.02', billingType: 'Operator Direct', amountUsd: 28500, rebillable: false },
      { category: 'Mud & Chems', description: 'WBM maintenance 12.3 ppg', vendor: 'M-I SWACO', afeCode: 'AFE-204.11', billingType: 'Operator Direct', amountUsd: 6500, rebillable: false },
      { category: 'Fuel & Power', description: 'Diesel rig power', vendor: 'Pertamina Patra Niaga', afeCode: 'AFE-105.08', billingType: 'JV Split', amountUsd: 7000, rebillable: false },
      { category: 'NPT Repair & Tech', description: 'Top drive seal & tech', vendor: 'NOV, #NC-877', afeCode: 'AFE-401.09', billingType: 'Vendor Rebill', amountUsd: 1750, rebillable: true },
      { category: 'Directional / RSS', description: 'MWD telemetry', vendor: 'Baker Hughes', afeCode: 'AFE-308.15', billingType: 'Rebill Contractor', amountUsd: 4700, rebillable: true },
      { category: 'Mud Logging', description: 'Mud logging service', vendor: 'Geolog International', afeCode: 'AFE-301.05', billingType: 'Operator Direct', amountUsd: 1260, rebillable: false },
    ],
    mud: { w: 12.3, v: 53, ph: 9.5, pv: 19, yp: 21, chem: 'Barite 75 sx, PAC-LV 7 sx', cost: 6500 },
    crew: 6,
  },
];

const CREW_TEMPLATE: Array<[string, string, string, string, string]> = [
  ['Marcus Vance', 'Toolpusher', 'Nabors Drilling', 'Day', 'Lifeboat 1'],
  ['Harlan Reed', 'Driller', 'Nabors Drilling', 'Day', 'Lifeboat 1'],
  ['Siti Rahma', 'Mud Engineer', 'M-I SWACO', 'Night', 'Lifeboat 2'],
  ['Aris Munandar', 'Lead Derrickman', 'Nabors Drilling', 'Night', 'Lifeboat 2'],
  ['Dave Miller', 'Company Man', 'Medco E&P', 'Day', 'Lifeboat 1'],
  ['Sarah Jenkins', 'Rig Clerk', 'Medco E&P', 'Day', 'Lifeboat 1'],
];

function summarize(rows: Row[]) {
  let total = 0, prd = 0, npt = 0, wow = 0;
  for (const r of rows) {
    const dur = rowDurationMinutes(r.start, r.end) ?? 0;
    total += dur;
    const cls = r.npt ? 'NPT' : classifyTime(r.code);
    if (cls === 'PRD') prd += dur;
    else if (cls === 'NPT') npt += dur;
    else if (cls === 'WOW') wow += dur;
  }
  return { total, prd, npt, wow };
}

async function insertReports(wellName: string, reports: Report[]): Promise<void> {
  const wellRows = await db.select().from(s.wells).where(eq(s.wells.name, wellName)).limit(1);
  const well = wellRows[0];
  if (!well) {
    console.warn(`[seed-variants] sumur ${wellName} tidak ditemukan, dilewati.`);
    return;
  }

  // rig: ARUN-05 -> RIG-08, lainnya RIG-12
  const rigCode = wellName === 'ARUN-05' ? 'RIG-08' : 'RIG-12';
  const rigRows = await db.select().from(s.rigs).where(eq(s.rigs.code, rigCode)).limit(1);
  const rig = rigRows[0];

  const userRows = await db.select().from(s.users).limit(20);
  const clerk = userRows.find((u) => u.role === 'RigClerk');
  const companyMan = userRows.find((u) => u.role === 'CompanyMan');

  for (const rep of reports) {
    const exists = await db
      .select({ id: s.dailyReports.id })
      .from(s.dailyReports)
      .where(and(eq(s.dailyReports.wellId, well.id), eq(s.dailyReports.reportDate, rep.reportDate)))
      .limit(1);
    if (exists[0]) continue;

    const agg = summarize(rep.rows);
    const daily = round2(rep.costs.reduce((a, c) => a + c.amountUsd, 0));

    const [report] = await db
      .insert(s.dailyReports)
      .values({
        wellId: well.id,
        rigId: rig?.id ?? null,
        reportDate: rep.reportDate,
        reportNo: rep.reportNo,
        periodFrom: '06:00',
        periodTo: '06:00',
        depthMdStart: String(rep.depthStart),
        depthMdEnd: String(rep.depthEnd),
        depthTvd: String(rep.depthTvd),
        progress24h: round2(rep.depthEnd - rep.depthStart).toFixed(2),
        summary: rep.summary,
        planNext: rep.planNext,
        geologyNotes: rep.geology,
        equipmentStatus: {
          'Top Drive System (TDS-11)': 'OK - bearing temp 54C',
          'Mud Pumps (#1 & #2)': rep.rows.some((r) => r.code === '08') ? 'Degraded - intermittent pulsation' : 'OK - 3,000 psi',
          'BOP Stack & Accumulator': 'OK - 3,000 psi',
          'Shale Shakers & Desander': 'OK - 140 mesh x4',
        },
        totalMinutes: agg.total,
        productiveMinutes: agg.prd,
        nptMinutes: agg.npt,
        wowMinutes: agg.wow,
        costDailyUsd: daily.toFixed(2),
        costCumulativeUsd: daily.toFixed(2),
        status: rep.status,
        createdBy: clerk?.id ?? null,
        submittedBy: clerk?.id ?? null,
        submittedAt: new Date(`${rep.reportDate}T06:30:00Z`),
        ...(rep.status === 'approved' || rep.status === 'distributed'
          ? { approvedBy: companyMan?.id ?? null, approvedAt: new Date(`${rep.reportDate}T07:00:00Z`), lockedAt: new Date(`${rep.reportDate}T07:00:00Z`), signatureName: companyMan?.name ?? 'Company Man' }
          : {}),
        ...(rep.status === 'distributed' ? { distributedAt: new Date(`${rep.reportDate}T07:05:00Z`) } : {}),
      })
      .returning();

    await db.insert(s.timeBreakdown).values(
      rep.rows.map((r, i) => ({
        reportId: report.id,
        sortOrder: i + 1,
        startHm: r.start,
        endHm: r.end,
        durationMin: rowDurationMinutes(r.start, r.end) ?? 0,
        iadcCode: r.code,
        iadcSubcode: r.sub,
        nptFlag: r.npt,
        timeClass: r.npt ? 'NPT' : classifyTime(r.code),
        remarks: r.remarks,
      }))
    );

    await db.insert(s.crewMembers).values(
      CREW_TEMPLATE.slice(0, rep.crew).map(([name, position, company, shift, muster]) => ({
        reportId: report.id,
        name,
        position,
        company,
        shift,
        hours: '12.00',
        pobStatus: 'in',
        musterStation: muster,
      }))
    );

    await db.insert(s.mudRecords).values({
      reportId: report.id,
      weightPpg: rep.mud.w.toFixed(2),
      viscositySecQt: rep.mud.v.toFixed(2),
      ph: rep.mud.ph.toFixed(2),
      pv: rep.mud.pv.toFixed(2),
      yp: rep.mud.yp.toFixed(2),
      chemicalsAdded: rep.mud.chem,
      costUsd: rep.mud.cost.toFixed(2),
    });

    await db.insert(s.bhaComponents).values([
      { reportId: report.id, sortOrder: 1, component: 'PDC Bit 8.5in', odIn: '8.50', lengthM: '0.35', hours: '12.00' },
      { reportId: report.id, sortOrder: 2, component: 'MWD/LWD Sub', odIn: '6.75', lengthM: '9.20', hours: '12.00' },
      { reportId: report.id, sortOrder: 3, component: 'Drill Collar 6.5in x3', odIn: '6.50', lengthM: '28.50', hours: '12.00' },
    ]);

    await db.insert(s.costLines).values(
      rep.costs.map((c) => ({
        reportId: report.id,
        wellId: well.id,
        category: c.category,
        description: c.description,
        vendor: c.vendor,
        afeCode: c.afeCode,
        billingType: c.billingType,
        amountUsd: c.amountUsd.toFixed(2),
        rebillable: c.rebillable,
      }))
    );

    await db.insert(s.surveyStations).values([
      { reportId: report.id, md: String(rep.depthStart), inclination: '12.40', azimuth: '145.20', tvd: String(rep.depthTvd) },
      { reportId: report.id, md: String(rep.depthEnd), inclination: '14.05', azimuth: '148.90', tvd: String(rep.depthTvd) },
    ]);

    console.log(
      `[seed-variants] ${wellName} DDR #${rep.reportNo} (${rep.reportDate}) - ${(agg.total / 60).toFixed(1)} jam, NPT ${(agg.npt / 60).toFixed(1)} jam, $${daily.toFixed(2)}, ${rep.status}`
    );
  }
}

export async function seedVariants(): Promise<void> {
  await migrate();
  await insertReports('ARUN-05', ARUN05_REPORTS);
  await insertReports('ARUN-06', ARUN06_REPORTS);
  await insertReports('ARUN-07', ARUN07_REPORTS);

  /*
   * Recalculate cost_cumulative_usd per sumur: jumlah berjalan dari laporan
   * terlama ke terbaru. Revisi pada tanggal yang sama dihitung sekali
   * (revisi tertinggi yang dipakai) - konsisten dengan repo/shared.ts.
   */
  const wells = await db.select({ id: s.wells.id, name: s.wells.name }).from(s.wells);
  for (const w of wells) {
    const reports = await db.select().from(s.dailyReports).where(eq(s.dailyReports.wellId, w.id));
    const byDate = new Map<string, (typeof reports)[number]>();
    for (const r of reports) {
      const cur = byDate.get(r.reportDate);
      if (!cur || r.revision > cur.revision) byDate.set(r.reportDate, r);
    }
    const ordered = [...byDate.values()].sort((a, b) => a.reportDate.localeCompare(b.reportDate));
    let cum = 0;
    for (const r of ordered) {
      cum = round2(cum + Number(r.costDailyUsd));
      await db.update(s.dailyReports).set({ costCumulativeUsd: cum.toFixed(2) }).where(eq(s.dailyReports.id, r.id));
    }
  }
  console.log('[seed-variants] kumulatif biaya dihitung ulang.');
}

if (require.main === module) {
  seedVariants()
    .then(async () => {
      await closeDb();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[seed-variants] GAGAL:', err);
      await closeDb().catch(() => undefined);
      process.exit(1);
    });
}
