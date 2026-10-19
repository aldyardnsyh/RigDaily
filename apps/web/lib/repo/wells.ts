/**
 * Repository - Wells (sumur).
 *
 * Well tidak punya kolom rig langsung: relasi rig & kedalaman terkini berasal
 * dari DDR terbaru untuk sumur tersebut.
 */
import 'server-only';
import { and, asc, count, desc, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@rigdaily/database';
import { round2 } from '@rigdaily/shared';
import type { WellDto, WellMilestone } from './types';
import { moneyOrNull, toNum, toNumOrNull } from './shared';

type WellRow = {
  well: typeof schema.wells.$inferSelect;
  fieldName: string | null;
};

type LatestInfo = { rigName: string | null; depthMd: number };

const wellColumns = { well: schema.wells, fieldName: schema.fields.name } as const;

function toWellDto(row: WellRow, latest: LatestInfo | undefined): WellDto {
  const w = row.well;
  const tdPlannedM = toNumOrNull(w.tdPlannedM);
  const latestDepthMd = latest ? latest.depthMd : null;
  const progressPercent =
    latestDepthMd !== null && tdPlannedM !== null && tdPlannedM > 0
      ? round2((latestDepthMd / tdPlannedM) * 100)
      : null;

  return {
    id: w.id,
    wellCode: w.wellCode,
    name: w.name,
    division: w.division,
    apiNo: w.apiNo,
    type: w.type,
    phase: w.phase,
    spudDate: w.spudDate,
    tdPlannedM,
    lat: toNumOrNull(w.lat),
    lon: toNumOrNull(w.lon),
    afeBudgetUsd: toNumOrNull(w.afeBudgetUsd),
    operator: w.operator,
    fieldName: row.fieldName,
    rigName: latest?.rigName ?? null,
    latestDepthMd,
    progressPercent,
  };
}

/**
 * Ambil DDR terbaru per well (rig + kedalaman) dalam satu query.
 *
 * Catatan: field `fields.name` di query well memakai left join; bila field
 * soft-deleted kita tetap tampilkan well (fieldName null) supaya sumur tidak
 * "hilang" dari daftar hanya karena field-nya dihapus.
 */
async function latestReportByWell(wellId?: string): Promise<Map<string, LatestInfo>> {
  const parts = [isNull(schema.dailyReports.deletedAt)];
  if (wellId) parts.push(eq(schema.dailyReports.wellId, wellId));

  const rows = await db
    .select({
      wellId: schema.dailyReports.wellId,
      reportDate: schema.dailyReports.reportDate,
      reportNo: schema.dailyReports.reportNo,
      revision: schema.dailyReports.revision,
      depthMdEnd: schema.dailyReports.depthMdEnd,
      rigName: schema.rigs.name,
    })
    .from(schema.dailyReports)
    .leftJoin(schema.rigs, eq(schema.dailyReports.rigId, schema.rigs.id))
    .where(and(...parts))
    .orderBy(
      desc(schema.dailyReports.reportDate),
      desc(schema.dailyReports.reportNo),
      desc(schema.dailyReports.revision),
    );

  const out = new Map<string, LatestInfo>();
  for (const r of rows) {
    if (out.has(r.wellId)) continue;
    out.set(r.wellId, { rigName: r.rigName, depthMd: toNum(r.depthMdEnd) });
  }
  return out;
}

async function selectWell(where: ReturnType<typeof eq> | undefined): Promise<WellRow | null> {
  const rows = await db
    .select(wellColumns)
    .from(schema.wells)
    .leftJoin(schema.fields, eq(schema.wells.fieldId, schema.fields.id))
    .where(and(isNull(schema.wells.deletedAt), where))
    .limit(1);
  return rows[0] ?? null;
}

export async function listWells(): Promise<WellDto[]> {
  const [rows, latest] = await Promise.all([
    db
      .select(wellColumns)
      .from(schema.wells)
      .leftJoin(schema.fields, eq(schema.wells.fieldId, schema.fields.id))
      .where(isNull(schema.wells.deletedAt))
      .orderBy(asc(schema.wells.name)),
    latestReportByWell(),
  ]);

  return rows.map((r) => toWellDto(r, latest.get(r.well.id)));
}

export async function getWellById(id: string): Promise<WellDto | null> {
  const row = await selectWell(eq(schema.wells.id, id));
  if (!row) return null;

  const latest = await latestReportByWell(row.well.id);
  return toWellDto(row, latest.get(row.well.id));
}

export async function getWellByName(name: string): Promise<WellDto | null> {
  const row = await selectWell(eq(schema.wells.name, name));
  if (!row) return null;

  const latest = await latestReportByWell(row.well.id);
  return toWellDto(row, latest.get(row.well.id));
}

export async function updateWell(
  id: string,
  patch: { phase?: string; tdPlannedM?: number | null; afeBudgetUsd?: number | null; operator?: string | null },
): Promise<void> {
  const set: Partial<typeof schema.wells.$inferInsert> = { updatedAt: new Date() };

  if (patch.phase !== undefined) set.phase = patch.phase;
  if (patch.tdPlannedM !== undefined) set.tdPlannedM = moneyOrNull(patch.tdPlannedM);
  if (patch.afeBudgetUsd !== undefined) set.afeBudgetUsd = moneyOrNull(patch.afeBudgetUsd);
  if (patch.operator !== undefined) set.operator = patch.operator;

  await db.update(schema.wells).set(set).where(and(eq(schema.wells.id, id), isNull(schema.wells.deletedAt)));
}

/* ------------------------------------------------------------------ */
/* Pembuatan & penghapusan sumur (admin well file)                     */
/* ------------------------------------------------------------------ */

export type WellCreateInput = {
  /** WELL ID: kode unik internal operator. */
  wellCode?: string | null;
  name: string;
  /** DIVISION: unit bisnis pemilik sumur. */
  division?: string | null;
  apiNo?: string | null;
  type: string;
  phase: string;
  /** YYYY-MM-DD */
  spudDate?: string | null;
  tdPlannedM?: number | null;
  afeBudgetUsd?: number | null;
  operator?: string | null;
  lat?: number | null;
  lon?: number | null;
  fieldId?: string | null;
};

/**
 * Buat sumur baru. Nilai `undefined`/`null` disimpan sebagai NULL sehingga
 * form admin bisa mengosongkan kolom opsional.
 *
 * Uniknya nama sumur TIDAK dijamin DB; pemanggil boleh memakai `getWellByName`
 * untuk mencegah duplikasi yang membingungkan di well file.
 */
export async function createWell(input: WellCreateInput): Promise<{ id: string }> {
  const [row] = await db
    .insert(schema.wells)
    .values({
      name: input.name.trim(),
      apiNo: input.apiNo?.trim() || null,
      wellCode: input.wellCode?.trim() || null,
      division: input.division?.trim() || null,
      type: input.type,
      phase: input.phase,
      spudDate: input.spudDate ?? null,
      tdPlannedM: moneyOrNull(input.tdPlannedM ?? null),
      afeBudgetUsd: moneyOrNull(input.afeBudgetUsd ?? null),
      operator: input.operator?.trim() || null,
      lat: moneyOrNull(input.lat ?? null),
      lon: moneyOrNull(input.lon ?? null),
      fieldId: input.fieldId ?? null,
    })
    .returning({ id: schema.wells.id });

  return { id: row.id };
}

/**
 * Perluas patch sumur dari form admin (semua kolom well file yang boleh diubah
 * lewat API). `updateWell` versi ringkas di atas dipertahankan untuk pemanggil
 * lama (halaman well file) - fungsi ini hanya membungkus kolom tambahan.
 */
export async function updateWellDetails(
  id: string,
  patch: {
    wellCode?: string | null;
    name?: string;
    division?: string | null;
    apiNo?: string | null;
    type?: string;
    phase?: string;
    spudDate?: string | null;
    tdPlannedM?: number | null;
    afeBudgetUsd?: number | null;
    operator?: string | null;
    lat?: number | null;
    lon?: number | null;
    fieldId?: string | null;
  },
): Promise<void> {
  const set: Partial<typeof schema.wells.$inferInsert> = { updatedAt: new Date() };

  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.apiNo !== undefined) set.apiNo = patch.apiNo?.trim() || null;
  if (patch.type !== undefined) set.type = patch.type;
  if (patch.phase !== undefined) set.phase = patch.phase;
  if (patch.spudDate !== undefined) set.spudDate = patch.spudDate;
  if (patch.tdPlannedM !== undefined) set.tdPlannedM = moneyOrNull(patch.tdPlannedM);
  if (patch.afeBudgetUsd !== undefined) set.afeBudgetUsd = moneyOrNull(patch.afeBudgetUsd);
  if (patch.operator !== undefined) set.operator = patch.operator?.trim() || null;
  if (patch.lat !== undefined) set.lat = moneyOrNull(patch.lat);
  if (patch.lon !== undefined) set.lon = moneyOrNull(patch.lon);
  if (patch.fieldId !== undefined) set.fieldId = patch.fieldId;

  await db.update(schema.wells).set(set).where(and(eq(schema.wells.id, id), isNull(schema.wells.deletedAt)));
}

