/**
 * Importer - legacy DDR CSV (time breakdown) → daily_reports + time_breakdown.
 *
 * Kenapa ada: rig lama mengirim time sheet sebagai CSV. Importer ini mengubahnya
 * menjadi DDR tanpa memaksa user mengetik ulang, sekaligus mencatat setiap
 * batch di `import_batches` supaya hasilnya bisa diaudit.
 *
 * Kontrak CSV
 *   Kolom wajib  : report_date, depth_md_start, depth_md_end, start, end, iadc_code
 *   Kolom opsional: report_no, iadc_subcode, remarks, npt_flag, vendor, cost/cost_usd/amount
 *   Baris dengan `report_date` sama digabung menjadi SATU laporan.
 *
 * ALIAS HEADER (P1-9)
 *   File legacy tidak konsisten menamai kolom ("Date", "Start Depth", "From
 *   Time", "IADC", ...). `HEADER_ALIASES` memetakan nama umum → kolom kanonik
 *   setelah normalisasi (lowercase, trim, spasi/underscore berulang → satu `_`).
 *
 * ATOMICITAS (P1-9)
 *   `createReport` + `replaceTimeRows` bukan satu transaksi (repo milik modul
 *   lain). Kompensasi eksplisit: bila langkah mana pun gagal setelah laporan
 *   dibuat, laporan itu di-soft-delete (plus time row & cost line-nya) agar
 *   tidak ada DDR orphan tanpa time rows.
 *
 * COST (P1-9)
 *   Bila CSV punya kolom cost, `costDailyUsd` diisi jumlah cost line yang dibuat
 *   dan `cost_lines` ikut ditulis. Bila tidak ada kolom cost, biarkan 0 dan
 *   laporkan lewat `costNotice` (recompute penuh tetap tugas modul Cost).
 *
 * Parser minimal (tanpa dependency): kutip ganda (`""` = kutip literal), koma di
 * dalam kutip, CRLF/LF, dan BOM UTF-8.
 *
 * Validasi memakai `validateTimeBreakdown()` dari `@rigdaily/shared` - aturan
 * 24 jam & kode IADC tidak diduplikasi di sini.
 */
import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@rigdaily/database';
import { round2, validateTimeBreakdown } from '@rigdaily/shared';
import { recomputeReportCosts, VALID_IADC_CODES, SUBCODE_REQUIRED_IADC } from '@/lib/repo/shared';
import { createReport, replaceTimeRows } from '@/lib/repo/reports';

export type ImportRowError = { row: number; message: string };

export type ImportResult = {
  batchId: string;
  rowCount: number;
  inserted: number;
  errorCount: number;
  errors: ImportRowError[];
  /** Jumlah DDR yang `costDailyUsd`-nya terisi dari kolom cost CSV. */
  costFilled: number;
  /** Pesan jujur bila cost tidak bisa diisi dari CSV (null = cost terisi). */
  costNotice: string | null;
};

/* ------------------------------------------------------------------ */
/* CSV parser                                                          */
/* ------------------------------------------------------------------ */

/**
 * Pecah teks CSV menjadi baris sel. Baris kosong (semua sel kosong) dibuang.
 *
 * Nomor baris (`row`) dihitung dari posisi fisik di file (header = baris 1)
 * supaya user bisa langsung menunjuk baris di spreadsheet-nya.
 */
function parseCsv(text: string): Array<{ row: number; cells: string[] }> {
  const src = text.replace(/^\uFEFF/, '');
  const rows: Array<{ row: number; cells: string[] }> = [];

  let cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;
  let hasContent = false;

  const pushCell = (): void => {
    cells.push(cell);
    cell = '';
  };

  const pushRow = (): void => {
    const meaningful = cells.some((c) => c.trim().length > 0);
    if (meaningful) rows.push({ row: rowStartLine, cells: cells.map((c) => c.trim()) });
    cells = [];
    hasContent = false;
  };

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line += 1;
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      hasContent = true;
      continue;
    }

    if (ch === ',') {
      pushCell();
      continue;
    }

    if (ch === '\r') {
      // Abaikan CR; LF berikutnya yang menutup baris (CRLF aman).
      continue;
    }

    if (ch === '\n') {
      pushCell();
      pushRow();
      line += 1;
      rowStartLine = line;
      continue;
    }

    if (!hasContent) hasContent = true;
    cell += ch;
  }

  // Baris terakhir tanpa newline.
  if (cell.length > 0 || cells.length > 0) {
    pushCell();
    pushRow();
  }

  return rows;
}

