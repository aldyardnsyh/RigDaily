'use client';
/**
 * Marine & MAC - data operasional per-DDR yang selama ini terpisah dari DDR.
 *
 * Section A: Marine Daily (variant jackup / anchored floater / DPP floater).
 *   Form grid tersimpan di `marine_daily.fields_json` (bebas per varian) dan
 *   dikirim lewat `PUT /api/reports/{id}/marine`.
 * Section B: MAC (dual derrick) - aktivitas Main vs Offline.
 *   Tersimpan di `mac_activities` lewat `PUT /api/reports/{id}/mac`.
 *
 * Semua nilai berasal dari API - tidak ada angka hardcode. Form read-only bila
 * DDR bukan `draft` (perubahan setelah submit wajib lewat amendment).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Clock, Compass, Plus, RefreshCw, Save, Ship, Trash2, Waves } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card, KpiCard } from '@rigdaily/ui';
import { formatHours } from '@rigdaily/shared';
import { Labeled, Note, PillGroup, Toggle, inStyle } from '@/components/controls';
import { StatusBadge } from '@/components/StatusBadge';
import { apiSend } from '@/lib/api-client';
import { useApi } from '@/lib/hooks/useApi';
import { useActiveWell } from '@/lib/hooks/useActiveWell';
import type { MarineDto, ReportDetail, ReportListItem, RigDto, WellDto } from '@/lib/repo/types';

type ReportsList = { items: ReportListItem[]; total: number };
type MacRow = { activityCenter: string; operation: string; hours: number; billable: boolean };
/** Baris server (punya id) vs baris form (punya key lokal untuk React). */
type MacItem = MacRow & { id: string };
type MacPayload = { reportId: string; items: MacItem[] };
type MacDraft = MacRow & { key: string };

type MePayload = { permissions: string[] };

type Variant = 'jackup' | 'anchored_floater' | 'dpp_floater';
type ThrusterState = 'ok' | 'degraded';
type ThrusterKey = 't1' | 't2' | 't3' | 't4' | 't5' | 't6';

const VARIANTS: Array<{ id: Variant; label: string }> = [
  { id: 'jackup', label: 'Jackup' },
  { id: 'anchored_floater', label: 'Anchored Floater' },
  { id: 'dpp_floater', label: 'DPP Floater' },
];

/** Enam thruster azimuth (label mengikuti konvensi DP vessel). */
const THRUSTERS: Array<{ key: ThrusterKey; label: string }> = [
  { key: 't1', label: 'T1 Bow Fwd Stbd' },
  { key: 't2', label: 'T2 Bow Fwd Port' },
  { key: 't3', label: 'T3 Midship Stbd' },
  { key: 't4', label: 'T4 Midship Port' },
  { key: 't5', label: 'T5 Aft Stbd' },
  { key: 't6', label: 'T6 Aft Port' },
];

const ACTIVITY_CENTERS = ['Main', 'Offline'];

/** Field numeric marine yang disimpan di `fields_json`. */
const MARINE_NUMERIC_FIELDS = [
  { key: 'draftForeM', label: 'Draft Depan (m)' },
  { key: 'draftAftM', label: 'Draft Belakang (m)' },
  { key: 'ballastT', label: 'Ballast (t)' },
  { key: 'windKn', label: 'Angin (kn)' },
  { key: 'waveHsM', label: 'Tinggi Gelombang Hs (m)' },
  { key: 'currentKn', label: 'Arus (kn)' },
  { key: 'fuelRobT', label: 'Sisa Bahan Bakar ROB (t)' },
  { key: 'waterRobT', label: 'Sisa Air ROB (t)' },
] as const;

type MarineNumericKey = (typeof MARINE_NUMERIC_FIELDS)[number]['key'];

type MarineForm = {
  variant: Variant;
  numeric: Record<MarineNumericKey, string>;
  windDir: string;
  currentDir: string;
  thrusters: Record<ThrusterKey, ThrusterState>;
};

