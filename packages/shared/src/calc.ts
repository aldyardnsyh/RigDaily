/**
 * KALKULASI INTI - FROZEN CONTRACT (single source of truth).
 *
 * ATURAN: SEMUA angka DDR (layar, PDF, dashboard, billing) HARUS dihitung dari
 * fungsi di file ini. Jangan duplikasi logika di komponen React / route handler.
 * Ini yang menjamin "angka sama persis" antara layar dan PDF (parity checklist 05 §3A).
 *
 * Semua durasi internal dalam MENIT. 24 jam = 1440 menit.
 */

export const MINUTES_PER_DAY = 1440;

export type TimeRowInput = {
  start: string; // "HH:MM" format 24 jam
  end: string; // "HH:MM"
  code: string; // IADC code
  npt?: boolean; // override company policy
  remarks?: string;
};

export type ValidationIssue = {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  rowIndex?: number;
};

/* ------------------------------------------------------------------ */
/* Parsing waktu                                                       */
/* ------------------------------------------------------------------ */

export function parseHm(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h < 0 || h > 24 || mi < 0 || mi > 59) return null;
  if (h === 24 && mi !== 0) return null;
  return h * 60 + mi;
}

export function formatHm(totalMinutes: number): string {
  const wrapped = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatHours(minutes: number, digits = 2): string {
  return (minutes / 60).toFixed(digits);
}

/**
 * Durasi sebuah baris. Mendukung lintas tengah malam (mis. 22:00 â†’ 04:30 = 6.5h).
 * Aturan: jika end <= start, dianggap melewati tengah malam.
 * Baris 00:00-00:00 dianggap 0 (ditolak validator).
 */
export function rowDurationMinutes(start: string, end: string): number | null {
  const s = parseHm(start);
  const e = parseHm(end);
  if (s === null || e === null) return null;
  if (e > s) return e - s;
  if (e < s) return MINUTES_PER_DAY - s + e;
  return 0;
}

/* ------------------------------------------------------------------ */
/* Validasi Time Breakdown                                             */
/* ------------------------------------------------------------------ */

/**
 * Validasi penuh time breakdown: total 24h, tidak ada overlap, kode valid,
 * sub-code wajib untuk Code 08/18/24.
 */
export function validateTimeBreakdown(
  rows: TimeRowInput[],
  opts: { requireFull24h?: boolean; validCodes?: Set<string>; subCodeRequired?: Set<string> } = {},
): { issues: ValidationIssue[]; totalMinutes: number; ok: boolean } {
  const { requireFull24h = true, validCodes, subCodeRequired } = opts;
  const issues: ValidationIssue[] = [];
  let totalMinutes = 0;

  // Normalisasi ke interval menit absolut (0..1440) dengan penanganan tengah malam.
  type Interval = { from: number; to: number; idx: number };
  const intervals: Interval[] = [];

  rows.forEach((r, idx) => {
    const s = parseHm(r.start);
    const e = parseHm(r.end);
    if (s === null || e === null) {
      issues.push({ severity: 'error', code: 'TIME_FORMAT', message: `Baris ${idx + 1}: format waktu tidak valid (${r.start} - ${r.end}). Gunakan HH:MM.`, rowIndex: idx });
      return;
    }
    const dur = rowDurationMinutes(r.start, r.end);
    if (dur === null || dur <= 0) {
      issues.push({ severity: 'error', code: 'TIME_ZERO', message: `Baris ${idx + 1}: durasi harus > 0 (${r.start} - ${r.end}).`, rowIndex: idx });
      return;
    }
    totalMinutes += dur;

    if (e > s) intervals.push({ from: s, to: e, idx });
    else if (e < s) {
      intervals.push({ from: s, to: MINUTES_PER_DAY, idx });
      intervals.push({ from: 0, to: e, idx });
    }

    if (validCodes && !validCodes.has(r.code)) {
      issues.push({ severity: 'error', code: 'IADC_UNKNOWN', message: `Baris ${idx + 1}: kode IADC "${r.code}" tidak dikenal.`, rowIndex: idx });
    }
    if (subCodeRequired?.has(r.code) && !(r.remarks && r.remarks.trim().length > 0)) {
      issues.push({
        severity: 'error',
        code: 'SUBCode_REQUIRED',
        message: `Baris ${idx + 1}: kode ${r.code} wajib punya sub-code/equipment/vendor di remarks (pemecah Code 08).`,
        rowIndex: idx,
      });
    }
  });

  // Deteksi overlap
  intervals.sort((a, b) => a.from - b.from);
  for (let i = 1; i < intervals.length; i += 1) {
    const prev = intervals[i - 1];
    const cur = intervals[i];
    if (cur.from < prev.to) {
      issues.push({
        severity: 'error',
        code: 'TIME_OVERLAP',
        message: `Overlap ${formatHm(cur.from)}-${formatHm(Math.min(prev.to, cur.to))} (baris ${prev.idx + 1} vs ${cur.idx + 1}).`,
        rowIndex: cur.idx,
      });
    }
  }

  if (requireFull24h && totalMinutes !== MINUTES_PER_DAY && issues.every((i) => i.code !== 'TIME_ZERO')) {
    const diff = MINUTES_PER_DAY - totalMinutes;
    if (diff > 0) {
      issues.push({
        severity: 'error',
        code: 'TIME_GAP',
        message: `Total ${formatHours(totalMinutes)}h / 24.0h - kurang ${formatHours(diff)}h. Harus tepat 24.00h sebelum submit.`,
      });
    } else {
      issues.push({
        severity: 'error',
        code: 'TIME_EXCESS',
        message: `Total ${formatHours(totalMinutes)}h melebihi 24.0h sebanyak ${formatHours(-diff)}h.`,
      });
    }
  }

  return { issues, totalMinutes, ok: issues.filter((i) => i.severity === 'error').length === 0 };
}

/* ------------------------------------------------------------------ */
/* Ringkasan klasifikasi waktu                                         */
/* ------------------------------------------------------------------ */

export type TimeSummary = {
  totalMinutes: number;
  productiveMinutes: number;
  nptMinutes: number;
  wowMinutes: number;
  fmMinutes: number;
  standbyMinutes: number;
  disputedMinutes: number;
  gapMinutes: number;
  nptPercent: number;
  productivePercent: number;
};

export function summarizeTime(
  rows: TimeRowInput[],
  classify: (code: string) => 'PRD' | 'NPT' | 'WOW' | 'FM' | 'STBY' | 'DSPT' | 'GAP',
): TimeSummary {
  let total = 0;
  let prd = 0;
  let npt = 0;
  let wow = 0;
  let fm = 0;
  let stby = 0;
  let dspt = 0;

  for (const r of rows) {
    const dur = rowDurationMinutes(r.start, r.end) ?? 0;
    total += dur;
    const cls = r.npt === true ? 'NPT' : r.npt === false ? classify(r.code) : classify(r.code);
    switch (cls) {
      case 'PRD': prd += dur; break;
      case 'NPT': npt += dur; break;
      case 'WOW': wow += dur; break;
      case 'FM': fm += dur; break;
      case 'STBY': stby += dur; break;
      case 'DSPT': dspt += dur; break;
      default: break;
    }
  }

  const gap = Math.max(0, MINUTES_PER_DAY - total);
  const denom = MINUTES_PER_DAY;
  return {
    totalMinutes: total,
    productiveMinutes: prd,
    nptMinutes: npt,
    wowMinutes: wow,
    fmMinutes: fm,
    standbyMinutes: stby,
    disputedMinutes: dspt,
    gapMinutes: gap,
    nptPercent: denom ? ((npt + wow) / denom) * 100 : 0,
    productivePercent: denom ? (prd / denom) * 100 : 0,
  };
}

/* ------------------------------------------------------------------ */
/* Validasi kedalaman                                                  */
/* ------------------------------------------------------------------ */

export function validateDepth(depthStartMd: number, depthEndMd: number, prevEndMd?: number | null): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!Number.isFinite(depthStartMd) || !Number.isFinite(depthEndMd)) {
    issues.push({ severity: 'error', code: 'DEPTH_INVALID', message: 'Kedalaman harus angka.' });
    return issues;
  }
  if (depthEndMd < depthStartMd) {
    issues.push({ severity: 'error', code: 'DEPTH_REGRESS', message: `Kedalaman akhir (${depthEndMd}m) tidak boleh lebih kecil dari awal (${depthStartMd}m) pada hari yang sama.` });
  }
  if (prevEndMd != null && depthStartMd < prevEndMd) {
    issues.push({ severity: 'error', code: 'DEPTH_CHAIN', message: `Kedalaman awal (${depthStartMd}m) lebih kecil dari kedalaman akhir laporan sebelumnya (${prevEndMd}m).` });
  }
  if (depthEndMd - depthStartMd > 500) {
    issues.push({ severity: 'warning', code: 'DEPTH_LARGE', message: `Progress ${(depthEndMd - depthStartMd).toFixed(1)}m dalam 24 jam tidak wajar - mohon verifikasi.` });
  }
  return issues;
}

