import 'server-only';

/**
 * RBAC helper - lapisan tipis di atas `can()` dari @rigdaily/shared.
 *
 * Aturan scope rig:
 *  - Admin             : selalu boleh semua rig.
 *  - rigScope kosong   : boleh semua rig (Viewer/CostController/DrillingEngineer global).
 *  - rigScope terisi   : hanya rig yang tercantum.
 *  - rigId null/undefined (belum di-assign): user ber-scope terbatas TIDAK boleh.
 */
import { can, permissionsFor, type Permission } from '@rigdaily/shared';
import type { SessionUser } from './auth';
import { ApiError } from './api-response';

/** True bila user boleh melihat/mengubah data pada rig tersebut. */
export function canAccessRig(user: SessionUser, rigId: string | null | undefined): boolean {
  if (user.role === 'Admin') return true;

  const scope = user.rigScope ?? [];
  // Scope kosong = akses global (lihat schema users.rig_scope).
  if (scope.length === 0) return true;

  // User dengan scope terbatas tidak boleh menyentuh data tanpa rig.
  if (!rigId) return false;

  return scope.includes(rigId);
}

/** Versi throwing dari canAccessRig - dipakai di route handler. */
export function assertRigAccess(user: SessionUser, rigId: string | null | undefined): void {
  if (!canAccessRig(user, rigId)) {
    throw new ApiError(403, 'FORBIDDEN_RIG', 'Anda tidak memiliki akses ke rig ini.');
  }
}

/** Daftar permission efektif untuk user (dipakai GET /api/auth/me). */
export function permissionsOf(user: SessionUser): Permission[] {
  return permissionsFor(user.role);
}
