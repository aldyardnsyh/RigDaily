-- Indeks tambahan untuk mempercepat query yang paling sering dipakai.
--
-- Latar belakang: dashboard, daftar laporan, billing, dan personnel masing-masing
-- memfilter berdasarkan sumur + tanggal + status. Tanpa indeks komposit,
-- PostgreSQL harus memindai seluruh tabel sehingga latensi naik seiring
-- bertambahnya laporan.
--
-- Semua perintah idempotent (IF NOT EXISTS) sehingga aman dijalankan berulang.

-- ---------- daily_reports ----------
-- Dashboard & daftar: filter well + urut tanggal terbaru.
CREATE INDEX IF NOT EXISTS dr_well_date_desc_idx
  ON daily_reports (well_id, report_date DESC)
  WHERE deleted_at IS NULL;

-- Daftar lintas sumur: urut tanggal terbaru (dipakai `?limit=1` setiap halaman).
CREATE INDEX IF NOT EXISTS dr_date_desc_idx
  ON daily_reports (report_date DESC)
  WHERE deleted_at IS NULL;

-- Filter status (billing hanya memakai laporan final; reports filter status).
CREATE INDEX IF NOT EXISTS dr_status_date_idx
  ON daily_reports (status, report_date DESC)
  WHERE deleted_at IS NULL;

-- Rig + tanggal (billing bulanan per rig).
CREATE INDEX IF NOT EXISTS dr_rig_date_idx
  ON daily_reports (rig_id, report_date DESC)
  WHERE deleted_at IS NULL;

-- ---------- time_breakdown ----------
-- Billing mengelompokkan jam per laporan + kode IADC.
CREATE INDEX IF NOT EXISTS tb_report_code_idx
  ON time_breakdown (report_id, iadc_code)
  WHERE deleted_at IS NULL;

-- ---------- cost_lines ----------
CREATE INDEX IF NOT EXISTS cl_report_idx
  ON cost_lines (report_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS cl_well_idx
  ON cost_lines (well_id)
  WHERE deleted_at IS NULL;

-- ---------- crew_members ----------
CREATE INDEX IF NOT EXISTS cm_report_idx
  ON crew_members (report_id)
  WHERE deleted_at IS NULL;

-- ---------- audit_log ----------
-- Halaman login membaca aktivitas `entity = 'auth'` terbaru.
CREATE INDEX IF NOT EXISTS al_entity_at_idx
  ON audit_log (entity, at DESC);

-- ---------- sessions ----------
-- Validasi sesi pada setiap request: cari berdasarkan hash token yang belum kedaluwarsa.
CREATE INDEX IF NOT EXISTS sessions_expires_idx
  ON sessions (expires_at);

-- ---------- wells ----------
CREATE INDEX IF NOT EXISTS wells_field_idx
  ON wells (field_id)
  WHERE deleted_at IS NULL;

-- ---------- safety_incidents ----------
CREATE INDEX IF NOT EXISTS si_report_idx
  ON safety_incidents (report_id)
  WHERE deleted_at IS NULL;
