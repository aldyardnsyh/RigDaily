/**
 * Seed data Well Engineering untuk 3 sumur demo.
 *
 * Mengisi:
 *  - `wells.well_code` (WELL ID) + `wells.division` (DIVISION)
 *  - `bits`            : riwayat matabor per sumur
 *  - `casing_designs`  : desain casing bertingkat
 *  - `cement_programs` : program penyemenan
 *
 * Angka disusun agar tiap sumur punya karakter berbeda dan realistis:
 *   ARUN-07 : drilling dalam, 5 bit, casing 4 section, 3 job semen
 *   ARUN-05 : drilling dangkal efisien, 3 bit (footage besar, ROP tinggi)
 *   ARUN-06 : completion, 2 bit, casing sudah terpasang penuh, 4 job semen
 *
 * Idempotent: update kolom wells, lalu hapus-lalu-isi bit/casing/cement
 * HANYA bila belum ada data (agar aman dijalankan berulang).
 *
 * Jalankan: npx tsx packages/database/src/seed-engineering.ts
 */
import { eq, sql } from 'drizzle-orm';
import { closeDb, db } from './client';
import * as s from './schema';

const WELL_META: Array<{ name: string; wellCode: string; division: string }> = [
  { name: 'ARUN-07', wellCode: 'ARN-07-DEV', division: 'Sumatera Operations' },
  { name: 'ARUN-05', wellCode: 'ARN-05-EXP', division: 'Sumatera Operations' },
  { name: 'ARUN-06', wellCode: 'ARN-06-DEV', division: 'North Aceh Development' },
];

type BitSeed = {
  bitNo: number;
  bitType: string;
  iadcBitCode: string;
  sizeIn: number;
  manufacturer: string;
  model: string;
  serialNo: string;
  nozzleCount: number;
  tfaIn2: number;
  depthInMd: number;
  depthOutMd: number;
  rotatingHours: number;
  dullGrade: string;
  status: 'active' | 'pulled' | 'available';
  notes: string;
};

