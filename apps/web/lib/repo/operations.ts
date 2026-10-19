/**
 * Repository - Data operasional per-DDR: marine daily, MAC (dual derrick),
 * directional survey, insiden safety, rate card, dan definisi KPI.
 *
 * SATU-SATUNYA tempat query Drizzle untuk tabel-tabel tersebut. Route handler
 * memanggil fungsi di sini lewat barrel `@/lib/repo` (server-only).
 *
 * Konvensi:
 * - `numeric` → `number`, `date` → `YYYY-MM-DD`, `timestamptz` → ISO string.
 * - Semua list memfilter `deletedAt IS NULL` (soft delete).
 * - Replace = hard delete baris lama + insert ulang (dalam satu transaksi), sama
 *   seperti `replaceTimeRows`/`replaceCrew` agar tidak ada baris "yatim".
 */
import 'server-only';
import { and, asc, count, desc, eq, gte, isNull, lte } from 'drizzle-orm';
import { db, schema } from '@rigdaily/database';
import type { MarineDto, RateCardDto } from './types';
import { money, moneyOrNull, toDateOrNull, toIso, toNum, toNumOrNull } from './shared';

/* ------------------------------------------------------------------ */
/* Marine Daily                                                        */
/* ------------------------------------------------------------------ */

/** Variant marine yang diterima (selaras komentar kolom `marine_daily.variant`). */
export const MARINE_VARIANTS = ['jackup', 'anchored_floater', 'dpp_floater'] as const;

export async function getMarine(reportId: string): Promise<MarineDto | null> {
  const rows = await db
    .select()
    .from(schema.marineDaily)
    .where(and(eq(schema.marineDaily.reportId, reportId), isNull(schema.marineDaily.deletedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    variant: row.variant,
    fields: row.fieldsJson ?? {},
  };
}

/**
 * Upsert satu baris marine per laporan (unique index `marine_report_uq`).
 *
 * Memakai `onConflictDoUpdate` pada `reportId` sehingga simpan berulang tidak
 * menabrak unique index; `revision` ikut naik untuk jejak sinkronisasi.
 */
export async function upsertMarine(
  reportId: string,
  variant: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await db
    .insert(schema.marineDaily)
    .values({ reportId, variant, fieldsJson: fields })
    .onConflictDoUpdate({
      target: schema.marineDaily.reportId,
      set: {
        variant,
        fieldsJson: fields,
        updatedAt: new Date(),
        deletedAt: null,
      },
    });
}

/* ------------------------------------------------------------------ */
/* MAC (Multiple Activity Center / dual derrick)                       */
/* ------------------------------------------------------------------ */

export type MacItemDto = {
  id: string;
  activityCenter: string;
  operation: string;
  hours: number;
  billable: boolean;
};

export async function listMac(reportId: string): Promise<MacItemDto[]> {
  const rows = await db
    .select()
    .from(schema.macActivities)
    .where(and(eq(schema.macActivities.reportId, reportId), isNull(schema.macActivities.deletedAt)))
    .orderBy(asc(schema.macActivities.createdAt));

  return rows.map((m) => ({
    id: m.id,
    activityCenter: m.activityCenter,
    operation: m.operation,
    hours: toNum(m.hours),
    billable: m.billable,
  }));
}

export async function replaceMac(
  reportId: string,
  items: Array<{ activityCenter: string; operation: string; hours: number; billable: boolean }>,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(schema.macActivities).where(eq(schema.macActivities.reportId, reportId));

    if (items.length > 0) {
      await tx.insert(schema.macActivities).values(
        items.map((m) => ({
          reportId,
          activityCenter: m.activityCenter,
          operation: m.operation,
          hours: money(m.hours),
          billable: m.billable,
        })),
      );
    }

    await tx
      .update(schema.dailyReports)
      .set({ updatedAt: new Date() })
      .where(eq(schema.dailyReports.id, reportId));
  });
}

/* ------------------------------------------------------------------ */
/* Directional Survey                                                  */
/* ------------------------------------------------------------------ */

export type SurveyItemDto = {
  id: string;
  md: number;
  inclination: number | null;
  azimuth: number | null;
  tvd: number | null;
};

export async function listSurvey(reportId: string): Promise<SurveyItemDto[]> {
  const rows = await db
    .select()
    .from(schema.surveyStations)
    .where(and(eq(schema.surveyStations.reportId, reportId), isNull(schema.surveyStations.deletedAt)))
    .orderBy(asc(schema.surveyStations.md));

  return rows.map((s) => ({
    id: s.id,
    md: toNum(s.md),
    inclination: toNumOrNull(s.inclination),
    azimuth: toNumOrNull(s.azimuth),
    tvd: toNumOrNull(s.tvd),
  }));
}

