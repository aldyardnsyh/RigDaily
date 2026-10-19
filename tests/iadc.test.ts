/**
 * Taksonomi IADC-compatible (34 kode) + klasifikasi waktu.
 */
import { describe, expect, it } from 'vitest';
import {
  IADC_BY_CODE,
  IADC_CODES,
  NPT_CODES,
  PRODUCTIVE_CODES,
  classifyTime,
  getIadcCode,
  iadcLabel,
} from '@rigdaily/shared';

describe('IADC_CODES - integritas daftar', () => {
  it('berisi tepat 34 kode', () => {
    expect(IADC_CODES).toHaveLength(34);
  });

  it('semua kode unik', () => {
    const unique = new Set(IADC_CODES.map((c) => c.code));
    expect(unique.size).toBe(IADC_CODES.length);
  });

  it('num 1..34 tanpa duplikat', () => {
    const nums = IADC_CODES.map((c) => c.num).sort((a, b) => a - b);
    expect(nums).toEqual(Array.from({ length: 34 }, (_, i) => i + 1));
  });

  it('setiap kode 2 digit dan cocok dengan num (01..34)', () => {
    for (const c of IADC_CODES) {
      expect(c.code).toMatch(/^\d{2}$/);
      expect(Number(c.code)).toBe(c.num);
    }
  });

  it('setiap kode punya nama non-kosong', () => {
    for (const c of IADC_CODES) {
      expect(c.name.trim().length).toBeGreaterThan(0);
    }
  });

  it('index IADC_BY_CODE memuat semua kode', () => {
    expect(Object.keys(IADC_BY_CODE)).toHaveLength(34);
  });
});

describe('flag sub-code', () => {
  it("kode '08' (Repair Rig) wajib sub-code", () => {
    expect(getIadcCode('08')?.subCodeRequired).toBe(true);
  });

  it("kode '18' (Fishing) dan '24' (NPT) wajib sub-code", () => {
    expect(getIadcCode('18')?.subCodeRequired).toBe(true);
    expect(getIadcCode('24')?.subCodeRequired).toBe(true);
  });

  it("kode '01' tidak wajib sub-code", () => {
    expect(getIadcCode('01')?.subCodeRequired ?? false).toBe(false);
  });

  it('getIadcCode kode tidak dikenal → undefined', () => {
    expect(getIadcCode('99')).toBeUndefined();
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
    ['', 'GAP'],
  ] as const)("kode '%s' → %s", (code, expected) => {
    expect(classifyTime(code)).toBe(expected);
  });

  it('WOW/FM/STBY/DSPT mengalahkan flag productive kode', () => {
    // 27,28,29,26 punya productive=false tapi kelas khusus tetap diprioritaskan
    expect(classifyTime('27')).toBe('WOW');
    expect(classifyTime('28')).toBe('FM');
    expect(classifyTime('29')).toBe('DSPT');
    expect(classifyTime('26')).toBe('STBY');
  });

  it('setiap kode di IADC_CODES menghasilkan kelas yang valid', () => {
    const valid = new Set(['PRD', 'NPT', 'WOW', 'FM', 'STBY', 'DSPT', 'GAP']);
    for (const c of IADC_CODES) {
      expect(valid.has(classifyTime(c.code))).toBe(true);
      expect(classifyTime(c.code)).not.toBe('GAP');
    }
  });

  it('kode productive=true selalu PRD (kecuali kelas khusus)', () => {
    const special = new Set(['26', '27', '28', '29']);
    for (const c of IADC_CODES.filter((x) => x.productive && !special.has(x.code))) {
      expect(classifyTime(c.code)).toBe('PRD');
    }
  });

  it('kode productive=false & bukan kelas khusus → NPT', () => {
    const special = new Set(['26', '27', '28', '29']);
    for (const c of IADC_CODES.filter((x) => !x.productive && !special.has(x.code))) {
      expect(classifyTime(c.code)).toBe('NPT');
    }
  });
});

describe('NPT_CODES & PRODUCTIVE_CODES', () => {
  it('NPT_CODES minimal berisi 08, 18, 24, 27', () => {
    const codes = NPT_CODES.map((c) => c.code);
    expect(codes).toEqual(expect.arrayContaining(['08', '18', '24', '27']));
  });

  it('NPT_CODES konsisten dengan nptDefault pada IADC_CODES', () => {
    expect(NPT_CODES).toEqual(IADC_CODES.filter((c) => c.nptDefault));
  });

  it('PRODUCTIVE_CODES konsisten dengan flag productive', () => {
    expect(PRODUCTIVE_CODES).toEqual(IADC_CODES.filter((c) => c.productive));
  });

  it('kode 27 (Wait on Weather) ditandai nptDefault', () => {
    expect(NPT_CODES.some((c) => c.code === '27')).toBe(true);
  });
});

describe('iadcLabel', () => {
  it("label kode '01' memuat kode dan nama", () => {
    expect(iadcLabel('01')).toBe('01 Rotary Drilling');
  });

  it('kode tidak dikenal diberi label Unknown', () => {
    expect(iadcLabel('99')).toBe('Unknown (99)');
  });
});