const BITS: Record<string, BitSeed[]> = {
  'ARUN-07': [
    { bitNo: 1, bitType: 'PDC', iadcBitCode: 'M323', sizeIn: 12.25, manufacturer: 'Baker Hughes', model: 'Talon HD', serialNo: 'BH-TH-88214', nozzleCount: 7, tfaIn2: 0.392, depthInMd: 0, depthOutMd: 1450, rotatingHours: 68.5, dullGrade: '2-3-WT-A-E-I', status: 'pulled', notes: 'Section 12.25in selesai di 1450 m, bit masih layak rerun.' },
    { bitNo: 2, bitType: 'PDC', iadcBitCode: 'M422', sizeIn: 8.5, manufacturer: 'SLB', model: 'MDi616', serialNo: 'SLB-MD-41207', nozzleCount: 6, tfaIn2: 0.284, depthInMd: 1450, depthOutMd: 2205, rotatingHours: 82.0, dullGrade: '3-4-BT-A-E-I', status: 'pulled', notes: 'Chipped cutter pada blade 3, diganti karena ROP turun.' },
    { bitNo: 3, bitType: 'PDC', iadcBitCode: 'M433', sizeIn: 8.5, manufacturer: 'Halliburton', model: 'Cruzer', serialNo: 'HL-CZ-77451', nozzleCount: 7, tfaIn2: 0.312, depthInMd: 2205, depthOutMd: 2680, rotatingHours: 96.5, dullGrade: '2-2-CT-A-E-I', status: 'pulled', notes: 'Performa stabil, ROP 2.8 m/hr rata-rata.' },
    { bitNo: 4, bitType: 'PDC', iadcBitCode: 'M433', sizeIn: 8.5, manufacturer: 'NOV', model: 'Revelation', serialNo: 'NOV-RV-30118', nozzleCount: 7, tfaIn2: 0.318, depthInMd: 2680, depthOutMd: 2808, rotatingHours: 54.0, dullGrade: '4-4-BT-A-E-I', status: 'pulled', notes: 'Formasi keras, aus pada shoulder.' },
    { bitNo: 5, bitType: 'PDC', iadcBitCode: 'M323', sizeIn: 8.5, manufacturer: 'Baker Hughes', model: 'Talon Force', serialNo: 'BH-TF-90532', nozzleCount: 7, tfaIn2: 0.336, depthInMd: 2808, depthOutMd: 2845, rotatingHours: 22.5, dullGrade: 'NEW', status: 'active', notes: 'Bit aktif saat ini, 1.5h NPT karena pompa lumpur.' },
  ],
  'ARUN-05': [
    { bitNo: 1, bitType: 'PDC', iadcBitCode: 'S223', sizeIn: 12.25, manufacturer: 'SLB', model: 'MDi516', serialNo: 'SLB-MD-55201', nozzleCount: 8, tfaIn2: 0.412, depthInMd: 0, depthOutMd: 1620, rotatingHours: 54.0, dullGrade: '1-2-WT-A-E-I', status: 'pulled', notes: 'Formasi lunak, footage tinggi.' },
    { bitNo: 2, bitType: 'PDC', iadcBitCode: 'M322', sizeIn: 8.5, manufacturer: 'Halliburton', model: 'Cruzer', serialNo: 'HL-CZ-88014', nozzleCount: 6, tfaIn2: 0.276, depthInMd: 1620, depthOutMd: 2500, rotatingHours: 71.0, dullGrade: '2-2-WT-A-E-I', status: 'pulled', notes: 'ROP 3.4 m/hr, efisien.' },
    { bitNo: 3, bitType: 'PDC', iadcBitCode: 'M322', sizeIn: 8.5, manufacturer: 'NOV', model: 'Revelation', serialNo: 'NOV-RV-41007', nozzleCount: 6, tfaIn2: 0.284, depthInMd: 2500, depthOutMd: 2648, rotatingHours: 36.0, dullGrade: 'NEW', status: 'active', notes: 'Bit aktif, kondisi baik, LCM pill 1 jam.' },
  ],
  'ARUN-06': [
    { bitNo: 1, bitType: 'PDC', iadcBitCode: 'M323', sizeIn: 12.25, manufacturer: 'Baker Hughes', model: 'Talon HD', serialNo: 'BH-TH-71104', nozzleCount: 7, tfaIn2: 0.386, depthInMd: 0, depthOutMd: 2100, rotatingHours: 76.0, dullGrade: '2-3-WT-A-E-I', status: 'pulled', notes: 'Section intermediate selesai.' },
    { bitNo: 2, bitType: 'PDC', iadcBitCode: 'M433', sizeIn: 8.5, manufacturer: 'SLB', model: 'MDi616', serialNo: 'SLB-MD-60022', nozzleCount: 7, tfaIn2: 0.302, depthInMd: 2100, depthOutMd: 3100, rotatingHours: 118.0, dullGrade: '4-5-BT-A-E-I', status: 'pulled', notes: 'Selesai di TD 3100 m, sumur masuk fase completion.' },
  ],
};

type CasingSeed = {
  section: string;
  sizeIn: number;
  weightPpf: number;
  grade: string;
  connection: string;
  topMd: number;
  shoeMd: number;
  holeSizeIn: number;
  joints: number;
  cementRequired: boolean;
};

