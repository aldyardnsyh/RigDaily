// Tambah tabel bits, casingDesigns, cementPrograms ke schema.
const fs = require('fs');
const NL = String.fromCharCode(10);
const f = 'packages/database/src/schema/index.ts';
let t = fs.readFileSync(f, 'utf8');

const marker =
  '/* ------------------------------------------------------------------ */' +
  NL +
  '/* Relations                                                           */';
const idx = t.indexOf(marker);
if (idx === -1) {
  console.log('GAGAL: marker Relations tidak ditemukan');
  process.exit(1);
}
if (t.includes('export const bits = pgTable')) {
  console.log('tabel sudah ada');
  process.exit(0);
}

const Q = String.fromCharCode(39); // single quote

const block = [
  '/* ------------------------------------------------------------------ */',
  '/* Bit records (matabor)                                               */',
  '/* ------------------------------------------------------------------ */',
  '',
  '/**',
  ' * Riwayat bit per sumur. Satu baris = satu bit yang pernah dipakai.',
  ' * Dipakai halaman Bits untuk menghitung jam pakai, ROP rata-rata, dan',
  ' * kondisi akhir (dull grade) tiap matabor.',
  ' */',
  'export const bits = pgTable(',
  '  ' + Q + 'bits' + Q + ',',
  '  {',
  '    id: uuid(' + Q + 'id' + Q + ').primaryKey().defaultRandom(),',
  '    wellId: uuid(' + Q + 'well_id' + Q + ')',
  '      .notNull()',
  '      .references(() => wells.id),',
  '    reportId: uuid(' + Q + 'report_id' + Q + ').references(() => dailyReports.id, { onDelete: ' + Q + 'set null' + Q + ' }),',
  '    /** Nomor urut bit di sumur ini (Bit #1, #2, ...). */',
  '    bitNo: integer(' + Q + 'bit_no' + Q + ').notNull().default(1),',
  '    /** Jenis: PDC, tricone, impregnated, core, reamer. */',
  '    bitType: varchar(' + Q + 'bit_type' + Q + ', { length: 40 }).notNull().default(' + Q + 'PDC' + Q + '),',
  '    /** Kode IADC bit 4 karakter, mis. M323. */',
  '    iadcBitCode: varchar(' + Q + 'iadc_bit_code' + Q + ', { length: 12 }),',
  '    sizeIn: numeric(' + Q + 'size_in' + Q + ', { precision: 6, scale: 3 }),',
  '    manufacturer: varchar(' + Q + 'manufacturer' + Q + ', { length: 160 }),',
  '    model: varchar(' + Q + 'model' + Q + ', { length: 160 }),',
  '    serialNo: varchar(' + Q + 'serial_no' + Q + ', { length: 120 }),',
  '    /** Jumlah nozzle dan total flow area (in2). */',
  '    nozzleCount: integer(' + Q + 'nozzle_count' + Q + '),',
  '    tfaIn2: numeric(' + Q + 'tfa_in2' + Q + ', { precision: 6, scale: 3 }),',
  '    /** Kedalaman masuk dan keluar memakai bit ini (m MD). */',
  '    depthInMd: numeric(' + Q + 'depth_in_md' + Q + ', { precision: 10, scale: 2 }),',
  '    depthOutMd: numeric(' + Q + 'depth_out_md' + Q + ', { precision: 10, scale: 2 }),',
  '    /** Total jam putar dan footage yang dihasilkan. */',
  '    rotatingHours: numeric(' + Q + 'rotating_hours' + Q + ', { precision: 8, scale: 2 }),',
  '    footageM: numeric(' + Q + 'footage_m' + Q + ', { precision: 10, scale: 2 }),',
  '    /** Kondisi akhir: NEW, RR (rerun), atau dull grade IADC. */',
  '    dullGrade: varchar(' + Q + 'dull_grade' + Q + ', { length: 40 }),',
  '    status: varchar(' + Q + 'status' + Q + ', { length: 20 }).notNull().default(' + Q + 'active' + Q + '), // active|pulled|available',
  '    notes: text(' + Q + 'notes' + Q + '),',
  '    ...syncColumns,',
  '  },',
  '  (t) => ({',
  '    wellIdx: index(' + Q + 'bits_well_idx' + Q + ').on(t.wellId),',
  '    statusIdx: index(' + Q + 'bits_status_idx' + Q + ').on(t.status),',
  '  }),',
  ');',
  '',
  '/* ------------------------------------------------------------------ */',
  '/* Casing design                                                       */',
  '/* ------------------------------------------------------------------ */',
  '',
  '/** Satu baris = satu string/section casing pada desain sumur. */',
  'export const casingDesigns = pgTable(',
  '  ' + Q + 'casing_designs' + Q + ',',
  '  {',
  '    id: uuid(' + Q + 'id' + Q + ').primaryKey().defaultRandom(),',
  '    wellId: uuid(' + Q + 'well_id' + Q + ')',
  '      .notNull()',
  '      .references(() => wells.id),',
  '    /** conductor, surface, intermediate, production, liner. */',
  '    section: varchar(' + Q + 'section' + Q + ', { length: 40 }).notNull(),',
  '    sortOrder: integer(' + Q + 'sort_order' + Q + ').notNull().default(1),',
  '    /** Ukuran nominal inci, mis. 13.375. */',
  '    sizeIn: numeric(' + Q + 'size_in' + Q + ', { precision: 6, scale: 3 }).notNull(),',
  '    weightPpf: numeric(' + Q + 'weight_ppf' + Q + ', { precision: 8, scale: 2 }),',
  '    grade: varchar(' + Q + 'grade' + Q + ', { length: 40 }),',
  '    connection: varchar(' + Q + 'connection' + Q + ', { length: 60 }),',
  '    /** Kedalaman sepatu dan top section ini (m MD). */',
  '    shoeMd: numeric(' + Q + 'shoe_md' + Q + ', { precision: 10, scale: 2 }),',
  '    topMd: numeric(' + Q + 'top_md' + Q + ', { precision: 10, scale: 2 }),',
  '    holeSizeIn: numeric(' + Q + 'hole_size_in' + Q + ', { precision: 6, scale: 3 }),',
  '    joints: integer(' + Q + 'joints' + Q + '),',
  '    cementRequired: boolean(' + Q + 'cement_required' + Q + ').notNull().default(true),',
  '    notes: text(' + Q + 'notes' + Q + '),',
  '    ...syncColumns,',
  '  },',
  '  (t) => ({ wellIdx: index(' + Q + 'casing_well_idx' + Q + ').on(t.wellId) }),',
  ');',
  '',
  '/* ------------------------------------------------------------------ */',
  '/* Cement program                                                      */',
  '/* ------------------------------------------------------------------ */',
  '',
  '/** Program penyemenan per section. Satu baris = satu job semen. */',
  'export const cementPrograms = pgTable(',
  '  ' + Q + 'cement_programs' + Q + ',',
  '  {',
  '    id: uuid(' + Q + 'id' + Q + ').primaryKey().defaultRandom(),',
  '    wellId: uuid(' + Q + 'well_id' + Q + ')',
  '      .notNull()',
  '      .references(() => wells.id),',
  '    casingDesignId: uuid(' + Q + 'casing_design_id' + Q + ').references(() => casingDesigns.id, { onDelete: ' + Q + 'set null' + Q + ' }),',
  '    section: varchar(' + Q + 'section' + Q + ', { length: 40 }).notNull(),',
  '    jobType: varchar(' + Q + 'job_type' + Q + ', { length: 40 }).notNull().default(' + Q + 'primary' + Q + '), // primary|squeeze|plug|liner',
  '    plannedDate: date(' + Q + 'planned_date' + Q + '),',
  '    executedDate: date(' + Q + 'executed_date' + Q + '),',
  '    slurryType: varchar(' + Q + 'slurry_type' + Q + ', { length: 40 }),',
  '    slurryDensityPpg: numeric(' + Q + 'slurry_density_ppg' + Q + ', { precision: 6, scale: 3 }),',
  '    yieldFt3Sx: numeric(' + Q + 'yield_ft3_sx' + Q + ', { precision: 8, scale: 3 }),',
  '    volumeBbl: numeric(' + Q + 'volume_bbl' + Q + ', { precision: 10, scale: 2 }),',
  '    sacksSx: integer(' + Q + 'sacks_sx' + Q + '),',
  '    mixWaterBbl: numeric(' + Q + 'mix_water_bbl' + Q + ', { precision: 10, scale: 2 }),',
  '    additive: text(' + Q + 'additive' + Q + '),',
  '    plugBumpedPsi: numeric(' + Q + 'plug_bumped_psi' + Q + ', { precision: 10, scale: 2 }),',
  '    topOfCementMd: numeric(' + Q + 'top_of_cement_md' + Q + ', { precision: 10, scale: 2 }),',
  '    /** good | partial | poor | unknown. */',
  '    evaluation: varchar(' + Q + 'evaluation' + Q + ', { length: 20 }).default(' + Q + 'unknown' + Q + '),',
  '    status: varchar(' + Q + 'status' + Q + ', { length: 20 }).notNull().default(' + Q + 'planned' + Q + '), // planned|executed|cancelled',
  '    notes: text(' + Q + 'notes' + Q + '),',
  '    ...syncColumns,',
  '  },',
  '  (t) => ({ wellIdx: index(' + Q + 'cement_well_idx' + Q + ').on(t.wellId) }),',
  ');',
  '',
].join(NL);

t = t.slice(0, idx) + block + NL + t.slice(idx);
fs.writeFileSync(f, t, 'utf8');
console.log('OK: bits, casingDesigns, cementPrograms ditambahkan');
