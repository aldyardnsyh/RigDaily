/**
 * Repository - Data engineering per sumur: bit (matabor), desain casing, dan
 * program semen.
 *
 * SATU-SATUNYA tempat query Drizzle untuk tabel `bits`, `casing_designs`, dan
 * `cement_programs`. Route handler memanggil fungsi di sini lewat barrel
 * `@/lib/repo` (server-only).
 *
 * Konvensi (lihat docs/KONTRAK-FROZEN.md §3):
 * - `numeric` (string) → `number` lewat `toNum` / `toNumOrNull`.
 * - `date` → `YYYY-MM-DD`, teks dibersihkan dengan `cleanTextOrNull`.
 * - Semua list memfilter `deletedAt IS NULL` (soft delete).
 * - `replaceCasingDesign` = hard delete + insert ulang dalam satu transaksi,
 *   sama seperti `replaceMac`/`replaceTimeRows`, agar tidak ada baris "yatim".
 */
import 'server-only';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@rigdaily/database';
import { round2 } from '@rigdaily/shared';
import { cleanTextOrNull, moneyOrNull, toNum, toNumOrNull } from './shared';

/* ------------------------------------------------------------------ */
/* Bit records                                                         */
/* ------------------------------------------------------------------ */

export type BitDto = {
  id: string;
  wellId: string;
  bitNo: number;
  /** PDC | tricone | impregnated | core | reamer */
  bitType: string;
  iadcBitCode: string | null;
  sizeIn: number | null;
  manufacturer: string | null;
  model: string | null;
  serialNo: string | null;
  nozzleCount: number | null;
  tfaIn2: number | null;
  depthInMd: number | null;
  depthOutMd: number | null;
  rotatingHours: number;
  footageM: number;
  dullGrade: string | null;
  /** active | pulled | available */
  status: string;
  notes: string | null;
  reportId: string | null;
  /** ISO string */
  createdAt: string;
};

export type BitInput = {
  reportId?: string | null;
  bitNo?: number;
  bitType?: string;
  iadcBitCode?: string | null;
  sizeIn?: number | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNo?: string | null;
  nozzleCount?: number | null;
  tfaIn2?: number | null;
  depthInMd?: number | null;
  depthOutMd?: number | null;
  rotatingHours?: number | null;
  footageM?: number | null;
  dullGrade?: string | null;
  status?: string;
  notes?: string | null;
};

export type BitPatch = Partial<BitInput>;

export type BitSummary = {
  totalBits: number;
  totalHours: number;
  totalFootage: number;
  avgRopMhr: number;
  activeBitNo: number | null;
};

