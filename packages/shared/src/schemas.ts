/**
 * ZOD SCHEMAS - FROZEN CONTRACT.
 * Dipakai bersama oleh: API route handler (validasi request), Electron IPC (validasi lokal),
 * seed script, dan test suite. JANGAN buat schema duplikat di tempat lain.
 */
import { z } from 'zod';

/* ---------------- Primitives ---------------- */

export const zHm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Format waktu harus HH:MM (00:00-23:59)');
export const zIsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD');

export const REPORT_STATUSES = ['draft', 'submitted', 'approved', 'distributed', 'locked'] as const;
export const zReportStatus = z.enum(REPORT_STATUSES);
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const WELL_PHASES = ['planning', 'drilling', 'completion', 'workover', 'fracking', 'flowback', 'facility', 'closed'] as const;
export const zWellPhase = z.enum(WELL_PHASES);
export type WellPhase = (typeof WELL_PHASES)[number];

export const WELL_TYPES = ['oil', 'gas', 'geothermal', 'ccs', 'mining', 'water'] as const;
export const zWellType = z.enum(WELL_TYPES);
export type WellType = (typeof WELL_TYPES)[number];

export const RIG_TYPES = ['land', 'jackup', 'anchored_floater', 'dpp_floater'] as const;
export const zRigType = z.enum(RIG_TYPES);
export type RigType = (typeof RIG_TYPES)[number];

/* ---------------- Time breakdown ---------------- */

export const zTimeBreakdownRow = z.object({
  id: z.string().optional(),
  start: zHm,
  end: zHm,
  iadcCode: z.string().min(1).max(4),
  iadcSubcode: z.string().max(160).optional().nullable(),
  equipmentId: z.string().uuid().optional().nullable(),
  vendor: z.string().max(160).optional().nullable(),
  nptFlag: z.boolean().default(false),
  remarks: z.string().max(2000).optional().nullable(),
  sortOrder: z.number().int().nonnegative().optional(),
});
export type TimeBreakdownRowInput = z.infer<typeof zTimeBreakdownRow>;

/* ---------------- Crew / POB ---------------- */

export const zCrewRow = z.object({
  name: z.string().min(1).max(160),
  position: z.string().max(120).default('Crew'),
  company: z.string().max(160).optional().nullable(),
  shift: z.enum(['Day', 'Night']).default('Day'),
  hours: z.number().min(0).max(24).default(12),
  pobStatus: z.enum(['in', 'out']).default('in'),
  musterStation: z.string().max(80).optional().nullable(),
});
export type CrewRowInput = z.infer<typeof zCrewRow>;

/* ---------------- Mud / BHA / Geology ---------------- */

export const zMudRecord = z.object({
  weightPpg: z.number().min(0).max(30).optional().nullable(),
  viscositySecQt: z.number().min(0).max(300).optional().nullable(),
  ph: z.number().min(0).max(14).optional().nullable(),
  pv: z.number().min(0).optional().nullable(),
  yp: z.number().min(0).optional().nullable(),
  chemicalsAdded: z.string().max(2000).optional().nullable(),
  costUsd: z.number().optional().nullable(),
});
export type MudRecordInput = z.infer<typeof zMudRecord>;

export const zBhaComponent = z.object({
  component: z.string().min(1).max(160),
  odIn: z.number().min(0).max(60).optional().nullable(),
  lengthM: z.number().min(0).optional().nullable(),
  hours: z.number().min(0).max(24).optional().nullable(),
});
export type BhaComponentInput = z.infer<typeof zBhaComponent>;

/* ---------------- Cost ---------------- */

export const zCostLine = z.object({
  id: z.string().optional(),
  category: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  vendor: z.string().max(200).optional().nullable(),
  afeCode: z.string().max(60).optional().nullable(),
  billingType: z.string().max(60).optional().nullable(),
  amount: z.number().refine((v) => v !== 0, 'Nominal tidak boleh 0'),
  rebillable: z.boolean().default(false),
});
export type CostLineInput = z.infer<typeof zCostLine>;

/* ---------------- Safety ---------------- */

export const zSafetyIncident = z.object({
  type: z.string().min(1).max(80),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  occurredAt: z.string().optional().nullable(),
  location: z.string().max(160).optional().nullable(),
  description: z.string().min(1).max(4000),
  immediateAction: z.string().max(4000).optional().nullable(),
  correctiveAction: z.string().max(4000).optional().nullable(),
  assignee: z.string().max(160).optional().nullable(),
  dueDate: zIsoDate.optional().nullable(),
  status: z.enum(['draft', 'open', 'closed']).default('open'),
});
export type SafetyIncidentInput = z.infer<typeof zSafetyIncident>;

/* ---------------- Daily Report (payload utama) ---------------- */