/** Field baru (tidak ada data) → kosong, bukan angka karangan. */
function emptyForm(variant: Variant): MarineForm {
  return {
    variant,
    numeric: {
      draftForeM: '',
      draftAftM: '',
      ballastT: '',
      windKn: '',
      waveHsM: '',
      currentKn: '',
      fuelRobT: '',
      waterRobT: '',
    },
    windDir: '',
    currentDir: '',
    thrusters: { t1: 'ok', t2: 'ok', t3: 'ok', t4: 'ok', t5: 'ok', t6: 'ok' },
  };
}

function isVariant(value: unknown): value is Variant {
  return value === 'jackup' || value === 'anchored_floater' || value === 'dpp_floater';
}

function asNumberText(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  return '';
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isThrusterState(value: unknown): value is ThrusterState {
  return value === 'ok' || value === 'degraded';
}

/** Default varian dari tipe rig DDR (rig jackup → jackup, dst.). */
function variantFromRigType(rigType: string | null | undefined): Variant {
  return isVariant(rigType) ? rigType : 'dpp_floater';
}

/** `fields_json` → state form (nilai hilang dibiarkan kosong). */
function formFromMarine(marine: MarineDto | null, fallbackVariant: Variant): MarineForm {
  if (!marine) return emptyForm(fallbackVariant);

  const fields = marine.fields;
  const thrustersRaw = fields.thrusters;
  const thrusters = { ...emptyForm(fallbackVariant).thrusters };
  if (typeof thrustersRaw === 'object' && thrustersRaw !== null && !Array.isArray(thrustersRaw)) {
    const rec = thrustersRaw as Record<string, unknown>;
    for (const t of THRUSTERS) {
      const v = rec[t.key];
      if (isThrusterState(v)) thrusters[t.key] = v;
    }
  }

  return {
    variant: isVariant(marine.variant) ? marine.variant : fallbackVariant,
    numeric: {
      draftForeM: asNumberText(fields.draftForeM),
      draftAftM: asNumberText(fields.draftAftM),
      ballastT: asNumberText(fields.ballastT),
      windKn: asNumberText(fields.windKn),
      waveHsM: asNumberText(fields.waveHsM),
      currentKn: asNumberText(fields.currentKn),
      fuelRobT: asNumberText(fields.fuelRobT),
      waterRobT: asNumberText(fields.waterRobT),
    },
    windDir: asText(fields.windDir),
    currentDir: asText(fields.currentDir),
    thrusters,
  };
}

/** State form → payload `fields`. String kosong disimpan sebagai null. */
function fieldsFromForm(form: MarineForm): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of MARINE_NUMERIC_FIELDS) {
    const raw = form.numeric[field.key].trim();
    if (raw === '') {
      out[field.key] = null;
      continue;
    }
    const n = Number(raw.replace(',', '.'));
    out[field.key] = Number.isFinite(n) ? n : null;
  }
  out.windDir = form.windDir.trim() === '' ? null : form.windDir.trim();
  out.currentDir = form.currentDir.trim() === '' ? null : form.currentDir.trim();
  out.thrusters = { ...form.thrusters };
  return out;
}

function numText(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  return '-';
}

