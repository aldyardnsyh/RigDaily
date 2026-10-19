/**
 * GET / PATCH /api/auth/me
 *
 * GET  : identitas sesi aktif + permission efektif + profil lengkap.
 *        401 bila tidak ada sesi valid (dipakai klien untuk redirect ke /login).
 * PATCH: ubah nama/email sendiri. Body minimal satu field.
 *
 * Bentuk respons GET menjaga kompatibilitas: `user` dan `permissions` tetap
 * ada seperti sebelumnya; `profile` adalah tambahan (detail lengkap).
 */
import { cookies } from 'next/headers';
import { z } from 'zod';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { getSessionUser, recordAudit, requireUser, SESSION_COOKIE } from '@/lib/auth';
import { permissionsOf } from '@/lib/rbac';
import { getProfile, hashSessionToken, updateProfile } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Minimal satu field harus diisi - PATCH kosong tidak bermakna. */
const zProfilePatch = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Nama minimal 2 karakter')
      .max(120, 'Nama maksimal 120 karakter')
      .optional(),
    email: z.string().trim().email('Format email tidak valid').max(200, 'Email maksimal 200 karakter').optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.email !== undefined, {
    message: 'Isi minimal satu dari: name, email',
  });

/** Token mentah dari cookie request ini (untuk menandai sesi "current"). */
async function currentTokenHash(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return token ? hashSessionToken(token) : null;
}

export async function GET(): Promise<Response> {
  try {
    const user = await getSessionUser();
    if (!user) {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Belum login.');
    }

    const profile = await getProfile(user.id);
    if (!profile) {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Sesi tidak valid atau sudah berakhir.');
    }

    return ok({ user, permissions: permissionsOf(user), profile });
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(req: Request): Promise<Response> {
  try {
    const user = await requireUser();

    const patch = parseBody(zProfilePatch, await readJson(req));

    const before = await getProfile(user.id);
    if (!before) throw new ApiError(404, 'USER_NOT_FOUND', 'Pengguna tidak ditemukan.');

    const changes: { name?: string; email?: string } = {};
    if (patch.name !== undefined) changes.name = patch.name;
    if (patch.email !== undefined) changes.email = patch.email;

    await updateProfile(user.id, changes);

    const after = await getProfile(user.id);
    if (!after) throw new ApiError(404, 'USER_NOT_FOUND', 'Pengguna tidak ditemukan.');

    await recordAudit({
      entity: 'user',
      entityId: user.id,
      action: 'profile_update',
      actor: user,
      oldJson: { name: before.name, email: before.email },
      newJson: { name: after.name, email: after.email, changed: Object.keys(changes) },
      ip: getClientIp(req),
      terminal: req.headers.get('user-agent')?.slice(0, 300) ?? null,
    });

    return ok(after);
  } catch (err) {
    return fail(err);
  }
}
