/**
 * DTO repository layer - plain JSON, BUKAN row DB mentah.
 *
 * Aturan:
 * - `numeric(14,2)` dari Drizzle keluar sebagai string → di sini sudah `number`.
 * - `date` → string `YYYY-MM-DD`; `timestamptz` → ISO string (`new Date().toISOString()`).
 * - File ini PURE TYPES (tanpa `server-only`) supaya bisa diimpor komponen client:
 *     import type { ReportDetail } from '@/lib/repo/types';
 *   JANGAN import dari '@/lib/repo' di client component (barrel itu server-only).
 */

/* ------------------------------------------------------------------ */
/* Daily Report                                                        */
/* ------------------------------------------------------------------ */

export type ReportListItem = {
  id: string;
  reportNo: number;
  /** YYYY-MM-DD */
  reportDate: string;
  wellId: string;
  wellName: string;
  rigId: string | null;
  rigName: string | null;
  depthMdStart: number;
  depthMdEnd: number;
  progress24h: number;
  totalMinutes: number;
  productiveMinutes: number;
  nptMinutes: number;
  wowMinutes: number;
  /** (npt + wow) / total * 100, 2 desimal. */
  nptPercent: number;
  costDailyUsd: number;
  status: string;
  /** ISO string */
  updatedAt: string;
};

export type ValidationIssueDto = {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  rowIndex?: number;
};

export type TimeRowDto = {
  id: string;
  sortOrder: number;
  /** HH:MM */
  start: string;
  /** HH:MM */
  end: string;
  durationMin: number;
  iadcCode: string;
  iadcName: string;
  iadcSubcode: string | null;
  vendor: string | null;
  nptFlag: boolean;
  /** PRD | NPT | WOW | FM | STBY | DSPT | GAP */
  timeClass: string;
  remarks: string | null;
};

export type CrewDto = {
  id: string;
  name: string;
  position: string;
  company: string | null;
  shift: string;
  hours: number;
  pobStatus: string;
  musterStation: string | null;
};

export type MudDto = {
  weightPpg: number | null;
  viscositySecQt: number | null;
  ph: number | null;
  pv: number | null;
  yp: number | null;
  chemicalsAdded: string | null;
  costUsd: number | null;
};

export type BhaDto = {
  id: string;
  sortOrder: number;
  component: string;
  odIn: number | null;
  lengthM: number | null;
  hours: number | null;
};

export type CostLineDto = {
  id: string;
  category: string;
  description: string;
  vendor: string | null;
  afeCode: string | null;
  billingType: string | null;
  amount: number;
  rebillable: boolean;
};

export type IncidentDto = {
  id: string;
  refNo: string | null;
  type: string;
  severity: string;
  /** ISO string */
  occurredAt: string | null;
  location: string | null;
  description: string;
  immediateAction: string | null;
  correctiveAction: string | null;
  assignee: string | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
  status: string;
};

export type SurveyDto = {
  id: string;
  md: number;
  inclination: number | null;
  azimuth: number | null;
  tvd: number | null;
};

export type MacDto = {
  id: string;
  activityCenter: string;
  operation: string;
  hours: number;
  billable: boolean;
};

export type ReportDetail = ReportListItem & {
  periodFrom: string;
  periodTo: string;
  depthTvd: number | null;
  summary: string | null;
  planNext: string | null;
  geologyNotes: string | null;
  equipmentStatus: Record<string, string> | null;
  costCumulativeUsd: number;
  signatureName: string | null;
  /** ISO string */
  submittedAt: string | null;
  /** ISO string */
  approvedAt: string | null;
  revision: number;
  parentReportId: string | null;
  timeRows: TimeRowDto[];
  crew: CrewDto[];
  mud: MudDto | null;
  bha: BhaDto[];
  costLines: CostLineDto[];
  incidents: IncidentDto[];
  survey: SurveyDto[];
  mac: MacDto[];
  validation: { ok: boolean; totalMinutes: number; issues: ValidationIssueDto[] };
};

/* ------------------------------------------------------------------ */
/* Well & Rig                                                          */
/* ------------------------------------------------------------------ */

export type WellDto = {
  id: string;
  /** WELL ID: kode unik internal operator. */
  wellCode: string | null;
  /** WELL NAME: nama tampilan sumur. */
  name: string;
  /** DIVISION: unit bisnis pemilik sumur. */
  division: string | null;
  apiNo: string | null;
  type: string;
  phase: string;
  /** YYYY-MM-DD */
  spudDate: string | null;
  tdPlannedM: number | null;
  lat: number | null;
  lon: number | null;
  afeBudgetUsd: number | null;
  operator: string | null;
  fieldName: string | null;
  /** Rig dari DDR terbaru (null bila belum ada laporan). */
  rigName: string | null;
  /** depthMdEnd DDR terbaru (null bila belum ada laporan). */
  latestDepthMd: number | null;
  /** latestDepthMd / tdPlannedM * 100 (null bila belum ada data). */
  progressPercent: number | null;
};

export type RigDto = {
  id: string;
  name: string;
  code: string | null;
  type: string;
  contractor: string | null;
  contractRef: string | null;
  /** Jumlah DDR 7 hari terakhir untuk rig ini. */
  activeReports: number;
};

