/**
 * IADC-COMPATIBLE CODE SET (34 main codes) - RigDaily Internal
 *
 * CATATAN LEGAL: Daftar ini adalah taksonomi operasi pengeboran yang disusun sendiri
 * (clean-room) agar "IADC-compatible format". JANGAN klaim "IADC Certified".
 * Struktur mengikuti pola publik DDR Plus (34 main code + sub-code granular),
 * lihat 05-Data-Model-DDR-IADC-Checklist-Parity.md §1.
 *
 * FROZEN CONTRACT - jangan ubah nilai `code`/`num` tanpa migrasi DB.
 */

export type IadcCategory =
  | 'drilling'
  | 'tripping'
  | 'well-construction'
  | 'evaluation'
  | 'intervention'
  | 'rig-move'
  | 'support'
  | 'npt'
  | 'other';

export type IadcCode = {
  /** Kode 2 digit, dipakai di DB & UI. */
  code: string;
  num: number;
  name: string;
  category: IadcCategory;
  /** true = masuk hitungan "productive time" di dashboard. */
  productive: boolean;
  /** true = default dihitung NPT; bisa dioverride company policy per laporan. */
  nptDefault: boolean;
  /** true = wajib isi sub-code (equipment/system/vendor) - pemecah Code 08. */
  subCodeRequired?: boolean;
};

export const IADC_CODES: IadcCode[] = [
  { code: '01', num: 1, name: 'Rotary Drilling', category: 'drilling', productive: true, nptDefault: false },
  { code: '02', num: 2, name: 'Slide Drilling (Steering)', category: 'drilling', productive: true, nptDefault: false },
  { code: '03', num: 3, name: 'Reaming', category: 'drilling', productive: true, nptDefault: false },
  { code: '04', num: 4, name: 'Hole Opening / Underreaming', category: 'drilling', productive: true, nptDefault: false },
  { code: '05', num: 5, name: 'Casing Drilling', category: 'drilling', productive: true, nptDefault: false },
  { code: '06', num: 6, name: 'Coring', category: 'drilling', productive: true, nptDefault: false },
  { code: '07', num: 7, name: 'Sidetrack / Mill', category: 'drilling', productive: true, nptDefault: false },
  { code: '08', num: 8, name: 'Repair Rig', category: 'npt', productive: false, nptDefault: true, subCodeRequired: true },
  { code: '09', num: 9, name: 'Tripping (POOH / RIH)', category: 'tripping', productive: true, nptDefault: false },
  { code: '10', num: 10, name: 'Circulate & Condition', category: 'tripping', productive: true, nptDefault: false },
  { code: '11', num: 11, name: 'Casing & Liner Running', category: 'well-construction', productive: true, nptDefault: false },
  { code: '12', num: 12, name: 'Cementing', category: 'well-construction', productive: true, nptDefault: false },
  { code: '13', num: 13, name: 'Logging & Evaluation', category: 'evaluation', productive: true, nptDefault: false },
  { code: '14', num: 14, name: 'Rig Service & Handover (Planned)', category: 'support', productive: true, nptDefault: false },
  { code: '15', num: 15, name: 'Well Testing', category: 'evaluation', productive: true, nptDefault: false },
  { code: '16', num: 16, name: 'Completion Operations', category: 'well-construction', productive: true, nptDefault: false },
  { code: '17', num: 17, name: 'Workover / Intervention', category: 'intervention', productive: true, nptDefault: false },
  { code: '18', num: 18, name: 'Fishing', category: 'intervention', productive: false, nptDefault: true, subCodeRequired: true },
  { code: '19', num: 19, name: 'Milling / Cutting', category: 'intervention', productive: true, nptDefault: false },
  { code: '20', num: 20, name: 'Wireline Operations', category: 'intervention', productive: true, nptDefault: false },
  { code: '21', num: 21, name: 'Coiled Tubing', category: 'intervention', productive: true, nptDefault: false },
  { code: '22', num: 22, name: 'Snubbing / Hydraulic Workover', category: 'intervention', productive: true, nptDefault: false },
  { code: '23', num: 23, name: 'Other (User Defined)', category: 'other', productive: true, nptDefault: false },
  { code: '24', num: 24, name: 'NPT (Non-Productive Time)', category: 'npt', productive: false, nptDefault: true, subCodeRequired: true },
  { code: '25', num: 25, name: 'Rig Move', category: 'rig-move', productive: true, nptDefault: false },
  { code: '26', num: 26, name: 'Standby (Operator Request)', category: 'support', productive: false, nptDefault: false },
  { code: '27', num: 27, name: 'Wait on Weather', category: 'support', productive: false, nptDefault: true },
  { code: '28', num: 28, name: 'Force Majeure', category: 'support', productive: false, nptDefault: false },
  { code: '29', num: 29, name: 'Disputed Time', category: 'support', productive: false, nptDefault: false },
  { code: '30', num: 30, name: 'Safety Meeting / Drill', category: 'support', productive: true, nptDefault: false },
  { code: '31', num: 31, name: 'Fracking Operations', category: 'well-construction', productive: true, nptDefault: false },
  { code: '32', num: 32, name: 'Flowback Operations', category: 'well-construction', productive: true, nptDefault: false },
  { code: '33', num: 33, name: 'Facilities / Production Ops', category: 'support', productive: true, nptDefault: false },
  { code: '34', num: 34, name: 'Plug & Abandonment', category: 'well-construction', productive: true, nptDefault: false },
];

export const IADC_BY_CODE: Record<string, IadcCode> = Object.fromEntries(
  IADC_CODES.map((c) => [c.code, c]),
);

export const NPT_CODES: IadcCode[] = IADC_CODES.filter((c) => c.nptDefault);

export const PRODUCTIVE_CODES: IadcCode[] = IADC_CODES.filter((c) => c.productive);

export function getIadcCode(code: string): IadcCode | undefined {
  return IADC_BY_CODE[code];
}

export function iadcLabel(code: string): string {
  const c = IADC_BY_CODE[code];
  return c ? `${c.code} ${c.name}` : `Unknown (${code})`;
}

/** Kategori waktu untuk ringkasan 24 jam. */
export type TimeClass = 'PRD' | 'NPT' | 'WOW' | 'FM' | 'STBY' | 'DSPT' | 'GAP';

export function classifyTime(code: string): TimeClass {
  const c = IADC_BY_CODE[code];
  if (!c) return 'GAP';
  switch (c.code) {
    case '27':
      return 'WOW';
    case '28':
      return 'FM';
    case '29':
      return 'DSPT';
    case '26':
      return 'STBY';
    default:
      return c.productive ? 'PRD' : 'NPT';
  }
}