export async function replaceSurvey(
  reportId: string,
  items: Array<{ md: number; inclination?: number | null; azimuth?: number | null; tvd?: number | null }>,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(schema.surveyStations).where(eq(schema.surveyStations.reportId, reportId));

    if (items.length > 0) {
      await tx.insert(schema.surveyStations).values(
        items.map((s) => ({
          reportId,
          md: money(s.md),
          inclination: moneyOrNull(s.inclination ?? null),
          azimuth: moneyOrNull(s.azimuth ?? null),
          tvd: moneyOrNull(s.tvd ?? null),
        })),
      );
    }

    await tx
      .update(schema.dailyReports)
      .set({ updatedAt: new Date() })
      .where(eq(schema.dailyReports.id, reportId));
  });
}

/* ------------------------------------------------------------------ */
/* Safety incidents                                                    */
/* ------------------------------------------------------------------ */

export type IncidentItemDto = {
  id: string;
  reportId: string | null;
  refNo: string | null;
  type: string;
  severity: string;
  /** ISO string */
  occurredAt: string | null;
  location: string | null;
  description: string;
  immediateAction: string | null;
  correctiveAction: string | null;
  assignee: string | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
  status: string;
};

/** Kolom teks bebas yang hanya boleh diisi string (bukan numeric/timestamp). */
const INCIDENT_TEXT_COLUMNS = [
  'refNo',
  'type',
  'severity',
  'location',
  'description',
  'immediateAction',
  'correctiveAction',
  'assignee',
  'dueDate',
  'status',
] as const;

type IncidentPatchColumn = (typeof INCIDENT_TEXT_COLUMNS)[number];

/**
 * Daftar insiden. Tanpa `reportId` → SEMUA insiden (register HSE), urut terbaru.
 * `occurredAt` null diletakkan di akhir agar insiden bertanggal tetap di atas.
 */
export async function listIncidents(reportId?: string): Promise<IncidentItemDto[]> {
  const parts = [isNull(schema.safetyIncidents.deletedAt)];
  if (reportId) parts.push(eq(schema.safetyIncidents.reportId, reportId));

  const rows = await db
    .select()
    .from(schema.safetyIncidents)
    .where(and(...parts))
    .orderBy(desc(schema.safetyIncidents.occurredAt), desc(schema.safetyIncidents.createdAt));

  return rows.map((i) => ({
    id: i.id,
    reportId: i.reportId,
    refNo: i.refNo,
    type: i.type,
    severity: i.severity,
    occurredAt: toIso(i.occurredAt),
    location: i.location,
    description: i.description,
    immediateAction: i.immediateAction,
    correctiveAction: i.correctiveAction,
    assignee: i.assignee,
    dueDate: i.dueDate,
    status: i.status,
  }));
}

/** Prefix nomor register insiden: `IR-YYYY-NNN`. */
export const INCIDENT_REF_PREFIX = 'IR';

/** Rentang tanggal satu tahun kalender (YYYY-01-01 .. YYYY-12-31). */
function yearBounds(year: number): { from: Date; to: Date } {
  return {
    from: new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0)),
    to: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
  };
}

/** Tanggal acuan penomoran: `occurredAt` bila ada, kalau tidak "sekarang". */
function refDate(input: { occurredAt?: string | null }): Date {
  const parsed = input.occurredAt ? toDateOrNull(input.occurredAt) : null;
  return parsed ?? new Date();
}

/**
 * Nomor register berikutnya `IR-YYYY-NNN` (pad 3 digit) = jumlah insiden pada
 * tahun berjalan + 1. Termasuk baris soft-deleted agar nomor tidak dipakai ulang.
 */
export async function nextIncidentRefNo(input: { occurredAt?: string | null } = {}): Promise<string> {
  const when = refDate(input);
  const year = when.getUTCFullYear();
  const { from, to } = yearBounds(year);

  const rows = await db
    .select({ n: count() })
    .from(schema.safetyIncidents)
    .where(and(gte(schema.safetyIncidents.createdAt, from), lte(schema.safetyIncidents.createdAt, to)));

  const next = Number(rows[0]?.n ?? 0) + 1;
  return `${INCIDENT_REF_PREFIX}-${year}-${String(next).padStart(3, '0')}`;
}

