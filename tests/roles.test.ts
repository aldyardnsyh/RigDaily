/**
 * RBAC - pastikan tidak ada role yang bisa approve tanpa kewenangan,
 * dan Admin benar-benar memegang SEMUA permission.
 */
import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_IDS, ROLE_PERMISSIONS, can, permissionsFor, type Permission } from '@rigdaily/shared';

describe('can() - kasus dasar', () => {
  it("RigClerk boleh 'report:create'", () => {
    expect(can('RigClerk', 'report:create')).toBe(true);
  });

  it("RigClerk TIDAK boleh 'report:approve'", () => {
    expect(can('RigClerk', 'report:approve')).toBe(false);
  });

  it("CompanyMan boleh 'report:approve'", () => {
    expect(can('CompanyMan', 'report:approve')).toBe(true);
  });

  it("Viewer TIDAK boleh 'report:create'", () => {
    expect(can('Viewer', 'report:create')).toBe(false);
  });

  it("Viewer boleh 'dashboard:read' (read-only)", () => {
    expect(can('Viewer', 'dashboard:read')).toBe(true);
  });

  it('role null/undefined â†’ false (fail closed)', () => {
    expect(can(null, 'dashboard:read')).toBe(false);
    expect(can(undefined, 'dashboard:read')).toBe(false);
  });

  it('role tidak dikenal pada runtime â†’ false (tidak crash)', () => {
    expect(can('Ghost' as unknown as (typeof ROLE_IDS)[number], 'dashboard:read')).toBe(false);
  });
});

describe('can() - Admin memegang semua permission', () => {
  it.each(PERMISSIONS.map((p) => [p] as const))("Admin boleh '%s'", (permission) => {
    expect(can('Admin', permission)).toBe(true);
  });

  it('iterasi eksplisit seluruh PERMISSIONS untuk Admin', () => {
    for (const permission of PERMISSIONS) {
      expect(can('Admin', permission), `Admin seharusnya punya ${permission}`).toBe(true);
    }
  });
});

describe('permissionsFor()', () => {
  it('Admin punya jumlah permission = PERMISSIONS.length', () => {
    expect(permissionsFor('Admin')).toHaveLength(PERMISSIONS.length);
  });

  it('DrillingEngineer tidak punya permission duplikat', () => {
    const list = permissionsFor('DrillingEngineer');
    const unique = new Set(list);

    // Dulu bug: spread ...VIEWER lalu menulis ulang 'cost:read' & 'wellfile:read'
    // menghasilkan 18 entri / 16 unik. Sekarang array harus bebas duplikat.
    expect(list.length).toBe(unique.size);
    expect(list.filter((p) => p === 'cost:read')).toHaveLength(1);
    expect(list.filter((p) => p === 'wellfile:read')).toHaveLength(1);
  });

  it('role selain DrillingEngineer tidak punya permission duplikat', () => {
    for (const role of ROLE_IDS.filter((r) => r !== 'DrillingEngineer')) {
      const list = permissionsFor(role);
      expect(new Set(list).size, `role ${role} punya permission duplikat`).toBe(list.length);
    }
  });

  it('can() DrillingEngineer tetap benar setelah dedup', () => {
    expect(can('DrillingEngineer', 'cost:read')).toBe(true);
    expect(can('DrillingEngineer', 'wellfile:read')).toBe(true);
  });

  it('semua permission setiap role adalah permission yang terdaftar', () => {
    const valid = new Set<string>(PERMISSIONS);
    for (const role of ROLE_IDS) {
      for (const p of permissionsFor(role)) {
        expect(valid.has(p), `${role} memiliki permission tak dikenal: ${p}`).toBe(true);
      }
    }
  });

  it('setiap role punya minimal dashboard:read (semua user bisa lihat dashboard)', () => {
    for (const role of ROLE_IDS) {
      expect(can(role, 'dashboard:read'), `role ${role} tanpa dashboard:read`).toBe(true);
    }
  });
});

describe('report:approve - hanya role yang berwenang', () => {
  const HOLDERS: Array<(typeof ROLE_IDS)[number]> = ['CompanyMan', 'Admin'];
  const EXPECTED_HOLDERS = ['CompanyMan', 'Admin'];

  it('daftar role pemegang report:approve sesuai implementasi (CompanyMan + Admin)', () => {
    const holders = ROLE_IDS.filter((r) => can(r, 'report:approve'));
    expect(holders).toEqual(EXPECTED_HOLDERS);
  });

  it('DrillingEngineer TIDAK memegang report:approve (hanya amend)', () => {
    expect(can('DrillingEngineer', 'report:approve')).toBe(false);
    expect(can('DrillingEngineer', 'report:amend')).toBe(true);
  });

  it('RigClerk, CostController, HSE, Viewer tidak memegang report:approve', () => {
    for (const role of ['RigClerk', 'CostController', 'HSE', 'Viewer'] as const) {
      expect(can(role, 'report:approve'), `${role} tidak boleh approve`).toBe(false);
    }
  });

  it('setiap holder memang ada di daftar ekspektasi', () => {
    for (const role of HOLDERS) expect(can(role, 'report:approve')).toBe(true);
  });
});

describe('report:lock & report:distribute - hanya CompanyMan/Admin', () => {
  it("hanya CompanyMan & Admin yang boleh lock dan distribute", () => {
    for (const permission of ['report:lock', 'report:distribute'] as const) {
      const holders = ROLE_IDS.filter((r) => can(r, permission));
      expect(holders).toEqual(['CompanyMan', 'Admin']);
    }
  });
});

describe('matriks RBAC', () => {
  it('ROLE_PERMISSIONS punya entri untuk setiap RoleId', () => {
    for (const role of ROLE_IDS) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
      expect(Array.isArray(ROLE_PERMISSIONS[role])).toBe(true);
    }
  });

  it('cost:edit dimiliki CostController & CompanyMan, tidak oleh Viewer/RigClerk', () => {
    expect(can('CostController', 'cost:edit')).toBe(true);
    expect(can('CompanyMan', 'cost:edit')).toBe(true);
    expect(can('Viewer', 'cost:edit')).toBe(false);
    expect(can('RigClerk', 'cost:edit')).toBe(false);
  });

  it('billing:manage hanya CostController & Admin', () => {
    const holders = ROLE_IDS.filter((r) => can(r, 'billing:manage'));
    expect(holders).toEqual(['CostController', 'Admin']);
  });

  it('master:manage & user:manage hanya Admin', () => {
    for (const permission of ['master:manage', 'user:manage'] as const) {
      const holders = ROLE_IDS.filter((r) => can(r, permission));
      expect(holders).toEqual(['Admin']);
    }
  });

  it('tidak ada permission yang mustahil dimiliki (minimal Admin memilikinya)', () => {
    for (const permission of PERMISSIONS as readonly Permission[]) {
      const holders = ROLE_IDS.filter((r) => can(r, permission));
      expect(holders.length, `permission ${permission} tidak dimiliki role mana pun`).toBeGreaterThan(0);
    }
  });
});