/** Jumlah DDR aktif (belum dihapus) milik satu sumur. */
export async function countReportsForWell(wellId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(schema.dailyReports)
    .where(and(eq(schema.dailyReports.wellId, wellId), isNull(schema.dailyReports.deletedAt)));

  return Number(rows[0]?.n ?? 0);
}

/**
 * Soft delete sumur. Mengembalikan `false` bila sumur tidak ada / sudah terhapus.
 * Pemanggil WAJIB menolak lebih dulu bila masih ada DDR aktif
 * (`countReportsForWell`) - DDR tanpa sumur akan merusak laporan & billing.
 */
export async function softDeleteWell(id: string): Promise<boolean> {
  const rows = await db
    .update(schema.wells)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.wells.id, id), isNull(schema.wells.deletedAt)))
    .returning({ id: schema.wells.id });

  return rows.length > 0;
}

/**
 * Milestone sumur - DITURUNKAN dari data yang ada (tidak ada tabel milestone):
 *
 * 1. Spud            → `spud_date` (done bila sudah diisi).
 * 2. Laporan DDR     → tanggal DDR terakhir untuk sumur ini (done).
 * 3. Progres TD      → kedalaman terkini vs TD planned (active selama pengeboran).
 * 4. Target TD       → kedalaman TD planned (planned, atau done bila phase closed).
 */
