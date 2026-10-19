/**
 * Repository - Profil user & sesi aktif milik sendiri.
 *
 * Batas tanggung jawab:
 *  - Semua fungsi di sini HANYA boleh menyentuh baris `users` milik `userId`
 *    yang diberikan pemanggil (= user yang sedang login), plus `sessions`
 *    miliknya sendiri.
 *  - `passwordHash` / `mfaSecret` TIDAK PERNAH keluar dari modul ini; DTO hanya
 *    membawa kolom yang aman untuk client.
 *  - Token sesi mentah tidak pernah disimpan/dikembalikan: pemanggil memberi
 *    `sha256Hex(token)` untuk menandai sesi mana yang "current".
 *
 * Error yang dilempar memakai kode stabil (`EMAIL_TAKEN`, `INVALID_CURRENT_PASSWORD`,
 * `PASSWORD_TOO_SHORT`) supaya route handler bisa memetakan ke status HTTP.
 */
import 'server-only';
import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { db, schema, hashPassword, sha256Hex, verifyPassword } from '@rigdaily/database';
import { ROLE_IDS, permissionsFor, type Permission, type RoleId } from '@rigdaily/shared';
import { ApiError } from '@/lib/api-response';
import { toIso } from './shared';

/* ------------------------------------------------------------------ */
/* Tipe publik                                                        */
/* ------------------------------------------------------------------ */

export type ProfileDto = {
  id: string;
  email: string;
  name: string;
  role: string;
  rigScope: string[];
  mfaEnabled: boolean;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  companyName: string | null;
  permissions: Permission[];
};

export type SessionDto = {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
};

/** Panjang minimum password baru - dipakai route untuk pesan sebelum hashing. */
export const PASSWORD_MIN_LENGTH = 8;

function isRoleId(value: string): value is RoleId {
  return (ROLE_IDS as readonly string[]).includes(value);
}

/** Permission efektif; role tak dikenal (data rusak) → daftar kosong, bukan throw. */
function permissionsOfRole(role: string): Permission[] {
  return isRoleId(role) ? permissionsFor(role) : [];
}

const EPOCH_ISO = new Date(0).toISOString();

/* ------------------------------------------------------------------ */
/* Profil                                                             */
/* ------------------------------------------------------------------ */

/**
 * Profil lengkap satu user aktif (deletedAt null).
 * `companyName` di-join dari `companies`; null bila user tanpa company.
 */
export async function getProfile(userId: string): Promise<ProfileDto | null> {
  const rows = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      role: schema.users.role,
      rigScope: schema.users.rigScope,
      mfaEnabled: schema.users.mfaEnabled,
      active: schema.users.active,
      lastLoginAt: schema.users.lastLoginAt,
      createdAt: schema.users.createdAt,
      companyName: schema.companies.name,
    })
    .from(schema.users)
    .leftJoin(schema.companies, eq(schema.users.companyId, schema.companies.id))
    .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    rigScope: Array.isArray(row.rigScope) ? row.rigScope : [],
    mfaEnabled: row.mfaEnabled,
    active: row.active,
    lastLoginAt: toIso(row.lastLoginAt),
    createdAt: toIso(row.createdAt) ?? EPOCH_ISO,
    companyName: row.companyName ?? null,
    permissions: permissionsOfRole(row.role),
  };
}

/**
 * Ubah nama dan/atau email user sendiri.
 *
 * Email dinormalisasi lowercase + trim. Duplikasi dicek EKSPLISIT lebih dulu
 * (user lain yang belum dihapus) supaya pesannya ramah; unique index
 * `users_email_uq` tetap menjadi jaring pengaman terakhir (race condition) dan
 * diterjemahkan ke `EMAIL_TAKEN` juga.
 */
