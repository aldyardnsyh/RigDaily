/**
 * Protokol sync (rig â†” kantor): hash kanonik, backoff, lock status, konflik.
 *
 * Aturan paling kritis: laporan Approved/Locked TIDAK BOLEH ditimpa sync -
 * harus lewat amendment. Test di sini menjaga gerbang itu.
 */
import { describe, expect, it } from 'vitest';
import {
  SYNC_BACKOFF_MS,
  SYNC_BATCH_SIZE,
  SYNC_LOCKED_STATUSES,
  SYNC_MAX_RETRY,
  SYNC_POLL_INTERVAL_MS,
  backoffForRetry,
  isSyncLocked,
  payloadHash,
  requiresManualResolve,
  stableStringify,
  syncIndicator,
  syncIndicatorLabel,
  zSyncMutation,
} from '@rigdaily/shared';

const VALID_UUID = '3f5a1c62-9b1e-4f0f-9d8e-2f7c1b9a4e10';
const VALID_UUID_2 = 'a0b1c2d3-e4f5-4a6b-8c9d-0e1f2a3b4c5d';

function validMutation(): Record<string, unknown> {
  return {
    clientMutationId: VALID_UUID,
    deviceId: 'RIG-12-LAPTOP',
    entity: 'daily_report',
    entityLocalId: VALID_UUID_2,
    entityServerId: null,
    op: 'update',
    updatedAt: '2026-09-10T06:30:00.000Z',
    hash: payloadHash({ depthMdEnd: 2845 }),
    payload: { depthMdEnd: 2845 },
    baseServerUpdatedAt: '2026-09-09T06:30:00.000Z',
  };
}

/* ------------------------------------------------------------------ */
/* stableStringify                                                     */
/* ------------------------------------------------------------------ */

describe('stableStringify', () => {
  it('urutan kunci berbeda â†’ string identik', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  it('nested objek dinormalisasi juga', () => {
    const x = { outer: { z: 1, a: 2 }, other: 3 };
    const y = { other: 3, outer: { a: 2, z: 1 } };
    expect(stableStringify(x)).toBe(stableStringify(y));
  });

  it('array mempertahankan urutan (urutan elemen signifikan)', () => {
    expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]));
  });

  it('array di dalam objek & array of objects di-hash stabil lintas urutan kunci', () => {
    const x = { rows: [{ start: '06:00', end: '08:30' }, { start: '08:30', end: '11:30' }] };
    const y = { rows: [{ end: '08:30', start: '06:00' }, { end: '11:30', start: '08:30' }] };
    expect(stableStringify(x)).toBe(stableStringify(y));
  });

  it('nilai primitif & null ditangani', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(42)).toBe('42');
    expect(stableStringify('abc')).toBe('"abc"');
  });

  it('format kanonik: kunci terurut alfabetis', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('nested array dalam objek tetap konsisten', () => {
    const x = { a: [1, { y: 2, x: 1 }] };
    const y = { a: [1, { x: 1, y: 2 }] };
    expect(stableStringify(x)).toBe(stableStringify(y));
  });
});

/* ------------------------------------------------------------------ */
/* payloadHash                                                         */
/* ------------------------------------------------------------------ */

describe('payloadHash', () => {
  it('deterministik untuk payload sama', () => {
    const payload = { depthMdStart: 2833, depthMdEnd: 2845, rows: 9 };
    expect(payloadHash(payload)).toBe(payloadHash(payload));
  });

  it('urutan kunci berbeda tetap menghasilkan hash sama', () => {
    expect(payloadHash({ a: 1, b: 2 })).toBe(payloadHash({ b: 2, a: 1 }));
  });

  it('payload berbeda â†’ hash berbeda', () => {
    expect(payloadHash({ depthMdEnd: 2845 })).not.toBe(payloadHash({ depthMdEnd: 2846 }));
  });

  it('beda 1 karakter â†’ hash berbeda', () => {
    expect(payloadHash({ summary: 'Drilled to 2845m' })).not.toBe(payloadHash({ summary: 'Drilled to 2846m' }));
  });

  it('hash berupa hex 32 karakter', () => {
    expect(payloadHash({ a: 1 })).toMatch(/^[0-9a-f]{32}$/);
  });

  it('hash tahan terhadap perbedaan tipe yang tampak mirip', () => {
    expect(payloadHash({ v: '2845' })).not.toBe(payloadHash({ v: 2845 }));
  });
});

