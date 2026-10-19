/**
 * Validasi kedalaman (MD) - mencegah DDR mundur atau lompat tak wajar.
 */
import { describe, expect, it } from 'vitest';
import { validateDepth } from '@rigdaily/shared';

function codesOf(issues: ReturnType<typeof validateDepth>): string[] {
  return issues.map((i) => i.code);
}

describe('validateDepth - alur normal', () => {
  it('2833 → 2845 (progress +12m) tidak menghasilkan issue', () => {
    expect(validateDepth(2833, 2845)).toEqual([]);
  });

  it('2833 → 2845 dengan prevEnd 2833 (chaining benar) tidak menghasilkan issue', () => {
    expect(validateDepth(2833, 2845, 2833)).toEqual([]);
  });

  it('prevEnd null dianggap tidak ada laporan sebelumnya', () => {
    expect(validateDepth(2833, 2845, null)).toEqual([]);
  });
});

describe('validateDepth - regresi', () => {
  it('2845 → 2833 (mundur) → DEPTH_REGRESS (error)', () => {
    const issues = validateDepth(2845, 2833);

    expect(codesOf(issues)).toContain('DEPTH_REGRESS');
    const regress = issues.find((i) => i.code === 'DEPTH_REGRESS');
    expect(regress?.severity).toBe('error');
    expect(regress?.message).toContain('2845m');
  });

  it('depth awal < depth akhir laporan sebelumnya → DEPTH_CHAIN (error)', () => {
    const issues = validateDepth(2833, 2845, 2860);

    expect(codesOf(issues)).toContain('DEPTH_CHAIN');
    expect(issues.find((i) => i.code === 'DEPTH_CHAIN')?.severity).toBe('error');
  });

  it('depth awal == prevEnd tidak dianggap chain regression', () => {
    expect(codesOf(validateDepth(2860, 2875, 2860))).not.toContain('DEPTH_CHAIN');
  });
});

describe('validateDepth - warning progress besar', () => {
  it('0 → 600 (progress 600m) → DEPTH_LARGE sebagai warning, bukan error', () => {
    const issues = validateDepth(0, 600);

    const large = issues.find((i) => i.code === 'DEPTH_LARGE');
    expect(large).toBeDefined();
    expect(large?.severity).toBe('warning');
    // warning tidak boleh memblokir submit
    expect(issues.every((i) => i.code !== 'DEPTH_LARGE' || i.severity === 'warning')).toBe(true);
  });

  it('progress tepat 500m tidak memicu DEPTH_LARGE', () => {
    expect(codesOf(validateDepth(1000, 1500))).not.toContain('DEPTH_LARGE');
  });

  it('progress 500.5m memicu DEPTH_LARGE', () => {
    expect(codesOf(validateDepth(1000, 1500.5))).toContain('DEPTH_LARGE');
  });
});

describe('validateDepth - input tidak valid', () => {
  it('NaN pada depth start → DEPTH_INVALID', () => {
    expect(codesOf(validateDepth(Number.NaN, 2845))).toEqual(['DEPTH_INVALID']);
  });

  it('NaN pada depth end → DEPTH_INVALID', () => {
    expect(codesOf(validateDepth(2833, Number.NaN))).toEqual(['DEPTH_INVALID']);
  });

  it('Infinity → DEPTH_INVALID dan berhenti (tidak menambah issue lain)', () => {
    const issues = validateDepth(2833, Number.POSITIVE_INFINITY);
    expect(codesOf(issues)).toEqual(['DEPTH_INVALID']);
  });
});
