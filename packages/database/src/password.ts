/**
 * Password hashing - Node-only (scrypt dari node:crypto).
 * Format: scrypt$N$r$p$saltB64$hashB64
 *
 * Dipakai oleh: seed script, API login, dan test.
 * TIDAK ada dependency eksternal supaya hemat footprint di VPS 2 vCPU.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 16384; // cost
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_LEN = 16;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN);
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    const actual = scryptSync(password, salt, expected.length, { N: n, r, p });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Token sesi acak (dipakai untuk cookie session). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256 hex - untuk menyimpan hash token sesi (jangan simpan token mentah). */
export function sha256Hex(input: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256').update(input).digest('hex');
}
