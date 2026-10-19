/**
 * /api/admin/users - kelola user (khusus Admin, `user:manage`).
 *
 * GET    → daftar user (tanpa passwordHash)
 * POST   → buat user baru dengan password default dari env
 * PATCH  → ubah { id, name?, email?, role?, rigScope?, active? }
 * DELETE ?id=<uuid> → soft delete + cabut semua sesi user tersebut
 *
 * Aturan penting:
 * - Admin tidak boleh menghapus dirinya sendiri (`CANNOT_DELETE_SELF`) dan
 *   tidak boleh membuat sistem kehilangan admin aktif terakhir (`LAST_ADMIN`).
 * - Password TIDAK pernah bisa diubah dari sini (hanya lewat /api/auth/password).
 * - Audit TIDAK pernah memuat passwordHash.
 */
import { z } from 'zod';
import { ROLE_IDS } from '@rigdaily/shared';
import { hashPassword } from '@rigdaily/database';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { queryToObject } from '@/lib/http-query';
import {
  countActiveAdmins,
  createUser,
  getUserById,
  listUsers,
  revokeAllUserSessions,
  softDeleteUser,
  updateUser,
} from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Password default user baru; override lewat env di produksi. */
const DEFAULT_USER_PASSWORD = process.env.DEFAULT_USER_PASSWORD ?? 'rigdaily123';

const zCreateUser = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(200),
  role: z.enum(ROLE_IDS),
  rigScope: z.array(z.string().uuid()).max(50).optional(),
});

const zPatchUser = z
  .object({
    id: z.string().uuid('id harus UUID'),
    name: z.string().trim().min(1, 'Nama wajib diisi').max(200).optional(),
    email: z.string().trim().email('Format email tidak valid').max(200).optional(),
    role: z.enum(ROLE_IDS).optional(),
    rigScope: z.array(z.string().uuid()).max(50).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.name !== undefined ||
      v.email !== undefined ||
      v.role !== undefined ||
      v.rigScope !== undefined ||
      v.active !== undefined,
    { message: 'Isi minimal satu dari: name, email, role, rigScope, active' },
  );

const zDeleteQuery = z.object({
  id: z.string().uuid('id harus UUID'),
});

/** Pemetaan pelanggaran unique `users_email_uq` → 409 EMAIL_TAKEN. */
function mapUniqueViolation(err: unknown): unknown {
  const pgCode = (err as { code?: string } | null)?.code;
  const message = err instanceof Error ? err.message : '';
  if (pgCode === '23505' || /duplicate key|users_email_uq/i.test(message)) {
    return new ApiError(409, 'EMAIL_TAKEN', 'Email tersebut sudah terdaftar. Gunakan email lain.');
  }
  return err;
}

export async function GET(): Promise<Response> {
  try {
    await requirePermission('user:manage');
    return ok(await listUsers());
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const actor = await requirePermission('user:manage');
    const body = parseBody(zCreateUser, await readJson(req));
    const email = body.email.trim().toLowerCase();
    const rigScope = body.rigScope ?? [];

    const passwordHash = hashPassword(DEFAULT_USER_PASSWORD);

    const { id } = await createUser({
      name: body.name.trim(),
      email,
      role: body.role,
      rigScope,
      passwordHash,
    });

    await recordAudit({
      entity: 'user',
      entityId: id,
      action: 'create',
      actor,
      newJson: { email, name: body.name.trim(), role: body.role, rigScope },
      ip: getClientIp(req),
      terminal: req.headers.get('user-agent')?.slice(0, 300) ?? null,
    });

    return ok({ id }, { status: 201 });
  } catch (err) {
    // Email unik di DB (unique index `users_email_uq`). Tanpa pemetaan ini,
    // pelanggaran constraint keluar sebagai 500 padahal ini kesalahan klien.
    return fail(mapUniqueViolation(err));
  }
}

export async function PATCH(req: Request): Promise<Response> {
  try {
    const actor = await requirePermission('user:manage');
    const body = parseBody(zPatchUser, await readJson(req));

    const existing = await getUserById(body.id);
    if (!existing) {
      throw new ApiError(404, 'NOT_FOUND', `Pengguna ${body.id} tidak ditemukan.`);
    }

    // Menonaktifkan admin terakhir akan mengunci seluruh sistem dari pengelolaan.
    if (existing.role === 'Admin' && body.active === false) {
      const remaining = await countActiveAdmins(existing.id);
      if (remaining < 1) {
        throw new ApiError(
          409,
          'LAST_ADMIN',
          'Tidak bisa menonaktifkan admin aktif terakhir. Angkat admin lain terlebih dahulu.',
        );
      }
    }

    const { before, after } = await updateUser(body.id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.role !== undefined ? { role: body.role } : {}),
      ...(body.rigScope !== undefined ? { rigScope: body.rigScope } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
    });

    if (!before || !after) {
      throw new ApiError(404, 'NOT_FOUND', `Pengguna ${body.id} tidak ditemukan.`);
    }

    await recordAudit({
      entity: 'user',
      entityId: body.id,
      action: 'user_update',
      actor,
      // Snapshot aman: tidak ada passwordHash / mfaSecret.
      oldJson: {
        name: before.name,
        email: before.email,
        role: before.role,
        rigScope: before.rigScope,
        active: before.active,
      },
      newJson: {
        name: after.name,
        email: after.email,
        role: after.role,
        rigScope: after.rigScope,
        active: after.active,
        changed: Object.keys(body).filter((k) => k !== 'id'),
      },
      ip: getClientIp(req),
      terminal: req.headers.get('user-agent')?.slice(0, 300) ?? null,
    });

    return ok(after);
  } catch (err) {
    return fail(mapUniqueViolation(err));
  }
}

export async function DELETE(req: Request): Promise<Response> {
  try {
    const actor = await requirePermission('user:manage');
    const { id } = parseBody(zDeleteQuery, queryToObject(req.url));

    if (id === actor.id) {
      throw new ApiError(400, 'CANNOT_DELETE_SELF', 'Anda tidak bisa menghapus akun sendiri.');
    }

    const existing = await getUserById(id);
    if (!existing) {
      throw new ApiError(404, 'NOT_FOUND', `Pengguna ${id} tidak ditemukan.`);
    }

    if (existing.role === 'Admin') {
      const remaining = await countActiveAdmins(existing.id);
      if (remaining < 1) {
        throw new ApiError(
          409,
          'LAST_ADMIN',
          'Tidak bisa menghapus admin aktif terakhir. Angkat admin lain terlebih dahulu.',
        );
      }
    }

    const removed = await softDeleteUser(id);
    if (!removed) {
      throw new ApiError(404, 'NOT_FOUND', `Pengguna ${id} tidak ditemukan.`);
    }

    // Token lama tidak boleh tetap berlaku setelah user dihapus.
    const revokedSessions = await revokeAllUserSessions(id);

    await recordAudit({
      entity: 'user',
      entityId: id,
      action: 'user_delete',
      actor,
      oldJson: {
        name: removed.name,
        email: removed.email,
        role: removed.role,
        rigScope: removed.rigScope,
        active: removed.active,
      },
      newJson: { deleted: true, active: false, revokedSessions },
      ip: getClientIp(req),
      terminal: req.headers.get('user-agent')?.slice(0, 300) ?? null,
    });

    return ok({ id, deleted: true, revokedSessions });
  } catch (err) {
    return fail(err);
  }
}
