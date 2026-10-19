-- Migrasi: kolom WELL ID (well_code) + DIVISION, dan tabel bits,
-- casing_designs, cement_programs. Idempotent (aman dijalankan berulang).

-- ---------- kolom baru pada wells ----------
ALTER TABLE wells ADD COLUMN IF NOT EXISTS well_code varchar(60);
ALTER TABLE wells ADD COLUMN IF NOT EXISTS division varchar(120);

CREATE INDEX IF NOT EXISTS wells_code_idx ON wells (well_code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS wells_division_idx ON wells (division) WHERE deleted_at IS NULL;

-- ---------- bits (matabor) ----------
CREATE TABLE IF NOT EXISTS bits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  well_id uuid NOT NULL REFERENCES wells(id),
  report_id uuid REFERENCES daily_reports(id) ON DELETE SET NULL,
  bit_no integer NOT NULL DEFAULT 1,
  bit_type varchar(40) NOT NULL DEFAULT 'PDC',
  iadc_bit_code varchar(12),
  size_in numeric(6,3),
  manufacturer varchar(160),
  model varchar(160),
  serial_no varchar(120),
  nozzle_count integer,
  tfa_in2 numeric(6,3),
  depth_in_md numeric(10,2),
  depth_out_md numeric(10,2),
  rotating_hours numeric(8,2),
  footage_m numeric(10,2),
  dull_grade varchar(40),
  status varchar(20) NOT NULL DEFAULT 'active',
  notes text,
  origin_device_id varchar(80),
  revision integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bits_well_idx ON bits (well_id);
CREATE INDEX IF NOT EXISTS bits_status_idx ON bits (status);

-- ---------- casing_designs ----------
CREATE TABLE IF NOT EXISTS casing_designs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  well_id uuid NOT NULL REFERENCES wells(id),
  section varchar(40) NOT NULL,
  sort_order integer NOT NULL DEFAULT 1,
  size_in numeric(6,3) NOT NULL,
  weight_ppf numeric(8,2),
  grade varchar(40),
  connection varchar(60),
  shoe_md numeric(10,2),
  top_md numeric(10,2),
  hole_size_in numeric(6,3),
  joints integer,
  cement_required boolean NOT NULL DEFAULT true,
  notes text,
  origin_device_id varchar(80),
  revision integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS casing_well_idx ON casing_designs (well_id);

-- ---------- cement_programs ----------
CREATE TABLE IF NOT EXISTS cement_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  well_id uuid NOT NULL REFERENCES wells(id),
  casing_design_id uuid REFERENCES casing_designs(id) ON DELETE SET NULL,
  section varchar(40) NOT NULL,
  job_type varchar(40) NOT NULL DEFAULT 'primary',
  planned_date date,
  executed_date date,
  slurry_type varchar(40),
  slurry_density_ppg numeric(6,3),
  yield_ft3_sx numeric(8,3),
  volume_bbl numeric(10,2),
  sacks_sx integer,
  mix_water_bbl numeric(10,2),
  additive text,
  plug_bumped_psi numeric(10,2),
  top_of_cement_md numeric(10,2),
  evaluation varchar(20) DEFAULT 'unknown',
  status varchar(20) NOT NULL DEFAULT 'planned',
  notes text,
  origin_device_id varchar(80),
  revision integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cement_well_idx ON cement_programs (well_id);

SELECT 'migrasi well_code/division/bits/casing/cement OK' AS status;