/* ------------------------------------------------------------------ */
/* Header & baris data                                                 */
/* ------------------------------------------------------------------ */

const REQUIRED_COLUMNS = ['report_date', 'depth_md_start', 'depth_md_end', 'start', 'end', 'iadc_code'] as const;

type CanonicalColumn =
  | 'report_date'
  | 'depth_md_start'
  | 'depth_md_end'
  | 'start'
  | 'end'
  | 'iadc_code'
  | 'iadc_subcode'
  | 'remarks'
  | 'npt_flag'
  | 'report_no'
  | 'vendor'
  | 'cost';

/**
 * Nama kolom umum → kolom kanonik (P1-9).
 *
 * Kunci SUDAH dalam bentuk ternormalisasi (`normalizeHeader`). Urutan penting:
 * `depth`/`md` sengaja dipetakan ke `depth_md_end` (paling sering berarti
 * "kedalaman saat ini"), sedangkan "from"/"depth start" ke awal.
 */
const HEADER_ALIASES: Record<string, CanonicalColumn> = {
  /* tanggal */
  date: 'report_date',
  tanggal: 'report_date',
  'report date': 'report_date',
  report_date: 'report_date',
  'report dt': 'report_date',
  tgl: 'report_date',
  /* kedalaman */
  'start depth': 'depth_md_start',
  'depth start': 'depth_md_start',
  from_depth: 'depth_md_start',
  'from depth': 'depth_md_start',
  from: 'depth_md_start',
  'depth md start': 'depth_md_start',
  depth_md_start: 'depth_md_start',
  'end depth': 'depth_md_end',
  'depth end': 'depth_md_end',
  to_depth: 'depth_md_end',
  'to depth': 'depth_md_end',
  to: 'depth_md_end',
  'depth md end': 'depth_md_end',
  depth_md_end: 'depth_md_end',
  depth: 'depth_md_end',
  md: 'depth_md_end',
  /* jam */
  'from time': 'start',
  'time from': 'start',
  'start time': 'start',
  start_hm: 'start',
  'end time': 'end',
  'time to': 'end',
  'to time': 'end',
  end_hm: 'end',
  /* kode */
  code: 'iadc_code',
  iadc: 'iadc_code',
  'iadc code': 'iadc_code',
  iadc_code: 'iadc_code',
  'iadc sub': 'iadc_subcode',
  'iadc subcode': 'iadc_subcode',
  iadc_subcode: 'iadc_subcode',
  subcode: 'iadc_subcode',
  /* narasi */
  sub: 'remarks',
  description: 'remarks',
  desc: 'remarks',
  remarks: 'remarks',
  detail: 'remarks',
  keterangan: 'remarks',
  /* flag NPT */
  npt: 'npt_flag',
  'npt flag': 'npt_flag',
  npt_flag: 'npt_flag',
  /* nomor laporan */
  'report no': 'report_no',
  'report number': 'report_no',
  'ddr no': 'report_no',
  no: 'report_no',
  report_no: 'report_no',
  /* vendor */
  vendor: 'vendor',
  kontraktor: 'vendor',
  /* cost */
  cost: 'cost',
  cost_usd: 'cost',
  'cost usd': 'cost',
  amount: 'cost',
  'amount usd': 'cost',
  biaya: 'cost',
  usd: 'cost',
};

/**
 * Bentuk pencarian header: lowercase, trim, spasi/underscore berulang → satu
 * spasi (kompatibel dengan tabel `HEADER_ALIASES` yang memakai spasi).
 */
function normalizeHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, ' ')
    .trim();
}

/** Kunci map `HEADER_ALIASES` dalam bentuk ternormalisasi yang sama. */
const ALIAS_LOOKUP: Map<string, CanonicalColumn> = new Map(
  Object.entries(HEADER_ALIASES).map(([alias, canonical]) => [normalizeHeader(alias), canonical]),
);

