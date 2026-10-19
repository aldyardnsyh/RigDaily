/**
 * Drizzle schema - PostgreSQL (pusat/kantor).
 *
 * FROZEN CONTRACT. Semua agent WAJIB pakai nama tabel & kolom ini.
 * Sumber: 05-Data-Model §2 (ERD logis) + 06-Blueprint §5 (kolom sync).
 *
 * Konvensi:
 * - PK: uuid (crypto.randomUUID) supaya rig bisa bikin ID offline tanpa tabrakan.
 * - Semua tabel operasional punya: createdAt, updatedAt, deletedAt (soft), originDeviceId, revision.
 * - Angka uang: numeric(14,2). Jam/durasi: integer menit (kecuali billing jam desimal).
 * - Timestamp: timestamptz.
 */
import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/* ------------------------------------------------------------------ */
/* Kolom sync standar                                                  */
/* ------------------------------------------------------------------ */
const syncColumns = {
  originDeviceId: varchar('origin_device_id', { length: 80 }),
  revision: integer('revision').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/* ------------------------------------------------------------------ */
/* Auth & organisasi                                                   */
/* ------------------------------------------------------------------ */

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 200 }).notNull(),
  type: varchar('type', { length: 40 }).notNull().default('operator'), // operator | contractor | partner
  ...syncColumns,
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').references(() => companies.id),
    email: varchar('email', { length: 200 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    /** scrypt hash: "scrypt$N$r$p$salt$hash" - lihat lib/password.ts */
    passwordHash: text('password_hash').notNull(),
    role: varchar('role', { length: 40 }).notNull(), // RoleId dari @rigdaily/shared
    /** Scope rig: array rig id; null/[] = semua (untuk Admin/Viewer global) */
    rigScope: jsonb('rig_scope').$type<string[]>().notNull().default([]),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    mfaSecret: text('mfa_secret'),
    active: boolean('active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...syncColumns,
  },
  (t) => ({
    emailIdx: uniqueIndex('users_email_uq').on(t.email),
    roleIdx: index('users_role_idx').on(t.role),
  }),
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 128 }).notNull(),
    userAgent: varchar('user_agent', { length: 300 }),
    ip: varchar('ip', { length: 60 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenIdx: uniqueIndex('sessions_token_uq').on(t.tokenHash),
    userIdx: index('sessions_user_idx').on(t.userId),
  }),
);

/* ------------------------------------------------------------------ */
/* Master data                                                         */
/* ------------------------------------------------------------------ */

export const fields = pgTable('fields', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').references(() => companies.id),
  name: varchar('name', { length: 160 }).notNull(),
  county: varchar('county', { length: 120 }),
  state: varchar('state', { length: 120 }),
  country: varchar('country', { length: 120 }).default('Indonesia'),
  location: varchar('location', { length: 200 }),
  ...syncColumns,
});

export const rigs = pgTable('rigs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 160 }).notNull(),
  code: varchar('code', { length: 60 }),
  type: varchar('type', { length: 40 }).notNull().default('land'), // land|jackup|anchored_floater|dpp_floater
  contractor: varchar('contractor', { length: 200 }),
  contractRef: varchar('contract_ref', { length: 120 }),
  ...syncColumns,
});

export const wells = pgTable(
  'wells',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fieldId: uuid('field_id').references(() => fields.id),
    /** WELL ID: kode unik internal operator, mis. ARN-07-HZ. */
    wellCode: varchar('well_code', { length: 60 }),
    /** WELL NAME: nama tampilan sumur, mis. ARUN-07. */
    name: varchar('name', { length: 160 }).notNull(),
    /** DIVISION: unit bisnis pemilik sumur, mis. Sumatera Operations. */
    division: varchar('division', { length: 120 }),
    apiNo: varchar('api_no', { length: 60 }),
    type: varchar('type', { length: 40 }).notNull().default('oil'), // oil|gas|geothermal|ccs|mining|water
    phase: varchar('phase', { length: 40 }).notNull().default('drilling'),
    spudDate: date('spud_date'),
    tdPlannedM: numeric('td_planned_m', { precision: 10, scale: 2 }),
    lat: numeric('lat', { precision: 10, scale: 6 }),
    lon: numeric('lon', { precision: 10, scale: 6 }),
    afeBudgetUsd: numeric('afe_budget_usd', { precision: 14, scale: 2 }),
    operator: varchar('operator', { length: 200 }),
    ...syncColumns,
  },
  (t) => ({
    nameIdx: index('wells_name_idx').on(t.name),
    phaseIdx: index('wells_phase_idx').on(t.phase),
  }),
);