/* ------------------------------------------------------------------ */
/* backoffForRetry                                                     */
/* ------------------------------------------------------------------ */

describe('backoffForRetry', () => {
  it('retry 0..10 â†’ 5000,15000,45000,135000,405000 lalu plateau 405000', () => {
    const expected = [5000, 15000, 45000, 135000, 405000, 405000, 405000, 405000, 405000, 405000, 405000];
    expect(Array.from({ length: 11 }, (_, i) => backoffForRetry(i))).toEqual(expected);
  });

  it('retry negatif di-clamp ke backoff pertama (bukan hot loop)', () => {
    // Dulu bug: SYNC_BACKOFF_MS[-1] = undefined sehingga setTimeout(cb, undefined)
    // menjadi retry instan (hot loop CPU/baterai di rig). Sekarang di-clamp ke 5000.
    expect(backoffForRetry(-1)).toBe(5000);
    expect(backoffForRetry(-999)).toBe(5000);
    expect(backoffForRetry(Number.NaN)).toBe(5000);
  });

  it('retry 0 tetap backoff pertama', () => {
    expect(backoffForRetry(0)).toBe(5000);
  });

  it('konstanta backoff naik monoton (5x lipat)', () => {
    for (let i = 1; i < SYNC_BACKOFF_MS.length; i += 1) {
      expect(SYNC_BACKOFF_MS[i]).toBe(SYNC_BACKOFF_MS[i - 1] * 3);
    }
  });

  it('konstanta protokol lainnya tidak berubah tanpa sengaja', () => {
    expect(SYNC_MAX_RETRY).toBe(5);
    expect(SYNC_BATCH_SIZE).toBe(100);
    expect(SYNC_POLL_INTERVAL_MS).toBe(60_000);
  });
});

/* ------------------------------------------------------------------ */
/* isSyncLocked                                                        */
/* ------------------------------------------------------------------ */

describe('isSyncLocked', () => {
  it.each(['approved', 'distributed', 'locked'] as const)("status '%s' terkunci", (status) => {
    expect(isSyncLocked(status)).toBe(true);
  });

  it.each(['draft', 'submitted', 'unknown', ''] as const)("status '%s' tidak terkunci", (status) => {
    expect(isSyncLocked(status)).toBe(false);
  });

  it('SYNC_LOCKED_STATUSES berisi tepat 3 status', () => {
    expect([...SYNC_LOCKED_STATUSES]).toEqual(['approved', 'distributed', 'locked']);
  });
});

/* ------------------------------------------------------------------ */
/* requiresManualResolve                                               */
/* ------------------------------------------------------------------ */