export async function updateProfile(userId: string, patch: { name?: string; email?: string }): Promise<void> {
  const set: Partial<typeof schema.users.$inferInsert> = { updatedAt: new Date() };

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new ApiError(400, 'INVALID_NAME', 'Nama tidak boleh kosong.');
    set.name = name;
  }

  if (patch.email !== undefined) {
    const email = patch.email.trim().toLowerCase();
    if (!email) throw new ApiError(400, 'INVALID_EMAIL', 'Email tidak boleh kosong.');

    const taken = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(
        and(
          sql`lower(${schema.users.email}) = ${email}`,
          ne(schema.users.id, userId),
          isNull(schema.users.deletedAt),
        ),
      )
      .limit(1);

    if (taken.length > 0) {
      throw new ApiError(409, 'EMAIL_TAKEN', 'Email tersebut sudah dipakai pengguna lain.');
    }

    set.email = email;
  }

  // Tidak ada field yang berubah → jangan sentuh updatedAt.
  if (Object.keys(set).length <= 1) return;

  try {
    await db.update(schema.users).set(set).where(eq(schema.users.id, userId));
  } catch (err) {
    // 23505 = unique_violation pada users_email_uq (dua request bersamaan).
    if ((err as { code?: string } | null)?.code === '23505') {
      throw new ApiError(409, 'EMAIL_TAKEN', 'Email tersebut sudah dipakai pengguna lain.');
    }
    throw err;
  }
}

/**
 * Ganti password user sendiri.
 *
 * Keamanan standar: SEMUA sesi lain milik user dicabut setelah password berubah
 * (perangkat yang mungkin dikuasai orang lain langsung logout). Sesi saat ini
 * dipertahankan agar user tidak ter-logout dari tab yang sedang dipakai.
 *
 * Mengembalikan jumlah sesi yang dicabut agar route bisa melaporkannya.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  currentTokenHash: string,
): Promise<number> {
  if (newPassword.length < PASSWORD_MIN_LENGTH) {
    throw new ApiError(400, 'PASSWORD_TOO_SHORT', `Password baru minimal ${PASSWORD_MIN_LENGTH} karakter.`);
  }

  const rows = await db
    .select({ passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) throw new ApiError(404, 'USER_NOT_FOUND', 'Pengguna tidak ditemukan.');

  if (!verifyPassword(currentPassword, row.passwordHash)) {
    throw new ApiError(401, 'INVALID_CURRENT_PASSWORD', 'Password saat ini salah.');
  }

  await db
    .update(schema.users)
    .set({ passwordHash: hashPassword(newPassword), updatedAt: new Date() })
    .where(eq(schema.users.id, userId));

  return revokeOtherSessions(userId, currentTokenHash);
}

/* ------------------------------------------------------------------ */
/* Sesi milik sendiri                                                 */
/* ------------------------------------------------------------------ */

/**
 * Sesi aktif (belum kedaluwarsa) milik user, terbaru lebih dulu.
 * `current=true` untuk baris yang tokenHash-nya sama dengan cookie request ini.
 */
export async function listSessions(userId: string, currentTokenHash: string): Promise<SessionDto[]> {
  const rows = await db
    .select({
      id: schema.sessions.id,
      userAgent: schema.sessions.userAgent,
      ip: schema.sessions.ip,
      createdAt: schema.sessions.createdAt,
      expiresAt: schema.sessions.expiresAt,
      tokenHash: schema.sessions.tokenHash,
    })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), gt(schema.sessions.expiresAt, new Date())))
    .orderBy(desc(schema.sessions.createdAt));

  return rows.map((r) => ({
    id: r.id,
    userAgent: r.userAgent,
    ip: r.ip,
    createdAt: toIso(r.createdAt) ?? EPOCH_ISO,
    expiresAt: toIso(r.expiresAt) ?? EPOCH_ISO,
    current: r.tokenHash === currentTokenHash,
  }));
}

/**
 * Cabut satu sesi MILIK user. `false` bila id tidak ada / bukan milik user
 * (id user lain tidak boleh bisa dicabut siapa pun selain pemiliknya).
 */
export async function revokeSession(userId: string, sessionId: string): Promise<boolean> {
  const deleted = await db
    .delete(schema.sessions)
    .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, userId)))
    .returning({ id: schema.sessions.id });

  return deleted.length > 0;
}

/**
 * Cabut semua sesi user KECUALI sesi pemanggil (`keepTokenHash`).
 * Mengembalikan jumlah sesi yang dihapus (0 bila hanya ada sesi ini).
 */
export async function revokeOtherSessions(userId: string, keepTokenHash: string): Promise<number> {
  const deleted = await db
    .delete(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), ne(schema.sessions.tokenHash, keepTokenHash)))
    .returning({ id: schema.sessions.id });

  return deleted.length;
}

/**
 * Hash token mentah dari cookie sesi. Diekspor dari sini agar route profil
 * tidak perlu import `@rigdaily/database` langsung (semua query lewat repo).
 */
export function hashSessionToken(token: string): string {
  return sha256Hex(token);
}
