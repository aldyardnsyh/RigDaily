/**
 * Repository - Personnel / POB (Person On Board).
 *
 * Sumber angka POB adalah `crew_members` per DDR. Karena crew menempel pada
 * laporan (bukan tabel personel global), daftar POB selalu dipotong rentang
 * tanggal/sumur/laporan supaya bermakna pada mustering harian.
 *
 * Konvensi (lihat docs/KONTRAK-FROZEN.md §3):
 * - `numeric` → `number`, `date` → `YYYY-MM-DD`.
 * - Semua query memfilter `deletedAt IS NULL` (soft delete) untuk crew maupun
 *   laporan induknya - crew dari laporan yang dihapus tidak boleh muncul.
 */
import 'server-only';
import { and, asc, desc, eq, gte, isNull, lte } from 'drizzle-orm';
import { db, schema } from '@rigdaily/database';
import { round2 } from '@rigdaily/shared';
import { money, toNum } from './shared';

/* ------------------------------------------------------------------ */
/* Tipe                                                                */
/* ------------------------------------------------------------------ */

export type PersonnelDto = {
  id: string;
  name: string;
  position: string;
  company: string | null;
  shift: string;
  hours: number;
  pobStatus: string;
  musterStation: string | null;
  reportId: string;
  reportDate: string;
};

export type PobSummary = {
  total: number;
  inCount: number;
  outCount: number;
  manHours: number;
  byCompany: Array<{ company: string; count: number }>;
  byMuster: Array<{ station: string; count: number }>;
};

export type PersonnelFilter = {
  rigId?: string;
  wellId?: string;
  reportId?: string;
  /** YYYY-MM-DD (inklusif) */
  from?: string;
  /** YYYY-MM-DD (inklusif) */
  to?: string;
  limit?: number;
};

/* ------------------------------------------------------------------ */
/* Query                                                               */
/* ------------------------------------------------------------------ */

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

type CrewRow = {
  id: string;
  name: string;
  position: string;
  company: string | null;
  shift: string;
  hours: string;
  pobStatus: string;
  musterStation: string | null;
  reportId: string;
  reportDate: string;
};

/**
 * Daftar crew/POB dengan filter opsional. Urut: laporan terbaru dulu, lalu nama.
 *
 * Catatan: `limit` di sini adalah batas baris yang benar-benar diambil
 * (default 500, maksimum 2000) - jaga memori tetap kecil di VPS 2 vCPU.
 */
export async function listPersonnel(filter: PersonnelFilter = {}): Promise<PersonnelDto[]> {
  const rawLimit = filter.limit ?? DEFAULT_LIMIT;
  const take = Math.min(Math.max(Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : DEFAULT_LIMIT, 1), MAX_LIMIT);

  const parts = [isNull(schema.crewMembers.deletedAt), isNull(schema.dailyReports.deletedAt)];

  if (filter.reportId) parts.push(eq(schema.crewMembers.reportId, filter.reportId));
  if (filter.wellId) parts.push(eq(schema.dailyReports.wellId, filter.wellId));
  if (filter.rigId) parts.push(eq(schema.dailyReports.rigId, filter.rigId));
  if (filter.from) parts.push(gte(schema.dailyReports.reportDate, filter.from));
  if (filter.to) parts.push(lte(schema.dailyReports.reportDate, filter.to));

  const rows: CrewRow[] = await db
    .select({
      id: schema.crewMembers.id,
      name: schema.crewMembers.name,
      position: schema.crewMembers.position,
      company: schema.crewMembers.company,
      shift: schema.crewMembers.shift,
      hours: schema.crewMembers.hours,
      pobStatus: schema.crewMembers.pobStatus,
      musterStation: schema.crewMembers.musterStation,
      reportId: schema.dailyReports.id,
      reportDate: schema.dailyReports.reportDate,
    })
    .from(schema.crewMembers)
    .innerJoin(schema.dailyReports, eq(schema.crewMembers.reportId, schema.dailyReports.id))
    .where(and(...parts))
    .orderBy(desc(schema.dailyReports.reportDate), asc(schema.crewMembers.name))
    .limit(take);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    position: r.position,
    company: r.company,
    shift: r.shift,
    hours: toNum(r.hours),
    pobStatus: r.pobStatus,
    musterStation: r.musterStation,
    reportId: r.reportId,
    reportDate: r.reportDate,
  }));
}