/** Bit tanpa nomor / nomor tidak wajar tetap tampil urut paling akhir. */
function safeBitNo(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

function toBitDto(b: typeof schema.bits.$inferSelect): BitDto {
  return {
    id: b.id,
    wellId: b.wellId,
    bitNo: safeBitNo(b.bitNo),
    bitType: b.bitType,
    iadcBitCode: cleanTextOrNull(b.iadcBitCode),
    sizeIn: toNumOrNull(b.sizeIn),
    manufacturer: cleanTextOrNull(b.manufacturer),
    model: cleanTextOrNull(b.model),
    serialNo: cleanTextOrNull(b.serialNo),
    nozzleCount: b.nozzleCount ?? null,
    tfaIn2: toNumOrNull(b.tfaIn2),
    depthInMd: toNumOrNull(b.depthInMd),
    depthOutMd: toNumOrNull(b.depthOutMd),
    rotatingHours: toNum(b.rotatingHours),
    footageM: toNum(b.footageM),
    dullGrade: cleanTextOrNull(b.dullGrade),
    status: b.status,
    notes: cleanTextOrNull(b.notes),
    reportId: b.reportId,
    createdAt: b.createdAt.toISOString(),
  };
}

/** Daftar bit satu sumur, urut nomor bit (Bit #1 di atas). */
export async function listBits(wellId: string): Promise<BitDto[]> {
  const rows = await db
    .select()
    .from(schema.bits)
    .where(and(eq(schema.bits.wellId, wellId), isNull(schema.bits.deletedAt)))
    .orderBy(asc(schema.bits.bitNo), asc(schema.bits.createdAt));

  return rows.map(toBitDto);
}

/**
 * Nomor bit berikutnya = maksimum `bitNo` aktif + 1.
 *
 * Termasuk baris soft-deleted TIDAK dihitung: nomor bit adalah urutan pemakaian
 * di sumur, jadi menghapus catatan keliru boleh memakai ulang nomornya.
 */
export async function nextBitNo(wellId: string): Promise<number> {
  const rows = await db
    .select({ bitNo: schema.bits.bitNo })
    .from(schema.bits)
    .where(and(eq(schema.bits.wellId, wellId), isNull(schema.bits.deletedAt)));

  let max = 0;
  for (const r of rows) max = Math.max(max, safeBitNo(r.bitNo));
  return max + 1;
}

export async function createBit(wellId: string, input: BitInput): Promise<{ id: string; bitNo: number }> {
  const bitNo = input.bitNo !== undefined ? safeBitNo(input.bitNo) : await nextBitNo(wellId);

  const [row] = await db
    .insert(schema.bits)
    .values({
      wellId,
      reportId: input.reportId ?? null,
      bitNo,
      bitType: input.bitType ?? 'PDC',
      iadcBitCode: input.iadcBitCode ?? null,
      sizeIn: moneyOrNull(input.sizeIn ?? null),
      manufacturer: input.manufacturer ?? null,
      model: input.model ?? null,
      serialNo: input.serialNo ?? null,
      nozzleCount: input.nozzleCount ?? null,
      tfaIn2: moneyOrNull(input.tfaIn2 ?? null),
      depthInMd: moneyOrNull(input.depthInMd ?? null),
      depthOutMd: moneyOrNull(input.depthOutMd ?? null),
      rotatingHours: moneyOrNull(input.rotatingHours ?? null),
      footageM: moneyOrNull(input.footageM ?? null),
      dullGrade: input.dullGrade ?? null,
      status: input.status ?? 'active',
      notes: input.notes ?? null,
    })
    .returning({ id: schema.bits.id, bitNo: schema.bits.bitNo });

  return { id: row.id, bitNo: safeBitNo(row.bitNo) };
}

/**
 * Patch sebagian kolom bit. `wellId` dan `reportId` tidak bisa dipindah lewat
 * patch (relasi permanen); nilai `undefined` diabaikan.
 */
export async function updateBit(id: string, patch: BitPatch): Promise<void> {
  const set: Partial<typeof schema.bits.$inferInsert> = { updatedAt: new Date() };

  if (patch.bitNo !== undefined) set.bitNo = safeBitNo(patch.bitNo);
  if (patch.bitType !== undefined) set.bitType = patch.bitType;
  if (patch.iadcBitCode !== undefined) set.iadcBitCode = patch.iadcBitCode;
  if (patch.sizeIn !== undefined) set.sizeIn = moneyOrNull(patch.sizeIn);
  if (patch.manufacturer !== undefined) set.manufacturer = patch.manufacturer;
  if (patch.model !== undefined) set.model = patch.model;
  if (patch.serialNo !== undefined) set.serialNo = patch.serialNo;
  if (patch.nozzleCount !== undefined) set.nozzleCount = patch.nozzleCount;
  if (patch.tfaIn2 !== undefined) set.tfaIn2 = moneyOrNull(patch.tfaIn2);
  if (patch.depthInMd !== undefined) set.depthInMd = moneyOrNull(patch.depthInMd);
  if (patch.depthOutMd !== undefined) set.depthOutMd = moneyOrNull(patch.depthOutMd);
  if (patch.rotatingHours !== undefined) set.rotatingHours = moneyOrNull(patch.rotatingHours);
  if (patch.footageM !== undefined) set.footageM = moneyOrNull(patch.footageM);
  if (patch.dullGrade !== undefined) set.dullGrade = patch.dullGrade;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.notes !== undefined) set.notes = patch.notes;

  await db
    .update(schema.bits)
    .set(set)
    .where(and(eq(schema.bits.id, id), isNull(schema.bits.deletedAt)));
}