/* ------------------------------------------------------------------ */
/* Billing: tiered rate                                                */
/* ------------------------------------------------------------------ */

export type BillingTier = {
  /** Batas bawah jam (inklusif), mis. 0, 12, 24 */
  fromHour: number;
  /** Batas atas jam (eksklusif), mis. 12, 24, null = tak terbatas */
  toHour: number | null;
  ratePerHour: number;
  label?: string;
};

/**
 * Hitung biaya tiered untuk sejumlah jam pada satu kategori aktivitas.
 * Contoh kontrak: 0-12h @ $1,187.50 ; 12-24h @ $950 ; >24h @ $750.
 */
export function calcTieredAmount(hours: number, tiers: BillingTier[]): number {
  if (hours <= 0 || tiers.length === 0) return 0;
  const sorted = [...tiers].sort((a, b) => a.fromHour - b.fromHour);
  let remaining = hours;
  let amount = 0;

  for (const tier of sorted) {
    if (remaining <= 0) break;
    const upper = tier.toHour ?? Infinity;
    // Jam yang jatuh di dalam tier ini = irisan [fromHour, upper) dengan jam
    // yang tersisa. Tier yang mulai SETELAH jam tersisa tidak menagih apa pun;
    // celah antar-tier tidak boleh ikut ditagihkan.
    const span = Math.max(0, upper - tier.fromHour);
    const sliceHours = Math.min(remaining, span);
    if (sliceHours <= 0) continue;
    amount += sliceHours * tier.ratePerHour;
    remaining -= sliceHours;
  }

  return round2(amount);
}