export const equipment = pgTable('equipment', {
  id: uuid('id').primaryKey().defaultRandom(),
  rigId: uuid('rig_id').references(() => rigs.id),
  name: varchar('name', { length: 200 }).notNull(),
  group: varchar('group', { length: 120 }), // Top Drive, Mud Pump, BOP, ...
  system: varchar('system', { length: 120 }),
  vendor: varchar('vendor', { length: 200 }),
  partNo: varchar('part_no', { length: 120 }),
  ...syncColumns,
});

export const vendors = pgTable('vendors', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 200 }).notNull(),
  service: varchar('service', { length: 160 }),
  contact: varchar('contact', { length: 200 }),
  ...syncColumns,
});

/** IADC codes master - 34 baris dari @rigdaily/shared, bisa di-toggle NPT per company. */
export const iadcCodes = pgTable('iadc_codes', {
  code: varchar('code', { length: 4 }).primaryKey(),
  num: integer('num').notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  category: varchar('category', { length: 40 }).notNull(),
  productive: boolean('productive').notNull(),
  nptDefault: boolean('npt_default').notNull().default(false),
  subCodeRequired: boolean('sub_code_required').notNull().default(false),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  ...syncColumns,
});

/* ------------------------------------------------------------------ */
/* Daily Report & anak-anaknya                                         */
/* ------------------------------------------------------------------ */

export const dailyReports = pgTable(
  'daily_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    wellId: uuid('well_id')
      .notNull()
      .references(() => wells.id),
    rigId: uuid('rig_id').references(() => rigs.id),
    reportDate: date('report_date').notNull(),
    reportNo: integer('report_no').notNull(),
    periodFrom: varchar('period_from', { length: 5 }).notNull().default('06:00'),
    periodTo: varchar('period_to', { length: 5 }).notNull().default('06:00'),

    depthMdStart: numeric('depth_md_start', { precision: 10, scale: 2 }).notNull(),
    depthMdEnd: numeric('depth_md_end', { precision: 10, scale: 2 }).notNull(),
    depthTvd: numeric('depth_tvd', { precision: 10, scale: 2 }),
    progress24h: numeric('progress_24h', { precision: 10, scale: 2 }),

    summary: text('summary'),
    planNext: text('plan_next'),
    geologyNotes: text('geology_notes'),
    equipmentStatus: jsonb('equipment_status').$type<Record<string, string>>(),

    /** Ringkasan waktu (denormalisasi untuk query dashboard cepat). */
    totalMinutes: integer('total_minutes').notNull().default(0),
    productiveMinutes: integer('productive_minutes').notNull().default(0),
    nptMinutes: integer('npt_minutes').notNull().default(0),
    wowMinutes: integer('wow_minutes').notNull().default(0),
    costDailyUsd: numeric('cost_daily_usd', { precision: 14, scale: 2 }).notNull().default('0'),
    costCumulativeUsd: numeric('cost_cumulative_usd', { precision: 14, scale: 2 }).notNull().default('0'),

    status: varchar('status', { length: 20 }).notNull().default('draft'),
    /** Untuk amendment: parent report id + nomor revisi. */
    parentReportId: uuid('parent_report_id'),
    amendmentReason: text('amendment_reason'),
    /** Locked saat approved - sync tidak boleh menimpa. */
    lockedAt: timestamp('locked_at', { withTimezone: true }),

    createdBy: uuid('created_by').references(() => users.id),
    submittedBy: uuid('submitted_by').references(() => users.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    signatureName: varchar('signature_name', { length: 200 }),
    distributedAt: timestamp('distributed_at', { withTimezone: true }),

    ...syncColumns,
  },
  (t) => ({
    wellDateUq: uniqueIndex('daily_reports_well_date_uq').on(t.wellId, t.reportDate, t.revision),
    dateIdx: index('daily_reports_date_idx').on(t.reportDate),
    statusIdx: index('daily_reports_status_idx').on(t.status),
    wellIdx: index('daily_reports_well_idx').on(t.wellId),
  }),
);

