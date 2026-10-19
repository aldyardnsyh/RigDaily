/**
 * RBAC - FROZEN CONTRACT.
 * Dipakai oleh: API (guard), middleware web, Admin console, Electron.
 * Sumber: 02-Modul-Fitur §D dan 06-Blueprint §4.
 */

export const ROLE_IDS = [
  'RigClerk',
  'CompanyMan',
  'DrillingEngineer',
  'CostController',
  'HSE',
  'Viewer',
  'Admin',
] as const;

export type RoleId = (typeof ROLE_IDS)[number];

export type RoleDef = {
  id: RoleId;
  label: string;
  scope: string;
  description: string;
};

export const ROLES: Record<RoleId, RoleDef> = {
  RigClerk: {
    id: 'RigClerk',
    label: 'Rig Clerk',
    scope: 'rig sendiri',
    description: 'Membuat & mengedit draft DDR harian untuk rig yang di-assign.',
  },
  CompanyMan: {
    id: 'CompanyMan',
    label: 'Company Man',
    scope: 'rig yang di-assign',
    description: 'Review, approve, dan tanda tangan digital DDR final.',
  },
  DrillingEngineer: {
    id: 'DrillingEngineer',
    label: 'Drilling Engineer',
    scope: 'lintas sumur',
    description: 'Validasi lintas sumur, koreksi lewat amendment dengan audit trail.',
  },
  CostController: {
    id: 'CostController',
    label: 'Cost Controller',
    scope: 'cost & billing',
    description: 'Input/approve biaya, AFE tracking, billing bulanan.',
  },
  HSE: {
    id: 'HSE',
    label: 'HSE Officer',
    scope: 'safety',
    description: 'Insiden safety, klasifikasi NPT, laporan HSE.',
  },
  Viewer: {
    id: 'Viewer',
    label: 'Viewer',
    scope: 'read only',
    description: 'Dashboard & PDF read-only, penerima email otomatis.',
  },
  Admin: {
    id: 'Admin',
    label: 'Administrator',
    scope: 'semua',
    description: 'Master data, user, kode IADC, rate card, jadwal sync, template.',
  },
};

/** Daftar permission granular. */
export const PERMISSIONS = [
  'dashboard:read',
  'report:read',
  'report:create',
  'report:edit-draft',
  'report:submit',
  'report:approve',
  'report:amend',
  'report:lock',
  'report:distribute',
  'time:edit',
  'cost:read',
  'cost:edit',
  'cost:approve',
  'billing:read',
  'billing:manage',
  'personnel:edit',
  'marine:edit',
  'safety:read',
  'safety:edit',
  'wellfile:read',
  'wellfile:edit',
  'reports:library',
  'sync:read',
  'sync:run',
  'sync:resolve',
  'audit:read',
  'master:manage',
  'user:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: Permission[] = ['dashboard:read', 'report:read', 'cost:read', 'billing:read', 'safety:read', 'wellfile:read', 'reports:library', 'sync:read'];

export const ROLE_PERMISSIONS: Record<RoleId, Permission[]> = {
  Viewer: VIEWER,
  RigClerk: [
    ...VIEWER,
    'report:create',
    'report:edit-draft',
    'report:submit',
    'time:edit',
    'personnel:edit',
    'marine:edit',
    'safety:edit',
    'sync:run',
  ],
  CompanyMan: [
    ...VIEWER,
    'report:create',
    'report:edit-draft',
    'report:submit',
    'report:approve',
    'report:amend',
    'report:lock',
    'report:distribute',
    'time:edit',
    'cost:edit',
    'cost:approve',
    'personnel:edit',
    'marine:edit',
    'safety:edit',
    'wellfile:edit',
    'sync:run',
    'sync:resolve',
    'audit:read',
  ],
  DrillingEngineer: [
    ...VIEWER,
    'report:create',
    'report:edit-draft',
    'report:submit',
    'report:amend',
    'time:edit',
    'wellfile:edit',
    'audit:read',
    'sync:run',
  ],
  CostController: [
    ...VIEWER,
    'cost:edit',
    'cost:approve',
    'billing:manage',
    'audit:read',
  ],
  HSE: [...VIEWER, 'safety:edit', 'report:edit-draft', 'audit:read'],
  Admin: [...PERMISSIONS],
};

export function can(role: RoleId | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function permissionsFor(role: RoleId): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}