/** Billing bulanan: kumpulkan jam per kategori lalu terapkan rate card. */
export type BillingLineInput = {
  date: string;
  code: string;
  hours: number;
  flags?: { forceMajeure?: boolean; disputed?: boolean; rebillable?: boolean };
};

export type RateCard = {
  activityCode: string;
  tiers: BillingTier[];
};

export type BillingLineResult = {
  date: string;
  code: string;
  hours: number;
  amount: number;
  flags: { forceMajeure: boolean; disputed: boolean; rebillable: boolean };
  notes: string[];
};

export function calcMonthlyBilling(lines: BillingLineInput[], rateCards: RateCard[]): {
  lines: BillingLineResult[];
  totals: { billableHours: number; amount: number; disputedHours: number; forceMajeureHours: number; rebillableAmount: number };
} {
  const cardByCode = Object.fromEntries(rateCards.map((r) => [r.activityCode, r]));
  const out: BillingLineResult[] = [];

  for (const line of lines) {
    const fm = line.flags?.forceMajeure ?? false;
    const disputed = line.flags?.disputed ?? false;
    const rebillable = line.flags?.rebillable ?? false;
    const card = cardByCode[line.code];
    const notes: string[] = [];
    let amount = 0;

    if (fm) {
      notes.push('Force majeure - ditagih pada rate FM sesuai klausul kontrak.');
    }
    if (disputed) {
      notes.push('Disputed - ditahan sampai dispute selesai.');
    }

    if (card && !disputed) {
      amount = calcTieredAmount(line.hours, card.tiers);
    } else if (card && disputed) {
      amount = calcTieredAmount(line.hours, card.tiers);
      notes.push('Nilai dihitung namun status masih disputed.');
    } else {
      notes.push(`Tidak ada rate card untuk kode ${line.code} - nilai 0, perlu setup Admin.`);
    }

    out.push({ date: line.date, code: line.code, hours: line.hours, amount, flags: { forceMajeure: fm, disputed, rebillable }, notes });
  }

  const totals = out.reduce(
    (acc, l) => {
      acc.billableHours += l.flags.disputed ? 0 : l.hours;
      acc.amount += l.flags.disputed ? 0 : l.amount;
      if (l.flags.disputed) acc.disputedHours += l.hours;
      if (l.flags.forceMajeure) acc.forceMajeureHours += l.hours;
      if (l.flags.rebillable) acc.rebillableAmount += l.amount;
      return acc;
    },
    { billableHours: 0, amount: 0, disputedHours: 0, forceMajeureHours: 0, rebillableAmount: 0 },
  );

  return { lines: out, totals: { ...totals, amount: round2(totals.amount), rebillableAmount: round2(totals.rebillableAmount) } };
}

/* ------------------------------------------------------------------ */
/* Cost & AFE                                                          */
/* ------------------------------------------------------------------ */

export type CostAggregateInput = { category: string; amount: number; afeCode?: string | null; rebillable?: boolean };

export function summarizeCost(lines: CostAggregateInput[], afeBudget?: number | null): {
  dailyTotal: number;
  byCategory: Record<string, number>;
  afeConsumedPercent: number | null;
  afeRemaining: number | null;
  rebillableTotal: number;
} {
  const byCategory: Record<string, number> = {};
  let total = 0;
  let rebill = 0;
  for (const l of lines) {
    total += l.amount;
    byCategory[l.category] = round2((byCategory[l.category] ?? 0) + l.amount);
    if (l.rebillable) rebill += l.amount;
  }
  return {
    dailyTotal: round2(total),
    byCategory,
    afeConsumedPercent: afeBudget && afeBudget > 0 ? round2((total / afeBudget) * 100) : null,
    afeRemaining: afeBudget && afeBudget > 0 ? round2(afeBudget - total) : null,
    rebillableTotal: round2(rebill),
  };
}

/* ------------------------------------------------------------------ */
/* Utils                                                               */
/* ------------------------------------------------------------------ */

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function formatUsd(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatMeters(n: number, digits = 1): string {
  return `${n.toFixed(digits)}m`;
}