/** Soft delete satu bit. `false` bila tidak ada / sudah terhapus. */
export async function softDeleteBit(id: string): Promise<boolean> {
  const rows = await db
    .update(schema.bits)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.bits.id, id), isNull(schema.bits.deletedAt)))
    .returning({ id: schema.bits.id });

  return rows.length > 0;
}

/**
 * Ringkasan bit satu sumur:
 * - `totalBits`  : jumlah bit aktif (belum dihapus).
 * - `totalHours` : akumulasi `rotatingHours`.
 * - `totalFootage`: akumulasi `footageM`.
 * - `avgRopMhr`  : total footage / total jam putar (rate of penetration rata-rata).
 * - `activeBitNo`: nomor bit berstatus `active` (bit yang masih di lubang).
 */
export async function getBitSummary(wellId: string): Promise<BitSummary> {
  const items = await listBits(wellId);

  let totalHours = 0;
  let totalFootage = 0;
  let activeBitNo: number | null = null;

  for (const b of items) {
    totalHours += b.rotatingHours;
    totalFootage += b.footageM;
    if (activeBitNo === null && b.status === 'active') activeBitNo = b.bitNo;
  }

  return {
    totalBits: items.length,
    totalHours: round2(totalHours),
    totalFootage: round2(totalFootage),
    avgRopMhr: totalHours > 0 ? round2(totalFootage / totalHours) : 0,
    activeBitNo,
  };
}

/* ------------------------------------------------------------------ */
/* Casing design                                                       */
/* ------------------------------------------------------------------ */

export type CasingDto = {
  id: string;
  wellId: string;
  /** conductor | surface | intermediate | production | liner */
  section: string;
  sortOrder: number;
  sizeIn: number;
  weightPpf: number | null;
  grade: string | null;
  connection: string | null;
  shoeMd: number | null;
  topMd: number | null;
  holeSizeIn: number | null;
  joints: number | null;
  cementRequired: boolean;
  notes: string | null;
};

export type CasingItemInput = Omit<CasingDto, 'id' | 'wellId'>;

function toCasingDto(c: typeof schema.casingDesigns.$inferSelect): CasingDto {
  return {
    id: c.id,
    wellId: c.wellId,
    section: c.section,
    sortOrder: c.sortOrder,
    sizeIn: toNum(c.sizeIn),
    weightPpf: toNumOrNull(c.weightPpf),
    grade: cleanTextOrNull(c.grade),
    connection: cleanTextOrNull(c.connection),
    shoeMd: toNumOrNull(c.shoeMd),
    topMd: toNumOrNull(c.topMd),
    holeSizeIn: toNumOrNull(c.holeSizeIn),
    joints: c.joints ?? null,
    cementRequired: c.cementRequired,
    notes: cleanTextOrNull(c.notes),
  };
}

/** Desain casing satu sumur, urut `sortOrder` (shoe dangkal -> dalam). */
export async function listCasingDesign(wellId: string): Promise<CasingDto[]> {
  const rows = await db
    .select()
    .from(schema.casingDesigns)
    .where(and(eq(schema.casingDesigns.wellId, wellId), isNull(schema.casingDesigns.deletedAt)))
    .orderBy(asc(schema.casingDesigns.sortOrder), asc(schema.casingDesigns.createdAt));

  return rows.map(toCasingDto);
}

/**
 * Ganti SELURUH desain casing satu sumur (hard delete + insert ulang) dalam
 * satu transaksi. Urutan baris mengikuti `sortOrder` yang dikirim; bila tidak
 * diisi, dipakai posisi array (1..n) supaya tabel tetap deterministik.
 */