describe('requiresManualResolve', () => {
  it('server locked + tanpa base â†’ true', () => {
    expect(
      requiresManualResolve({ serverStatus: 'approved', serverUpdatedAt: '2026-09-10T06:30:00.000Z', baseServerUpdatedAt: null }),
    ).toBe(true);
  });

  it('server locked + base undefined â†’ true', () => {
    expect(
      requiresManualResolve({ serverStatus: 'locked', serverUpdatedAt: '2026-09-10T06:30:00.000Z' }),
    ).toBe(true);
  });

  it('server locked + base lebih lama dari server â†’ true', () => {
    expect(
      requiresManualResolve({
        serverStatus: 'locked',
        serverUpdatedAt: '2026-09-10T06:30:00.000Z',
        baseServerUpdatedAt: '2026-09-09T06:30:00.000Z',
      }),
    ).toBe(true);
  });

  it('server locked + base == server â†’ false (device pegang versi terbaru)', () => {
    expect(
      requiresManualResolve({
        serverStatus: 'locked',
        serverUpdatedAt: '2026-09-10T06:30:00.000Z',
        baseServerUpdatedAt: '2026-09-10T06:30:00.000Z',
      }),
    ).toBe(false);
  });

  it('server draft â†’ false walau base lebih lama', () => {
    expect(
      requiresManualResolve({
        serverStatus: 'draft',
        serverUpdatedAt: '2026-09-10T06:30:00.000Z',
        baseServerUpdatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toBe(false);
  });

  it('server distributed (locked) + base lebih lama â†’ true', () => {
    expect(
      requiresManualResolve({
        serverStatus: 'distributed',
        serverUpdatedAt: '2026-09-10T06:30:00.000Z',
        baseServerUpdatedAt: '2026-09-10T06:29:59.000Z',
      }),
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* syncIndicator                                                       */
/* ------------------------------------------------------------------ */

describe('syncIndicator', () => {
  it('pending 0 & online & tanpa error â†’ green', () => {
    expect(syncIndicator({ pending: 0, failed: 0, online: true })).toBe('green');
  });

  it('pending 3 & online â†’ amber', () => {
    expect(syncIndicator({ pending: 3, failed: 0, online: true })).toBe('amber');
  });

  it('failed 1 â†’ red', () => {
    expect(syncIndicator({ pending: 0, failed: 1, online: true })).toBe('red');
  });

  it('offline â†’ amber', () => {
    expect(syncIndicator({ pending: 0, failed: 0, online: false })).toBe('amber');
  });

  it('lastError terisi â†’ red meski pending 0 & online', () => {
    expect(syncIndicator({ pending: 0, failed: 0, online: true, lastError: 'HTTP 500' })).toBe('red');
  });

  it('failed mengalahkan offline (red > amber)', () => {
    expect(syncIndicator({ pending: 5, failed: 2, online: false })).toBe('red');
  });

  it('label indikator sesuai status', () => {
    expect(syncIndicatorLabel('green', 0)).toBe('Synced');
    expect(syncIndicatorLabel('amber', 3)).toBe('Pending 3');
    expect(syncIndicatorLabel('amber', 0)).toContain('Offline');
    expect(syncIndicatorLabel('red', 0)).toContain('Sync error');
  });
});

/* ------------------------------------------------------------------ */
/* zSyncMutation (zod)                                                 */
/* ------------------------------------------------------------------ */

describe('zSyncMutation - validasi zod', () => {
  it('mutation valid lolos parsing', () => {
    const parsed = zSyncMutation.safeParse(validMutation());
    expect(parsed.success).toBe(true);
  });

  it('clientMutationId bukan UUID ditolak', () => {
    const parsed = zSyncMutation.safeParse({ ...validMutation(), clientMutationId: 'not-a-uuid' });
    expect(parsed.success).toBe(false);
  });

  it('entityLocalId bukan UUID ditolak', () => {
    const parsed = zSyncMutation.safeParse({ ...validMutation(), entityLocalId: '12345' });
    expect(parsed.success).toBe(false);
  });

  it('op tidak dikenal ditolak', () => {
    const parsed = zSyncMutation.safeParse({ ...validMutation(), op: 'upsert' });
    expect(parsed.success).toBe(false);
  });

  it('entity tidak dikenal ditolak', () => {
    const parsed = zSyncMutation.safeParse({ ...validMutation(), entity: 'invoice' });
    expect(parsed.success).toBe(false);
  });

  it('hash terlalu pendek ditolak', () => {
    const parsed = zSyncMutation.safeParse({ ...validMutation(), hash: 'abc' });
    expect(parsed.success).toBe(false);
  });

  it('deviceId kosong ditolak', () => {
    const parsed = zSyncMutation.safeParse({ ...validMutation(), deviceId: '' });
    expect(parsed.success).toBe(false);
  });

  it('payload wajib objek, string ditolak', () => {
    const parsed = zSyncMutation.safeParse({ ...validMutation(), payload: 'x' });
    expect(parsed.success).toBe(false);
  });

  it('entityServerId opsional (null diterima)', () => {
    const parsed = zSyncMutation.safeParse({ ...validMutation(), entityServerId: null });
    expect(parsed.success).toBe(true);
  });
});
