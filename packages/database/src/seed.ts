/**
 * SEED v2 - Dataset demo 3 sumur untuk benchmarking.
 *
 * Tujuan: memberi pembanding nyata di halaman Insights. Tiga sumur dengan
 * karakteristik BERBEDA (disengaja) agar perbandingan bermakna:
 *
 *   ARUN-07  Drilling aktif, NPT tinggi (16.7%), cost tinggi   -> sumur "bermasalah"
 *   ARUN-05  Drilling selesai lebih cepat, NPT rendah (4.2%)    -> sumur "efisien"
 *   ARUN-06  Completion, NPT sedang (9.1%), fokus sumur lain   -> sumur "normal"
 *
 * Idempotent: aman dijalankan berulang.
 *
 * Jalankan: npm run db:seed
 */
import { and, eq, sql } from 'drizzle-orm';
import { closeDb, db } from './client';
import * as s from './schema';
import { hashPassword } from './password';
import { IADC_CODES, classifyTime, rowDurationMinutes, round2 } from '@rigdaily/shared';
import { migrate } from './migrate';

/* ==================================================================== */
/* Definisi sumur                                                       */
/* ==================================================================== */

type WellSpec = {
  name: string;
  apiNo: string;
  type: 'oil' | 'gas' | 'geothermal' | 'ccs' | 'mining' | 'water';
  phase: string;
  spudDate: string;
  tdPlannedM: number;
  afeBudgetUsd: number;
  /** Laporan: satu per tanggal */
  reports: ReportSpec[];
};

type ReportSpec = {
  reportDate: string;
  reportNo: number;
  depthMdStart: number;
  depthMdEnd: number;
  depthTvd: number;
  status: 'draft' | 'submitted' | 'approved' | 'distributed';
  summary: string;
  planNext: string;
  geology: string;
  costLines: Array<{ category: string; description: string; vendor: string; afeCode: string; billingType: string; amountUsd: number; rebillable: boolean }>;
  timeRows: Array<{ start: string; end: string; code: string; sub: string; npt: boolean; remarks: string }>;
  mud: { weightPpg: number; visc: number; ph: number; pv: number; yp: number; chemicals: string; cost: number };
  crewCount: number;
};

/** Baris time 24 jam generik dengan parameter NPT. */
function timeRows(nptSegments: Array<{ afterMin: number; minutes: number; code: string; sub: string; remarks: string }>, baseOps: string): ReportSpec['timeRows'] {
  // Bangun 24 jam: mulai 06:00, sisipkan segmen NPT pada offset tertentu.
  const segments: ReportSpec['timeRows'] = [];
  let cursor = 6 * 60; // 06:00
  const total = 24 * 60;
  let consumed = 0;

  const fmt = (m: number) => {
    const x = ((m % total) + total) % total;
    return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
  };

  const ops = baseOps;
  for (const seg of nptSegments) {
    const gap = seg.afterMin - consumed;
    if (gap > 0) {
      const start = cursor;
      cursor += gap;
      consumed += gap;
      segments.push({ start: fmt(start), end: fmt(cursor), code: '01', sub: 'BHA 8.5in PDC', npt: false, remarks: ops });
    }
    const start = cursor;
    cursor += seg.minutes;
    consumed += seg.minutes;
    segments.push({ start: fmt(start), end: fmt(cursor), code: seg.code, sub: seg.sub, npt: true, remarks: seg.remarks });
  }
  if (consumed < total) {
    const start = cursor;
    cursor += total - consumed;
    segments.push({ start: fmt(start), end: fmt(cursor), code: '14', sub: 'Shift handover (IADC 14)', npt: false, remarks: 'Handover shift, total genap 24.0h.' });
  }
  return segments;
}