/**
 * Ringkasan POB dari hasil `listPersonnel` (satu sumber angka dengan daftar,
 * supaya "total POB" di kartu = jumlah baris tabel).
 *
 * - `inCount`/`outCount`: hitung `pobStatus` (`in` / `out`).
 * - `manHours`: jumlah jam orang (`hours`), 2 desimal.
 * - `byCompany`/`byMuster`: kelompokkan seluruh personel (tanpa batas 500) -
 *   agregasi dihitung ulang dari query tanpa `limit` agar tetap akurat.
 */
export async function getPobSummary(filter: Omit<PersonnelFilter, 'limit'> = {}): Promise<PobSummary> {
  const items = await listPersonnel({ ...filter, limit: MAX_LIMIT });

  let inCount = 0;
  let outCount = 0;
  let manHours = 0;
  const companyCount = new Map<string, number>();
  const musterCount = new Map<string, number>();

  for (const p of items) {
    const status = p.pobStatus.trim().toLowerCase();
    if (status === 'out') outCount += 1;
    else inCount += 1;

    manHours += p.hours;

    const company = p.company?.trim() ? p.company.trim() : 'Unassigned';
    companyCount.set(company, (companyCount.get(company) ?? 0) + 1);

    const station = p.musterStation?.trim() ? p.musterStation.trim() : 'Unassigned';
    musterCount.set(station, (musterCount.get(station) ?? 0) + 1);
  }

  const sortByCount = <T extends { count: number }>(rows: T[]): T[] =>
    rows.sort((a, b) => b.count - a.count);

  return {
    total: items.length,
    inCount,
    outCount,
    manHours: round2(manHours),
    byCompany: sortByCount([...companyCount.entries()].map(([company, count]) => ({ company, count }))),
    byMuster: sortByCount([...musterCount.entries()].map(([station, count]) => ({ station, count }))),
  };
}

/**
 * Ganti SELURUH crew/POB satu laporan (hard delete + insert ulang) dalam satu
 * transaksi - pola sama dengan `replaceCrew`/`replaceMac` agar tidak ada baris
 * "yatim" bila insert gagal di tengah jalan.
 *
 * Dipakai bila data personel diimpor massal (mis. CSV/POB manifest) untuk
 * sebuah laporan. Route yang mengubah crew satu DDR tetap memakai `replaceCrew`
 * (yang sekaligus menghormati status draft).
 */
export async function upsertPersonnel(
  reportId: string,
  rows: Array<{
    name: string;
    position: string;
    company?: string | null;
    shift: string;
    hours: number;
    pobStatus?: string;
    musterStation?: string | null;
  }>,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(schema.crewMembers).where(eq(schema.crewMembers.reportId, reportId));

    if (rows.length > 0) {
      await tx.insert(schema.crewMembers).values(
        rows.map((r) => ({
          reportId,
          name: r.name.trim(),
          position: r.position.trim() || 'Crew',
          company: r.company?.trim() ? r.company.trim() : null,
          shift: r.shift.trim() || 'Day',
          hours: money(r.hours ?? 0),
          pobStatus: r.pobStatus?.trim() || 'in',
          musterStation: r.musterStation?.trim() ? r.musterStation.trim() : null,
        })),
      );
    }

    await tx
      .update(schema.dailyReports)
      .set({ updatedAt: new Date() })
      .where(eq(schema.dailyReports.id, reportId));
  });
}