export async function replaceCasingDesign(wellId: string, items: CasingItemInput[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(schema.casingDesigns).where(eq(schema.casingDesigns.wellId, wellId));

    if (items.length > 0) {
      await tx.insert(schema.casingDesigns).values(
        items.map((c, index) => ({
          wellId,
          section: c.section,
          sortOrder: Number.isFinite(c.sortOrder) && c.sortOrder > 0 ? Math.trunc(c.sortOrder) : index + 1,
          // sizeIn NOT NULL di schema: nilai kosong disimpan 0 agar baris tetap valid.
          sizeIn: moneyOrNull(c.sizeIn) ?? '0.00',
          weightPpf: moneyOrNull(c.weightPpf),
          grade: c.grade,
          connection: c.connection,
          shoeMd: moneyOrNull(c.shoeMd),
          topMd: moneyOrNull(c.topMd),
          holeSizeIn: moneyOrNull(c.holeSizeIn),
          joints: c.joints,
          cementRequired: c.cementRequired,
          notes: c.notes,
        })),
      );
    }

    await tx.update(schema.wells).set({ updatedAt: new Date() }).where(eq(schema.wells.id, wellId));
  });
}

/* ------------------------------------------------------------------ */
/* Cement programs                                                     */
/* ------------------------------------------------------------------ */

export type CementDto = {
  id: string;
  wellId: string;
  casingDesignId: string | null;
  section: string;
  /** primary | squeeze | plug | liner */
  jobType: string;
  /** YYYY-MM-DD */
  plannedDate: string | null;
  /** YYYY-MM-DD */
  executedDate: string | null;
  slurryType: string | null;
  slurryDensityPpg: number | null;
  yieldFt3Sx: number | null;
  volumeBbl: number | null;
  sacksSx: number | null;
  mixWaterBbl: number | null;
  additive: string | null;
  plugBumpedPsi: number | null;
  topOfCementMd: number | null;
  /** good | partial | poor | unknown */
  evaluation: string;
  /** planned | executed | cancelled */
  status: string;
  notes: string | null;
};

export type CementInput = {
  casingDesignId?: string | null;
  section: string;
  jobType?: string;
  plannedDate?: string | null;
  executedDate?: string | null;
  slurryType?: string | null;
  slurryDensityPpg?: number | null;
  yieldFt3Sx?: number | null;
  volumeBbl?: number | null;
  sacksSx?: number | null;
  mixWaterBbl?: number | null;
  additive?: string | null;
  plugBumpedPsi?: number | null;
  topOfCementMd?: number | null;
  evaluation?: string;
  status?: string;
  notes?: string | null;
};

export type CementPatch = Partial<CementInput>;

function toCementDto(c: typeof schema.cementPrograms.$inferSelect): CementDto {
  return {
    id: c.id,
    wellId: c.wellId,
    casingDesignId: c.casingDesignId,
    section: c.section,
    jobType: c.jobType,
    plannedDate: c.plannedDate,
    executedDate: c.executedDate,
    slurryType: cleanTextOrNull(c.slurryType),
    slurryDensityPpg: toNumOrNull(c.slurryDensityPpg),
    yieldFt3Sx: toNumOrNull(c.yieldFt3Sx),
    volumeBbl: toNumOrNull(c.volumeBbl),
    sacksSx: c.sacksSx ?? null,
    mixWaterBbl: toNumOrNull(c.mixWaterBbl),
    additive: cleanTextOrNull(c.additive),
    plugBumpedPsi: toNumOrNull(c.plugBumpedPsi),
    topOfCementMd: toNumOrNull(c.topOfCementMd),
    evaluation: c.evaluation ?? 'unknown',
    status: c.status,
    notes: cleanTextOrNull(c.notes),
  };
}

/**
 * Program semen satu sumur. Urut tanggal rencana terbaru dulu, lalu dibuat.
 * Baris tanpa tanggal rencana diletakkan terakhir.
 */