const CASING: Record<string, CasingSeed[]> = {
  'ARUN-07': [
    { section: 'conductor', sizeIn: 30, weightPpf: 309.7, grade: 'X-52', connection: 'STC', topMd: 0, shoeMd: 256, holeSizeIn: 36, joints: 21, cementRequired: true },
    { section: 'surface', sizeIn: 20, weightPpf: 133.0, grade: 'K-55', connection: 'BTC', topMd: 0, shoeMd: 896, holeSizeIn: 26, joints: 74, cementRequired: true },
    { section: 'intermediate', sizeIn: 13.375, weightPpf: 68.0, grade: 'L-80', connection: 'BTC', topMd: 0, shoeMd: 1984, holeSizeIn: 17.5, joints: 164, cementRequired: true },
    { section: 'production', sizeIn: 9.625, weightPpf: 47.0, grade: 'P-110', connection: 'Premium', topMd: 0, shoeMd: 2845, holeSizeIn: 12.25, joints: 236, cementRequired: true },
  ],
  'ARUN-05': [
    { section: 'conductor', sizeIn: 30, weightPpf: 309.7, grade: 'X-52', connection: 'STC', topMd: 0, shoeMd: 180, holeSizeIn: 36, joints: 15, cementRequired: true },
    { section: 'surface', sizeIn: 20, weightPpf: 133.0, grade: 'K-55', connection: 'BTC', topMd: 0, shoeMd: 720, holeSizeIn: 26, joints: 60, cementRequired: true },
    { section: 'intermediate', sizeIn: 13.375, weightPpf: 68.0, grade: 'L-80', connection: 'BTC', topMd: 0, shoeMd: 1620, holeSizeIn: 17.5, joints: 134, cementRequired: true },
    { section: 'production', sizeIn: 9.625, weightPpf: 47.0, grade: 'P-110', connection: 'Premium', topMd: 0, shoeMd: 2648, holeSizeIn: 12.25, joints: 220, cementRequired: true },
  ],
  'ARUN-06': [
    { section: 'conductor', sizeIn: 30, weightPpf: 309.7, grade: 'X-52', connection: 'STC', topMd: 0, shoeMd: 220, holeSizeIn: 36, joints: 18, cementRequired: true },
    { section: 'surface', sizeIn: 20, weightPpf: 133.0, grade: 'K-55', connection: 'BTC', topMd: 0, shoeMd: 810, holeSizeIn: 26, joints: 67, cementRequired: true },
    { section: 'intermediate', sizeIn: 13.375, weightPpf: 68.0, grade: 'L-80', connection: 'BTC', topMd: 0, shoeMd: 2100, holeSizeIn: 17.5, joints: 174, cementRequired: true },
    { section: 'production', sizeIn: 7.0, weightPpf: 32.0, grade: 'P-110', connection: 'Premium', topMd: 2100, shoeMd: 3100, holeSizeIn: 8.5, joints: 152, cementRequired: true },
  ],
};

type CementSeed = {
  section: string;
  jobType: string;
  slurryType: string;
  slurryDensityPpg: number;
  yieldFt3Sx: number;
  volumeBbl: number;
  sacksSx: number;
  mixWaterBbl: number;
  additive: string;
  plugBumpedPsi: number;
  topOfCementMd: number;
  evaluation: 'good' | 'partial' | 'poor' | 'unknown';
  status: 'planned' | 'executed' | 'cancelled';
  executedDate: string | null;
  plannedDate: string;
};

