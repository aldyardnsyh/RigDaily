/**
 * ATURAN 24 JAM - test paling kritis di RigDaily.
 *
 * Regresi di sini berarti DDR bisa lolos submit dengan total ≠ 24.00h atau
 * baris saling overlap, yang langsung merusak billing & PDF.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyTime,
  formatHm,
  formatHours,
  parseHm,
  rowDurationMinutes,
  summarizeTime,
  validateTimeBreakdown,
  type TimeRowInput,
} from '@rigdaily/shared';
import { SEED_TIME_ROWS, seedTimeInputs } from './helpers/fixtures';

/** Set kode IADC valid (34 kode) + set sub-code wajib, disalin dari shared. */
const VALID_CODES = new Set(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '34']);
const SUBCODE_REQUIRED = new Set(['08', '18', '24']);

function issuesOf(rows: TimeRowInput[], opts: Parameters<typeof validateTimeBreakdown>[1] = {}) {
  return validateTimeBreakdown(rows, opts).issues;
}

function codes(rows: TimeRowInput[], opts: Parameters<typeof validateTimeBreakdown>[1] = {}) {
  return issuesOf(rows, opts).map((i) => i.code);
}

/* ------------------------------------------------------------------ */
/* parseHm                                                             */
/* ------------------------------------------------------------------ */

