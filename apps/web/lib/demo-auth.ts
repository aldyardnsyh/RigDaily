import 'server-only';

import { SignJWT, jwtVerify } from 'jose';
import { ROLE_IDS, type RoleId } from '@rigdaily/shared';
import { isDemoMode } from './demo';
import { SESSION_TTL_HOURS } from './session-constants';

/**
 * Sesi demo STATELESS (JWT di cookie), bukan baris `sessions` di database.
 *
 * Alasannya: di Vercel setiap instance punya PGlite in-memory sendiri. Sesi
 * yang disimpan di database instance A tidak dikenali instance B, sehingga
 * pengguna terlempar ke login setiap kali request mendarat di instance lain.
 * JWT bertanda tangan tetap valid di semua instance.
 *
 * Token TIDAK menyimpan user id (id berbeda di setiap instance hasil seed).
 * Token hanya menyimpan email + role; `getSessionUser()` memetakannya ke baris
 * `users` lokal instance tersebut agar foreign key (created_by, actor_id) tetap
 * konsisten.
 */

export type DemoTokenPayload = {
  email: string;
  name: string;
  role: RoleId;
  rigScope: string[];
};

const DEFAULT_SECRET = 'rigdaily-demo-only-secret-change-me-in-vercel';

const secret = new TextEncoder().encode(process.env.RIGDAILY_DEMO_SECRET || DEFAULT_SECRET);

if (isDemoMode() && !process.env.RIGDAILY_DEMO_SECRET) {
  console.warn(
    '[demo] RIGDAILY_DEMO_SECRET belum diset - memakai secret default. ' +
      'Set variabel ini di Vercel agar cookie demo tidak dapat dipalsukan.',
  );
}

function isRoleId(value: unknown): value is RoleId {
  return typeof value === 'string' && (ROLE_IDS as readonly string[]).includes(value);
}

export async function signDemoToken(payload: DemoTokenPayload): Promise<string> {
  return new SignJWT({
    email: payload.email,
    name: payload.name,
    role: payload.role,
    rigScope: payload.rigScope,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(payload.email)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_HOURS}h`)
    .sign(secret);
}

export async function verifyDemoToken(token: string): Promise<DemoTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    if (
      typeof payload.email !== 'string' ||
      typeof payload.name !== 'string' ||
      !isRoleId(payload.role) ||
      !Array.isArray(payload.rigScope)
    ) {
      return null;
    }
    return {
      email: payload.email,
      name: payload.name,
      role: payload.role,
      rigScope: payload.rigScope.filter((v): v is string => typeof v === 'string'),
    };
  } catch {
    return null;
  }
}