export type WellMilestone = {
  label: string;
  /** YYYY-MM-DD | null */
  date: string | null;
  status: 'done' | 'active' | 'planned';
  depthM?: number;
};

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

export type DashboardKpi = {
  depthToday: number;
  depthDelta: number;
  nptPercent: number;
  nptDelta: number;
  dailyCost: number;
  dailyCostDelta: number;
  afeConsumedPercent: number | null;
  afeBudget: number | null;
  cumulativeCost: number;
  activeRigs: number;
  totalRigs: number;
};

export type TrendPoint = {
  /** YYYY-MM-DD */
  date: string;
  depthMd: number;
  nptPercent: number;
  dailyCost: number;
};

/** Semua nilai dalam MENIT. */
export type TimeMix = {
  productive: number;
  npt: number;
  wow: number;
  standby: number;
  disputed: number;
  gap: number;
};

/* ------------------------------------------------------------------ */
/* Billing                                                             */
/* ------------------------------------------------------------------ */

export type BillingRow = {
  /** YYYY-MM-DD */
  date: string;
  reportNo: number;
  iadcCode: string;
  iadcName: string;
  hours: number;
  amount: number;
  forceMajeure: boolean;
  disputed: boolean;
  rebillable: boolean;
};

export type BillingSummary = {
  rows: BillingRow[];
  totals: {
    billableHours: number;
    amount: number;
    disputedHours: number;
    forceMajeureHours: number;
    rebillableAmount: number;
  };
};

export type RateCardDto = {
  id: string;
  rigId: string | null;
  activityCode: string;
  label: string | null;
  tiers: Array<{ fromHour: number; toHour: number | null; ratePerHour: number; label?: string }>;
  /** YYYY-MM-DD */
  effectiveDate: string | null;
  active: boolean;
};

/* ------------------------------------------------------------------ */
/* Cost                                                                */
/* ------------------------------------------------------------------ */

export type CostSummary = {
  dailyTotal: number;
  cumulativeTotal: number;
  afeBudget: number | null;
  afeConsumedPercent: number | null;
  byCategory: Array<{ category: string; amount: number; percent: number }>;
};

/* ------------------------------------------------------------------ */
/* Master data                                                         */
/* ------------------------------------------------------------------ */

export type IadcCodeDto = {
  code: string;
  num: number;
  name: string;
  category: string;
  productive: boolean;
  nptDefault: boolean;
  subCodeRequired: boolean;
  active: boolean;
};

export type DistributionRuleDto = {
  id: string;
  name: string;
  reportType: string;
  recipientGroup: string[];
  scheduleCron: string;
  templateId: string;
  active: boolean;
  /** ISO string */
  lastRunAt: string | null;
};

export type DeliveryLogDto = {
  id: string;
  toAddresses: string[];
  subject: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  /** ISO string */
  sentAt: string | null;
  /** ISO string */
  createdAt: string;
};

export type KpiDefinitionDto = {
  id: string;
  name: string;
  formula: string;
  category: string | null;
  baseline: number | null;
  unit: string | null;
};

/** Marine daily satu laporan (`marine_daily.fields_json` bebas per varian). */
export type MarineDto = {
  id: string;
  /** jackup | anchored_floater | dpp_floater */
  variant: string;
  fields: Record<string, unknown>;
};

export type SyncDeviceDto = {
  id: string;
  deviceId: string;
  name: string;
  kind: string;
  rigId: string | null;
  /** Nama rig ter-assign (null = belum di-assign / rig terhapus). */
  rigName?: string | null;
  /** ISO string */
  lastSeenAt: string | null;
  pendingCount: number;
  active: boolean;
};

export type UserDto = {
  id: string;
  name: string;
  email: string;
  role: string;
  rigScope: string[];
  mfaEnabled: boolean;
  active: boolean;
  /** ISO string */
  lastLoginAt: string | null;
};

/* ------------------------------------------------------------------ */
/* Audit                                                               */
/* ------------------------------------------------------------------ */

export type AuditEntryDto = {
  id: string;
  /** ISO string */
  at: string;
  actorName: string | null;
  entity: string;
  entityId: string | null;
  action: string;
  oldJson: unknown;
  newJson: unknown;
  ip: string | null;
};

/* ------------------------------------------------------------------ */
/* Monitoring admin (GET /api/admin/overview)                          */
/* ------------------------------------------------------------------ */

export type RecentAuditDto = {
  /** ISO string */
  at: string;
  actorName: string | null;
  entity: string;
  action: string;
};

export type ActiveSessionDto = {
  id: string;
  userName: string | null;
  ip: string | null;
  userAgent: string | null;
  /** ISO string */
  createdAt: string;
};

/** Bentuk respons `GET /api/admin/overview`. */
export type SystemOverviewDto = {
  counts: {
    wells: number;
    rigs: number;
    users: number;
    reports: number;
    incidents: number;
    devices: number;
    rateCards: number;
  };
  reportsByStatus: Array<{ status: string; count: number }>;
  /** 10 audit terakhir (terbaru lebih dulu). */
  recentAudit: RecentAuditDto[];
  /** 10 sesi aktif terakhir (belum kedaluwarsa). */
  activeSessions: ActiveSessionDto[];
  db: { driver: 'postgres' | 'pglite'; ok: boolean; sizeApproxMb: number | null };
  /** ISO string */
  serverTime: string;
};
