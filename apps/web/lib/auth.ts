import 'server-only';

/**
 * Autentikasi sesi - cookie HttpOnly + tabel `sessions`.
 *
 * Kenapa bukan NextAuth: target deploy 2 vCPU / RAM kecil, dan kita hanya butuh
 * satu mekanisme (email+password) yang bisa diaudit penuh. Token mentah TIDAK
 * pernah disimpan: DB hanya menyimpan `sha256Hex(token)`.
 *
 * Alur:
 *   login()  -> verifikasi password, update lastLoginAt, createSession()
 *   request  -> getSessionUser() baca cookie, cek hash di DB, cek expiry/active
 *   logout() -> destroySession() hapus baris + cookie
 */
import { cookies } from 'next/headers';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema, randomToken, sha256Hex, verifyPassword } from '@rigdaily/database';
import { ROLE_IDS, can, type Permission, type RoleId } from '@rigdaily/shared';
import { ApiError, getClientIp } from './api-response';
import { isDemoMode, ensureDemoReady } from './demo';
import { signDemoToken, verifyDemoToken } from './demo-auth';
import { SESSION_COOKIE, SESSION_TTL_HOURS } from './session-constants';
import { writeAudit } from '@/lib/repo';

export { SESSION_COOKIE, SESSION_TTL_HOURS };

const SESSION_TTL_MS = SESSION_TTL_HOURS * 60 * 60 * 1000;

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: RoleId;
  rigScope: string[];
};

/**
 * Hash dummy (password acak yang tidak dipakai siapa pun).
 * Dipakai agar login dengan email tak dikenal tetap menjalankan scrypt,
 * sehingga waktu respons tidak membocorkan apakah email terdaftar.
 */
const DUMMY_PASSWORD_HASH =
  'scrypt$16384$8$1$cmlnZGFpbHktZHVtbXktc2FsdA==$OnIVMX3rlcVYoI66wb3HouFmBlTZ3RC9vphNawLrTXjLVCIPV5LDBVt2Up8/C0m8Iqo+jEiiJzpOkr3/vo9TwA==';

type UserRow = typeof schema.users.$inferSelect;

function isRoleId(value: string): value is RoleId {
  return (ROLE_IDS as readonly string[]).includes(value);
}

/** Baris users -> SessionUser (tanpa passwordHash / kolom sensitif lain). */
function toSessionUser(row: UserRow): SessionUser {
  if (!isRoleId(row.role)) {
    throw new ApiError(403, 'INVALID_ROLE', 'Role pengguna tidak dikenali.');
  }
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    rigScope: Array.isArray(row.rigScope) ? row.rigScope : [],
  };
}

/* ------------------------------------------------------------------ */
/* Cookie                                                              */
/* ------------------------------------------------------------------ */

async function cookieStore() {
  // Next 14: cookies() sinkron; Next 15: Promise. `await` aman untuk keduanya.
  return await cookies();
}

function cookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSec,
  };
}

async function setSessionCookie(token: string): Promise<void> {
  const store = await cookieStore();
  store.set(SESSION_COOKIE, token, cookieOptions(SESSION_TTL_HOURS * 3600));
}

/* ------------------------------------------------------------------ */
/* Sesi                                                               */
/* ------------------------------------------------------------------ */

/**
 * Buat sesi baru + set cookie. Mengembalikan token MENTAH hanya ke pemanggil;
 * DB hanya menyimpan hash-nya.
 */
export async function createSession(
  userId: string,
  meta?: { userAgent?: string; ip?: string },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(schema.sessions).values({
    userId,
    tokenHash,
    userAgent: meta?.userAgent ? meta.userAgent.slice(0, 300) : null,
    ip: meta?.ip ? meta.ip.slice(0, 60) : null,
    expiresAt,
  });

  await setSessionCookie(token);

  return { token, expiresAt };
}

/**
 * Mode demo: validasi JWT lalu petakan ke baris `users` instance ini.
 * ID user sengaja TIDAK diambil dari token karena setiap instance PGlite
 * menghasilkan UUID berbeda saat seed.
 */