export async function createIncident(input: {
  reportId?: string | null;
  refNo?: string | null;
  type: string;
  severity: string;
  occurredAt?: string | null;
  location?: string | null;
  description: string;
  immediateAction?: string | null;
  correctiveAction?: string | null;
  assignee?: string | null;
  dueDate?: string | null;
  status?: string;
}): Promise<{ id: string; refNo: string }> {
  const refNo = input.refNo?.trim() ? input.refNo.trim() : await nextIncidentRefNo({ occurredAt: input.occurredAt });

  const [row] = await db
    .insert(schema.safetyIncidents)
    .values({
      reportId: input.reportId ?? null,
      refNo,
      type: input.type,
      severity: input.severity,
      occurredAt: toDateOrNull(input.occurredAt ?? null),
      location: input.location ?? null,
      description: input.description,
      immediateAction: input.immediateAction ?? null,
      correctiveAction: input.correctiveAction ?? null,
      assignee: input.assignee ?? null,
      dueDate: input.dueDate ?? null,
      status: input.status ?? 'open',
    })
    .returning({ id: schema.safetyIncidents.id, refNo: schema.safetyIncidents.refNo });

  return { id: row.id, refNo: row.refNo ?? refNo };
}

/**
 * Patch sebagian kolom insiden. `reportId` TIDAK bisa dipindah lewat patch
 * (relasi ke DDR bersifat permanen). Nilai `undefined` diabaikan.
 */
export async function updateIncident(id: string, patch: Record<string, unknown>): Promise<void> {
  const set: Partial<typeof schema.safetyIncidents.$inferInsert> = { updatedAt: new Date() };

  // timestamptz: string ISO / `null` → Date | null.
  if (patch.occurredAt !== undefined) {
    const raw = patch.occurredAt;
    set.occurredAt = raw === null ? null : toDateOrNull(String(raw));
  }

  for (const column of INCIDENT_TEXT_COLUMNS) {
    if (!(column in patch)) continue;
    const raw = patch[column];
    if (raw === undefined) continue;
    // `description`/`type` bertipe NOT NULL - null tidak boleh menimpanya.
    if (raw === null) {
      if (column === 'description' || column === 'type' || column === 'severity' || column === 'status') continue;
      set[column] = null;
      continue;
    }
    set[column] = String(raw);
  }

  await db.update(schema.safetyIncidents).set(set).where(eq(schema.safetyIncidents.id, id));
}

/**
 * Soft delete satu insiden. Jejak audit & riwayat tetap utuh; insiden hilang
 * dari daftar/register HSE. Mengembalikan `false` bila tidak ada / sudah terhapus.
 */
export async function softDeleteIncident(id: string): Promise<boolean> {
  const rows = await db
    .update(schema.safetyIncidents)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.safetyIncidents.id, id), isNull(schema.safetyIncidents.deletedAt)))
    .returning({ id: schema.safetyIncidents.id });

  return rows.length > 0;
}

/* ------------------------------------------------------------------ */
/* Rate cards (master billing)                                         */
/* ------------------------------------------------------------------ */

export type RateTierDto = { fromHour: number; toHour: number | null; ratePerHour: number; label?: string };

export type RateCardDetailedDto = {
  id: string;
  rigId: string | null;
  activityCode: string;
  label: string | null;
  tiers: RateTierDto[];
  /** YYYY-MM-DD */
  effectiveDate: string | null;
  active: boolean;
};

/** Normalisasi tier dari jsonb (nilai bisa berupa string bila diedit manual). */
function normalizeTiers(raw: unknown): RateTierDto[] {
  if (!Array.isArray(raw)) return [];
  const out: RateTierDto[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const fromHour = toNumOrNull(rec.fromHour as string | number | null | undefined);
    if (fromHour === null) continue;
    const toHourRaw = toNumOrNull(rec.toHour as string | number | null | undefined);
    const ratePerHour = toNum(rec.ratePerHour as string | number | null | undefined);
    const label = typeof rec.label === 'string' && rec.label.trim().length > 0 ? rec.label : undefined;
    out.push({ fromHour, toHour: toHourRaw, ratePerHour, ...(label ? { label } : {}) });
  }
  return out;
}

function toRateCardDto(r: typeof schema.rateCards.$inferSelect): RateCardDetailedDto {
  return {
    id: r.id,
    rigId: r.rigId,
    activityCode: r.activityCode,
    label: r.label,
    tiers: normalizeTiers(r.tiers),
    effectiveDate: r.effectiveDate,
    active: r.active,
  };
}

