/**
 * Migrasi idempotent - JALAN DI POSTGRES MAUPUN PGLITE.
 *
 * Semua DDL pakai "IF NOT EXISTS" sehingga aman dijalankan berulang
 * (container start, dev server pertama kali, atau CI).
 *
 * Jalankan: npm run db:migrate --workspace=@rigdaily/database
 */
import { db, closeDb, isPglite } from './client';
import { sql } from 'drizzle-orm';

const STATEMENTS: string[] = [
  `CREATE EXTENSION IF NOT EXISTS "pgcrypto"`,

  /* ---------------- organisasi & auth ---------------- */
  `CREATE TABLE IF NOT EXISTS companies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(200) NOT NULL,
    type varchar(40) NOT NULL DEFAULT 'operator',
    origin_device_id varchar(80),
    revision integer NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid REFERENCES companies(id),
    email varchar(200) NOT NULL,
    name varchar(200) NOT NULL,
    password_hash text NOT NULL,
    role varchar(40) NOT NULL,
    rig_scope jsonb NOT NULL DEFAULT '[]'::jsonb,
    mfa_enabled boolean NOT NULL DEFAULT false,
    mfa_secret text,
    active boolean NOT NULL DEFAULT true,
    last_login_at timestamptz,
    origin_device_id varchar(80),
    revision integer NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (email)`,
  `CREATE INDEX IF NOT EXISTS users_role_idx ON users (role)`,

  `CREATE TABLE IF NOT EXISTS sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash varchar(128) NOT NULL,
    user_agent varchar(300),
    ip varchar(60),
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_uq ON sessions (token_hash)`,
  `CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id)`,

  /* ---------------- master ---------------- */
  `CREATE TABLE IF NOT EXISTS fields (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid REFERENCES companies(id),
    name varchar(160) NOT NULL,
    county varchar(120),
    state varchar(120),
    country varchar(120) DEFAULT 'Indonesia',
    location varchar(200),
    origin_device_id varchar(80),
    revision integer NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS rigs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(160) NOT NULL,
    code varchar(60),
    type varchar(40) NOT NULL DEFAULT 'land',
    contractor varchar(200),
    contract_ref varchar(120),
    origin_device_id varchar(80),
    revision integer NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS wells (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    field_id uuid REFERENCES fields(id),
    name varchar(160) NOT NULL,
    api_no varchar(60),
    type varchar(40) NOT NULL DEFAULT 'oil',
    phase varchar(40) NOT NULL DEFAULT 'drilling',
    spud_date date,
    td_planned_m numeric(10,2),
    lat numeric(10,6),
    lon numeric(10,6),
    afe_budget_usd numeric(14,2),
    operator varchar(200),
    origin_device_id varchar(80),
    revision integer NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS wells_name_idx ON wells (name)`,
  `CREATE INDEX IF NOT EXISTS wells_phase_idx ON wells (phase)`,

  `CREATE TABLE IF NOT EXISTS equipment (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rig_id uuid REFERENCES rigs(id),
    name varchar(200) NOT NULL,
    "group" varchar(120),
    system varchar(120),
    vendor varchar(200),
    part_no varchar(120),
    origin_device_id varchar(80),
    revision integer NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS vendors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(200) NOT NULL,
    service varchar(160),
    contact varchar(200),
    origin_device_id varchar(80),
    revision integer NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS iadc_codes (
    code varchar(4) PRIMARY KEY,
    num integer NOT NULL,
    name varchar(200) NOT NULL,
    category varchar(40) NOT NULL,
    productive boolean NOT NULL,
    npt_default boolean NOT NULL DEFAULT false,
    sub_code_required boolean NOT NULL DEFAULT false,
    active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,
    origin_device_id varchar(80),
    revision integer NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  /* ---------------- daily report ---------------- */
  `CREATE TABLE IF NOT EXISTS daily_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    well_id uuid NOT NULL REFERENCES wells(id),
    rig_id uuid REFERENCES rigs(id),
    report_date date NOT NULL,
    report_no integer NOT NULL,
    period_from varchar(5) NOT NULL DEFAULT '06:00',
    period_to varchar(5) NOT NULL DEFAULT '06:00',
    depth_md_start numeric(10,2) NOT NULL,
    depth_md_end numeric(10,2) NOT NULL,
    depth_tvd numeric(10,2),
    progress_24h numeric(10,2),
    summary text,
    plan_next text,
    geology_notes text,
    equipment_status jsonb,
    total_minutes integer NOT NULL DEFAULT 0,
    productive_minutes integer NOT NULL DEFAULT 0,
    npt_minutes integer NOT NULL DEFAULT 0,
    wow_minutes integer NOT NULL DEFAULT 0,
    cost_daily_usd numeric(14,2) NOT NULL DEFAULT 0,
    cost_cumulative_usd numeric(14,2) NOT NULL DEFAULT 0,
    status varchar(20) NOT NULL DEFAULT 'draft',
    parent_report_id uuid,
    amendment_reason text,
    locked_at timestamptz,
    created_by uuid REFERENCES users(id),
    submitted_by uuid REFERENCES users(id),
    submitted_at timestamptz,
    approved_by uuid REFERENCES users(id),
    approved_at timestamptz,
    signed_at timestamptz,
    signature_name varchar(200),
    distributed_at timestamptz,
    origin_device_id varchar(80),
    revision integer NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS daily_reports_well_date_uq ON daily_reports (well_id, report_date, revision)`,
  `CREATE INDEX IF NOT EXISTS daily_reports_date_idx ON daily_reports (report_date)`,
  `CREATE INDEX IF NOT EXISTS daily_reports_status_idx ON daily_reports (status)`,
  `CREATE INDEX IF NOT EXISTS daily_reports_well_idx ON daily_reports (well_id)`,

  `CREATE TABLE IF NOT EXISTS time_breakdown (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id uuid NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
    sort_order integer NOT NULL DEFAULT 0,
    start_hm varchar(5) NOT NULL,
    end_hm varchar(5) NOT NULL,
    duration_min integer NOT NULL,
    iadc_code varchar(4) NOT NULL,
    iadc_subcode varchar(160),
    equipment_id uuid REFERENCES equipment(id),
    vendor_id uuid REFERENCES vendors(id),
    npt_flag boolean NOT NULL DEFAULT false,
    time_class varchar(6) NOT NULL DEFAULT 'PRD',
    remarks text,
    origin_device_id varchar(80),
    revision integer NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS time_breakdown_report_idx ON time_breakdown (report_id)`,
  `CREATE INDEX IF NOT EXISTS time_breakdown_code_idx ON time_breakdown (iadc_code)`,

  `CREATE TABLE IF NOT EXISTS crew_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id uuid NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
    name varchar(160) NOT NULL,
    position varchar(120) NOT NULL DEFAULT 'Crew',
    company varchar(160),
    shift varchar(10) NOT NULL DEFAULT 'Day',
    hours numeric(5,2) NOT NULL DEFAULT 12,
    pob_status varchar(10) NOT NULL DEFAULT 'in',
    muster_station varchar(80),
    origin_device_id varchar(80),
    revision integer NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS crew_report_idx ON crew_members (report_id)`,

  `CREATE TABLE IF NOT EXISTS mud_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id uuid NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
    weight_ppg numeric(6,2),
    viscosity_sec_qt numeric(8,2),
    ph numeric(5,2),
    pv numeric(8,2),
    yp numeric(8,2),
    chemicals_added text,
    cost_usd numeric(14,2),
    origin_device_id varchar(80),
    revision integer NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS mud_report_uq ON mud_records (report_id)`,

  `CREATE TABLE IF NOT EXISTS bha_components (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id uuid NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
    sort_order integer NOT NULL DEFAULT 0,
    component varchar(160) NOT NULL,
    od_in numeric(6,2),
    length_m numeric(8,2),
    hours numeric(5,2),
    origin_device_id varchar(80),
    revision integer NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS bha_report_idx ON bha_components (report_id)`,

  `CREATE TABLE IF NOT EXISTS cost_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id uuid REFERENCES daily_reports(id) ON DELETE CASCADE,
    well_id uuid REFERENCES wells(id),
    category varchar(80) NOT NULL,
    description varchar(500) NOT NULL,
    vendor varchar(200),
    afe_code varchar(60),
    billing_type varchar(60),
    amount_usd numeric(14,2) NOT NULL,
    rebillable boolean NOT NULL DEFAULT false,
    origin_device_id varchar(80),
    revision integer NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS cost_lines_report_idx ON cost_lines (report_id)`,
  `CREATE INDEX IF NOT EXISTS cost_lines_category_idx ON cost_lines (category)`,

  `CREATE TABLE IF NOT EXISTS safety_incidents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id uuid REFERENCES daily_reports(id) ON DELETE CASCADE,
    ref_no varchar(60),
    type varchar(80) NOT NULL,
    severity varchar(20) NOT NULL,
    occurred_at timestamptz,
    location varchar(160),
    description text NOT NULL,
    immediate_action text,
    corrective_action text,
    assignee varchar(160),
    due_date date,
    status varchar(20) NOT NULL DEFAULT 'open',
    origin_device_id varchar(80),
    revision integer NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS safety_severity_idx ON safety_incidents (severity)`,

  `CREATE TABLE IF NOT EXISTS marine_daily (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id uuid NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
    variant varchar(30) NOT NULL,
    fields_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    origin_device_id varchar(80),
    revision integer NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS marine_report_uq ON marine_daily (report_id)`,

  `CREATE TABLE IF NOT EXISTS mac_activities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id uuid NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
    activity_center varchar(60) NOT NULL,
    operation varchar(200) NOT NULL,
    hours numeric(5,2) NOT NULL,
    billable boolean NOT NULL DEFAULT true,
    origin_device_id varchar(80),
    revision integer NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS mac_report_idx ON mac_activities (report_id)`,

  `CREATE TABLE IF NOT EXISTS survey_stations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id uuid NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
    md numeric(10,2) NOT NULL,
    inclination numeric(6,2),
    azimuth numeric(6,2),
    tvd numeric(10,2),
    origin_device_id varchar(80),
    revision integer NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS survey_report_idx ON survey_stations (report_id)`,

  /* ---------------- billing ---------------- */
  `CREATE TABLE IF NOT EXISTS rate_cards (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rig_id uuid REFERENCES rigs(id),
    activity_code varchar(4) NOT NULL,
    label varchar(120),
    tiers jsonb NOT NULL,
    effective_date date,
    active boolean NOT NULL DEFAULT true,
    origin_device_id varchar(80),
    revision integer NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS rate_cards_rig_code_idx ON rate_cards (rig_id, activity_code)`,

  `CREATE TABLE IF NOT EXISTS billing_flags (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id uuid NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
    time_row_id uuid REFERENCES time_breakdown(id) ON DELETE CASCADE,
    force_majeure boolean NOT NULL DEFAULT false,
    disputed boolean NOT NULL DEFAULT false,
    rebillable boolean NOT NULL DEFAULT false,
    note text,
    origin_device_id varchar(80),
    revision integer NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS billing_flags_report_idx ON billing_flags (report_id)`,

  /* ---------------- distribusi ---------------- */
  `CREATE TABLE IF NOT EXISTS distribution_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(160) NOT NULL,
    report_type varchar(60) NOT NULL DEFAULT 'ddr',
    recipient_group jsonb NOT NULL DEFAULT '[]'::jsonb,
    schedule_cron varchar(60) NOT NULL DEFAULT '0 7 * * *',
    template_id varchar(60) NOT NULL DEFAULT 'ddr-default',
    active boolean NOT NULL DEFAULT true,
    last_run_at timestamptz,
    origin_device_id varchar(80),
    revision integer NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS delivery_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id uuid REFERENCES distribution_rules(id) ON DELETE SET NULL,
    report_id uuid REFERENCES daily_reports(id) ON DELETE CASCADE,
    to_addresses jsonb NOT NULL DEFAULT '[]'::jsonb,
    cc_addresses jsonb NOT NULL DEFAULT '[]'::jsonb,
    subject varchar(300),
    status varchar(20) NOT NULL DEFAULT 'queued',
    attempts integer NOT NULL DEFAULT 0,
    last_error text,
    sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS delivery_status_idx ON delivery_log (status)`,
  `CREATE INDEX IF NOT EXISTS delivery_report_idx ON delivery_log (report_id)`,

  /* ---------------- sync ---------------- */
  `CREATE TABLE IF NOT EXISTS sync_devices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id varchar(80) NOT NULL,
    name varchar(160) NOT NULL,
    rig_id uuid REFERENCES rigs(id),
    kind varchar(30) NOT NULL DEFAULT 'electron',
    api_key_hash varchar(128),
    last_seen_at timestamptz,
    last_pulled_at timestamptz,
    pending_count integer NOT NULL DEFAULT 0,
    active boolean NOT NULL DEFAULT true,
    origin_device_id varchar(80),
    revision integer NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS sync_devices_device_uq ON sync_devices (device_id)`,

  `CREATE TABLE IF NOT EXISTS sync_conflicts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id varchar(80) NOT NULL,
    entity varchar(40) NOT NULL,
    entity_server_id uuid,
    entity_local_id uuid,
    client_mutation_id uuid NOT NULL,
    rig_payload jsonb NOT NULL,
    server_payload jsonb NOT NULL,
    reason text NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'open',
    resolved_by uuid REFERENCES users(id),
    resolved_at timestamptz,
    resolution varchar(20),
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS sync_conflicts_status_idx ON sync_conflicts (status)`,

  `CREATE TABLE IF NOT EXISTS sync_mutation_log (
    client_mutation_id uuid PRIMARY KEY,
    device_id varchar(80) NOT NULL,
    entity varchar(40) NOT NULL,
    entity_server_id uuid,
    result varchar(20) NOT NULL,
    processed_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS sync_mutation_device_idx ON sync_mutation_log (device_id)`,

  /* ---------------- audit & kpi ---------------- */
  `CREATE TABLE IF NOT EXISTS audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entity varchar(60) NOT NULL,
    entity_id varchar(80),
    actor_id uuid REFERENCES users(id),
    actor_name varchar(200),
    action varchar(60) NOT NULL,
    old_json jsonb,
    new_json jsonb,
    ip varchar(60),
    terminal varchar(120),
    at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_log (entity, entity_id)`,
  `CREATE INDEX IF NOT EXISTS audit_at_idx ON audit_log (at)`,

  `CREATE TABLE IF NOT EXISTS kpi_definitions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(160) NOT NULL,
    formula text NOT NULL,
    category varchar(80),
    baseline numeric(14,4),
    unit varchar(30),
    active boolean NOT NULL DEFAULT true,
    origin_device_id varchar(80),
    revision integer NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS import_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source varchar(120) NOT NULL,
    file_name varchar(300),
    row_count integer NOT NULL DEFAULT 0,
    error_count integer NOT NULL DEFAULT 0,
    errors jsonb NOT NULL DEFAULT '[]'::jsonb,
    status varchar(20) NOT NULL DEFAULT 'processing',
    created_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
];

/**
 * Jalankan semua DDL. Idempotent.
 * Catatan: materialized view dibuat terpisah karena PGlite mendukung REFRESH
 * tapi belum tentu mendukung CREATE MATERIALIZED VIEW di semua versi - jadi
 * dashboard memakai query agregasi langsung (tetap cepat dengan index di atas).
 */
export async function migrate(): Promise<void> {
  for (const stmt of STATEMENTS) {
    try {
      await db.execute(sql.raw(stmt));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // pgcrypto tidak tersedia di PGlite (gen_random_uuid sudah built-in di PG13+)
      if (msg.includes('pgcrypto') || msg.includes('extension')) continue;
      throw new Error(`[migrate] gagal pada statement:\n${stmt.slice(0, 160)}...\n${msg}`);
    }
  }
  console.log(`[migrate] OK - ${STATEMENTS.length} statement (driver: ${isPglite ? 'PGlite' : 'PostgreSQL'}).`);
}

/** Cek apakah schema sudah ada; kalau belum, jalankan migrasi. */
export async function ensureMigrated(): Promise<void> {
  try {
    const res = await db.execute(sql`SELECT to_regclass('public.daily_reports') AS t`);
    const rows = (res as unknown as { rows: Array<{ t: string | null }> }).rows ?? [];
    if (!rows[0]?.t) {
      console.log('[migrate] schema belum ada - migrasi otomatis...');
      await migrate();
    }
  } catch {
    await migrate();
  }
}

if (require.main === module) {
  migrate()
    .then(async () => {
      await closeDb();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[migrate] GAGAL:', err);
      await closeDb().catch(() => undefined);
      process.exit(1);
    });
}