export default function MarineMacPage() {
  /* ---------- sumber data: well → DDR terbaru → detail ---------- */
  const activeWell = useActiveWell();
  const wells = activeWell.wells;
  const wellId = activeWell.wellId;

  const reportsList = useApi<ReportsList>(wellId ? `/api/reports?wellId=${wellId}&limit=1` : null);
  const latest = reportsList.data?.items?.[0] ?? null;
  const reportId = latest?.id ?? null;

  const detail = useApi<ReportDetail>(reportId ? `/api/reports/${reportId}` : null);
  const marine = useApi<MarineDto | null>(reportId ? `/api/reports/${reportId}/marine` : null);
  const mac = useApi<MacPayload>(reportId ? `/api/reports/${reportId}/mac` : null);
  const rigs = useApi<RigDto[]>('/api/rigs');
  const me = useApi<MePayload>('/api/auth/me');

  const report = detail.data;
  const isDraft = report?.status === 'draft';
  const canMarineEdit = me.data?.permissions.includes('marine:edit') ?? false;
  const canReportEdit = me.data?.permissions.includes('report:edit-draft') ?? false;

  const rigType = useMemo(() => {
    if (!report?.rigId) return null;
    return rigs.data?.find((r) => r.id === report.rigId)?.type ?? null;
  }, [report?.rigId, rigs.data]);

  const defaultVariant = variantFromRigType(rigType);

  /* ---------- Section A: marine form ---------- */
  const [form, setForm] = useState<MarineForm>(() => emptyForm('dpp_floater'));
  const [savingMarine, setSavingMarine] = useState(false);

  const marineSignature = marine.data
    ? `${marine.data.id}:${marine.data.variant}:${JSON.stringify(marine.data.fields)}`
    : `none:${defaultVariant}`;

  useEffect(() => {
    // Sinkronkan form setiap server mengembalikan data baru (termasuk setelah simpan).
    setForm(formFromMarine(marine.data, defaultVariant));
  }, [marineSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Section B: MAC rows ---------- */
  const [macRows, setMacRows] = useState<MacDraft[]>([]);
  const [savingMac, setSavingMac] = useState(false);

  const macSignature = (mac.data?.items ?? []).map((r) => `${r.id}:${r.activityCenter}:${r.operation}:${r.hours}:${r.billable}`).join('|');

  useEffect(() => {
    setMacRows(
      (mac.data?.items ?? []).map((r, i) => ({
        key: r.id ?? `srv-${i}`,
        activityCenter: r.activityCenter,
        operation: r.operation,
        hours: r.hours,
        billable: r.billable,
      })),
    );
  }, [macSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  const reloadAll = useCallback(() => {
    marine.reload();
    mac.reload();
    detail.reload();
  }, [marine.reload, mac.reload, detail.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Simpan marine ---------- */
  async function saveMarine() {
    if (!report) return;
    setSavingMarine(true);
    try {
      await apiSend<MarineDto | null>(`/api/reports/${report.id}/marine`, 'PUT', {
        variant: form.variant,
        fields: fieldsFromForm(form),
      });
      toast.success('Marine daily tersimpan.');
      reloadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan marine daily.');
    } finally {
      setSavingMarine(false);
    }
  }

  /* ---------- Simpan MAC ---------- */
  async function saveMac() {
    if (!report) return;
    const invalid = macRows.find((r) => r.operation.trim() === '' || !Number.isFinite(r.hours));
    if (invalid) {
      toast.error('Setiap baris MAC wajib punya operation dan jam yang valid.');
      return;
    }
    const over = macRows.find((r) => r.hours < 0 || r.hours > 24);
    if (over) {
      toast.error('Jam aktivitas harus di antara 0 dan 24.');
      return;
    }

    setSavingMac(true);
    try {
      await apiSend<MacPayload>(`/api/reports/${report.id}/mac`, 'PUT', {
        items: macRows.map((r) => ({
          activityCenter: r.activityCenter,
          operation: r.operation.trim(),
          hours: r.hours,
          billable: r.billable,
        })),
      });
      toast.success(`Aktivitas MAC tersimpan (${macRows.length} baris).`);
      reloadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan aktivitas MAC.');
    } finally {
      setSavingMac(false);
    }
  }

  function addMacRow(center: string) {
    setMacRows((prev) => [
      ...prev,
      { key: `new-${Date.now()}-${prev.length}`, activityCenter: center, operation: '', hours: 0, billable: true },
    ]);
  }

  function updateMacRow(key: string, patch: Partial<MacRow>) {
    setMacRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeMacRow(key: string) {
    setMacRows((prev) => prev.filter((r) => r.key !== key));
  }

  /* ---------- Derived totals (dari baris form, bukan angka tetap) ---------- */
  const mainRows = macRows.filter((r) => r.activityCenter === 'Main');
  const offlineRows = macRows.filter((r) => r.activityCenter === 'Offline');
  const mainHours = mainRows.reduce((acc, r) => acc + (Number.isFinite(r.hours) ? r.hours : 0), 0);
  const offlineHours = offlineRows.reduce((acc, r) => acc + (Number.isFinite(r.hours) ? r.hours : 0), 0);

  const loading = activeWell.loading || reportsList.loading || detail.loading;
  const loadError = activeWell.error ?? reportsList.error ?? detail.error ?? marine.error ?? mac.error;

  const marineReadOnly = !isDraft || !canMarineEdit;
  const macReadOnly = !isDraft || !canReportEdit;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
        DAILY DRILLING REPORT {report ? `#${report.reportNo}` : ''} &gt; MARINE DAILY &amp; MULTIPLE ACTIVITY CENTER
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 20, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Compass size={20} color="var(--accent-teal)" aria-hidden /> Marine &amp; Dual-Derrick Operations
        </h1>
        {report && <StatusBadge status={report.status} />}
        {report && !isDraft && <Badge kind="Locked">HANYA BACA</Badge>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={reloadAll} aria-label="Muat ulang data marine dan MAC">
            <RefreshCw size={16} aria-hidden /> Refresh
          </Button>
          {reportId && (
            <Link href={`/ddr`} style={{ textDecoration: 'none' }}>
              <Button variant="secondary">Buka DDR</Button>
            </Link>
          )}
        </span>
      </div>

      <p style={{ margin: 0, fontSize: 13 }}>
        {report ? (
          <>
            Sumur {report.wellName}
            {report.rigName ? ` · Rig ${report.rigName}` : ''} · {report.reportDate} · Periode {report.periodFrom}-{report.periodTo}
          </>
        ) : (
          'Memuat laporan...'
        )}
      </p>

      {loadError && (
        <div role="alert" style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 8, padding: 12, color: 'var(--danger-deep)', fontSize: 13 }}>
          {loadError}
        </div>
      )}

      {loading ? (
        <Card>
          <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div aria-hidden style={{ height: 24, width: 220, background: 'var(--bg-surface-2)', borderRadius: 4 }} />
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} aria-hidden style={{ height: 32, background: 'var(--bg-surface-2)', borderRadius: 4 }} />
            ))}
          </div>
        </Card>
      ) : !report ? (
        <Card>
          <Note kind="info">Belum ada DDR pada sumur ini. Data marine dan MAC baru bisa diisi setelah DDR dibuat.</Note>
        </Card>
      ) : (
        <>
          {/* ============ SECTION A - MARINE DAILY ============ */}
          <Card>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 16, margin: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
                <Ship size={16} color="var(--accent-teal)" aria-hidden /> Marine Daily
              </h2>
              <Badge kind="Draft">{VARIANTS.find((v) => v.id === form.variant)?.label ?? form.variant}</Badge>
              {!marine.data && <Badge kind="Submitted">BELUM DIISI</Badge>}
              <span style={{ marginLeft: 'auto' }}>
                <Button onClick={saveMarine} disabled={marineReadOnly || savingMarine}>
                  <Save size={16} aria-hidden /> {savingMarine ? 'Menyimpan...' : 'Simpan Marine'}
                </Button>
              </span>
            </div>

            {!isDraft && <Note kind="info">Laporan berstatus {report.status} - data marine daily hanya bisa diubah lewat amendemen.</Note>}
            {isDraft && !canMarineEdit && <Note kind="warn">Role Anda tidak punya izin <code>marine:edit</code> untuk menyimpan data marine daily.</Note>}

            <div style={{ margin: '10px 0' }}>
              <span className="field-label">Varian platform</span>
              <PillGroup
                ariaLabel="Varian platform marine"
                value={form.variant}
                onChange={(v) => setForm((prev) => ({ ...prev, variant: v }))}
                options={VARIANTS.map((v) => ({ id: v.id, label: v.label.toUpperCase() }))}
              />
            </div>

            <fieldset disabled={marineReadOnly} style={{ border: 0, padding: 0, margin: 0 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
                {MARINE_NUMERIC_FIELDS.map((field) => (
                  <Labeled key={field.key} label={field.label}>
                    <input
                      className="tnum"
                      style={inStyle()}
                      inputMode="decimal"
                      value={form.numeric[field.key]}
                      onChange={(e) => setForm((prev) => ({ ...prev, numeric: { ...prev.numeric, [field.key]: e.target.value } }))}
                      placeholder="-"
                      aria-label={field.label}
                    />
                  </Labeled>
                ))}
                <Labeled label="Wind arah (°)">
                  <input
                    className="tnum"
                    style={inStyle()}
                    value={form.windDir}
                    onChange={(e) => setForm((prev) => ({ ...prev, windDir: e.target.value }))}
                    placeholder="mis. 042 NNE"
                    aria-label="Arah angin"
                  />
                </Labeled>
                <Labeled label="Current arah (°)">
                  <input
                    className="tnum"
                    style={inStyle()}
                    value={form.currentDir}
                    onChange={(e) => setForm((prev) => ({ ...prev, currentDir: e.target.value }))}
                    placeholder="mis. 195 SSW"
                    aria-label="Arah arus"
                  />
                </Labeled>
              </div>

              <div style={{ marginTop: 14 }}>
                <span className="field-label">Status thruster (6 unit)</span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                  {THRUSTERS.map((t) => {
                    const degraded = form.thrusters[t.key] === 'degraded';
                    return (
                      <div
                        key={t.key}
                        style={{
                          display: 'flex',
                          gap: 8,
                          alignItems: 'center',
                          border: `1px solid ${degraded ? 'var(--danger)' : 'var(--border-default)'}`,
                          background: degraded ? 'var(--danger-soft)' : '#fff',
                          borderRadius: 4,
                          padding: '8px 10px',
                        }}
                      >
                        <span style={{ fontSize: 12, fontWeight: 700, flex: 1, minWidth: 0 }}>{t.label}</span>
                        <Toggle
                          checked={degraded}
                          label={`${t.label} terdegradasi`}
                          onChange={(v) =>
                            setForm((prev) => ({ ...prev, thrusters: { ...prev.thrusters, [t.key]: v ? 'degraded' : 'ok' } }))
                          }
                        />
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: degraded ? 'var(--danger)' : 'var(--success)',
                            minWidth: 66,
                            textAlign: 'right',
                          }}
                        >
                          {degraded ? 'TERDEGRADASI' : 'NORMAL'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </fieldset>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginTop: 14, borderTop: '1px solid var(--border-default)', paddingTop: 12 }}>
              <SummaryStat label="Angin" value={`${numText(form.numeric.windKn)} kn`} />
              <SummaryStat label="Gelombang Hs" value={`${numText(form.numeric.waveHsM)} m`} />
              <SummaryStat label="Arus" value={`${numText(form.numeric.currentKn)} kn`} />
              <SummaryStat label="Sisa BBM ROB" value={`${numText(form.numeric.fuelRobT)} t`} />
              <SummaryStat label="Sisa Air ROB" value={`${numText(form.numeric.waterRobT)} t`} />
            </div>
          </Card>

          {/* ============ SECTION B - MAC ============ */}
          <Card>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 16, margin: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
                <Clock size={16} color="var(--accent-teal)" aria-hidden /> Multiple Activity Center (MAC)
              </h2>
              <Badge kind="Draft">{macRows.length} aktivitas</Badge>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button variant="secondary" onClick={() => addMacRow('Main')} disabled={macReadOnly}>
                  <Plus size={16} aria-hidden /> Baris Main
                </Button>
                <Button variant="secondary" onClick={() => addMacRow('Offline')} disabled={macReadOnly}>
                  <Plus size={16} aria-hidden /> Baris Offline
                </Button>
                <Button onClick={saveMac} disabled={macReadOnly || savingMac}>
                  <Save size={16} aria-hidden /> {savingMac ? 'Menyimpan...' : 'Simpan MAC'}
                </Button>
              </span>
            </div>

            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 10px' }}>
              Aktivitas paralel di rotary table (Main) versus aux derrick / offline center. Jam Offline dihitung sebagai
              penghematan waktu terhadap critical path.
            </p>

            {!isDraft && <Note kind="info">Laporan berstatus {report.status} - aktivitas MAC hanya bisa diubah lewat amendemen.</Note>}
            {isDraft && !canReportEdit && <Note kind="warn">Role Anda tidak punya izin <code>report:edit-draft</code> untuk menyimpan MAC.</Note>}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 12 }}>
              <KpiCard
                label="Jalur utama (Main)"
                value={`${formatHours(Math.round(mainHours * 60))} h`}
                sub={`${mainRows.length} aktivitas`}
                icon={<Clock size={18} color="var(--accent-teal)" aria-hidden />}
              />
              <KpiCard
                label="Offline (waktu terhemat)"
                value={`${formatHours(Math.round(offlineHours * 60))} h`}
                valueColor="var(--success)"
                sub={`${offlineRows.length} aktivitas paralel`}
                icon={<CheckCircle2 size={18} color="var(--success)" aria-hidden />}
              />
              <KpiCard
                label="Total tercatat"
                value={`${formatHours(Math.round((mainHours + offlineHours) * 60))} jam`}
                sub="Main + Offline"
                icon={<Waves size={18} color="var(--info)" aria-hidden />}
              />
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', fontSize: 12, color: 'var(--text-muted)' }}>
                    <th style={{ padding: '6px 8px' }}>Pusat Aktivitas</th>
                    <th style={{ padding: '6px 8px' }}>Operasi</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', width: 110 }}>Jam</th>
                    <th style={{ padding: '6px 8px', textAlign: 'center', width: 90 }}>Dapat Ditagih</th>
                    <th style={{ padding: '6px 8px', width: 52 }}>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {macRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: '10px 8px', color: 'var(--text-muted)' }}>
                        Belum ada aktivitas MAC. Tambahkan baris Main atau Offline lewat tombol di atas.
                      </td>
                    </tr>
                  ) : (
                    macRows.map((row) => {
                      const isOffline = row.activityCenter === 'Offline';
                      return (
                        <tr key={row.key} style={{ borderTop: '1px solid var(--border-default)' }}>
                          <td style={{ padding: '6px 8px' }}>
                            <select
                              style={{ ...inStyle(), width: 'auto', minWidth: 110 }}
                              value={row.activityCenter}
                              disabled={macReadOnly}
                              aria-label={`Pusat aktivitas baris ${row.operation || row.key}`}
                              onChange={(e) => updateMacRow(row.key, { activityCenter: e.target.value })}
                            >
                              {ACTIVITY_CENTERS.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <input
                              style={inStyle()}
                              value={row.operation}
                              disabled={macReadOnly}
                              placeholder="mis. Tripping out 8-1/2in"
                              aria-label={`Operasi baris ${row.key}`}
                              onChange={(e) => updateMacRow(row.key, { operation: e.target.value })}
                            />
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                            <input
                              className="tnum"
                              style={{ ...inStyle(), textAlign: 'right' }}
                              inputMode="decimal"
                              value={Number.isFinite(row.hours) ? String(row.hours) : ''}
                              disabled={macReadOnly}
                              aria-label={`Jam baris ${row.operation || row.key}`}
                              onChange={(e) => {
                                const n = Number(e.target.value.replace(',', '.'));
                                updateMacRow(row.key, { hours: Number.isFinite(n) ? n : Number.NaN });
                              }}
                            />
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={row.billable}
                              disabled={macReadOnly}
                              aria-label={`Dapat ditagih baris ${row.operation || row.key}`}
                              onChange={(e) => updateMacRow(row.key, { billable: e.target.checked })}
                            />
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <button
                              type="button"
                              aria-label={`Hapus baris ${row.operation || row.key}`}
                              disabled={macReadOnly}
                              onClick={() => removeMacRow(row.key)}
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: macReadOnly ? 'not-allowed' : 'pointer',
                                color: 'var(--danger)',
                                padding: 4,
                              }}
                            >
                              <Trash2 size={16} aria-hidden />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div
              style={{
                display: 'flex',
                gap: 12,
                flexWrap: 'wrap',
                alignItems: 'center',
                background: 'var(--bg-surface-2)',
                borderRadius: 4,
                padding: 12,
                marginTop: 10,
              }}
            >
              <p className="tnum" style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>
                MAIN {formatHours(Math.round(mainHours * 60))} jam · OFFLINE {formatHours(Math.round(offlineHours * 60))} jam
              </p>
              <Badge kind="Distributed">
                <CheckCircle2 size={12} aria-hidden /> WAKTU TERHEMAT {formatHours(Math.round(offlineHours * 60))} jam
              </Badge>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="field-label" style={{ marginBottom: 2 }}>
        {label}
      </div>
      <div className="tnum" style={{ fontWeight: 800 }}>
        {value}
      </div>
    </div>
  );
}