/** Nama kolom fisik → kolom kanonik (atau null bila tidak dikenal). */
function canonicalColumn(rawHeader: string): CanonicalColumn | null {
  const normalized = normalizeHeader(rawHeader);
  if (ALIAS_LOOKUP.has(normalized)) return ALIAS_LOOKUP.get(normalized) ?? null;
  // Underscore yang sudah dinormalisasi ke spasi - cek juga versi underscore.
  const underscored = normalized.replace(/ /g, '_');
  const viaUnderscore = ALIAS_LOOKUP.get(normalizeHeader(underscored));
  if (viaUnderscore) return viaUnderscore;
  // Nama kanonik itu sendiri (mis. `depth_md_start`).
  if ((REQUIRED_COLUMNS as readonly string[]).includes(underscored)) return underscored as CanonicalColumn;
  return null;
}

type HeaderMap = Map<string, number>;

function headerIndexOf(header: HeaderMap, name: string): number {
  return header.get(name) ?? -1;
}

function cellAt(cells: string[], header: HeaderMap, name: string): string {
  const idx = headerIndexOf(header, name);
  if (idx < 0 || idx >= cells.length) return '';
  return cells[idx] ?? '';
}

type DraftRow = {
  csvRow: number;
  date: string;
  depthStart: number;
  depthEnd: number;
  reportNo: number | null;
  start: string;
  end: string;
  iadcCode: string;
  iadcSubcode: string | null;
  remarks: string | null;
  nptFlag: boolean;
  vendor: string | null;
  /** Biaya baris (kolom cost CSV), null bila kolomnya tidak ada / kosong. */
  cost: number | null;
};