async function getDemoSessionUser(token: string): Promise<SessionUser | null> {
  const payload = await verifyDemoToken(token);
  if (!payload) return null;

  try {
    await ensureDemoReady();
  } catch {
    return null;
  }

  const rows = await db
    .select()
    .from(schema.users)
    .where(
      and(
        sql`lower(${schema.users.email}) = ${payload.email.trim().toLowerCase()}`,
        isNull(schema.users.deletedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || !row.active) return null;

  try {
    return toSessionUser(row);
  } catch {
    return null;
  }
}

/**
 * Baca cookie sesi, validasi ke DB, dan kembalikan user.
 * Null bila: tidak ada cookie, sesi tidak ada, kedaluwarsa, user nonaktif/terhapus.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookieStore();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  // Demo publik: cookie berisi JWT stateless (bertahan lintas instance Vercel).
  if (isDemoMode()) return getDemoSessionUser(token);

  const tokenHash = sha256Hex(token);

  const rows = await db
    .select({ user: schema.users, session: schema.sessions })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(and(eq(schema.sessions.tokenHash, tokenHash), isNull(schema.users.deletedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  if (row.session.expiresAt.getTime() <= Date.now()) {
    // Bersihkan baris kedaluwarsa; kegagalan hapus tidak boleh menggagalkan request.
    await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.id, row.session.id))
      .catch(() => undefined);
    return null;
  }

  if (!row.user.active) return null;

  try {
    return toSessionUser(row.user);
  } catch {
    // Role tidak dikenal = konfigurasi rusak; perlakukan sebagai tidak login.
    console.warn('[auth] user memiliki role tidak dikenal:', row.user.id, row.user.role);
    return null;
  }
}

/**
 * Hapus cookie sesi di browser.
 *
 * Dipakai ketika token tidak valid (bukan sekadar belum login): sesi tidak
 * ada di database, sudah kedaluwarsa, atau user dinonaktifkan. Tanpa ini,
 * cookie rusak tetap terkirim di setiap permintaan dan memicu 401 berulang.
 *
 * Tidak melempar error: penghapusan cookie tidak boleh menggagalkan render.
 */
export async function clearSessionCookie(): Promise<void> {
  try {
    const store = await cookieStore();
    store.set(SESSION_COOKIE, '', cookieOptions(0));
  } catch {
    /* di luar konteks request (mis. build): abaikan */
  }
}

/** Hapus sesi aktif (DB) dan cookie. Aman dipanggil walau tidak ada sesi. */
export async function destroySession(): Promise<void> {
  const store = await cookieStore();
  const token = store.get(SESSION_COOKIE)?.value;

  if (token) {
    const tokenHash = sha256Hex(token);
    await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, tokenHash));
  }

  // maxAge 0 = hapus cookie di browser.
  store.set(SESSION_COOKIE, '', cookieOptions(0));
}

/* ------------------------------------------------------------------ */
/* Guard                                                              */
/* ------------------------------------------------------------------ */

/** Wajib login. Throw ApiError 401 bila tidak ada sesi valid. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Sesi tidak valid atau sudah berakhir. Silakan login kembali.');
  }
  return user;
}

/** Wajib login + punya permission granular. Throw 403 bila tidak punya. */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) {
    throw new ApiError(403, 'FORBIDDEN', `Anda tidak memiliki izin "${permission}" untuk aksi ini.`);
  }
  return user;
}

/* ------------------------------------------------------------------ */
/* Login                                                              */
/* ------------------------------------------------------------------ */

/**
 * Verifikasi kredensial lalu buat sesi (cookie ikut ter-set oleh createSession).
 * Pesan error SELALU generik agar tidak membocorkan email mana yang terdaftar.
 */