export const zDailyReportPayload = z.object({
  wellId: z.string().uuid(),
  rigId: z.string().uuid().optional().nullable(),
  reportDate: zIsoDate,
  reportNo: z.number().int().positive().optional(),
  periodFrom: zHm.default('06:00'),
  periodTo: zHm.default('06:00'),

  depthMdStart: z.number().min(0).max(15000),
  depthMdEnd: z.number().min(0).max(15000),
  depthTvd: z.number().min(0).max(15000).optional().nullable(),
  progress24h: z.number().optional(),

  summary: z.string().max(8000).optional().nullable(),
  planNext: z.string().max(4000).optional().nullable(),
  geologyNotes: z.string().max(4000).optional().nullable(),
  equipmentStatus: z.record(z.string(), z.string()).optional().nullable(),

  timeRows: z.array(zTimeBreakdownRow).min(1).max(200),
  crew: z.array(zCrewRow).max(300).default([]),
  mud: zMudRecord.optional().nullable(),
  bha: z.array(zBhaComponent).max(100).default([]),
  costLines: z.array(zCostLine).max(300).default([]),
  incidents: z.array(zSafetyIncident).max(100).default([]),
});
export type DailyReportPayload = z.infer<typeof zDailyReportPayload>;

/* ---------------- Auth ---------------- */

export const zLoginRequest = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});
export type LoginRequest = z.infer<typeof zLoginRequest>;

/* ---------------- Billing ---------------- */

export const zBillingTier = z.object({
  fromHour: z.number().min(0),
  toHour: z.number().min(0).nullable(),
  ratePerHour: z.number(),
  label: z.string().optional(),
});

export const zRateCard = z.object({
  rigId: z.string().uuid().optional().nullable(),
  activityCode: z.string().min(1).max(4),
  label: z.string().max(120).optional().nullable(),
  tiers: z.array(zBillingTier).min(1),
  effectiveDate: zIsoDate.optional().nullable(),
});

/* ---------------- Sync protocol ---------------- */

export const zSyncMutation = z.object({
  /** UUID v4 dibuat device - idempotency key. */
  clientMutationId: z.string().uuid(),
  deviceId: z.string().min(1).max(80),
  entity: z.enum(['daily_report', 'time_breakdown', 'cost_line', 'crew', 'mud', 'safety_incident', 'well', 'rig']),
  /** Local UUID di device. */
  entityLocalId: z.string().uuid(),
  /** ID server bila sudah pernah tersinkron. */
  entityServerId: z.string().optional().nullable(),
  op: z.enum(['create', 'update', 'delete']),
  /** ISO timestamp saat perubahan dibuat di device. */
  updatedAt: z.string(),
  /** SHA-256 hex dari payload kanonik untuk deteksi drift. */
  hash: z.string().min(16).max(128),
  payload: z.record(z.string(), z.unknown()),
  /** Base version server yang dipegang device saat edit (optimistic lock). */
  baseServerUpdatedAt: z.string().optional().nullable(),
});
export type SyncMutation = z.infer<typeof zSyncMutation>;

export const zSyncPushRequest = z.object({
  deviceId: z.string().min(1).max(80),
  mutations: z.array(zSyncMutation).min(1).max(500),
});
export type SyncPushRequest = z.infer<typeof zSyncPushRequest>;

export const zSyncPushAck = z.object({
  clientMutationId: z.string(),
  status: z.enum(['acked', 'conflict', 'rejected']),
  entityServerId: z.string().optional().nullable(),
  serverUpdatedAt: z.string().optional().nullable(),
  conflictReason: z.string().optional().nullable(),
  /** Payload versi server (untuk side-by-side resolver). */
  serverPayload: z.record(z.string(), z.unknown()).optional().nullable(),
});
export type SyncPushAck = z.infer<typeof zSyncPushAck>;

export const zSyncPushResponse = z.object({
  deviceId: z.string(),
  serverTime: z.string(),
  acks: z.array(zSyncPushAck),
});
export type SyncPushResponse = z.infer<typeof zSyncPushResponse>;

export const zSyncPullRequest = z.object({
  deviceId: z.string().min(1).max(80),
  /** ISO timestamp pull terakhir; server kirim semua perubahan setelah ini. */
  since: z.string().optional().nullable(),
  entities: z.array(z.string()).optional(),
});
export type SyncPullRequest = z.infer<typeof zSyncPullRequest>;

export const zSyncPullResponse = z.object({
  serverTime: z.string(),
  changes: z.array(
    z.object({
      entity: z.string(),
      entityServerId: z.string(),
      entityLocalId: z.string().optional().nullable(),
      op: z.enum(['upsert', 'delete']),
      updatedAt: z.string(),
      payload: z.record(z.string(), z.unknown()),
    }),
  ),
  /** True jika ada lebih banyak batch; device harus pull lagi. */
  hasMore: z.boolean(),
});
export type SyncPullResponse = z.infer<typeof zSyncPullResponse>;

/* ---------------- Amendment ---------------- */

export const zAmendmentRequest = z.object({
  reportId: z.string().uuid(),
  reason: z.string().min(10).max(1000),
  changes: z.record(z.string(), z.unknown()),
});
export type AmendmentRequest = z.infer<typeof zAmendmentRequest>;