const WELLS: WellSpec[] = [
  /* ---------------- ARUN-07 - sumur "bermasalah" (NPT tinggi) ---------------- */
  {
    name: 'ARUN-07',
    apiNo: '00-047-20123-00-00',
    type: 'oil',
    phase: 'drilling',
    spudDate: '2026-08-01',
    tdPlannedM: 3200,
    afeBudgetUsd: 1600000,
    reports: [
      {
        reportDate: '2026-09-10',
        reportNo: 145,
        depthMdStart: 2833,
        depthMdEnd: 2845,
        depthTvd: 2770.6,
        status: 'submitted',
        summary:
          'Drilled 8-1/2in hole from 2833m to 2845m with controlled WOB. Experienced pump pressure pulsation due to leaking manifold discharge valve; shut down for 1.5h NPT to replace O-ring seal. Circulated bottoms up at 2845m. Observed dull bit characteristics, initiated POOH.',
        planNext: 'POOH, inspect PDC M19, BHA #7 + Bit #8, RIH 2845m, drill to Arun Limestone top.',
        geology:
          'Interbedded grey silty shale with fine sandstone laminations. Gas 18 to 44 units at 2838m. No fluorescence. ROP 1.2-2.5 m/hr.',
        costLines: [
          { category: 'Rig Spread', description: 'Rig 12 Operating Dayrate (24.0h operating spread)', vendor: 'Nabors Drilling, Contract #RC-2025-912', afeCode: 'AFE-101.02', billingType: 'Operator Direct', amountUsd: 28500, rebillable: false },
          { category: 'Mud & Chems', description: '12.4 ppg WBM Barite Addition (180 sx) + Biocide', vendor: 'M-I SWACO (SLB), Ticket #SLB-MUD-9914', afeCode: 'AFE-204.11', billingType: 'Operator Direct', amountUsd: 6800, rebillable: false },
          { category: 'Fuel & Power', description: 'Rig Power Generation #2 Diesel (1,995 gal @ $3.45/gal)', vendor: 'Pertamina Patra Niaga, Bulk #5512', afeCode: 'AFE-105.08', billingType: 'JV Split (60/40)', amountUsd: 6882.5, rebillable: false },
          { category: 'Directional / RSS', description: 'AutoTrak RSS & MWD Telemetry', vendor: 'Baker Hughes, Tool Spread Run 03', afeCode: 'AFE-308.15', billingType: 'Rebill Contractor', amountUsd: 4850, rebillable: true },
          { category: 'NPT Repair & Tech', description: 'Top Drive O-Ring Replacement & Specialist Tech', vendor: 'NOV, Tech Callout #NC-883', afeCode: 'AFE-401.09', billingType: 'Vendor Rebill', amountUsd: 1420, rebillable: true },
          { category: 'Standby Adjust.', description: 'Severe Lightning Squall Standby Credit (1.5 hrs @ WOW Rate)', vendor: 'Nabors Contract Cl. 14.2', afeCode: 'AFE-101.03', billingType: 'Contract Rate', amountUsd: -687.5, rebillable: false },
          { category: 'Waste & Solids', description: 'Centrifuge Cuttings Drying & Shaker Screens', vendor: 'NOV Brandt, Consumable Package', afeCode: 'AFE-502.04', billingType: 'Operator Direct', amountUsd: 1225, rebillable: false },
          { category: 'Mud Logging', description: 'Pressurized Mud Logging Cabin & Degasser Sensor', vendor: 'Geolog International, 2-Man 24h', afeCode: 'AFE-301.05', billingType: 'Operator Direct', amountUsd: 1260, rebillable: false },
        ],
        timeRows: [
          { start: '06:00', end: '08:30', code: '01', sub: 'BHA #6 8.5in PDC M19', npt: false, remarks: 'Drilling 2833-2835m. WOB 18k, RPM 120, SPP 3120psi.' },
          { start: '08:30', end: '11:30', code: '01', sub: 'BHA #6 MWD Survey', npt: false, remarks: 'Drilling to 2838m with MWD gamma and resistivity.' },
          { start: '11:30', end: '13:00', code: '08', sub: 'Top Drive Standpipe [NOV]', npt: true, remarks: 'Shutdown replace manifold #2 hose. O-ring replaced.' },
          { start: '13:00', end: '16:30', code: '10', sub: 'Mud Pumps #1 & #2 (12.4 ppg)', npt: false, remarks: 'Bottoms up at 2838m for sample. Condition mud.' },
          { start: '16:30', end: '19:30', code: '09', sub: '5in S-135 Drillpipe', npt: false, remarks: 'Slug 14.5 ppg pill. POOH 2838m to 2410m shoe.' },
          { start: '19:30', end: '20:30', code: '08', sub: 'Mud Pump #2 [Gardner Denver]', npt: true, remarks: 'Discharge valve vibration. Replace valve seat insert.' },
          { start: '20:30', end: '22:00', code: '27', sub: 'Crane & Derrick Ops', npt: false, remarks: 'Lightning squall. Derrick suspended per SOP.' },
          { start: '22:00', end: '04:30', code: '09', sub: 'BHA #6 Disassembly', npt: false, remarks: 'POOH to surface. Inspect PDC cutting structure.' },
          { start: '04:30', end: '06:00', code: '14', sub: 'Shift handover (IADC 14)', npt: false, remarks: 'Handover shift, total 24.0h.' },
        ],
        mud: { weightPpg: 12.4, visc: 54, ph: 9.6, pv: 19, yp: 22, chemicals: 'Caustic 4 sx, Barite 85 sx, Xanvis 6 sx, PAC-LV 8 sx', cost: 6800 },
        crewCount: 6,
      },
    ],
  },

  /* ---------------- ARUN-05 - sumur "efisien" (NPT rendah) ---------------- */
  {
    name: 'ARUN-05',
    apiNo: '00-047-20098-00-00',
    type: 'gas',
    phase: 'drilling',
    spudDate: '2026-07-12',
    tdPlannedM: 2950,
    afeBudgetUsd: 1450000,
    reports: [
      {
        reportDate: '2026-09-08',
        reportNo: 88,
        depthMdStart: 2610,
        depthMdEnd: 2648,
        depthTvd: 2549.2,
        status: 'approved',
        summary:
          'Drilled 8-1/2in hole from 2610m to 2648m at average ROP 3.1 m/hr. No downtime; mud properties stable. Encountered minor seepage at 2631m, controlled with LCM pill.',
        planNext: 'Continue drilling to 2680m, then run 7in liner. Prepare cementing program.',
        geology: 'Predominantly clean sandstone with thin shale interbeds. Good reservoir quality indicators. Gas readings 25-60 units.',
        costLines: [
          { category: 'Rig Spread', description: 'Rig 08 Operating Dayrate', vendor: 'Nabors Drilling, Contract #RC-2025-908', afeCode: 'AFE-101.02', billingType: 'Operator Direct', amountUsd: 24800, rebillable: false },
          { category: 'Mud & Chems', description: '11.8 ppg WBM Maintenance + LCM Pill', vendor: 'Halliburton Baroid, Ticket #HAL-772', afeCode: 'AFE-204.11', billingType: 'Operator Direct', amountUsd: 4100, rebillable: false },
          { category: 'Fuel & Power', description: 'Rig Fuel Consumption', vendor: 'Pertamina Patra Niaga', afeCode: 'AFE-105.08', billingType: 'JV Split', amountUsd: 5900, rebillable: false },
          { category: 'Directional / RSS', description: 'MWD Telemetry Only (no RSS)', vendor: 'Halliburton Sperry', afeCode: 'AFE-308.15', billingType: 'Rebill Contractor', amountUsd: 3100, rebillable: true },
          { category: 'Waste & Solids', description: 'Cuttings Handling', vendor: 'NOV Brandt', afeCode: 'AFE-502.04', billingType: 'Operator Direct', amountUsd: 980, rebillable: false },
          { category: 'Mud Logging', description: 'Mud Logging Service', vendor: 'Geolog International', afeCode: 'AFE-301.05', billingType: 'Operator Direct', amountUsd: 1180, rebillable: false },
        ],
        timeRows: [
          { start: '06:00', end: '14:00', code: '01', sub: 'BHA #4 8.5in PDC', npt: false, remarks: 'Drilling 2610-2631m, ROP 3.0-3.4 m/hr.' },
          { start: '14:00', end: '15:00', code: '24', sub: 'Lost Circulation [Seepage]', npt: true, remarks: 'Minor seepage at 2631m, LCM pill spotted.' },
          { start: '15:00', end: '23:30', code: '01', sub: 'BHA #4 8.5in PDC', npt: false, remarks: 'Drilling 2631-2648m after LCM treatment.' },
          { start: '23:30', end: '04:00', code: '10', sub: 'Mud Pumps #1', npt: false, remarks: 'Circulate bottoms up, sample collection.' },
          { start: '04:00', end: '06:00', code: '14', sub: 'Shift handover (IADC 14)', npt: false, remarks: 'Handover shift.' },
        ],
        mud: { weightPpg: 11.8, visc: 48, ph: 9.2, pv: 16, yp: 18, chemicals: 'Barite 60 sx, PAC-LV 5 sx, LCM 12 sx', cost: 4100 },
        crewCount: 5,
      },
    ],
  },

  /* ---------------- ARUN-06 - sumur "normal" (completion) ---------------- */
  {
    name: 'ARUN-06',
    apiNo: '00-047-20110-00-00',
    type: 'oil',
    phase: 'completion',
    spudDate: '2026-06-20',
    tdPlannedM: 3100,
    afeBudgetUsd: 1800000,
    reports: [
      {
        reportDate: '2026-09-05',
        reportNo: 201,
        depthMdStart: 3040,
        depthMdEnd: 3040,
        depthTvd: 2968.4,
        status: 'distributed',
        summary:
          'Completion operations: run 4-1/2in production liner and cemented. Perforated interval 3035-3040m (12 shots). Well displaced to completion brine 9.5 ppg. Surface wellhead installed.',
        planNext: 'Run completion string, install tree, prepare well for cleanup flow.',
        geology: 'Target reservoir reached at 3035m. Good porosity indications on LWD. No losses during cementing.',
        costLines: [
          { category: 'Rig Spread', description: 'Rig 12 Completion Dayrate', vendor: 'Nabors Drilling, Contract #RC-2025-912', afeCode: 'AFE-101.02', billingType: 'Operator Direct', amountUsd: 26100, rebillable: false },
          { category: 'Cementing', description: 'Liner Cement Job 4-1/2in (160 sx)', vendor: 'Halliburton, Job #HAL-CEM-441', afeCode: 'AFE-206.02', billingType: 'Operator Direct', amountUsd: 9400, rebillable: false },
          { category: 'Tubulars', description: '4-1/2in Production Liner (42 joints)', vendor: 'Tenaris, PO #TN-9921', afeCode: 'AFE-207.01', billingType: 'Operator Direct', amountUsd: 18500, rebillable: false },
          { category: 'Logging', description: 'Cement Bond Log + Perforation', vendor: 'Schlumberger, Job #SLB-CBL-118', afeCode: 'AFE-309.04', billingType: 'Rebill Contractor', amountUsd: 7200, rebillable: true },
          { category: 'Mud & Chems', description: 'Completion Brine 9.5 ppg Displacement', vendor: 'M-I SWACO', afeCode: 'AFE-204.11', billingType: 'Operator Direct', amountUsd: 5200, rebillable: false },
          { category: 'NPT Repair & Tech', description: 'Wellhead Install Delay - Thread Repair', vendor: 'NOV, Tech #NC-901', afeCode: 'AFE-401.09', billingType: 'Vendor Rebill', amountUsd: 2100, rebillable: true },
        ],
        timeRows: [
          { start: '06:00', end: '11:00', code: '11', sub: '4-1/2in Liner Running', npt: false, remarks: 'RIH liner 42 joints to 3040m.' },
          { start: '11:00', end: '14:30', code: '12', sub: 'Cementing Unit', npt: false, remarks: 'Cement liner 160 sx, plug bumped.' },
          { start: '14:30', end: '16:30', code: '08', sub: 'Wellhead [NOV] - Thread Repair', npt: true, remarks: 'Wellhead thread damage, machinist called.' },
          { start: '16:30', end: '20:00', code: '13', sub: 'CBL / Perforation Tool', npt: false, remarks: 'CBL run and perforation 3035-3040m.' },
          { start: '20:00', end: '02:00', code: '16', sub: 'Completion String Prep', npt: false, remarks: 'Prepare completion string, displace to brine.' },
          { start: '02:00', end: '06:00', code: '14', sub: 'Shift handover (IADC 14)', npt: false, remarks: 'Handover shift.' },
        ],
        mud: { weightPpg: 9.5, visc: 42, ph: 8.8, pv: 14, yp: 15, chemicals: 'Completion brine 9.5 ppg, biocide', cost: 5200 },
        crewCount: 5,
      },
    ],
  },
];