export async function listCementPrograms(wellId: string): Promise<CementDto[]> {
  const rows = await db
    .select()
    .from(schema.cementPrograms)
    .where(and(eq(schema.cementPrograms.wellId, wellId), isNull(schema.cementPrograms.deletedAt)))
    .orderBy(asc(schema.cementPrograms.plannedDate), asc(schema.cementPrograms.createdAt));

  return rows.map(toCementDto);
}

export async function createCementProgram(wellId: string, input: CementInput): Promise<{ id: string }> {
  const [row] = await db
    .insert(schema.cementPrograms)
    .values({
      wellId,
      casingDesignId: input.casingDesignId ?? null,
      section: input.section,
      jobType: input.jobType ?? 'primary',
      plannedDate: input.plannedDate ?? null,
      executedDate: input.executedDate ?? null,
      slurryType: input.slurryType ?? null,
      slurryDensityPpg: moneyOrNull(input.slurryDensityPpg ?? null),
      yieldFt3Sx: moneyOrNull(input.yieldFt3Sx ?? null),
      volumeBbl: moneyOrNull(input.volumeBbl ?? null),
      sacksSx: input.sacksSx ?? null,
      mixWaterBbl: moneyOrNull(input.mixWaterBbl ?? null),
      additive: input.additive ?? null,
      plugBumpedPsi: moneyOrNull(input.plugBumpedPsi ?? null),
      topOfCementMd: moneyOrNull(input.topOfCementMd ?? null),
      evaluation: input.evaluation ?? 'unknown',
      status: input.status ?? 'planned',
      notes: input.notes ?? null,
    })
    .returning({ id: schema.cementPrograms.id });

  return { id: row.id };
}

/** Patch sebagian kolom job semen. `wellId` tidak bisa dipindah lewat patch. */
export async function updateCementProgram(id: string, patch: CementPatch): Promise<void> {
  const set: Partial<typeof schema.cementPrograms.$inferInsert> = { updatedAt: new Date() };

  if (patch.casingDesignId !== undefined) set.casingDesignId = patch.casingDesignId;
  if (patch.section !== undefined) set.section = patch.section;
  if (patch.jobType !== undefined) set.jobType = patch.jobType;
  if (patch.plannedDate !== undefined) set.plannedDate = patch.plannedDate;
  if (patch.executedDate !== undefined) set.executedDate = patch.executedDate;
  if (patch.slurryType !== undefined) set.slurryType = patch.slurryType;
  if (patch.slurryDensityPpg !== undefined) set.slurryDensityPpg = moneyOrNull(patch.slurryDensityPpg);
  if (patch.yieldFt3Sx !== undefined) set.yieldFt3Sx = moneyOrNull(patch.yieldFt3Sx);
  if (patch.volumeBbl !== undefined) set.volumeBbl = moneyOrNull(patch.volumeBbl);
  if (patch.sacksSx !== undefined) set.sacksSx = patch.sacksSx;
  if (patch.mixWaterBbl !== undefined) set.mixWaterBbl = moneyOrNull(patch.mixWaterBbl);
  if (patch.additive !== undefined) set.additive = patch.additive;
  if (patch.plugBumpedPsi !== undefined) set.plugBumpedPsi = moneyOrNull(patch.plugBumpedPsi);
  if (patch.topOfCementMd !== undefined) set.topOfCementMd = moneyOrNull(patch.topOfCementMd);
  if (patch.evaluation !== undefined) set.evaluation = patch.evaluation;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.notes !== undefined) set.notes = patch.notes;

  await db
    .update(schema.cementPrograms)
    .set(set)
    .where(and(eq(schema.cementPrograms.id, id), isNull(schema.cementPrograms.deletedAt)));
}

/** Soft delete satu job semen. `false` bila tidak ada / sudah terhapus. */
export async function softDeleteCementProgram(id: string): Promise<boolean> {
  const rows = await db
    .update(schema.cementPrograms)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.cementPrograms.id, id), isNull(schema.cementPrograms.deletedAt)))
    .returning({ id: schema.cementPrograms.id });

  return rows.length > 0;
}