export async function getWellMilestones(wellId: string): Promise<WellMilestone[]> {
  const wellRows = await db
    .select()
    .from(schema.wells)
    .where(and(eq(schema.wells.id, wellId), isNull(schema.wells.deletedAt)))
    .limit(1);

  const well = wellRows[0];
  if (!well) return [];

  const latestRows = await db
    .select({
      reportDate: schema.dailyReports.reportDate,
      depthMdEnd: schema.dailyReports.depthMdEnd,
    })
    .from(schema.dailyReports)
    .where(and(eq(schema.dailyReports.wellId, wellId), isNull(schema.dailyReports.deletedAt)))
    .orderBy(
      desc(schema.dailyReports.reportDate),
      desc(schema.dailyReports.reportNo),
      desc(schema.dailyReports.revision),
    )
    .limit(1);

  const latest = latestRows[0] ?? null;
  const latestDepth = latest ? toNum(latest.depthMdEnd) : null;
  const tdPlannedM = toNumOrNull(well.tdPlannedM);
  const isClosed = well.phase === 'closed';

  const milestones: WellMilestone[] = [];

  milestones.push({
    label: 'Spud',
    date: well.spudDate,
    status: well.spudDate ? 'done' : 'planned',
  });

  if (latest) {
    milestones.push({
      label: `Laporan terakhir (depth ${latestDepth ?? 0} m)`,
      date: latest.reportDate,
      status: 'done',
    });
  }

  if (latestDepth !== null) {
    const done = isClosed || (tdPlannedM !== null && tdPlannedM > 0 && latestDepth >= tdPlannedM);
    milestones.push({
      label: 'Progres TD',
      date: latest?.reportDate ?? null,
      status: done ? 'done' : 'active',
      depthM: latestDepth,
    });
  }

  if (tdPlannedM !== null) {
    milestones.push({
      label: 'Target TD',
      date: null,
      status: isClosed ? 'done' : 'planned',
      depthM: tdPlannedM,
    });
  }

  return milestones;
}