const CEMENT: Record<string, CementSeed[]> = {
  'ARUN-07': [
    { section: 'surface', jobType: 'primary', slurryType: 'Lead + Tail', slurryDensityPpg: 13.2, yieldFt3Sx: 1.18, volumeBbl: 320, sacksSx: 1450, mixWaterBbl: 168, additive: 'Retarder HR-25 0.3%, Fluid loss FL-33 0.5%', plugBumpedPsi: 850, topOfCementMd: 0, evaluation: 'good', status: 'executed', executedDate: '2026-08-06', plannedDate: '2026-08-06' },
    { section: 'intermediate', jobType: 'primary', slurryType: 'Lead + Tail', slurryDensityPpg: 14.0, yieldFt3Sx: 1.16, volumeBbl: 410, sacksSx: 1820, mixWaterBbl: 214, additive: 'Retarder HR-25 0.4%, Antifoam AF-10 0.1%', plugBumpedPsi: 1200, topOfCementMd: 0, evaluation: 'good', status: 'executed', executedDate: '2026-08-22', plannedDate: '2026-08-22' },
    { section: 'production', jobType: 'primary', slurryType: 'Tail only', slurryDensityPpg: 14.6, yieldFt3Sx: 1.14, volumeBbl: 180, sacksSx: 810, mixWaterBbl: 96, additive: 'Gasblock GB-7 1.0%, Fluid loss FL-33 0.6%', plugBumpedPsi: 1450, topOfCementMd: 0, evaluation: 'partial', status: 'executed', executedDate: '2026-09-02', plannedDate: '2026-09-02' },
  ],
  'ARUN-05': [
    { section: 'surface', jobType: 'primary', slurryType: 'Lead + Tail', slurryDensityPpg: 13.0, yieldFt3Sx: 1.18, volumeBbl: 260, sacksSx: 1180, mixWaterBbl: 138, additive: 'Retarder HR-25 0.3%', plugBumpedPsi: 780, topOfCementMd: 0, evaluation: 'good', status: 'executed', executedDate: '2026-07-18', plannedDate: '2026-07-18' },
    { section: 'intermediate', jobType: 'primary', slurryType: 'Lead + Tail', slurryDensityPpg: 13.8, yieldFt3Sx: 1.16, volumeBbl: 340, sacksSx: 1500, mixWaterBbl: 176, additive: 'Retarder HR-25 0.4%, Extender EX-9 0.8%', plugBumpedPsi: 1100, topOfCementMd: 0, evaluation: 'good', status: 'executed', executedDate: '2026-08-02', plannedDate: '2026-08-02' },
    { section: 'production', jobType: 'primary', slurryType: 'Tail only', slurryDensityPpg: 14.4, yieldFt3Sx: 1.14, volumeBbl: 165, sacksSx: 742, mixWaterBbl: 88, additive: 'Gasblock GB-7 1.0%', plugBumpedPsi: 1320, topOfCementMd: 0, evaluation: 'good', status: 'executed', executedDate: '2026-09-01', plannedDate: '2026-09-01' },
  ],
  'ARUN-06': [
    { section: 'surface', jobType: 'primary', slurryType: 'Lead + Tail', slurryDensityPpg: 13.1, yieldFt3Sx: 1.18, volumeBbl: 290, sacksSx: 1310, mixWaterBbl: 152, additive: 'Retarder HR-25 0.3%', plugBumpedPsi: 820, topOfCementMd: 0, evaluation: 'good', status: 'executed', executedDate: '2026-06-28', plannedDate: '2026-06-28' },
    { section: 'intermediate', jobType: 'primary', slurryType: 'Lead + Tail', slurryDensityPpg: 14.1, yieldFt3Sx: 1.16, volumeBbl: 390, sacksSx: 1720, mixWaterBbl: 202, additive: 'Retarder HR-25 0.4%, Fluid loss FL-33 0.5%', plugBumpedPsi: 1180, topOfCementMd: 0, evaluation: 'good', status: 'executed', executedDate: '2026-07-25', plannedDate: '2026-07-25' },
    { section: 'production', jobType: 'liner', slurryType: 'Single', slurryDensityPpg: 14.5, yieldFt3Sx: 1.14, volumeBbl: 160, sacksSx: 704, mixWaterBbl: 84, additive: 'Gasblock GB-7 1.0%, Antifoam AF-10 0.1%', plugBumpedPsi: 1380, topOfCementMd: 2100, evaluation: 'good', status: 'executed', executedDate: '2026-09-04', plannedDate: '2026-09-04' },
    { section: 'production', jobType: 'squeeze', slurryType: 'Micro-cement', slurryDensityPpg: 12.8, yieldFt3Sx: 1.22, volumeBbl: 42, sacksSx: 168, mixWaterBbl: 24, additive: 'Accelerator AC-12 0.5%', plugBumpedPsi: 2100, topOfCementMd: 2960, evaluation: 'unknown', status: 'planned', executedDate: null, plannedDate: '2026-10-25' },
  ],
};

async function hasRows(table: 'bits' | 'casing_designs' | 'cement_programs', wellId: string): Promise<boolean> {
  const res = await db.execute(
    sql`SELECT count(*)::int AS n FROM ${sql.raw(table)} WHERE well_id = ${wellId} AND deleted_at IS NULL`,
  );
  const rows = (res as unknown as { rows: Array<{ n: number }> }).rows;
  return (rows[0]?.n ?? 0) > 0;
}