/* ==================================================================== */
/* Seeding                                                              */
/* ==================================================================== */

async function seedIadcCodes() {
  for (const c of IADC_CODES) {
    await db
      .insert(s.iadcCodes)
      .values({
        code: c.code, num: c.num, name: c.name, category: c.category,
        productive: c.productive, nptDefault: c.nptDefault,
        subCodeRequired: c.subCodeRequired ?? false, active: true, sortOrder: c.num,
      })
      .onConflictDoUpdate({
        target: s.iadcCodes.code,
        set: { name: c.name, category: c.category, productive: c.productive, nptDefault: c.nptDefault, subCodeRequired: c.subCodeRequired ?? false, sortOrder: c.num, updatedAt: new Date() },
      });
  }
  console.log(`[seed] iadc_codes: ${IADC_CODES.length} baris.`);
}

function summarize(rows: ReportSpec['timeRows']) {
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

export async function seed(): Promise<void> {
  await migrate();
  await seedIadcCodes();

  const password = process.env.SEED_PASSWORD ?? 'rigdaily123';

  const existingCompany = await db.select().from(s.companies).where(eq(s.companies.name, 'Medco E&P / Pertamina JV')).limit(1);
  const company = existingCompany[0] ?? (await db.insert(s.companies).values({ name: 'Medco E&P / Pertamina JV', type: 'operator' }).returning())[0];

  const existingField = await db.select().from(s.fields).where(eq(s.fields.name, 'Arun Field')).limit(1);
  const field = existingField[0] ?? (await db.insert(s.fields).values({ companyId: company.id, name: 'Arun Field', county: 'Aceh Utara', state: 'Aceh', country: 'Indonesia', location: 'Sumatera Utara Block B' }).returning())[0];

  // Dua rig: RIG-12 (DEEP-HORIZON 04) dan RIG-08
  const rigSpecs = [
    { name: 'DEEP-HORIZON 04', code: 'RIG-12', type: 'jackup', contractor: 'Nabors Drilling', contractRef: 'RC-2025-912' },
    { name: 'ARUN PRIDE 08', code: 'RIG-08', type: 'land', contractor: 'Nabors Drilling', contractRef: 'RC-2025-908' },
  ];
  const rigs: Record<string, string> = {};
  for (const r of rigSpecs) {
    const found = await db.select().from(s.rigs).where(eq(s.rigs.name, r.name)).limit(1);
    rigs[r.code] = found[0]?.id ?? (await db.insert(s.rigs).values(r).returning())[0].id;
  }

  // Users
  const userSeed = [
    { email: 'dave.miller@medco-energi.com', name: 'Dave Miller', role: 'CompanyMan' },
    { email: 's.jenkins@medco-energi.com', name: 'Sarah Jenkins', role: 'RigClerk' },
    { email: 'a.arifin@partner-jv.com', name: 'Dr. A. Arifin', role: 'DrillingEngineer' },
    { email: 'cost.control@medco-energi.com', name: 'Rina Wibowo', role: 'CostController' },
    { email: 'hse@medco-energi.com', name: 'Budi Santoso', role: 'HSE' },
    { email: 'h.setiawan@pertamina-jv.com', name: 'Hendra Setiawan', role: 'Viewer' },
    { email: 'admin@rigdaily.local', name: 'System Administrator', role: 'Admin' },
  ];
  const userIds: Record<string, string> = {};
  for (const u of userSeed) {
    const found = await db.select().from(s.users).where(eq(s.users.email, u.email)).limit(1);
    if (found[0]) { userIds[u.role] = found[0].id; continue; }
    const ins = await db.insert(s.users).values({ companyId: company.id, email: u.email, name: u.name, passwordHash: hashPassword(password), role: u.role, rigScope: [], mfaEnabled: false, active: true }).returning();
    userIds[u.role] = ins[0].id;
  }
  console.log(`[seed] users: ${userSeed.length} (password "${password}").`);

  // Wells + reports
  for (const spec of WELLS) {
    const foundWell = await db.select().from(s.wells).where(eq(s.wells.name, spec.name)).limit(1);
    const well =
      foundWell[0] ??
      (
        await db
          .insert(s.wells)
          .values({
            fieldId: field.id, name: spec.name, apiNo: spec.apiNo, type: spec.type, phase: spec.phase,
            spudDate: spec.spudDate, tdPlannedM: String(spec.tdPlannedM), lat: '5.062300', lon: '97.418100',
            afeBudgetUsd: String(spec.afeBudgetUsd), operator: 'Medco E&P / Pertamina JV',
          })
          .returning()
      )[0];

    const rigCode = spec.name === 'ARUN-05' ? 'RIG-08' : 'RIG-12';
    const rigId = rigs[rigCode];

    // Kumulatif berjalan per well
    let cumulative = 0;

    for (const rep of spec.reports) {
      const exists = await db
        .select()
        .from(s.dailyReports)
        .where(and(eq(s.dailyReports.wellId, well.id), eq(s.dailyReports.reportDate, rep.reportDate)))
        .limit(1);
      if (exists[0]) {
        cumulative += Number(exists[0].costDailyUsd);
        continue;
      }

      const agg = summarize(rep.timeRows);
      const daily = round2(rep.costLines.reduce((a, l) => a + l.amountUsd, 0));
      cumulative = round2(cumulative + daily);

      const [report] = await db
        .insert(s.dailyReports)
        .values({
          wellId: well.id,
          rigId,
          reportDate: rep.reportDate,
          reportNo: rep.reportNo,
          periodFrom: '06:00',
          periodTo: '06:00',
          depthMdStart: String(rep.depthMdStart),
          depthMdEnd: String(rep.depthMdEnd),
          depthTvd: String(rep.depthTvd),
          progress24h: round2(rep.depthMdEnd - rep.depthMdStart).toFixed(2),
          summary: rep.summary,
          planNext: rep.planNext,
          geologyNotes: rep.geology,
          equipmentStatus: {
            'Top Drive System (TDS-11)': 'OK - bearing temp 54C',
            'Mud Pumps (#1 & #2)': nptHigh(rep) ? 'Degraded - high discharge pulsation' : 'OK - 3,000 psi',
            'BOP Stack & Accumulator': 'OK - 3,000 psi',
            'Shale Shakers & Desander': 'OK - 140 mesh x4',
          },
          totalMinutes: agg.total,
          productiveMinutes: agg.prd,
          nptMinutes: agg.npt,
          wowMinutes: agg.wow,
          costDailyUsd: daily.toFixed(2),
          costCumulativeUsd: cumulative.toFixed(2),
          status: rep.status,
          createdBy: userIds.RigClerk,
          submittedBy: userIds.RigClerk,
          submittedAt: new Date(`${rep.reportDate}T06:30:00Z`),
          ...(rep.status === 'approved' || rep.status === 'distributed'
            ? { approvedBy: userIds.CompanyMan, approvedAt: new Date(`${rep.reportDate}T07:00:00Z`), lockedAt: new Date(`${rep.reportDate}T07:00:00Z`), signatureName: 'Dave Miller' }
            : {}),
          ...(rep.status === 'distributed' ? { distributedAt: new Date(`${rep.reportDate}T07:05:00Z`) } : {}),
        })
        .returning();

      await db.insert(s.timeBreakdown).values(
        rep.timeRows.map((r, i) => ({
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
        })),
      );

      const crewNames = [
        ['Marcus Vance', 'Toolpusher', 'Nabors Drilling', 'Day', 'Lifeboat 1'],
        ['Harlan Reed', 'Driller', 'Nabors Drilling', 'Day', 'Lifeboat 1'],
        ['Siti Rahma', 'Mud Engineer', 'M-I SWACO', 'Night', 'Lifeboat 2'],
        ['Aris Munandar', 'Lead Derrickman', 'Nabors Drilling', 'Night', 'Lifeboat 2'],
        ['Dave Miller', 'Company Man', 'Medco E&P', 'Day', 'Lifeboat 1'],
        ['Sarah Jenkins', 'Rig Clerk', 'Medco E&P', 'Day', 'Lifeboat 1'],
      ].slice(0, rep.crewCount);

      await db.insert(s.crewMembers).values(
        crewNames.map(([name, position, comp, shift, muster]) => ({
          reportId: report.id, name, position, company: comp, shift, hours: '12.00', pobStatus: 'in', musterStation: muster,
        })),
      );

      await db.insert(s.mudRecords).values({
        reportId: report.id,
        weightPpg: rep.mud.weightPpg.toFixed(2),
        viscositySecQt: rep.mud.visc.toFixed(2),
        ph: rep.mud.ph.toFixed(2),
        pv: rep.mud.pv.toFixed(2),
        yp: rep.mud.yp.toFixed(2),
        chemicalsAdded: rep.mud.chemicals,
        costUsd: rep.mud.cost.toFixed(2),
      });

      await db.insert(s.bhaComponents).values([
        { reportId: report.id, sortOrder: 1, component: 'PDC Bit 8.5in M19', odIn: '8.50', lengthM: '0.35', hours: '12.00' },
        { reportId: report.id, sortOrder: 2, component: 'MWD/LWD Sub (Gamma + Resistivity)', odIn: '6.75', lengthM: '9.20', hours: '12.00' },
        { reportId: report.id, sortOrder: 3, component: 'Drill Collar 6.5in x 3', odIn: '6.50', lengthM: '28.50', hours: '12.00' },
      ]);

      await db.insert(s.costLines).values(
        rep.costLines.map((c) => ({ reportId: report.id, wellId: well.id, ...c, amountUsd: c.amountUsd.toFixed(2) })),
      );

      await db.insert(s.surveyStations).values([
        { reportId: report.id, md: String(rep.depthMdStart), inclination: '12.40', azimuth: '145.20', tvd: String(rep.depthTvd) },
        { reportId: report.id, md: String(rep.depthMdEnd), inclination: '14.05', azimuth: '148.90', tvd: String(rep.depthTvd) },
      ]);

      console.log(`[seed] ${spec.name} DDR #${rep.reportNo} (${rep.reportDate}) - ${(agg.total / 60).toFixed(1)}h, NPT ${(agg.npt / 60).toFixed(1)}h, cost $${daily.toFixed(2)}, status ${rep.status}`);
    }
  }

  /* -------- safety incidents -------- */
  const incidentCount = await db.select({ n: sql<number>`count(*)::int` }).from(s.safetyIncidents);
  if (!incidentCount[0]?.n) {
    const anyReport = await db.select({ id: s.dailyReports.id }).from(s.dailyReports).limit(1);
    await db.insert(s.safetyIncidents).values([
      { reportId: anyReport[0]?.id ?? null, refNo: 'IR-2026-014', type: 'Near Miss - Dropped Object', severity: 'medium', occurredAt: new Date('2026-09-09T14:20:00Z'), location: 'Drill Floor, RIG-12', description: 'Wrench 1-7/16in fell from rotary table during BHA make-up. No injuries. Area cleared, toolbox meeting held.', immediateAction: 'Area isolated, visual inspection, housekeeping.', correctiveAction: 'Install secondary retention for all hand tools on drill floor; weekly audit.', assignee: 'Marcus Vance', dueDate: '2026-09-17', status: 'open' },
      { reportId: anyReport[0]?.id ?? null, refNo: 'IR-2026-011', type: 'First Aid Case', severity: 'low', occurredAt: new Date('2026-08-28T09:10:00Z'), location: 'Pipe Deck, RIG-08', description: 'Hand laceration during pipe handling. Treated on site, returned to duty.', immediateAction: 'First aid administered, incident logged.', correctiveAction: 'Refresher PPE training, glove replacement.', assignee: 'Budi Santoso', dueDate: '2026-09-05', status: 'closed' },
    ]);
    console.log('[seed] safety_incidents: 2 baris.');
  }

  /* -------- rate cards -------- */
  const rateCount = await db.select({ n: sql<number>`count(*)::int` }).from(s.rateCards);
  if (!rateCount[0]?.n) {
    const cards = [
      { code: '01', label: 'Rotary Drilling', tiers: [{ fromHour: 0, toHour: 12, ratePerHour: 1187.5, label: 'Standard 0-12h' }, { fromHour: 12, toHour: 24, ratePerHour: 1050, label: 'Extended 12-24h' }, { fromHour: 24, toHour: null, ratePerHour: 950, label: 'Deep day >24h' }] },
      { code: '09', label: 'Tripping', tiers: [{ fromHour: 0, toHour: null, ratePerHour: 1187.5, label: 'Operating rate' }] },
      { code: '08', label: 'Repair Rig', tiers: [{ fromHour: 0, toHour: 2, ratePerHour: 1187.5, label: 'First 2h full rate' }, { fromHour: 2, toHour: null, ratePerHour: 750, label: 'Repair rate after 2h' }] },
      { code: '27', label: 'Wait on Weather', tiers: [{ fromHour: 0, toHour: null, ratePerHour: 687.5, label: 'WOW rate (Cl. 14.2)' }] },
      { code: '14', label: 'Rig Service', tiers: [{ fromHour: 0, toHour: null, ratePerHour: 0, label: 'Non-chargeable' }] },
      { code: '10', label: 'Circulate & Condition', tiers: [{ fromHour: 0, toHour: null, ratePerHour: 1187.5, label: 'Operating rate' }] },
      { code: '11', label: 'Casing & Liner', tiers: [{ fromHour: 0, toHour: null, ratePerHour: 1187.5 }] },
      { code: '12', label: 'Cementing', tiers: [{ fromHour: 0, toHour: null, ratePerHour: 1187.5 }] },
      { code: '13', label: 'Logging', tiers: [{ fromHour: 0, toHour: null, ratePerHour: 1187.5 }] },
      { code: '16', label: 'Completion', tiers: [{ fromHour: 0, toHour: null, ratePerHour: 1187.5 }] },
      { code: '24', label: 'NPT', tiers: [{ fromHour: 0, toHour: null, ratePerHour: 900 }] },
    ];
    for (const c of cards) {
      await db.insert(s.rateCards).values({ rigId: rigs['RIG-12'], activityCode: c.code, label: c.label, tiers: c.tiers, effectiveDate: '2026-01-01' });
    }
    console.log(`[seed] rate_cards: ${cards.length} baris.`);
  }

  /* -------- distribution rules -------- */
  const ruleCount = await db.select({ n: sql<number>`count(*)::int` }).from(s.distributionRules);
  if (!ruleCount[0]?.n) {
    await db.insert(s.distributionRules).values([
      { name: 'DDR harian 07:00', reportType: 'ddr', recipientGroup: ['CompanyMan', 'DrillingEngineer', 'Viewer'], scheduleCron: '0 7 * * *', templateId: 'ddr-default', active: true },
      { name: 'Cost summary 08:00', reportType: 'cost', recipientGroup: ['CostController', 'Admin'], scheduleCron: '0 8 * * *', templateId: 'cost-default', active: true },
      { name: 'IADC time sheet 07:15', reportType: 'iadc', recipientGroup: ['CompanyMan', 'DrillingEngineer'], scheduleCron: '15 7 * * *', templateId: 'iadc-default', active: true },
    ]);
    console.log('[seed] distribution_rules: 3 baris.');
  }

  /* -------- sync devices -------- */
  const devCount = await db.select({ n: sql<number>`count(*)::int` }).from(s.syncDevices);
  if (!devCount[0]?.n) {
    await db.insert(s.syncDevices).values([
      { deviceId: 'RIG-12-LAPTOP', name: 'Rig 12 Doghouse Laptop', rigId: rigs['RIG-12'], kind: 'electron', active: true, lastSeenAt: new Date() },
      { deviceId: 'OFFICE-SRV-JKT', name: 'Office Server Jakarta', rigId: null, kind: 'office', active: true, lastSeenAt: new Date() },
      { deviceId: 'RIG-08-TABLET', name: 'Rig 08 Toolpusher Tablet', rigId: rigs['RIG-08'], kind: 'electron', active: true, lastSeenAt: new Date(Date.now() - 3 * 3600_000) },
    ]);
    console.log('[seed] sync_devices: 3 baris.');
  }

  /* -------- KPI definitions -------- */
  const kpiCount = await db.select({ n: sql<number>`count(*)::int` }).from(s.kpiDefinitions);
  if (!kpiCount[0]?.n) {
    await db.insert(s.kpiDefinitions).values([
      { name: 'NPT %', formula: '(npt_minutes + wow_minutes) / total_minutes * 100', category: 'efficiency', baseline: '5.0000', unit: '%', active: true },
      { name: 'Rig Uptime %', formula: '(productive_minutes + standby_minutes) / total_minutes * 100', category: 'efficiency', baseline: '95.0000', unit: '%', active: true },
      { name: 'Cost per Meter', formula: 'cost_daily_usd / progress_24h', category: 'cost', baseline: '4000.0000', unit: 'USD/m', active: true },
      { name: 'Rig Move Time (days)', formula: 'manual', category: 'logistics', baseline: '2.1000', unit: 'days', active: true },
    ]);
    console.log('[seed] kpi_definitions: 4 baris.');
  }

  console.log('\n[seed] SELESAI.');
  console.log('[seed] Sumur: ARUN-07 (NPT tinggi), ARUN-05 (efisien), ARUN-06 (completion)');
  console.log(`[seed] Login: admin@rigdaily.local / ${password}`);
}

function nptHigh(rep: ReportSpec): boolean {
  const agg = summarize(rep.timeRows);
  return agg.total > 0 && (agg.npt + agg.wow) / agg.total > 0.1;
}

if (require.main === module) {
  seed()
    .then(async () => { await closeDb(); process.exit(0); })
    .catch(async (err) => { console.error('[seed] GAGAL:', err); await closeDb().catch(() => undefined); process.exit(1); });
}