export const timeBreakdown = pgTable(
  'time_breakdown',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => dailyReports.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    startHm: varchar('start_hm', { length: 5 }).notNull(),
    endHm: varchar('end_hm', { length: 5 }).notNull(),
    /** Durasi menit - dihitung oleh @rigdaily/shared rowDurationMinutes, disimpan untuk query. */
    durationMin: integer('duration_min').notNull(),
    iadcCode: varchar('iadc_code', { length: 4 }).notNull(),
    iadcSubcode: varchar('iadc_subcode', { length: 160 }),
    equipmentId: uuid('equipment_id').references(() => equipment.id),
    vendorId: uuid('vendor_id').references(() => vendors.id),
    nptFlag: boolean('npt_flag').notNull().default(false),
    timeClass: varchar('time_class', { length: 6 }).notNull().default('PRD'), // PRD|NPT|WOW|FM|STBY|DSPT
    remarks: text('remarks'),
    ...syncColumns,
  },
  (t) => ({
    reportIdx: index('time_breakdown_report_idx').on(t.reportId),
    codeIdx: index('time_breakdown_code_idx').on(t.iadcCode),
  }),
);

export const crewMembers = pgTable(
  'crew_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => dailyReports.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 160 }).notNull(),
    position: varchar('position', { length: 120 }).notNull().default('Crew'),
    company: varchar('company', { length: 160 }),
    shift: varchar('shift', { length: 10 }).notNull().default('Day'),
    hours: numeric('hours', { precision: 5, scale: 2 }).notNull().default('12'),
    pobStatus: varchar('pob_status', { length: 10 }).notNull().default('in'),
    musterStation: varchar('muster_station', { length: 80 }),
    ...syncColumns,
  },
  (t) => ({ reportIdx: index('crew_report_idx').on(t.reportId) }),
);

export const mudRecords = pgTable(
  'mud_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => dailyReports.id, { onDelete: 'cascade' }),
    weightPpg: numeric('weight_ppg', { precision: 6, scale: 2 }),
    viscositySecQt: numeric('viscosity_sec_qt', { precision: 8, scale: 2 }),
    ph: numeric('ph', { precision: 5, scale: 2 }),
    pv: numeric('pv', { precision: 8, scale: 2 }),
    yp: numeric('yp', { precision: 8, scale: 2 }),
    chemicalsAdded: text('chemicals_added'),
    costUsd: numeric('cost_usd', { precision: 14, scale: 2 }),
    ...syncColumns,
  },
  (t) => ({ reportIdx: uniqueIndex('mud_report_uq').on(t.reportId) }),
);

export const bhaComponents = pgTable(
  'bha_components',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => dailyReports.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    component: varchar('component', { length: 160 }).notNull(),
    odIn: numeric('od_in', { precision: 6, scale: 2 }),
    lengthM: numeric('length_m', { precision: 8, scale: 2 }),
    hours: numeric('hours', { precision: 5, scale: 2 }),
    ...syncColumns,
  },
  (t) => ({ reportIdx: index('bha_report_idx').on(t.reportId) }),
);

export const costLines = pgTable(
  'cost_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id').references(() => dailyReports.id, { onDelete: 'cascade' }),
    wellId: uuid('well_id').references(() => wells.id),
    category: varchar('category', { length: 80 }).notNull(),
    description: varchar('description', { length: 500 }).notNull(),
    vendor: varchar('vendor', { length: 200 }),
    afeCode: varchar('afe_code', { length: 60 }),
    billingType: varchar('billing_type', { length: 60 }),
    amountUsd: numeric('amount_usd', { precision: 14, scale: 2 }).notNull(),
    rebillable: boolean('rebillable').notNull().default(false),
    ...syncColumns,
  },
  (t) => ({
    reportIdx: index('cost_lines_report_idx').on(t.reportId),
    catIdx: index('cost_lines_category_idx').on(t.category),
  }),
);

