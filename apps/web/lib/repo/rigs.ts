/**
 * Repository - Rigs.
 *
 * `activeReports` = jumlah DDR rig tersebut dalam 7 hari terakhir
 * (titik acuan: `max(hari ini, tanggal DDR terbaru)` - lihat shared.ts).
 */
import 'server-only';
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@rigdaily/database';
import type { RigDto } from './types';
import { reportCountsInWindow } from './shared';

function toDto(r: typeof schema.rigs.$inferSelect, counts: Map<string, number>): RigDto {
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    type: r.type,
    contractor: r.contractor,
    contractRef: r.contractRef,
    activeReports: counts.get(r.id) ?? 0,
  };
}

export async function listRigs(): Promise<RigDto[]> {
  const [rows, counts] = await Promise.all([
    db.select().from(schema.rigs).where(isNull(schema.rigs.deletedAt)).orderBy(asc(schema.rigs.name)),
    reportCountsInWindow(),
  ]);

  return rows.map((r) => toDto(r, counts));
}

export async function getRigById(id: string): Promise<RigDto | null> {
  const rows = await db
    .select()
    .from(schema.rigs)
    .where(and(eq(schema.rigs.id, id), isNull(schema.rigs.deletedAt)))
    .limit(1);

  const rig = rows[0];
  if (!rig) return null;

  const counts = await reportCountsInWindow();
  return toDto(rig, counts);
}

/* ------------------------------------------------------------------ */
/* CRUD rig (admin master data)                                        */
/* ------------------------------------------------------------------ */

export type RigCreateInput = {
  name: string;
  code?: string | null;
  type: string;
  contractor?: string | null;
  contractRef?: string | null;
};

export type RigPatchInput = {
  name?: string;
  code?: string | null;
  type?: string;
  contractor?: string | null;
  contractRef?: string | null;
};

/** `''`/spasi → null supaya kolom opsional benar-benar kosong di DB. */
function optionalText(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function createRig(input: RigCreateInput): Promise<{ id: string }> {
  const [row] = await db
    .insert(schema.rigs)
    .values({
      name: input.name.trim(),
      code: optionalText(input.code),
      type: input.type,
      contractor: optionalText(input.contractor),
      contractRef: optionalText(input.contractRef),
    })
    .returning({ id: schema.rigs.id });

  return { id: row.id };
}

/**
 * Ubah data rig. Mengembalikan `{ before, after }`; `before` null bila rig
 * tidak ada / sudah terhapus (route memetakan ke 404).
 */
export async function updateRig(
  id: string,
  patch: RigPatchInput,
): Promise<{ before: RigDto | null; after: RigDto | null }> {
  const before = await getRigById(id);
  if (!before) return { before: null, after: null };

  const set: Partial<typeof schema.rigs.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.code !== undefined) set.code = optionalText(patch.code);
  if (patch.type !== undefined) set.type = patch.type;
  if (patch.contractor !== undefined) set.contractor = optionalText(patch.contractor);
  if (patch.contractRef !== undefined) set.contractRef = optionalText(patch.contractRef);

  await db
    .update(schema.rigs)
    .set(set)
    .where(and(eq(schema.rigs.id, id), isNull(schema.rigs.deletedAt)));

  return { before, after: await getRigById(id) };
}

/**
 * Rincian pemakaian rig: jumlah DDR aktif + jumlah well (via DDR) + device sync
 * yang masih ter-assign. Dipakai route sebelum menolak hapus (409 `RIG_IN_USE`).
 */
export async function countRigUsage(rigId: string): Promise<{
  reports: number;
  wells: number;
  devices: number;
}> {
  const [reportRows, wellRows, deviceRows] = await Promise.all([
    db
      .select({ n: count() })
      .from(schema.dailyReports)
      .where(and(eq(schema.dailyReports.rigId, rigId), isNull(schema.dailyReports.deletedAt))),
    db
      .select({ n: count() })
      .from(schema.dailyReports)
      .where(and(eq(schema.dailyReports.rigId, rigId), isNull(schema.dailyReports.deletedAt)))
      .groupBy(schema.dailyReports.wellId),
    db
      .select({ n: count() })
      .from(schema.syncDevices)
      .where(and(eq(schema.syncDevices.rigId, rigId), isNull(schema.syncDevices.deletedAt))),
  ]);

  return {
    // `groupBy(wellId)` → satu baris per sumur, jadi panjang array = jumlah sumur.
    wells: wellRows.length,
    reports: Number(reportRows[0]?.n ?? 0),
    devices: Number(deviceRows[0]?.n ?? 0),
  };
}

/**
 * Soft delete rig. Mengembalikan data sebelum dihapus (`null` bila tidak ada).
 * Pemanggil WAJIB memeriksa `countRigUsage` lebih dulu - DDR/well tetap harus
 * punya rig yang valid untuk billing & tampilan.
 */
export async function softDeleteRig(id: string): Promise<RigDto | null> {
  const before = await getRigById(id);
  if (!before) return null;

  await db
    .update(schema.rigs)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.rigs.id, id), isNull(schema.rigs.deletedAt)));

  return before;
}
