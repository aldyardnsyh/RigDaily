/**
 * Repository - Billing bulanan (tiered rate card).
 *
 * Alur: `time_breakdown` bulan tsb + `daily_reports` (filter rig) → group per
 * (reportDate, iadcCode) → jam = sum(durationMin)/60 → `calcMonthlyBilling()`
 * dari @rigdaily/shared dengan rate card rig tersebut.
 */
import 'server-only';
import { and, asc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { db, schema } from '@rigdaily/database';
import { calcMonthlyBilling, round2, type BillingLineResult } from '@rigdaily/shared';
import type { BillingRow, BillingSummary, RateCardDto } from './types';
import { iadcNameOf } from './shared';

type Flags = { forceMajeure: boolean; disputed: boolean; rebillable: boolean };

const NO_FLAGS: Flags = { forceMajeure: false, disputed: false, rebillable: false };

function orFlags(a: Flags, b: Flags): Flags {
  return {
    forceMajeure: a.forceMajeure || b.forceMajeure,
    disputed: a.disputed || b.disputed,
    rebillable: a.rebillable || b.rebillable,
  };
}

/** "YYYY-MM" → batas tanggal inklusif (hari terakhir dihitung, aman semua bulan). */
function monthBounds(month: string): { from: string; to: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error(`Format bulan harus YYYY-MM (diterima: "${month}").`);
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) throw new Error(`Bulan tidak valid: "${month}".`);
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${String(lastDay).padStart(2, '0')}` };
}

/**
 * Rate card: bila `rigId` diberikan, sertakan juga rate card global (rigId null)
 * sebagai fallback. Rate card spesifik rig menang atas global di `getMonthlyBilling`.
 */
export async function listRateCards(rigId?: string): Promise<RateCardDto[]> {
  const where = rigId
    ? and(
        isNull(schema.rateCards.deletedAt),
        or(eq(schema.rateCards.rigId, rigId), isNull(schema.rateCards.rigId)),
      )
    : isNull(schema.rateCards.deletedAt);

  const rows = await db
    .select()
    .from(schema.rateCards)
    .where(where)
    .orderBy(asc(schema.rateCards.activityCode), asc(schema.rateCards.effectiveDate));

  return rows.map((r) => ({
    id: r.id,
    rigId: r.rigId,
    activityCode: r.activityCode,
    label: r.label,
    tiers: r.tiers ?? [],
    effectiveDate: r.effectiveDate,
    active: r.active,
  }));
}

/** Semua rate card aktif yang berlaku untuk rig ini (rig-specific + global null). */
async function rateCardsForRig(rigId: string): Promise<RateCardDto[]> {
  const rows = await db
    .select()
    .from(schema.rateCards)
    .where(
      and(
        isNull(schema.rateCards.deletedAt),
        eq(schema.rateCards.active, true),
        or(eq(schema.rateCards.rigId, rigId), isNull(schema.rateCards.rigId)),
      ),
    )
    .orderBy(asc(schema.rateCards.activityCode), asc(schema.rateCards.effectiveDate));

  return rows.map((r) => ({
      id: r.id,
      rigId: r.rigId,
      activityCode: r.activityCode,
      label: r.label,
      tiers: r.tiers ?? [],
      effectiveDate: r.effectiveDate,
      active: r.active,
    }));
}

type Aggregated = Flags & {
  date: string;
  code: string;
  reportNo: number;
  minutes: number;
};

/**
 * Pilih SATU rate card yang berlaku pada tanggal `date` untuk kode aktivitas:
 *  - hanya kartu dengan `effectiveDate == null` (berlaku sejak awal) atau
 *    `effectiveDate <= date` yang dipertimbangkan (P1-10: tarif baru tidak
 *    boleh mengubah billing historis);
 *  - `effectiveDate` terbesar menang (versi terbaru yang sudah berlaku);
 *  - pada tanggal efektif sama, kartu spesifik rig menang atas kartu global.
 */
function pickApplicableCard(cards: RateCardDto[], date: string): RateCardDto | null {
  let best: RateCardDto | null = null;
  for (const c of cards) {
    if (c.effectiveDate !== null && c.effectiveDate > date) continue; // belum berlaku
    if (!best) {
      best = c;
      continue;
    }
    const a = best.effectiveDate ?? ''; // '' = sejak awal → paling tua
    const b = c.effectiveDate ?? '';
    if (b > a) best = c;
    else if (b === a) {
      const bestRigSpecific = best.rigId !== null;
      const candidateRigSpecific = c.rigId !== null;
      if (candidateRigSpecific && !bestRigSpecific) best = c;
    }
  }
  return best;
}

export async function getMonthlyBilling(rigId: string, month: string): Promise<BillingSummary> {
  const { from, to } = monthBounds(month);

  const rows = await db
    .select({
      reportId: schema.dailyReports.id,
      reportDate: schema.dailyReports.reportDate,
      reportNo: schema.dailyReports.reportNo,
      timeRowId: schema.timeBreakdown.id,
      iadcCode: schema.timeBreakdown.iadcCode,
      durationMin: schema.timeBreakdown.durationMin,
    })
    .from(schema.timeBreakdown)
    .innerJoin(schema.dailyReports, eq(schema.timeBreakdown.reportId, schema.dailyReports.id))
    .where(
      and(
        eq(schema.dailyReports.rigId, rigId),
        gte(schema.dailyReports.reportDate, from),
        lte(schema.dailyReports.reportDate, to),
        isNull(schema.dailyReports.deletedAt),
        isNull(schema.timeBreakdown.deletedAt),
      ),
    )
    .orderBy(asc(schema.dailyReports.reportDate), asc(schema.timeBreakdown.sortOrder));

  // Flags: per baris waktu (timeRowId) diutamakan, fallback per laporan (timeRowId null).
  const reportIds = [...new Set(rows.map((r) => r.reportId))];
  const byTimeRow = new Map<string, Flags>();
  const byReport = new Map<string, Flags>();

  if (reportIds.length > 0) {
    const flagRows = await db
      .select({
        reportId: schema.billingFlags.reportId,
        timeRowId: schema.billingFlags.timeRowId,
        forceMajeure: schema.billingFlags.forceMajeure,
        disputed: schema.billingFlags.disputed,
        rebillable: schema.billingFlags.rebillable,
      })
      .from(schema.billingFlags)
      .where(and(inArray(schema.billingFlags.reportId, reportIds), isNull(schema.billingFlags.deletedAt)));

    for (const f of flagRows) {
      const flags: Flags = {
        forceMajeure: f.forceMajeure,
        disputed: f.disputed,
        rebillable: f.rebillable,
      };
      if (f.timeRowId) {
        const prev = byTimeRow.get(f.timeRowId);
        byTimeRow.set(f.timeRowId, prev ? orFlags(prev, flags) : flags);
      } else {
        const prev = byReport.get(f.reportId);
        byReport.set(f.reportId, prev ? orFlags(prev, flags) : flags);
      }
    }
  }

  // Group per (tanggal, kode): jam dijumlahkan, flags di-OR.
  const grouped = new Map<string, Aggregated>();
  for (const r of rows) {
    const flags = byTimeRow.get(r.timeRowId) ?? byReport.get(r.reportId) ?? NO_FLAGS;
    const key = `${r.reportDate}|${r.iadcCode}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.minutes += r.durationMin;
      existing.forceMajeure = existing.forceMajeure || flags.forceMajeure;
      existing.disputed = existing.disputed || flags.disputed;
      existing.rebillable = existing.rebillable || flags.rebillable;
    } else {
      grouped.set(key, {
        date: r.reportDate,
        code: r.iadcCode,
        reportNo: r.reportNo,
        minutes: r.durationMin,
        ...flags,
      });
    }
  }

  const ordered = [...grouped.values()].sort((a, b) =>
    a.date === b.date ? a.code.localeCompare(b.code) : a.date.localeCompare(b.date),
  );

  const lines = ordered.map((g) => ({
    date: g.date,
    code: g.code,
    hours: round2(g.minutes / 60),
    flags: { forceMajeure: g.forceMajeure, disputed: g.disputed, rebillable: g.rebillable },
  }));

  // Rate card per tanggal: spesifik rig menang atas global, effectiveDate dihormati.
  const cards = await rateCardsForRig(rigId);
  const cardsByCode = new Map<string, RateCardDto[]>();
  for (const c of cards) {
    const list = cardsByCode.get(c.activityCode);
    if (list) list.push(c);
    else cardsByCode.set(c.activityCode, [c]);
  }

  // `calcMonthlyBilling()` menerima satu kartu per kode (tanpa tanggal). Baris
  // dikelompokkan per kartu yang berlaku pada tanggal baris tsb, dihitung per
  // kelompok, lalu digabung kembali - sehingga setiap tanggal memakai tarif yang
  // berlaku saat itu. Baris tanpa kartu tetap dihitung agar notes "tidak ada rate
  // card" muncul dan total tetap konsisten.
  const cardsInUse = new Map<string, RateCardDto>();
  const cardKeyFor = (g: Aggregated): string => {
    const card = pickApplicableCard(cardsByCode.get(g.code) ?? [], g.date);
    if (card) cardsInUse.set(`v:${card.id}`, card);
    return card ? `v:${card.id}` : `none:${g.code}`;
  };

  const groups = new Map<string, typeof lines>();
  for (const line of lines) {
    const key = cardKeyFor({ date: line.date, code: line.code, reportNo: 0, minutes: 0, ...NO_FLAGS });
    const bucket = groups.get(key);
    if (bucket) bucket.push(line);
    else groups.set(key, [line]);
  }

  const ratedByKey = new Map<string, BillingLineResult>();
  for (const [key, groupLines] of groups) {
    const card = cardsInUse.get(key);
    const result = calcMonthlyBilling(
      groupLines,
      card ? [{ activityCode: card.activityCode, tiers: card.tiers }] : [],
    );
    for (const l of result.lines) ratedByKey.set(`${l.date}|${l.code}`, l);
  }

  const billingRows: BillingRow[] = ordered.map((g) => {
    const l = ratedByKey.get(`${g.date}|${g.code}`);
    return {
      date: g.date,
      reportNo: g.reportNo,
      iadcCode: g.code,
      iadcName: iadcNameOf(g.code),
      hours: l?.hours ?? round2(g.minutes / 60),
      amount: l?.amount ?? 0,
      forceMajeure: g.forceMajeure,
      disputed: g.disputed,
      rebillable: g.rebillable,
    };
  });

  const totals = billingRows.reduce(
    (acc, r) => {
      acc.billableHours += r.disputed ? 0 : r.hours;
      acc.amount += r.disputed ? 0 : r.amount;
      if (r.disputed) acc.disputedHours += r.hours;
      if (r.forceMajeure) acc.forceMajeureHours += r.hours;
      if (r.rebillable) acc.rebillableAmount += r.amount;
      return acc;
    },
    { billableHours: 0, amount: 0, disputedHours: 0, forceMajeureHours: 0, rebillableAmount: 0 },
  );

  return {
    rows: billingRows,
    totals: {
      billableHours: round2(totals.billableHours),
      amount: round2(totals.amount),
      disputedHours: round2(totals.disputedHours),
      forceMajeureHours: round2(totals.forceMajeureHours),
      rebillableAmount: round2(totals.rebillableAmount),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Billing flags (P0-7) - dikelola dari UI /billing                    */
/* ------------------------------------------------------------------ */

export type BillingFlagDto = {
  id: string;
  timeRowId: string | null;
  forceMajeure: boolean;
  disputed: boolean;
  rebillable: boolean;
  note: string | null;
};

/** Semua flag aktif (belum dihapus) untuk satu laporan. */
export async function getBillingFlags(reportId: string): Promise<BillingFlagDto[]> {
  const rows = await db
    .select({
      id: schema.billingFlags.id,
      timeRowId: schema.billingFlags.timeRowId,
      forceMajeure: schema.billingFlags.forceMajeure,
      disputed: schema.billingFlags.disputed,
      rebillable: schema.billingFlags.rebillable,
      note: schema.billingFlags.note,
    })
    .from(schema.billingFlags)
    .where(and(eq(schema.billingFlags.reportId, reportId), isNull(schema.billingFlags.deletedAt)))
    .orderBy(asc(schema.billingFlags.createdAt));

  return rows;
}

/**
 * Upsert flag untuk kombinasi (report, timeRow) - satu baris per time row
 * (`timeRowId = null` = flag level laporan). Field yang tidak dikirim dibiarkan
 * apa adanya; waktu update `updatedAt` selalu diisi.
 *
 * Catatan: unik secara logis per (report, timeRow). Bila data lama punya
 * duplikat, baris pertama dipakai dan diperbarui - tidak error.
 */
export async function setBillingFlag(input: {
  reportId: string;
  timeRowId?: string | null;
  forceMajeure?: boolean;
  disputed?: boolean;
  rebillable?: boolean;
  note?: string | null;
}): Promise<{ id: string }> {
  const timeRowId = input.timeRowId ?? null;

  const where = and(
    eq(schema.billingFlags.reportId, input.reportId),
    timeRowId === null ? isNull(schema.billingFlags.timeRowId) : eq(schema.billingFlags.timeRowId, timeRowId),
    isNull(schema.billingFlags.deletedAt),
  );

  const existing = await db
    .select({ id: schema.billingFlags.id })
    .from(schema.billingFlags)
    .where(where)
    .limit(1);

  const set: Partial<typeof schema.billingFlags.$inferInsert> = { updatedAt: new Date() };
  if (input.forceMajeure !== undefined) set.forceMajeure = input.forceMajeure;
  if (input.disputed !== undefined) set.disputed = input.disputed;
  if (input.rebillable !== undefined) set.rebillable = input.rebillable;
  if (input.note !== undefined) set.note = input.note;

  const current = existing[0];
  if (current) {
    await db.update(schema.billingFlags).set(set).where(eq(schema.billingFlags.id, current.id));
    return { id: current.id };
  }

  const [row] = await db
    .insert(schema.billingFlags)
    .values({
      reportId: input.reportId,
      timeRowId,
      forceMajeure: input.forceMajeure ?? false,
      disputed: input.disputed ?? false,
      rebillable: input.rebillable ?? false,
      note: input.note ?? null,
    })
    .returning({ id: schema.billingFlags.id });

  return { id: row.id };
}

/** Soft delete satu flag (jejak audit tetap utuh). */
export async function deleteBillingFlag(id: string): Promise<void> {
  await db
    .update(schema.billingFlags)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.billingFlags.id, id));
}