/**
 * Daftar rate card detail (semua tier). `rigId` diberikan → sertakan rate card
 * global (`rigId IS NULL`) sebagai fallback, sama seperti `listRateCards`.
 */
export async function listRateCardsDetailed(rigId?: string): Promise<RateCardDto[]> {
  const where = rigId
    ? and(isNull(schema.rateCards.deletedAt), eq(schema.rateCards.rigId, rigId))
    : isNull(schema.rateCards.deletedAt);

  const rows = await db
    .select()
    .from(schema.rateCards)
    .where(where)
    .orderBy(asc(schema.rateCards.activityCode), asc(schema.rateCards.effectiveDate));

  return rows.map(toRateCardDto);
}

/**
 * Buat / perbarui rate card untuk (rigId, activityCode).
 *
 * Bila kombinasi tersebut sudah punya baris aktif, baris itu diperbarui
 * (label, tiers, effectiveDate) - atau di-soft-delete lalu dibuat ulang bila
 * `effectiveDate` berbeda, supaya riwayat tarif tetap terbaca.
 */
export async function upsertRateCard(input: {
  rigId?: string | null;
  activityCode: string;
  label?: string | null;
  tiers: RateTierDto[];
  effectiveDate?: string | null;
}): Promise<{ id: string }> {
  const rigId = input.rigId ?? null;
  const effectiveDate = input.effectiveDate ?? null;
  const tiers = normalizeTiers(input.tiers);

  const existing = await db
    .select()
    .from(schema.rateCards)
    .where(
      and(
        isNull(schema.rateCards.deletedAt),
        eq(schema.rateCards.activityCode, input.activityCode),
        rigId === null ? isNull(schema.rateCards.rigId) : eq(schema.rateCards.rigId, rigId),
      ),
    )
    .orderBy(desc(schema.rateCards.effectiveDate));

  const match = existing.find((r) => (r.effectiveDate ?? null) === effectiveDate);

  if (match) {
    await db
      .update(schema.rateCards)
      .set({
        label: input.label ?? null,
        tiers,
        active: true,
        updatedAt: new Date(),
      })
      .where(eq(schema.rateCards.id, match.id));
    return { id: match.id };
  }

  const [created] = await db
    .insert(schema.rateCards)
    .values({
      rigId,
      activityCode: input.activityCode,
      label: input.label ?? null,
      tiers,
      effectiveDate,
      active: true,
    })
    .returning({ id: schema.rateCards.id });

  return { id: created.id };
}

/** Satu rate card (semua tier) - `null` bila tidak ada / sudah dihapus. */
export async function getRateCardById(id: string): Promise<RateCardDetailedDto | null> {
  const rows = await db
    .select()
    .from(schema.rateCards)
    .where(and(eq(schema.rateCards.id, id), isNull(schema.rateCards.deletedAt)))
    .limit(1);

  return rows[0] ? toRateCardDto(rows[0]) : null;
}

/**
 * Patch satu rate card (label, tiers, tanggal efektif, aktif/nonaktif).
 *
 * `rigId` dan `activityCode` sengaja tetap: kombinasi itu adalah identitas
 * tarif, mengubahnya berarti membuat rate card baru (pakai `upsertRateCard`).
 * Mengembalikan `{ before, after }`; `before` null bila rate card tidak ada.
 */
export async function updateRateCard(
  id: string,
  patch: {
    label?: string | null;
    tiers?: RateTierDto[];
    effectiveDate?: string | null;
    active?: boolean;
  },
): Promise<{ before: RateCardDetailedDto | null; after: RateCardDetailedDto | null }> {
  const before = await getRateCardById(id);
  if (!before) return { before: null, after: null };

  const set: Partial<typeof schema.rateCards.$inferInsert> = { updatedAt: new Date() };
  if (patch.label !== undefined) set.label = patch.label;
  if (patch.tiers !== undefined) set.tiers = normalizeTiers(patch.tiers);
  if (patch.effectiveDate !== undefined) set.effectiveDate = patch.effectiveDate;
  if (patch.active !== undefined) set.active = patch.active;

  const rows = await db
    .update(schema.rateCards)
    .set(set)
    .where(and(eq(schema.rateCards.id, id), isNull(schema.rateCards.deletedAt)))
    .returning();

  return { before, after: rows[0] ? toRateCardDto(rows[0]) : null };
}

/**
 * Soft delete satu rate card. Tarif berhenti dipakai billing bulan berikutnya,
 * baris tetap tersimpan sebagai riwayat. `null` bila tidak ada / sudah terhapus.
 */