describe('parseHm', () => {
  it('mengubah "06:00" menjadi 360 menit', () => {
    expect(parseHm('06:00')).toBe(360);
  });

  it('menerima "24:00" sebagai 1440 menit (batas akhir hari)', () => {
    expect(parseHm('24:00')).toBe(1440);
  });

  it('menerima "00:00" sebagai 0 menit', () => {
    expect(parseHm('00:00')).toBe(0);
  });

  it('menerima jam satu digit "6:00" (toleran terhadap input manual)', () => {
    expect(parseHm('6:00')).toBe(360);
  });

  it('menolak menit tidak valid "06:60"', () => {
    expect(parseHm('06:60')).toBeNull();
  });

  it('menolak jam tidak valid "25:00"', () => {
    expect(parseHm('25:00')).toBeNull();
  });

  it('menolak "24:30" (24:xx hanya boleh 24:00)', () => {
    expect(parseHm('24:30')).toBeNull();
  });

  it('menolak teks "abc"', () => {
    expect(parseHm('abc')).toBeNull();
  });

  it('menolak string kosong', () => {
    expect(parseHm('')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* formatHm / formatHours                                              */
/* ------------------------------------------------------------------ */

describe('formatHm & formatHours', () => {
  it('formatHm(360) → "06:00"', () => {
    expect(formatHm(360)).toBe('06:00');
  });

  it('formatHm(1440) membungkus ke "00:00" (representasi hari berikutnya)', () => {
    expect(formatHm(1440)).toBe('00:00');
  });

  it('formatHm(-30) membungkus negatif ke "23:30"', () => {
    expect(formatHm(-30)).toBe('23:30');
  });

  it('formatHm(255) → "04:15"', () => {
    expect(formatHm(255)).toBe('04:15');
  });

  it('formatHours(1440) → "24.00"', () => {
    expect(formatHours(1440)).toBe('24.00');
  });

  it('formatHours(90) → "1.50"', () => {
    expect(formatHours(90)).toBe('1.50');
  });

  it('formatHours mendukung digit kustom', () => {
    expect(formatHours(90, 1)).toBe('1.5');
  });
});

/* ------------------------------------------------------------------ */
/* rowDurationMinutes                                                  */
/* ------------------------------------------------------------------ */

describe('rowDurationMinutes', () => {
  it('"06:00" → "08:30" = 150 menit', () => {
    expect(rowDurationMinutes('06:00', '08:30')).toBe(150);
  });

  it('"22:00" → "04:30" = 390 menit (lintas tengah malam)', () => {
    expect(rowDurationMinutes('22:00', '04:30')).toBe(390);
  });

  it('"06:00" → "06:00" = 0 menit', () => {
    expect(rowDurationMinutes('06:00', '06:00')).toBe(0);
  });

  it('"00:00" → "24:00" = 1440 menit (satu hari penuh)', () => {
    expect(rowDurationMinutes('00:00', '24:00')).toBe(1440);
  });

  it('format tidak valid → null', () => {
    expect(rowDurationMinutes('abc', '08:00')).toBeNull();
  });

  it('jumlah durasi seluruh baris seed = 1440 menit', () => {
    const total = SEED_TIME_ROWS.reduce((acc, r) => acc + (rowDurationMinutes(r.start, r.end) ?? 0), 0);
    expect(total).toBe(1440);
  });
});

/* ------------------------------------------------------------------ */
/* validateTimeBreakdown - happy path seed DDR #145                    */
/* ------------------------------------------------------------------ */

describe('validateTimeBreakdown - DDR #145 seed', () => {
  it('9 baris seed berjumlah 1440 menit → ok, tanpa issue', () => {
    const result = validateTimeBreakdown(seedTimeInputs(), { validCodes: VALID_CODES });

    expect(result.totalMinutes).toBe(1440);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('9 baris seed tetap ok saat subCodeRequired diaktifkan (semua Code 08 punya remarks)', () => {
    const result = validateTimeBreakdown(seedTimeInputs(), {
      validCodes: VALID_CODES,
      subCodeRequired: SUBCODE_REQUIRED,
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* validateTimeBreakdown - gap / excess                                */
/* ------------------------------------------------------------------ */

describe('validateTimeBreakdown - total 24 jam', () => {
  it('hilang 1 baris (90 menit) → TIME_GAP dengan pesan "1.50h"', () => {
    const rows = seedTimeInputs().filter((_, i) => i !== 2); // buang 11:30-13:00 (90 menit)
    const result = validateTimeBreakdown(rows, { validCodes: VALID_CODES });

    expect(result.ok).toBe(false);
    expect(result.totalMinutes).toBe(1350);

    const gap = result.issues.filter((i) => i.code === 'TIME_GAP');
    expect(gap).toHaveLength(1);
    expect(gap[0].severity).toBe('error');
    expect(gap[0].message).toContain('1.50h');
  });

  it('total 1500 menit (kelebihan) → TIME_EXCESS, bukan TIME_GAP', () => {
    const rows: TimeRowInput[] = [
      { start: '00:00', end: '12:00', code: '01' },
      { start: '12:00', end: '24:00', code: '01' },
      { start: '00:00', end: '01:00', code: '01' }, // 60 menit ekstra (overlap juga)
    ];
    const result = validateTimeBreakdown(rows, { validCodes: VALID_CODES });

    expect(result.totalMinutes).toBe(1500);
    expect(result.ok).toBe(false);
    expect(codes(rows, { validCodes: VALID_CODES })).toContain('TIME_EXCESS');
    expect(codes(rows, { validCodes: VALID_CODES })).not.toContain('TIME_GAP');
  });

  it('array kosong → TIME_GAP 1440 menit', () => {
    const result = validateTimeBreakdown([], { validCodes: VALID_CODES });

    expect(result.totalMinutes).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toEqual(['TIME_GAP']);
    expect(result.issues[0].message).toContain('24.00h');
  });

  it('requireFull24h: false → tidak ada TIME_GAP walau kurang', () => {
    const rows: TimeRowInput[] = [{ start: '06:00', end: '12:00', code: '01' }];
    const result = validateTimeBreakdown(rows, { requireFull24h: false, validCodes: VALID_CODES });

    expect(result.totalMinutes).toBe(360);
    expect(result.issues.map((i) => i.code)).not.toContain('TIME_GAP');
    expect(result.ok).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* validateTimeBreakdown - overlap                                     */
/* ------------------------------------------------------------------ */

describe('validateTimeBreakdown - overlap', () => {
  it('dua baris overlap (06:00-08:30 & 08:00-09:00) → TIME_OVERLAP "Overlap 08:00-08:30"', () => {
    const rows: TimeRowInput[] = [
      { start: '06:00', end: '08:30', code: '01' },
      { start: '08:00', end: '09:00', code: '01' },
    ];
    const result = validateTimeBreakdown(rows, { validCodes: VALID_CODES });

    const overlap = result.issues.filter((i) => i.code === 'TIME_OVERLAP');
    expect(overlap).toHaveLength(1);
    expect(overlap[0].message).toContain('Overlap 08:00-08:30');
    expect(result.ok).toBe(false);
  });

  it('overlap lintas tengah malam terdeteksi (22:00-04:00 vs 03:00-05:00)', () => {
    const rows: TimeRowInput[] = [
      { start: '22:00', end: '04:00', code: '09' },
      { start: '03:00', end: '05:00', code: '09' },
    ];
    const result = validateTimeBreakdown(rows, { requireFull24h: false, validCodes: VALID_CODES });

    const overlap = result.issues.filter((i) => i.code === 'TIME_OVERLAP');
    expect(overlap).toHaveLength(1);
    expect(overlap[0].message).toContain('Overlap 03:00-04:00');
  });

  it('baris bersambung tepat (06:00-08:00 lalu 08:00-09:00) tidak dianggap overlap', () => {
    const rows: TimeRowInput[] = [
      { start: '06:00', end: '08:00', code: '01' },
      { start: '08:00', end: '09:00', code: '01' },
    ];
    const result = validateTimeBreakdown(rows, { requireFull24h: false, validCodes: VALID_CODES });

    expect(result.issues).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* validateTimeBreakdown - kode, sub-code, format, durasi 0            */
/* ------------------------------------------------------------------ */

describe('validateTimeBreakdown - validasi baris', () => {
  it('kode IADC tidak dikenal "99" → IADC_UNKNOWN', () => {
    const rows: TimeRowInput[] = [{ start: '06:00', end: '07:00', code: '99' }];
    const issues = issuesOf(rows, { requireFull24h: false, validCodes: VALID_CODES });

    expect(issues.map((i) => i.code)).toContain('IADC_UNKNOWN');
    expect(issues.find((i) => i.code === 'IADC_UNKNOWN')?.message).toContain('"99"');
  });

  it('kode "08" tanpa remarks + subCodeRequired → SUBCode_REQUIRED', () => {
    const rows: TimeRowInput[] = [{ start: '06:00', end: '07:00', code: '08', npt: true }];
    const issues = issuesOf(rows, { requireFull24h: false, validCodes: VALID_CODES, subCodeRequired: SUBCODE_REQUIRED });

    expect(issues.map((i) => i.code)).toContain('SUBCode_REQUIRED');
  });

  it('kode "08" dengan remarks kosong-spasi tetap SUBCode_REQUIRED', () => {
    const rows: TimeRowInput[] = [{ start: '06:00', end: '07:00', code: '08', remarks: '   ' }];
    const issues = issuesOf(rows, { requireFull24h: false, validCodes: VALID_CODES, subCodeRequired: SUBCODE_REQUIRED });

    expect(issues.map((i) => i.code)).toContain('SUBCode_REQUIRED');
  });

  it('kode "08" dengan remarks terisi → tidak ada SUBCode_REQUIRED', () => {
    const rows: TimeRowInput[] = [{ start: '06:00', end: '07:00', code: '08', remarks: 'Mud Pump #2 [Gardner Denver]' }];
    const issues = issuesOf(rows, { requireFull24h: false, validCodes: VALID_CODES, subCodeRequired: SUBCODE_REQUIRED });

    expect(issues.map((i) => i.code)).not.toContain('SUBCode_REQUIRED');
  });

  it('format waktu salah "6:0" → TIME_FORMAT', () => {
    const rows: TimeRowInput[] = [{ start: '6:0', end: '07:00', code: '01' }];
    const issues = issuesOf(rows, { requireFull24h: false, validCodes: VALID_CODES });

    expect(issues.map((i) => i.code)).toContain('TIME_FORMAT');
    expect(issues.find((i) => i.code === 'TIME_FORMAT')?.message).toContain('HH:MM');
  });

  it('baris durasi 0 (06:00-06:00) → TIME_ZERO', () => {
    const rows: TimeRowInput[] = [{ start: '06:00', end: '06:00', code: '01' }];
    const issues = issuesOf(rows, { requireFull24h: false, validCodes: VALID_CODES });

    expect(issues.map((i) => i.code)).toContain('TIME_ZERO');
  });

  it('baris dengan TIME_ZERO tidak menghasilkan TIME_GAP tambahan (hindari noise)', () => {
    const rows: TimeRowInput[] = [{ start: '06:00', end: '06:00', code: '01' }];
    const issues = issuesOf(rows, { requireFull24h: true, validCodes: VALID_CODES });

    expect(issues.map((i) => i.code)).toEqual(['TIME_ZERO']);
  });

  it('semua issue menyertakan rowIndex yang menunjuk baris bermasalah', () => {
    const rows: TimeRowInput[] = [
      { start: '06:00', end: '07:00', code: '01' },
      { start: '07:00', end: '08:00', code: '99' },
    ];
    const issues = issuesOf(rows, { requireFull24h: false, validCodes: VALID_CODES });

    expect(issues.find((i) => i.code === 'IADC_UNKNOWN')?.rowIndex).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* summarizeTime + classifyTime                                        */
/* ------------------------------------------------------------------ */

describe('summarizeTime - DDR #145 seed', () => {
  const summary = summarizeTime(seedTimeInputs(), classifyTime);

  it('total 1440 menit', () => {
    expect(summary.totalMinutes).toBe(1440);
  });

  it('productive 1200 menit (20.0h)', () => {
    expect(summary.productiveMinutes).toBe(1200);
  });

  it('npt 150 menit (2.5h)', () => {
    expect(summary.nptMinutes).toBe(150);
  });

  it('wow 90 menit (1.5h)', () => {
    expect(summary.wowMinutes).toBe(90);
  });

  it('gap 0 menit', () => {
    expect(summary.gapMinutes).toBe(0);
  });

  it('nptPercent ≈ 16.67', () => {
    expect(summary.nptPercent).toBeCloseTo(16.67, 2);
  });

  it('productivePercent = 83.33', () => {
    expect(summary.productivePercent).toBeCloseTo(83.333, 3);
  });

  it('fm/standby/disputed 0 pada seed', () => {
    expect(summary.fmMinutes).toBe(0);
    expect(summary.standbyMinutes).toBe(0);
    expect(summary.disputedMinutes).toBe(0);
  });
});

describe('classifyTime', () => {
  it.each([
    ['01', 'PRD'],
    ['08', 'NPT'],
    ['27', 'WOW'],
    ['28', 'FM'],
    ['26', 'STBY'],
    ['29', 'DSPT'],
    ['99', 'GAP'],
  ] as const)('kode %s → %s', (code, expected) => {
    expect(classifyTime(code)).toBe(expected);
  });
});

/* ------------------------------------------------------------------ */
/* Kasus tepi / performa                                               */
/* ------------------------------------------------------------------ */

describe('kasus tepi', () => {
  it('array kosong → gap 1440 menit', () => {
    const summary = summarizeTime([], classifyTime);
    expect(summary.totalMinutes).toBe(0);
    expect(summary.gapMinutes).toBe(1440);
  });

  it('1440 baris berdurasi 1 menit diproses < 500ms dan tetap total 1440', () => {
    // Catatan: `formatHm(1440)` membungkus ke "00:00", jadi baris terakhir
    // harus ditulis eksplisit sebagai 23:59 → 24:00.
    const rows: TimeRowInput[] = Array.from({ length: 1440 }, (_, i) => ({
      start: formatHm(i),
      end: i === 1439 ? '24:00' : formatHm(i + 1),
      code: '01',
    }));

    const started = performance.now();
    const result = validateTimeBreakdown(rows, { validCodes: VALID_CODES });
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(500);
    expect(result.totalMinutes).toBe(1440);
    expect(result.ok).toBe(true);
  });

  /**
   * PERILAKU TERKUNCI (bug produksi terverifikasi):
   * interval `23:59 → 24:00` menghasilkan {from: 1439, to: 1440} sehingga tidak
   * ada overlap - hasilnya BENAR. Test ini menjaga agar tidak regresi.
   * (Kasus 24:00 dibahas juga di bagian kasus tepi.)
   */
  it('baris 23:59-24:00 valid dan tidak memicu issue', () => {
    const result = validateTimeBreakdown([{ start: '23:59', end: '24:00', code: '01' }], {
      requireFull24h: false,
      validCodes: VALID_CODES,
    });

    expect(result.totalMinutes).toBe(1);
    expect(result.issues).toEqual([]);
  });

  it('baris melewati tengah malam tidak dihitung sebagai gap (regresi DDR 06:00-06:00)', () => {
    const rows: TimeRowInput[] = [
      { start: '06:00', end: '18:00', code: '01' },
      { start: '18:00', end: '06:00', code: '01' },
    ];
    const result = validateTimeBreakdown(rows, { validCodes: VALID_CODES });

    expect(result.totalMinutes).toBe(1440);
    expect(result.ok).toBe(true);
  });
});