export const safetyIncidents = pgTable(
  'safety_incidents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id').references(() => dailyReports.id, { onDelete: 'cascade' }),
    refNo: varchar('ref_no', { length: 60 }),
    type: varchar('type', { length: 80 }).notNull(),
    severity: varchar('severity', { length: 20 }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    location: varchar('location', { length: 160 }),
    description: text('description').notNull(),
    immediateAction: text('immediate_action'),
    correctiveAction: text('corrective_action'),
    assignee: varchar('assignee', { length: 160 }),
    dueDate: date('due_date'),
    status: varchar('status', { length: 20 }).notNull().default('open'),
    ...syncColumns,
  },
  (t) => ({ sevIdx: index('safety_severity_idx').on(t.severity) }),
);

export const marineDaily = pgTable(
  'marine_daily',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => dailyReports.id, { onDelete: 'cascade' }),
    variant: varchar('variant', { length: 30 }).notNull(), // jackup|anchored_floater|dpp_floater
    fieldsJson: jsonb('fields_json').$type<Record<string, unknown>>().notNull().default({}),
    ...syncColumns,
  },
  (t) => ({ reportIdx: uniqueIndex('marine_report_uq').on(t.reportId) }),
);

/** MAC - dual derrick / parallel ops. */
export const macActivities = pgTable(
  'mac_activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => dailyReports.id, { onDelete: 'cascade' }),
    activityCenter: varchar('activity_center', { length: 60 }).notNull(), // Main | Offline
    operation: varchar('operation', { length: 200 }).notNull(),
    hours: numeric('hours', { precision: 5, scale: 2 }).notNull(),
    billable: boolean('billable').notNull().default(true),
    ...syncColumns,
  },
  (t) => ({ reportIdx: index('mac_report_idx').on(t.reportId) }),
);

/** Directional survey stations. */
export const surveyStations = pgTable(
  'survey_stations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => dailyReports.id, { onDelete: 'cascade' }),
    md: numeric('md', { precision: 10, scale: 2 }).notNull(),
    inclination: numeric('inclination', { precision: 6, scale: 2 }),
    azimuth: numeric('azimuth', { precision: 6, scale: 2 }),
    tvd: numeric('tvd', { precision: 10, scale: 2 }),
    ...syncColumns,
  },
  (t) => ({ reportIdx: index('survey_report_idx').on(t.reportId) }),
);

/* ------------------------------------------------------------------ */
/* Billing                                                             */
/* ------------------------------------------------------------------ */

export const rateCards = pgTable(
  'rate_cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rigId: uuid('rig_id').references(() => rigs.id),
    activityCode: varchar('activity_code', { length: 4 }).notNull(),
    label: varchar('label', { length: 120 }),
    tiers: jsonb('tiers').$type<Array<{ fromHour: number; toHour: number | null; ratePerHour: number; label?: string }>>().notNull(),
    effectiveDate: date('effective_date'),
    active: boolean('active').notNull().default(true),
    ...syncColumns,
  },
  (t) => ({ rigCodeIdx: index('rate_cards_rig_code_idx').on(t.rigId, t.activityCode) }),
);

export const billingFlags = pgTable(
  'billing_flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => dailyReports.id, { onDelete: 'cascade' }),
    timeRowId: uuid('time_row_id').references(() => timeBreakdown.id, { onDelete: 'cascade' }),
    forceMajeure: boolean('force_majeure').notNull().default(false),
    disputed: boolean('disputed').notNull().default(false),
    rebillable: boolean('rebillable').notNull().default(false),
    note: text('note'),
    ...syncColumns,
  },
  (t) => ({ reportIdx: index('billing_flags_report_idx').on(t.reportId) }),
);

/* ------------------------------------------------------------------ */
/* Distribusi laporan                                                  */
/* ------------------------------------------------------------------ */

export const distributionRules = pgTable('distribution_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 160 }).notNull(),
  reportType: varchar('report_type', { length: 60 }).notNull().default('ddr'),
  /** RoleId atau email langsung. */
  recipientGroup: jsonb('recipient_group').$type<string[]>().notNull().default([]),
  scheduleCron: varchar('schedule_cron', { length: 60 }).notNull().default('0 7 * * *'),
  templateId: varchar('template_id', { length: 60 }).notNull().default('ddr-default'),
  active: boolean('active').notNull().default(true),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  ...syncColumns,
});