export async function softDeleteRateCard(id: string): Promise<RateCardDetailedDto | null> {
  const rows = await db
    .update(schema.rateCards)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.rateCards.id, id), isNull(schema.rateCards.deletedAt)))
    .returning();

  return rows[0] ? toRateCardDto(rows[0]) : null;
}

/* ------------------------------------------------------------------ */
/* KPI definitions                                                     */
/* ------------------------------------------------------------------ */

export type KpiDefinitionDetailedDto = {
  id: string;
  name: string;
  formula: string;
  category: string | null;
  baseline: number | null;
  unit: string | null;
  active: boolean;
};

/** Semua definisi KPI (termasuk non-aktif) untuk layar builder admin. */
export async function listKpiDefinitionsDetailed(): Promise<KpiDefinitionDetailedDto[]> {
  const rows = await db
    .select()
    .from(schema.kpiDefinitions)
    .where(isNull(schema.kpiDefinitions.deletedAt))
    .orderBy(asc(schema.kpiDefinitions.category), asc(schema.kpiDefinitions.name));

  return rows.map((k) => ({
    id: k.id,
    name: k.name,
    formula: k.formula,
    category: k.category,
    baseline: toNumOrNull(k.baseline),
    unit: k.unit,
    active: k.active,
  }));
}

/** Kolom `baseline` bertipe numeric(14,4) - 4 desimal, bukan 2. */
function baselineValue(n: number | null | undefined): string | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  return n.toFixed(4);
}

export async function createKpiDefinition(input: {
  name: string;
  formula: string;
  category?: string | null;
  baseline?: number | null;
  unit?: string | null;
  active?: boolean;
}): Promise<{ id: string }> {
  const [row] = await db
    .insert(schema.kpiDefinitions)
    .values({
      name: input.name,
      formula: input.formula,
      category: input.category ?? null,
      baseline: baselineValue(input.baseline),
      unit: input.unit ?? null,
      active: input.active ?? true,
    })
    .returning({ id: schema.kpiDefinitions.id });

  return { id: row.id };
}

/** Satu definisi KPI - `null` bila tidak ada / sudah dihapus. */
export async function getKpiDefinitionById(id: string): Promise<KpiDefinitionDetailedDto | null> {
  const rows = await db
    .select()
    .from(schema.kpiDefinitions)
    .where(and(eq(schema.kpiDefinitions.id, id), isNull(schema.kpiDefinitions.deletedAt)))
    .limit(1);

  const k = rows[0];
  if (!k) return null;

  return {
    id: k.id,
    name: k.name,
    formula: k.formula,
    category: k.category,
    baseline: toNumOrNull(k.baseline),
    unit: k.unit,
    active: k.active,
  };
}

/**
 * Patch satu definisi KPI. `baseline` memakai numeric(14,4) - lihat
 * `baselineValue`. Mengembalikan `{ before, after }`; `before` null bila
 * definisi tidak ada.
 */
export async function updateKpiDefinition(
  id: string,
  patch: {
    name?: string;
    formula?: string;
    category?: string | null;
    baseline?: number | null;
    unit?: string | null;
    active?: boolean;
  },
): Promise<{ before: KpiDefinitionDetailedDto | null; after: KpiDefinitionDetailedDto | null }> {
  const before = await getKpiDefinitionById(id);
  if (!before) return { before: null, after: null };

  const set: Partial<typeof schema.kpiDefinitions.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.formula !== undefined) set.formula = patch.formula;
  if (patch.category !== undefined) set.category = patch.category;
  if (patch.baseline !== undefined) set.baseline = baselineValue(patch.baseline);
  if (patch.unit !== undefined) set.unit = patch.unit;
  if (patch.active !== undefined) set.active = patch.active;

  await db
    .update(schema.kpiDefinitions)
    .set(set)
    .where(and(eq(schema.kpiDefinitions.id, id), isNull(schema.kpiDefinitions.deletedAt)));

  return { before, after: await getKpiDefinitionById(id) };
}

/**
 * Soft delete satu definisi KPI. Metrik historis tetap memakai definisi lama
 * (nilai KPI disimpan per laporan), jadi menghapus definisi tidak menghapus data.
 * `null` bila tidak ada / sudah terhapus.
 */
export async function softDeleteKpiDefinition(id: string): Promise<KpiDefinitionDetailedDto | null> {
  const before = await getKpiDefinitionById(id);
  if (!before) return null;

  await db
    .update(schema.kpiDefinitions)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.kpiDefinitions.id, id), isNull(schema.kpiDefinitions.deletedAt)));

  return before;
}