type DraftGroup = {
  date: string;
  depthStart: number;
  depthEnd: number;
  reportNo: number | null;
  rows: DraftRow[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Normalisasi jam: `6:00` → `06:00`, `600` → `06:00`. Null bila tidak valid. */
function normalizeHm(raw: string): string | null {
  const value = raw.trim();
  if (HM.test(value)) return value;

  const colon = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (colon) {
    const h = Number(colon[1]);
    const m = Number(colon[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return `${String(h).padStart(2, '0')}:${colon[2]}`;
    return null;
  }

  const digits = /^(\d{1,2})(\d{2})$/.exec(value);
  if (digits) {
    const h = Number(digits[1]);
    const m = Number(digits[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return `${String(h).padStart(2, '0')}:${digits[2]}`;
  }

  return null;
}

/** Normalisasi tanggal: `YYYY-MM-DD` atau `DD/MM/YYYY`. Null bila tidak valid. */
function normalizeDate(raw: string): string | null {
  const value = raw.trim();
  if (ISO_DATE.test(value)) return value;

  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);
  if (dmy) {
    const d = Number(dmy[1]);
    const m = Number(dmy[2]);
    const y = Number(dmy[3]);
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  return null;
}

function truthy(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'y' || v === 'npt';
}

/**
 * Normalisasi nominal cost: buang pemisah ribuan (`1,234.50`, `1.234,50`),
 * simbol `$`. Null bila kosong / bukan angka.
 */
function normalizeCost(raw: string): number | null {
  const value = raw.trim().replace(/\$/g, '').replace(/\s/g, '');
  if (!value) return null;

  // Format Eropa (1.234,50) vs format US (1,234.50): pemisah desimal = yang terakhir.
  const lastDot = value.lastIndexOf('.');
  const lastComma = value.lastIndexOf(',');
  let normalized: string;
  if (lastDot > lastComma) {
    normalized = value.replace(/,/g, '');
  } else if (lastComma > lastDot) {
    normalized = value.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = value.replace(/,/g, '');
  }

  const n = Number(normalized);
  return Number.isFinite(n) ? round2(n) : null;
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

async function writeBatch(input: {
  fileName: string;
  rowCount: number;
  errors: ImportRowError[];
  status: 'completed' | 'failed';
  actorId: string | null;
}): Promise<string> {
  const [row] = await db
    .insert(schema.importBatches)
    .values({
      source: 'csv',
      fileName: input.fileName,
      rowCount: input.rowCount,
      errorCount: input.errors.length,
      errors: input.errors.slice(0, 500),
      status: input.status,
      createdBy: input.actorId,
    })
    .returning({ id: schema.importBatches.id });

  return row.id;
}

/**
 * Impor CSV legacy untuk satu sumur.
 *
 * Idempotent di level tanggal: grup yang `report_date`-nya sudah punya DDR untuk
 * sumur tersebut dilewati dan dicatat sebagai error "sudah ada".
 */
export async function importDailyReportsCsv(
  csv: string,
  opts: { wellId: string; rigId?: string | null; actorId?: string | null; fileName?: string },
): Promise<ImportResult> {
  const fileName = opts.fileName ?? 'legacy-import.csv';
  const actorId = opts.actorId ?? null;
  const parsed = parseCsv(csv);

  const errors: ImportRowError[] = [];
  const dataRows = parsed.slice(1);
  const rowCount = dataRows.length;

  if (parsed.length === 0) {
    const batchId = await writeBatch({ fileName, rowCount: 0, errors: [{ row: 0, message: 'File CSV kosong: tidak ada baris data yang bisa diimpor. Periksa isi file lalu ulangi.' }], status: 'failed', actorId });
    return {
      batchId,
      rowCount: 0,
      inserted: 0,
      errorCount: 1,
      errors: [{ row: 0, message: 'File CSV kosong: tidak ada baris data yang bisa diimpor. Periksa isi file lalu ulangi.' }],
      costFilled: 0,
      costNotice: 'Tidak ada data yang diimpor - cost tidak dihitung.',
    };
  }

  /* Peta kolom kanonik → indeks sel, dibangun dari alias header (P1-9). */
  const header: HeaderMap = new Map();
  const unmappedHeaders: string[] = [];
  parsed[0].cells.forEach((name, idx) => {
    const canonical = canonicalColumn(name);
    // Kolom kanonik pertama menang (bila ada duplikat alias, mis. "code" + "IADC").
    if (canonical && !header.has(canonical)) header.set(canonical, idx);
    else if (!canonical && name.trim().length > 0) unmappedHeaders.push(name.trim());
  });

  const missing = REQUIRED_COLUMNS.filter((c) => !header.has(c));
  if (missing.length > 0) {
    const aliasHint =
      'Nama kolom umum dikenali (mis. "Date", "Start Depth", "From Time", "IADC"). ' +
      (unmappedHeaders.length > 0 ? `Kolom tidak dikenali: ${unmappedHeaders.join(', ')}.` : '');
    const message = `Kolom wajib tidak ditemukan: ${missing.join(', ')}. ${aliasHint}`.trim();
    errors.push({ row: parsed[0].row, message });
    const batchId = await writeBatch({ fileName, rowCount, errors, status: 'failed', actorId });
    return { batchId, rowCount, inserted: 0, errorCount: errors.length, errors, costFilled: 0, costNotice: message };
  }

  /** CSV punya kolom cost? Dipakai juga untuk laporan akhir. */
  const hasCostColumn = header.has('cost');

  /* ---- 1. Parse per baris + catat error format ---- */
  const groups = new Map<string, DraftGroup>();

  for (const { row, cells } of dataRows) {
    const date = normalizeDate(cellAt(cells, header, 'report_date'));
    if (!date) {
      errors.push({ row, message: 'Kolom report_date tidak valid. Gunakan format YYYY-MM-DD (mis. 2026-09-11).' });
      continue;
    }

    const depthStartRaw = cellAt(cells, header, 'depth_md_start');
    const depthEndRaw = cellAt(cells, header, 'depth_md_end');
    const depthStart = Number(depthStartRaw.replace(/,/g, ''));
    const depthEnd = Number(depthEndRaw.replace(/,/g, ''));

    if (!Number.isFinite(depthStart) || !Number.isFinite(depthEnd)) {
      errors.push({ row, message: 'Kolom depth_md_start dan depth_md_end harus berupa angka. Periksa baris ini di CSV.' });
      continue;
    }

    const start = normalizeHm(cellAt(cells, header, 'start'));
    const end = normalizeHm(cellAt(cells, header, 'end'));
    if (!start || !end) {
      errors.push({ row, message: 'Kolom start dan end harus berformat jam HH:MM 24 jam (mis. 06:00). Periksa baris ini di CSV.' });
      continue;
    }

    const iadcCode = cellAt(cells, header, 'iadc_code').trim().toUpperCase();
    if (!iadcCode) {
      errors.push({ row, message: 'Kolom iadc_code kosong. Isi kode IADC (mis. 01, 08) untuk baris ini.' });
      continue;
    }

    const reportNoRaw = cellAt(cells, header, 'report_no');
    const reportNo = reportNoRaw ? Number(reportNoRaw) : NaN;

    const draft: DraftRow = {
      csvRow: row,
      date,
      depthStart,
      depthEnd,
      reportNo: Number.isInteger(reportNo) && reportNo > 0 ? reportNo : null,
      start,
      end,
      iadcCode,
      iadcSubcode: cellAt(cells, header, 'iadc_subcode') || null,
      remarks: cellAt(cells, header, 'remarks') || null,
      nptFlag: truthy(cellAt(cells, header, 'npt_flag')),
      vendor: cellAt(cells, header, 'vendor') || null,
      cost: hasCostColumn ? normalizeCost(cellAt(cells, header, 'cost')) : null,
    };

    const existing = groups.get(date);
    if (!existing) {
      groups.set(date, {
        date,
        depthStart,
        depthEnd,
        reportNo: draft.reportNo,
        rows: [draft],
      });
      continue;
    }

    /*
     * P1-9 #4: baris ke-2 dst pada tanggal yang sama HARUS konsisten dengan
     * baris pertama. Sebelumnya perbedaan `report_no` / `depth_md_end` diabaikan
     * diam-diam (data hilang tanpa jejak). Kini dicatat sebagai error baris.
     */
    const mismatches: string[] = [];
    if (draft.reportNo !== null && existing.reportNo !== null && draft.reportNo !== existing.reportNo) {
      mismatches.push(`report_no ${draft.reportNo} ≠ ${existing.reportNo} (baris pertama tanggal ini)`);
    }
    if (Math.abs(draft.depthEnd - existing.depthEnd) > 0.001) {
      mismatches.push(`depth_md_end ${draft.depthEnd} ≠ ${existing.depthEnd} (baris pertama tanggal ini)`);
    }
    if (mismatches.length > 0) {
      errors.push({
        row,
        message: `[${date}] baris tidak konsisten dengan baris pertama grup: ${mismatches.join('; ')}.`,
      });
      continue;
    }

    existing.rows.push(draft);
  }

  /* ---- 2. Validasi grup + tulis report ---- */
  let inserted = 0;
  let costFilled = 0;

  for (const group of groups.values()) {
    const firstRow = group.rows[0]?.csvRow ?? 0;

    const validation = validateTimeBreakdown(
      group.rows.map((r) => ({
        start: r.start,
        end: r.end,
        code: r.iadcCode,
        npt: r.nptFlag,
        remarks: r.remarks ?? r.iadcSubcode ?? undefined,
      })),
      { requireFull24h: true, validCodes: VALID_IADC_CODES, subCodeRequired: SUBCODE_REQUIRED_IADC },
    );

    const groupErrors = validation.issues.filter((i) => i.severity === 'error');
    if (groupErrors.length > 0) {
      for (const issue of groupErrors) {
        const offset = typeof issue.rowIndex === 'number' ? group.rows[issue.rowIndex]?.csvRow : undefined;
        errors.push({ row: offset ?? firstRow, message: `[${group.date}] ${issue.message}` });
      }
      continue;
    }

    /* Idempotent: lewati tanggal yang sudah punya DDR untuk sumur ini. */
    const existingReport = await db
      .select({ id: schema.dailyReports.id })
      .from(schema.dailyReports)
      .where(
        and(
          eq(schema.dailyReports.wellId, opts.wellId),
          eq(schema.dailyReports.reportDate, group.date),
          isNull(schema.dailyReports.deletedAt),
        ),
      )
      .limit(1);

    if (existingReport[0]) {
      errors.push({ row: firstRow, message: `[${group.date}] DDR untuk tanggal ini sudah ada, baris dilewati.` });
      continue;
    }

    let createdId: string | null = null;
    try {
      const created = await createReport({
        wellId: opts.wellId,
        rigId: opts.rigId ?? null,
        reportDate: group.date,
        reportNo: group.reportNo ?? undefined,
        depthMdStart: group.depthStart,
        depthMdEnd: group.depthEnd,
        createdBy: actorId,
      });
      createdId = created.id;

      await replaceTimeRows(
        created.id,
        group.rows.map((r) => ({
          start: r.start,
          end: r.end,
          iadcCode: r.iadcCode,
          iadcSubcode: r.iadcSubcode,
          vendor: r.vendor,
          nptFlag: r.nptFlag,
          remarks: r.remarks,
        })),
      );

      /* Cost (P1-9 #3): isi dari kolom CSV bila ada, selain itu biarkan 0. */
      const groupCost = round2(
        group.rows.reduce((acc, r) => acc + (r.cost ?? 0), 0),
      );
      if (hasCostColumn && group.rows.some((r) => r.cost !== null)) {
        const label = group.rows[0]?.remarks?.trim() || `Impor legacy CSV ${fileName}`;
        await db.insert(schema.costLines).values({
          reportId: created.id,
          wellId: opts.wellId,
          category: 'Lain-lain',
          description: label.slice(0, 300),
          amountUsd: groupCost.toFixed(2),
          rebillable: false,
        });
        // Recompute kolom denormalisasi memakai helper bersama repo (satu jalur
        // hitung dengan dashboard/cost) - bukan rumus baru di importer.
        await db.transaction(async (tx) => {
          await recomputeReportCosts(tx, created.id);
        });
        costFilled += 1;
      }

      inserted += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      /*
       * KOMPENSASI (P1-9 #2): `createReport` dan `replaceTimeRows` tidak berbagi
       * transaksi. Bila langkah setelah `createReport` gagal, laporan setengah
       * jadi itu di-soft-delete bersama anaknya agar tidak ada DDR orphan.
       */
      const compensation = createdId ? await compensateFailedImport(createdId) : { ok: true, detail: '' };

      errors.push({
        row: firstRow,
        message:
          `[${group.date}] Gagal menyimpan DDR: ${message} Perbaiki baris ini lalu ulangi impor.` +
          (createdId
            ? compensation.ok
              ? ' DDR parsial sudah dibatalkan (soft delete).'
              : ` DDR parsial GAGAL dibatalkan: ${compensation.detail}`
            : ''),
      });
    }
  }

  const costNotice = hasCostColumn
    ? costFilled > 0
      ? null
      : 'Kolom cost ada tetapi tidak ada nilai yang terbaca - cost DDR dibiarkan 0.'
    : 'CSV tidak punya kolom cost - cost DDR dibiarkan 0. Lengkapi lewat modul Cost lalu simpan.';

  const batchId = await writeBatch({
    fileName,
    rowCount,
    errors,
    status: errors.length > 0 && inserted === 0 ? 'failed' : 'completed',
    actorId,
  });

  return { batchId, rowCount, inserted, errorCount: errors.length, errors, costFilled, costNotice };
}

/**
 * Batalkan DDR hasil impor yang gagal di tengah jalan (soft delete).
 *
 * Soft delete dipilih (bukan hard delete) supaya jejak audit tetap ada; semua
 * query repo/dashboard memakai `deletedAt IS NULL` sehingga DDR ini tidak
 * muncul lagi di layar maupun angka KPI.
 */
async function compensateFailedImport(
  reportId: string,
): Promise<{ ok: boolean; detail: string }> {
  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(schema.timeBreakdown)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(schema.timeBreakdown.reportId, reportId));
      await tx
        .update(schema.costLines)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(schema.costLines.reportId, reportId));
      await tx
        .update(schema.dailyReports)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(schema.dailyReports.id, reportId));
    });
    return { ok: true, detail: '' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