export async function login(
  email: string,
  password: string,
  meta?: { userAgent?: string; ip?: string },
): Promise<SessionUser> {
  // Pastikan schema + data demo siap sebelum query pertama di instance baru.
  if (isDemoMode()) await ensureDemoReady();

  const normalizedEmail = email.trim().toLowerCase();

  const rows = await db
    .select()
    .from(schema.users)
    .where(and(sql`lower(${schema.users.email}) = ${normalizedEmail}`, isNull(schema.users.deletedAt)))
    .limit(1);

  const row = rows[0];

  // Selalu jalankan scrypt (walau user tidak ada) supaya waktu respons seragam.
  const passwordOk = row ? verifyPassword(password, row.passwordHash) : verifyPassword(password, DUMMY_PASSWORD_HASH);

  if (!row || !passwordOk || !row.active) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email atau password salah.');
  }

  const user = toSessionUser(row);

  await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, row.id));

  if (isDemoMode()) {
    // Sesi demo stateless: tetap valid walau request berikutnya mendarat di
    // instance serverless lain yang punya database in-memory sendiri.
    const token = await signDemoToken({
      email: user.email,
      name: user.name,
      role: user.role,
      rigScope: user.rigScope,
    });
    await setSessionCookie(token);
  } else {
    await createSession(row.id, meta);
  }

  return user;
}

/**
 * Masuk cepat mode demo (tanpa password) untuk akun yang ada di seed.
 * Hanya aktif bila RIGDAILY_DEMO=1; di produksi normal selalu 404.
 */
export async function loginDemo(email: string): Promise<SessionUser> {
  if (!isDemoMode()) {
    throw new ApiError(404, 'DEMO_DISABLED', 'Mode demo tidak aktif pada instalasi ini.');
  }

  try {
    await ensureDemoReady();
  } catch {
    throw new ApiError(503, 'DEMO_NOT_READY', 'Data demo belum siap. Coba lagi beberapa detik lagi.');
  }

  const normalizedEmail = email.trim().toLowerCase();
  const rows = await db
    .select()
    .from(schema.users)
    .where(
      and(
        sql`lower(${schema.users.email}) = ${normalizedEmail}`,
        isNull(schema.users.deletedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || !row.active) {
    throw new ApiError(404, 'DEMO_ACCOUNT_NOT_FOUND', 'Akun demo tidak ditemukan pada instalasi ini.');
  }

  const user = toSessionUser(row);

  await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, row.id));

  const token = await signDemoToken({
    email: user.email,
    name: user.name,
    role: user.role,
    rigScope: user.rigScope,
  });
  await setSessionCookie(token);

  return user;
}

/* ------------------------------------------------------------------ */
/* Audit                                                              */
/* ------------------------------------------------------------------ */

/**
 * Penulisan audit_log ada di `@/lib/repo` (writeAudit) - satu pintu query.
 * Helper ini hanya memetakan SessionUser -> actorId/actorName supaya route
 * tidak perlu mengulang mapping tersebut.
 */
export async function recordAudit(entry: {
  entity: string;
  entityId?: string | null;
  action: string;
  oldJson?: unknown;
  newJson?: unknown;
  actor?: SessionUser | null;
  ip?: string | null;
  terminal?: string | null;
}): Promise<void> {
  await writeAudit({
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    actorId: entry.actor?.id ?? null,
    actorName: entry.actor?.name ?? null,
    action: entry.action,
    oldJson: entry.oldJson,
    newJson: entry.newJson,
    ip: entry.ip ?? null,
    terminal: entry.terminal ?? null,
  });
}

/* ------------------------------------------------------------------ */
/* Kompatibilitas untuk agent lain (route/laporan, pdf)               */
/* ------------------------------------------------------------------ */

/**
 * Pemetaan SessionUser -> actorId/actorName untuk pemanggil `writeAudit()`
 * langsung (dipakai route laporan/PDF milik agent lain). Dipertahankan agar
 * signature lama tetap valid.
 */
export function auditActor(user: SessionUser | null | undefined): { actorId: string | null; actorName: string | null } {
  return { actorId: user?.id ?? null, actorName: user?.name ?? null };
}

/** IP klien (varian lama: `undefined` bila tidak diketahui). */
export function clientIp(req: Request): string | undefined {
  const ip = getClientIp(req);
  return ip === 'unknown' ? undefined : ip;
}

/** User-Agent terpotong (varian lama). */
export function clientUserAgent(req: Request): string | undefined {
  return req.headers.get('user-agent')?.slice(0, 300) ?? undefined;
}