export const deliveryLog = pgTable(
  'delivery_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ruleId: uuid('rule_id').references(() => distributionRules.id, { onDelete: 'set null' }),
    reportId: uuid('report_id').references(() => dailyReports.id, { onDelete: 'cascade' }),
    toAddresses: jsonb('to_addresses').$type<string[]>().notNull().default([]),
    ccAddresses: jsonb('cc_addresses').$type<string[]>().notNull().default([]),
    subject: varchar('subject', { length: 300 }),
    status: varchar('status', { length: 20 }).notNull().default('queued'), // queued|sent|failed
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('delivery_status_idx').on(t.status),
    reportIdx: index('delivery_report_idx').on(t.reportId),
  }),
);

/* ------------------------------------------------------------------ */
/* Sync                                                                */
/* ------------------------------------------------------------------ */

export const syncDevices = pgTable(
  'sync_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deviceId: varchar('device_id', { length: 80 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    rigId: uuid('rig_id').references(() => rigs.id),
    kind: varchar('kind', { length: 30 }).notNull().default('electron'), // electron|office|api
    apiKeyHash: varchar('api_key_hash', { length: 128 }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    lastPulledAt: timestamp('last_pulled_at', { withTimezone: true }),
    pendingCount: integer('pending_count').notNull().default(0),
    active: boolean('active').notNull().default(true),
    ...syncColumns,
  },
  (t) => ({ deviceIdx: uniqueIndex('sync_devices_device_uq').on(t.deviceId) }),
);

/** Log konflik yang menunggu resolusi manual di Sync Center. */
export const syncConflicts = pgTable(
  'sync_conflicts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deviceId: varchar('device_id', { length: 80 }).notNull(),
    entity: varchar('entity', { length: 40 }).notNull(),
    entityServerId: uuid('entity_server_id'),
    entityLocalId: uuid('entity_local_id'),
    clientMutationId: uuid('client_mutation_id').notNull(),
    rigPayload: jsonb('rig_payload').$type<Record<string, unknown>>().notNull(),
    serverPayload: jsonb('server_payload').$type<Record<string, unknown>>().notNull(),
    reason: text('reason').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('open'), // open|resolved|discarded
    resolvedBy: uuid('resolved_by').references(() => users.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolution: varchar('resolution', { length: 20 }), // keep_rig|keep_server|merge
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ statusIdx: index('sync_conflicts_status_idx').on(t.status) }),
);

/** Idempotency ledger: mutation id yang sudah diproses. */
export const syncMutationLog = pgTable(
  'sync_mutation_log',
  {
    clientMutationId: uuid('client_mutation_id').primaryKey(),
    deviceId: varchar('device_id', { length: 80 }).notNull(),
    entity: varchar('entity', { length: 40 }).notNull(),
    entityServerId: uuid('entity_server_id'),
    result: varchar('result', { length: 20 }).notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ deviceIdx: index('sync_mutation_device_idx').on(t.deviceId) }),
);

/* ------------------------------------------------------------------ */
/* Audit & KPI                                                         */
/* ------------------------------------------------------------------ */

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entity: varchar('entity', { length: 60 }).notNull(),
    entityId: varchar('entity_id', { length: 80 }),
    actorId: uuid('actor_id').references(() => users.id),
    actorName: varchar('actor_name', { length: 200 }),
    action: varchar('action', { length: 60 }).notNull(),
    oldJson: jsonb('old_json').$type<Record<string, unknown>>(),
    newJson: jsonb('new_json').$type<Record<string, unknown>>(),
    ip: varchar('ip', { length: 60 }),
    terminal: varchar('terminal', { length: 120 }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    entityIdx: index('audit_entity_idx').on(t.entity, t.entityId),
    atIdx: index('audit_at_idx').on(t.at),
  }),
);

export const kpiDefinitions = pgTable('kpi_definitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 160 }).notNull(),
  formula: text('formula').notNull(),
  category: varchar('category', { length: 80 }),
  baseline: numeric('baseline', { precision: 14, scale: 4 }),
  unit: varchar('unit', { length: 30 }),
  active: boolean('active').notNull().default(true),
  ...syncColumns,
});

