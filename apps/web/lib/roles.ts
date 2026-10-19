export const ROLES = {
  RigClerk: { label: 'Rig Clerk', scope: 'rig sendiri' },
  CompanyMan: { label: 'Company Man', scope: 'rig yang diassign' },
  DrillingEngineer: { label: 'Drilling Engineer', scope: 'lintas sumur' },
  CostController: { label: 'Cost Controller', scope: 'cost/billing' },
  HSE: { label: 'HSE Officer', scope: 'safety' },
  Viewer: { label: 'Viewer', scope: 'read only' },
  Admin: { label: 'Administrator', scope: 'semua' },
} as const;
export type RoleId = keyof typeof ROLES;