export async function seedEngineering(): Promise<void> {
  // 1. WELL ID + DIVISION
  for (const meta of WELL_META) {
    await db
      .update(s.wells)
      .set({ wellCode: meta.wellCode, division: meta.division, updatedAt: new Date() })
      .where(eq(s.wells.name, meta.name));
    console.log(`[seed-eng] ${meta.name}: WELL ID ${meta.wellCode}, DIVISION ${meta.division}`);
  }

  // 2. Bits, casing, cement per sumur
  for (const meta of WELL_META) {
    const wellRows = await db.select({ id: s.wells.id }).from(s.wells).where(eq(s.wells.name, meta.name)).limit(1);
    const well = wellRows[0];
    if (!well) {
      console.warn(`[seed-eng] sumur ${meta.name} tidak ditemukan, dilewati.`);
      continue;
    }

    // bits
    if (!(await hasRows('bits', well.id))) {
      const list = BITS[meta.name] ?? [];
      if (list.length > 0) {
        await db.insert(s.bits).values(
          list.map((b) => ({
            wellId: well.id,
            bitNo: b.bitNo,
            bitType: b.bitType,
            iadcBitCode: b.iadcBitCode,
            sizeIn: String(b.sizeIn),
            manufacturer: b.manufacturer,
            model: b.model,
            serialNo: b.serialNo,
            nozzleCount: b.nozzleCount,
            tfaIn2: String(b.tfaIn2),
            depthInMd: String(b.depthInMd),
            depthOutMd: String(b.depthOutMd),
            rotatingHours: String(b.rotatingHours),
            footageM: String(round2(b.depthOutMd - b.depthInMd)),
            dullGrade: b.dullGrade,
            status: b.status,
            notes: b.notes,
          })),
        );
        console.log(`[seed-eng] ${meta.name}: ${list.length} bit`);
      }
    }

    // casing design
    if (!(await hasRows('casing_designs', well.id))) {
      const list = CASING[meta.name] ?? [];
      if (list.length > 0) {
        await db.insert(s.casingDesigns).values(
          list.map((c, i) => ({
            wellId: well.id,
            section: c.section,
            sortOrder: i + 1,
            sizeIn: String(c.sizeIn),
            weightPpf: String(c.weightPpf),
            grade: c.grade,
            connection: c.connection,
            topMd: String(c.topMd),
            shoeMd: String(c.shoeMd),
            holeSizeIn: String(c.holeSizeIn),
            joints: c.joints,
            cementRequired: c.cementRequired,
          })),
        );
        console.log(`[seed-eng] ${meta.name}: ${list.length} section casing`);
      }
    }

    // cement program
    if (!(await hasRows('cement_programs', well.id))) {
      const list = CEMENT[meta.name] ?? [];
      if (list.length > 0) {
        await db.insert(s.cementPrograms).values(
          list.map((c) => ({
            wellId: well.id,
            section: c.section,
            jobType: c.jobType,
            plannedDate: c.plannedDate,
            executedDate: c.executedDate,
            slurryType: c.slurryType,
            slurryDensityPpg: String(c.slurryDensityPpg),
            yieldFt3Sx: String(c.yieldFt3Sx),
            volumeBbl: String(c.volumeBbl),
            sacksSx: c.sacksSx,
            mixWaterBbl: String(c.mixWaterBbl),
            additive: c.additive,
            plugBumpedPsi: String(c.plugBumpedPsi),
            topOfCementMd: String(c.topOfCementMd),
            evaluation: c.evaluation,
            status: c.status,
          })),
        );
        console.log(`[seed-eng] ${meta.name}: ${list.length} job semen`);
      }
    }
  }

  console.log('\n[seed-eng] SELESAI.');
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

if (require.main === module) {
  seedEngineering()
    .then(async () => {
      await closeDb();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[seed-eng] GAGAL:', err);
      await closeDb().catch(() => undefined);
      process.exit(1);
    });
}