/** Import legacy & reconciliation. */
export const importBatches = pgTable('import_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  source: varchar('source', { length: 120 }).notNull(),
  fileName: varchar('file_name', { length: 300 }),
  rowCount: integer('row_count').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  errors: jsonb('errors').$type<Array<{ row: number; message: string }>>().default([]),
  status: varchar('status', { length: 20 }).notNull().default('processing'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Bit records (matabor)                                               */
/* ------------------------------------------------------------------ */

/**
 * Riwayat bit per sumur. Satu baris = satu bit yang pernah dipakai.
 * Dipakai halaman Bits untuk menghitung jam pakai, ROP rata-rata, dan
 * kondisi akhir (dull grade) tiap matabor.
 */
export const bits = pgTable(
  'bits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    wellId: uuid('well_id')
      .notNull()
      .references(() => wells.id),
    reportId: uuid('report_id').references(() => dailyReports.id, { onDelete: 'set null' }),
    /** Nomor urut bit di sumur ini (Bit #1, #2, ...). */
    bitNo: integer('bit_no').notNull().default(1),
    /** Jenis: PDC, tricone, impregnated, core, reamer. */
    bitType: varchar('bit_type', { length: 40 }).notNull().default('PDC'),
    /** Kode IADC bit 4 karakter, mis. M323. */
    iadcBitCode: varchar('iadc_bit_code', { length: 12 }),
    sizeIn: numeric('size_in', { precision: 6, scale: 3 }),
    manufacturer: varchar('manufacturer', { length: 160 }),
    model: varchar('model', { length: 160 }),
    serialNo: varchar('serial_no', { length: 120 }),
    /** Jumlah nozzle dan total flow area (in2). */
    nozzleCount: integer('nozzle_count'),
    tfaIn2: numeric('tfa_in2', { precision: 6, scale: 3 }),
    /** Kedalaman masuk dan keluar memakai bit ini (m MD). */
    depthInMd: numeric('depth_in_md', { precision: 10, scale: 2 }),
    depthOutMd: numeric('depth_out_md', { precision: 10, scale: 2 }),
    /** Total jam putar dan footage yang dihasilkan. */
    rotatingHours: numeric('rotating_hours', { precision: 8, scale: 2 }),
    footageM: numeric('footage_m', { precision: 10, scale: 2 }),
    /** Kondisi akhir: NEW, RR (rerun), atau dull grade IADC. */
    dullGrade: varchar('dull_grade', { length: 40 }),
    status: varchar('status', { length: 20 }).notNull().default('active'), // active|pulled|available
    notes: text('notes'),
    ...syncColumns,
  },
  (t) => ({
    wellIdx: index('bits_well_idx').on(t.wellId),
    statusIdx: index('bits_status_idx').on(t.status),
  }),
);

/* ------------------------------------------------------------------ */
/* Casing design                                                       */
/* ------------------------------------------------------------------ */

/** Satu baris = satu string/section casing pada desain sumur. */
export const casingDesigns = pgTable(
  'casing_designs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    wellId: uuid('well_id')
      .notNull()
      .references(() => wells.id),
    /** conductor, surface, intermediate, production, liner. */
    section: varchar('section', { length: 40 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(1),
    /** Ukuran nominal inci, mis. 13.375. */
    sizeIn: numeric('size_in', { precision: 6, scale: 3 }).notNull(),
    weightPpf: numeric('weight_ppf', { precision: 8, scale: 2 }),
    grade: varchar('grade', { length: 40 }),
    connection: varchar('connection', { length: 60 }),
    /** Kedalaman sepatu dan top section ini (m MD). */
    shoeMd: numeric('shoe_md', { precision: 10, scale: 2 }),
    topMd: numeric('top_md', { precision: 10, scale: 2 }),
    holeSizeIn: numeric('hole_size_in', { precision: 6, scale: 3 }),
    joints: integer('joints'),
    cementRequired: boolean('cement_required').notNull().default(true),
    notes: text('notes'),
    ...syncColumns,
  },
  (t) => ({ wellIdx: index('casing_well_idx').on(t.wellId) }),
);

/* ------------------------------------------------------------------ */
/* Cement program                                                      */
/* ------------------------------------------------------------------ */

/** Program penyemenan per section. Satu baris = satu job semen. */
export const cementPrograms = pgTable(
  'cement_programs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    wellId: uuid('well_id')
      .notNull()
      .references(() => wells.id),
    casingDesignId: uuid('casing_design_id').references(() => casingDesigns.id, { onDelete: 'set null' }),
    section: varchar('section', { length: 40 }).notNull(),
    jobType: varchar('job_type', { length: 40 }).notNull().default('primary'), // primary|squeeze|plug|liner
    plannedDate: date('planned_date'),
    executedDate: date('executed_date'),
    slurryType: varchar('slurry_type', { length: 40 }),
    slurryDensityPpg: numeric('slurry_density_ppg', { precision: 6, scale: 3 }),
    yieldFt3Sx: numeric('yield_ft3_sx', { precision: 8, scale: 3 }),
    volumeBbl: numeric('volume_bbl', { precision: 10, scale: 2 }),
    sacksSx: integer('sacks_sx'),
    mixWaterBbl: numeric('mix_water_bbl', { precision: 10, scale: 2 }),
    additive: text('additive'),
    plugBumpedPsi: numeric('plug_bumped_psi', { precision: 10, scale: 2 }),
    topOfCementMd: numeric('top_of_cement_md', { precision: 10, scale: 2 }),
    /** good | partial | poor | unknown. */
    evaluation: varchar('evaluation', { length: 20 }).default('unknown'),
    status: varchar('status', { length: 20 }).notNull().default('planned'), // planned|executed|cancelled
    notes: text('notes'),
    ...syncColumns,
  },
  (t) => ({ wellIdx: index('cement_well_idx').on(t.wellId) }),
);

/* ------------------------------------------------------------------ */
/* Relations                                                           */
/* ------------------------------------------------------------------ */

export const wellRelations = relations(wells, ({ one, many }) => ({
  field: one(fields, { fields: [wells.fieldId], references: [fields.id] }),
  reports: many(dailyReports),
}));

export const reportRelations = relations(dailyReports, ({ one, many }) => ({
  well: one(wells, { fields: [dailyReports.wellId], references: [wells.id] }),
  rig: one(rigs, { fields: [dailyReports.rigId], references: [rigs.id] }),
  timeRows: many(timeBreakdown),
  crew: many(crewMembers),
  costLines: many(costLines),
  incidents: many(safetyIncidents),
  mud: one(mudRecords, { fields: [dailyReports.id], references: [mudRecords.reportId] }),
}));

export const timeRowRelations = relations(timeBreakdown, ({ one }) => ({
  report: one(dailyReports, { fields: [timeBreakdown.reportId], references: [dailyReports.id] }),
  equipment: one(equipment, { fields: [timeBreakdown.equipmentId], references: [equipment.id] }),
  vendor: one(vendors, { fields: [timeBreakdown.vendorId], references: [vendors.id] }),
}));

export const userRelations = relations(users, ({ one }) => ({
  company: one(companies, { fields: [users.companyId], references: [companies.id] }),
}));

/* ------------------------------------------------------------------ */
/* Tipe inferensi                                                      */
/* ------------------------------------------------------------------ */

export type Company = typeof companies.$inferSelect;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Rig = typeof rigs.$inferSelect;
export type Well = typeof wells.$inferSelect;
export type DailyReport = typeof dailyReports.$inferSelect;
export type NewDailyReport = typeof dailyReports.$inferInsert;
export type TimeBreakdown = typeof timeBreakdown.$inferSelect;
export type NewTimeBreakdown = typeof timeBreakdown.$inferInsert;
export type CrewMember = typeof crewMembers.$inferSelect;
export type CostLine = typeof costLines.$inferSelect;
export type SafetyIncident = typeof safetyIncidents.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
export type SyncDevice = typeof syncDevices.$inferSelect;
export type SyncConflict = typeof syncConflicts.$inferSelect;
export type RateCardRow = typeof rateCards.$inferSelect;
export type DistributionRule = typeof distributionRules.$inferSelect;
export type DeliveryLogRow = typeof deliveryLog.$inferSelect;
