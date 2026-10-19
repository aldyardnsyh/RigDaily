'use client';
/**
 * Safety & Directional Survey - data per-DDR yang dikelola HSE/Drilling Engineer.
 *
 * Kartu A: register insiden safety (`/api/incidents`, POST + PATCH status).
 * Kartu B: stasiun directional survey (`/api/reports/{id}/survey`, PUT).
 * Kartu C: pratinjau PDF (DDR & IADC) + ringkasan isi dokumen dari data DDR
 *          yang sebenarnya, supaya user tahu apa yang akan tercetak.
 *
 * Tidak ada angka hardcode: semua berasal dari API (`/api/reports/{id}`).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  Compass,
  Download,
  FileText,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card, KpiCard } from '@rigdaily/ui';
import { formatHours, formatUsd } from '@rigdaily/shared';
import { Labeled, Modal, Note, ProgressBar, inStyle } from '@/components/controls';
import { StatusBadge } from '@/components/StatusBadge';
import { apiSend, apiUrl } from '@/lib/api-client';
import { useApi } from '@/lib/hooks/useApi';
import { useActiveWell } from '@/lib/hooks/useActiveWell';
import type { ReportDetail, ReportListItem, WellDto } from '@/lib/repo/types';

type ReportsList = { items: ReportListItem[]; total: number };
type MePayload = { permissions: string[] };

type Severity = 'critical' | 'high' | 'medium' | 'low';
type IncidentStatus = 'draft' | 'open' | 'closed';

type IncidentItem = {
  id: string;
  reportId: string | null;
  refNo: string | null;
  type: string;
  severity: string;
  occurredAt: string | null;
  location: string | null;
  description: string;
  immediateAction: string | null;
  correctiveAction: string | null;
  assignee: string | null;
  dueDate: string | null;
  status: string;
};

type SurveyItem = { id: string; md: number; inclination: number | null; azimuth: number | null; tvd: number | null };
type SurveyPayload = { reportId: string; items: SurveyItem[] };
type SurveyDraft = { key: string; md: string; inclination: string; azimuth: string; tvd: string };

const SEVERITIES: Array<{ id: Severity; label: string }> = [
  { id: 'critical', label: 'Critical' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
];

const STATUSES: IncidentStatus[] = ['draft', 'open', 'closed'];

/** Warna severity memakai token: critical/high rose, medium amber, low slate. */
const SEVERITY_STYLE: Record<string, { background: string; color: string }> = {
  critical: { background: 'var(--danger)', color: '#fff' },
  high: { background: 'var(--danger-soft)', color: 'var(--danger-deep)' },
  medium: { background: 'var(--warning-soft)', color: 'var(--warning)' },
  low: { background: 'var(--bg-surface-2)', color: 'var(--text-secondary)' },
};

const STATUS_STYLE: Record<string, { background: string; color: string }> = {
  draft: { background: 'var(--bg-surface-2)', color: 'var(--text-secondary)' },
  open: { background: 'var(--info-soft)', color: 'var(--info)' },
  closed: { background: 'var(--success-soft)', color: 'var(--success)' },
};

function severityStyle(severity: string): React.CSSProperties {
  const s = SEVERITY_STYLE[severity.trim().toLowerCase()] ?? SEVERITY_STYLE.low;
  return { ...s, borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' };
}

function statusStyle(status: string): React.CSSProperties {
  const s = STATUS_STYLE[status.trim().toLowerCase()] ?? STATUS_STYLE.draft;
  return { ...s, borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' };
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * `datetime-local` value dari ISO. Memakai komponen waktu LOKAL browser supaya
 * input jam rig sesuai yang diketik operator.
 */
function toDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function numText(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value) ? '-' : value.toFixed(digits);
}

type IncidentForm = {
  type: string;
  severity: Severity;
  occurredAt: string;
  location: string;
  description: string;
  immediateAction: string;
  correctiveAction: string;
  assignee: string;
  dueDate: string;
};

function emptyIncidentForm(): IncidentForm {
  return {
    type: '',
    severity: 'medium',
    occurredAt: '',
    location: '',
    description: '',
    immediateAction: '',
    correctiveAction: '',
    assignee: '',
    dueDate: '',
  };
}

export default function SafetySurveyPage() {
  /* ---------- laporan terbaru ---------- */
  const activeWell = useActiveWell();
  const wells = activeWell.wells;
  const wellId = activeWell.wellId;

  const reportsList = useApi<ReportsList>(wellId ? `/api/reports?wellId=${wellId}&limit=1` : null);
  const latest = reportsList.data?.items?.[0] ?? null;
  const reportId = latest?.id ?? null;

  const detail = useApi<ReportDetail>(reportId ? `/api/reports/${reportId}` : null);
  const survey = useApi<SurveyPayload>(reportId ? `/api/reports/${reportId}/survey` : null);
  const incidents = useApi<IncidentItem[]>('/api/incidents');
  const me = useApi<MePayload>('/api/auth/me');

  const report = detail.data;
  const isDraft = report?.status === 'draft';
  const canSafetyEdit = me.data?.permissions.includes('safety:edit') ?? false;
  const canReportEdit = me.data?.permissions.includes('report:edit-draft') ?? false;

  /* ---------- Kartu A: insiden ---------- */
  const [scope, setScope] = useState<'all' | 'report'>('all');
  const [reportOpen, setReportOpen] = useState(false);
  const [form, setForm] = useState<IncidentForm>(emptyIncidentForm);
  const [busy, setBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState<string | null>(null);

  const incidentRows = useMemo(() => {
    const list = incidents.data ?? [];
    if (scope === 'report') return reportId ? list.filter((i) => i.reportId === reportId) : [];
    return list;
  }, [incidents.data, scope, reportId]);

  const openCount = useMemo(() => (incidents.data ?? []).filter((i) => i.status !== 'closed').length, [incidents.data]);

  async function submitIncident() {
    if (!form.type.trim()) {
      toast.error('Tipe insiden wajib diisi.');
      return;
    }
    if (!form.description.trim()) {
      toast.error('Deskripsi insiden wajib diisi.');
      return;
    }

    setBusy(true);
    try {
      const created = await apiSend<{ id: string; refNo: string }>('/api/incidents', 'POST', {
        reportId: reportId ?? null,
        type: form.type.trim(),
        severity: form.severity,
        occurredAt: form.occurredAt ? new Date(form.occurredAt).toISOString() : null,
        location: form.location.trim() ? form.location.trim() : null,
        description: form.description.trim(),
        immediateAction: form.immediateAction.trim() ? form.immediateAction.trim() : null,
        correctiveAction: form.correctiveAction.trim() ? form.correctiveAction.trim() : null,
        assignee: form.assignee.trim() ? form.assignee.trim() : null,
        dueDate: form.dueDate.trim() ? form.dueDate.trim() : null,
      });
      toast.success(`Insiden ${created.refNo} tercatat.`);
      setReportOpen(false);
      setForm(emptyIncidentForm());
      incidents.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mencatat insiden. Periksa isian lalu coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  async function patchStatus(id: string, status: IncidentStatus, refNo: string | null) {
    setStatusBusy(id);
    try {
      await apiSend(`/api/incidents/${id}`, 'PATCH', { status });
      toast.success(`Status ${refNo ?? 'insiden'} → ${status.toUpperCase()}.`);
      incidents.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengubah status insiden. Coba lagi.');
    } finally {
      setStatusBusy(null);
    }
  }

  /* ---------- Kartu B: survey ---------- */
  const [surveyRows, setSurveyRows] = useState<SurveyDraft[]>([]);
  const [savingSurvey, setSavingSurvey] = useState(false);

  const surveySignature = (survey.data?.items ?? []).map((s) => `${s.id}:${s.md}:${s.inclination}:${s.azimuth}:${s.tvd}`).join('|');

  useEffect(() => {
    setSurveyRows(
      (survey.data?.items ?? []).map((s, i) => ({
        key: s.id ?? `srv-${i}`,
        md: numText(s.md, 2),
        inclination: s.inclination === null ? '' : numText(s.inclination, 2),
        azimuth: s.azimuth === null ? '' : numText(s.azimuth, 2),
        tvd: s.tvd === null ? '' : numText(s.tvd, 2),
      })),
    );
  }, [surveySignature]); // eslint-disable-line react-hooks/exhaustive-deps

  const surveyReadOnly = !isDraft || !canReportEdit;

  function parseOptionalNumber(raw: string): number | null {
    const value = raw.trim();
    if (value === '') return null;
    const n = Number(value.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  async function saveSurvey() {
    if (!report) return;

    const items: Array<{ md: number; inclination: number | null; azimuth: number | null; tvd: number | null }> = [];
    for (const row of surveyRows) {
      const md = parseOptionalNumber(row.md);
      if (md === null) {
        toast.error('MD setiap stasiun harus diisi berupa angka.');
        return;
      }
      if (md < 0 || md > 15000) {
        toast.error('MD harus di antara 0 dan 15000 m.');
        return;
      }
      items.push({
        md,
        inclination: parseOptionalNumber(row.inclination),
        azimuth: parseOptionalNumber(row.azimuth),
        tvd: parseOptionalNumber(row.tvd),
      });
    }

    setSavingSurvey(true);
    try {
      await apiSend<SurveyPayload>(`/api/reports/${report.id}/survey`, 'PUT', { items });
      toast.success(`Survey tersimpan dengan ${items.length} stasiun.`);
      survey.reload();
      detail.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan survey. Periksa MD dan nilai stasiun lalu coba lagi.');
    } finally {
      setSavingSurvey(false);
    }
  }

  function addSurveyRow() {
    setSurveyRows((prev) => [...prev, { key: `new-${Date.now()}-${prev.length}`, md: '', inclination: '', azimuth: '', tvd: '' }]);
  }

  function updateSurveyRow(key: string, patch: Partial<SurveyDraft>) {
    setSurveyRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeSurveyRow(key: string) {
    setSurveyRows((prev) => prev.filter((r) => r.key !== key));
  }

  /* ---------- ringkasan isi PDF ---------- */
  const totalTimeHours = report ? (report.totalMinutes > 0 ? report.totalMinutes / 60 : 0) : 0;
  const pdfSummary = report
    ? {
        timeRows: report.timeRows.length,
        totalHours: totalTimeHours,
        costDaily: report.costDailyUsd,
        costCumulative: report.costCumulativeUsd,
        crew: report.crew.length,
        incidents: report.incidents.length,
        surveyStations: (survey.data?.items ?? report.survey).length,
        mac: report.mac.length,
      }
    : null;

  const loading = activeWell.loading || reportsList.loading || detail.loading;
  const loadError = activeWell.error ?? reportsList.error ?? detail.error ?? survey.error ?? incidents.error;

  const reloadAll = useCallback(() => {
    detail.reload();
    survey.reload();
    incidents.reload();
  }, [detail.reload, survey.reload, incidents.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
        KEPATUHAN HSE &amp; SURVEY {report ? `· Laporan #${report.reportNo}` : ''}
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 20, display: 'flex', gap: 8, alignItems: 'center' }}>
          <ShieldCheck size={20} color="var(--success)" aria-hidden /> Insiden Keselamatan &amp; Survey Terarah
        </h1>
        {report && <StatusBadge status={report.status} />}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={reloadAll} aria-label="Muat ulang data keselamatan dan survey">
            <RefreshCw size={16} aria-hidden /> Refresh
          </Button>
        </span>
      </div>

      <p style={{ margin: 0, fontSize: 13 }}>
        {report ? (
          <>
            Sumur {report.wellName}
            {report.rigName ? ` · Rig ${report.rigName}` : ''} · {report.reportDate}
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
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
            <KpiCard
              label="Insiden terbuka"
              value={String(openCount)}
              valueColor={openCount > 0 ? 'var(--danger)' : 'var(--success)'}
              sub={`${incidents.data?.length ?? 0} total tercatat`}
              icon={<AlertTriangle size={20} color="var(--danger)" aria-hidden />}
            />
            <KpiCard
              label="Stasiun survey"
              value={String(pdfSummary?.surveyStations ?? 0)}
              sub={report ? `Bit depth ${report.depthMdEnd.toFixed(2)} m MD` : '-'}
              icon={<Compass size={20} color="var(--accent-teal)" aria-hidden />}
            />
            <KpiCard
              label="Jam terlapor"
              value={`${formatHours(report?.totalMinutes ?? 0)} h`}
              sub={report && report.totalMinutes > 0 ? `${(report.totalMinutes / 60).toFixed(2)} jam pada DDR ini` : 'Belum ada time breakdown'}
              icon={<FileText size={20} color="var(--info)" aria-hidden />}
            />
            <KpiCard
              label="Total biaya harian"
              value={report ? formatUsd(report.costDailyUsd) : '-'}
              sub={report ? `Kumulatif ${formatUsd(report.costCumulativeUsd)}` : '-'}
              icon={<FileText size={20} color="var(--text-secondary)" aria-hidden />}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 16, alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* ============ KARTU A - SAFETY INCIDENTS ============ */}
              <Card>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <h2 style={{ fontSize: 16, margin: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
                    <AlertOctagon size={16} color="var(--danger)" aria-hidden /> Insiden Keselamatan
                  </h2>
                  <Badge kind="Draft">{incidentRows.length} baris</Badge>
                  <span style={{ marginLeft: 'auto' }}>
                    <Button onClick={() => setReportOpen(true)} disabled={!canSafetyEdit}>
                      <Plus size={16} aria-hidden /> Catat Insiden
                    </Button>
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0' }} role="group" aria-label="Filter insiden">
                  {([
                    { id: 'all' as const, label: 'Semua insiden' },
                    { id: 'report' as const, label: report ? `Laporan ini (#${report.reportNo})` : 'Laporan ini' },
                  ]).map((opt) => {
                    const active = scope === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setScope(opt.id)}
                        className="pill"
                        style={{
                          background: active ? 'var(--bg-sidebar)' : '#fff',
                          color: active ? '#fff' : 'var(--text-primary)',
                          borderColor: active ? 'var(--bg-sidebar)' : 'var(--border-default)',
                        }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>

                {!canSafetyEdit && <Note kind="warn">Role Anda tidak punya izin <code>safety:edit</code> untuk mencatat atau mengubah insiden.</Note>}
                {incidents.error && <Note kind="error">{incidents.error}</Note>}

                {incidents.loading ? (
                  <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} aria-hidden style={{ height: 48, background: 'var(--bg-surface-2)', borderRadius: 4 }} />
                    ))}
                  </div>
                ) : incidentRows.length === 0 ? (
                  <Note kind="info">
                    {scope === 'report'
                      ? 'Belum ada insiden tertaut ke laporan ini. Gunakan tombol Catat Insiden untuk menambahkan.'
                      : 'Belum ada insiden tercatat. Gunakan tombol Catat Insiden untuk mencatat kejadian baru.'}
                  </Note>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {incidentRows.map((inc) => (
                      <li key={inc.id} style={{ border: '1px solid var(--border-default)', borderRadius: 6, padding: 12 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <strong className="tnum">{inc.refNo ?? 'IR (tanpa nomor)'}</strong>
                          <span style={severityStyle(inc.severity)}>{inc.severity}</span>
                          <span style={statusStyle(inc.status)}>{inc.status}</span>
                          <span className="tnum" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-secondary)' }}>
                            {fmtDateTime(inc.occurredAt)}
                          </span>
                        </div>
                        <p style={{ margin: '6px 0 0', fontSize: 13, fontWeight: 600 }}>{inc.type}</p>
                        {inc.location && (
                          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>Lokasi: {inc.location}</p>
                        )}
                        <p style={{ margin: '6px 0 0', fontSize: 13 }}>{inc.description}</p>
                        {inc.immediateAction && (
                          <p style={{ margin: '6px 0 0', fontSize: 12 }}>
                            <strong>Tindakan segera:</strong> {inc.immediateAction}
                          </p>
                        )}
                        {inc.correctiveAction && (
                          <p style={{ margin: '4px 0 0', fontSize: 12 }}>
                            <strong>Tindakan korektif:</strong> {inc.correctiveAction}
                          </p>
                        )}
                        <p className="tnum" style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-secondary)' }}>
                          Penanggung jawab: {inc.assignee ?? '-'} · Tenggat: {inc.dueDate ?? '-'}
                        </p>

                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }} role="group" aria-label={`Ubah status ${inc.refNo ?? inc.id}`}>
                          {STATUSES.filter((s) => s !== inc.status).map((s) => (
                            <button
                              key={s}
                              type="button"
                              className="pill"
                              disabled={!canSafetyEdit || statusBusy === inc.id}
                              onClick={() => patchStatus(inc.id, s, inc.refNo)}
                            >
                              {statusBusy === inc.id ? 'Menyimpan...' : `Tandai ${s}`}
                            </button>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              {/* ============ KARTU B - DIRECTIONAL SURVEY ============ */}
              <Card>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <h2 style={{ fontSize: 16, margin: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
                    <Compass size={16} color="var(--accent-teal)" aria-hidden /> Survey Terarah
                  </h2>
                  <Badge kind="Draft">{surveyRows.length} stasiun</Badge>
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Button variant="secondary" onClick={addSurveyRow} disabled={surveyReadOnly}>
                      <Plus size={16} aria-hidden /> Tambah stasiun
                    </Button>
                    <Button onClick={saveSurvey} disabled={surveyReadOnly || savingSurvey || !report}>
                      <Save size={16} aria-hidden /> {savingSurvey ? 'Menyimpan...' : 'Simpan'}
                    </Button>
                  </span>
                </div>

                {report && !isDraft && (
                  <Note kind="info">Laporan berstatus {report.status} - data survey hanya bisa diubah lewat amendemen.</Note>
                )}
                {isDraft && !canReportEdit && <Note kind="warn">Role Anda tidak punya izin <code>report:edit-draft</code> untuk menyimpan survey.</Note>}

                <div style={{ overflowX: 'auto', marginTop: 8 }}>
                  <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', fontSize: 12, color: 'var(--text-muted)' }}>
                        <th style={{ padding: '6px 8px', width: '30%' }}>MD (m)</th>
                        <th style={{ padding: '6px 8px', width: '24%' }}>Inklinasi (°)</th>
                        <th style={{ padding: '6px 8px', width: '24%' }}>Azimut (°)</th>
                        <th style={{ padding: '6px 8px', width: '22%' }}>TVD (m)</th>
                        <th style={{ padding: '6px 8px', width: 52 }}>Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {surveyRows.length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ padding: '10px 8px', color: 'var(--text-muted)' }}>
                            Belum ada stasiun survey pada laporan ini. Tambahkan lewat tombol Tambah stasiun.
                          </td>
                        </tr>
                      ) : (
                        surveyRows.map((row) => (
                          <tr key={row.key} style={{ borderTop: '1px solid var(--border-default)' }}>
                            <td style={{ padding: '6px 8px' }}>
                              <input
                                className="tnum"
                                style={inStyle()}
                                inputMode="decimal"
                                value={row.md}
                                disabled={surveyReadOnly}
                                aria-label="MD stasiun"
                                onChange={(e) => updateSurveyRow(row.key, { md: e.target.value })}
                              />
                            </td>
                            <td style={{ padding: '6px 8px' }}>
                              <input
                                className="tnum"
                                style={inStyle()}
                                inputMode="decimal"
                                value={row.inclination}
                                disabled={surveyReadOnly}
                                aria-label="Inklinasi stasiun"
                                onChange={(e) => updateSurveyRow(row.key, { inclination: e.target.value })}
                              />
                            </td>
                            <td style={{ padding: '6px 8px' }}>
                              <input
                                className="tnum"
                                style={inStyle()}
                                inputMode="decimal"
                                value={row.azimuth}
                                disabled={surveyReadOnly}
                                aria-label="Azimut stasiun"
                                onChange={(e) => updateSurveyRow(row.key, { azimuth: e.target.value })}
                              />
                            </td>
                            <td style={{ padding: '6px 8px' }}>
                              <input
                                className="tnum"
                                style={inStyle()}
                                inputMode="decimal"
                                value={row.tvd}
                                disabled={surveyReadOnly}
                                aria-label="TVD stasiun"
                                onChange={(e) => updateSurveyRow(row.key, { tvd: e.target.value })}
                              />
                            </td>
                            <td style={{ padding: '6px 8px' }}>
                              <button
                                type="button"
                                aria-label={`Hapus stasiun MD ${row.md}`}
                                disabled={surveyReadOnly}
                                onClick={() => removeSurveyRow(row.key)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  cursor: surveyReadOnly ? 'not-allowed' : 'pointer',
                                  color: 'var(--danger)',
                                  padding: 4,
                                }}
                              >
                                <Trash2 size={16} aria-hidden />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '6px 0 0' }}>
                  Nilai disimpan apa adanya dari tim MWD; layar ini tidak menghitung DLS secara otomatis.
                </p>
              </Card>
            </div>

            {/* ============ KARTU C - PDF PREVIEW ============ */}
            <Card>
              <h2 style={{ fontSize: 16, margin: '0 0 4px', display: 'flex', gap: 6, alignItems: 'center' }}>
                <FileText size={16} color="var(--info)" aria-hidden /> Pratinjau PDF
              </h2>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 10px' }}>
                Dokumen dihasilkan dari data DDR ini. Ringkasan di bawah menunjukkan isi yang akan tercetak.
              </p>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <a
                  href={report ? apiUrl(`/api/reports/${report.id}/pdf?type=ddr`) : undefined}
                  target="_blank"
                  rel="noreferrer"
                  style={{ textDecoration: 'none', pointerEvents: report ? 'auto' : 'none', opacity: report ? 1 : 0.5 }}
                  aria-label="Unduh PDF DDR"
                >
                  <Button variant="secondary" disabled={!report}>
                    <Download size={16} aria-hidden /> Unduh PDF DDR
                  </Button>
                </a>
                <a
                  href={report ? apiUrl(`/api/reports/${report.id}/pdf?type=iadc`) : undefined}
                  target="_blank"
                  rel="noreferrer"
                  style={{ textDecoration: 'none', pointerEvents: report ? 'auto' : 'none', opacity: report ? 1 : 0.5 }}
                  aria-label="Unduh PDF IADC"
                >
                  <Button variant="secondary" disabled={!report}>
                    <Download size={16} aria-hidden /> Unduh PDF IADC
                  </Button>
                </a>
              </div>

              {!report ? (
                <Note kind="info">Belum ada laporan untuk dipratinjau. Buat DDR terlebih dahulu. Buat DDR terlebih dahulu.</Note>
              ) : (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ border: '1px solid var(--border-default)', borderRadius: 6, padding: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                      DDR #{report.reportNo} - {report.wellName}
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.7 }}>
                      <li className="tnum">Baris time breakdown: {pdfSummary?.timeRows ?? 0}</li>
                      <li className="tnum">Total jam: {formatHours(report.totalMinutes)} jam</li>
                      <li className="tnum">Biaya harian: {formatUsd(pdfSummary?.costDaily ?? 0)}</li>
                      <li className="tnum">Biaya kumulatif: {formatUsd(pdfSummary?.costCumulative ?? 0)}</li>
                      <li className="tnum">Kru/POB: {pdfSummary?.crew ?? 0}</li>
                      <li className="tnum">Insiden tertaut: {pdfSummary?.incidents ?? 0}</li>
                      <li className="tnum">Stasiun survey: {pdfSummary?.surveyStations ?? 0}</li>
                      <li className="tnum">Aktivitas MAC: {pdfSummary?.mac ?? 0}</li>
                    </ul>
                  </div>

                  <div>
                    <span className="field-label">Kelengkapan data</span>
                    <ProgressBar value={report.validation.ok ? 100 : report.validation.totalMinutes > 0 ? 60 : 20} label="Kelengkapan laporan untuk PDF" />
                    <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                      {report.validation.ok
                        ? 'Validasi 24 jam lulus, PDF siap dicetak.'
                        : `${report.validation.issues.filter((i) => i.severity === 'error').length} kesalahan validasi time breakdown. Perbaiki di halaman Time Breakdown.`}
                    </p>
                  </div>
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      {/* ============ MODAL: REPORT INCIDENT ============ */}
      <Modal open={reportOpen} onClose={() => setReportOpen(false)} title="Catat Insiden">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Labeled label="Tipe insiden">
            <input
              style={inStyle()}
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              placeholder="mis. Near Miss - Dropped Object"
            />
          </Labeled>
          <Labeled label="Tanggal &amp; jam kejadian">
            <input
              className="tnum"
              type="datetime-local"
              style={inStyle()}
              value={form.occurredAt}
              onChange={(e) => setForm({ ...form, occurredAt: e.target.value })}
            />
          </Labeled>
        </div>

        <div style={{ marginTop: 12 }}>
          <span className="field-label">Tingkat keparahan</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="group" aria-label="Tingkat keparahan insiden">
            {SEVERITIES.map((s) => {
              const active = form.severity === s.id;
              const style = SEVERITY_STYLE[s.id];
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setForm({ ...form, severity: s.id })}
                  className="pill"
                  style={{
                    background: active ? style.background : '#fff',
                    color: active ? style.color : 'var(--text-primary)',
                    borderColor: active ? style.background : 'var(--border-default)',
                  }}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <Labeled label="Lokasi">
            <input style={inStyle()} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="mis. Drill Floor, RIG-12" />
          </Labeled>
        </div>

        <div style={{ marginTop: 12 }}>
          <Labeled label="Deskripsi">
            <textarea
              style={{ ...inStyle(), height: 'auto', padding: 8 }}
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Labeled>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <Labeled label="Tindakan segera">
            <textarea
              style={{ ...inStyle(), height: 'auto', padding: 8 }}
              rows={2}
              value={form.immediateAction}
              onChange={(e) => setForm({ ...form, immediateAction: e.target.value })}
            />
          </Labeled>
          <Labeled label="Tindakan korektif">
            <textarea
              style={{ ...inStyle(), height: 'auto', padding: 8 }}
              rows={2}
              value={form.correctiveAction}
              onChange={(e) => setForm({ ...form, correctiveAction: e.target.value })}
            />
          </Labeled>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <Labeled label="Penanggung jawab">
            <input style={inStyle()} value={form.assignee} onChange={(e) => setForm({ ...form, assignee: e.target.value })} />
          </Labeled>
          <Labeled label="Tenggat penyelesaian">
            <input className="tnum" type="date" style={inStyle()} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          </Labeled>
        </div>

        <p style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button onClick={submitIncident} disabled={busy}>
            {busy ? 'Menyimpan...' : 'Simpan insiden'}
          </Button>
          <Button variant="secondary" onClick={() => setReportOpen(false)} disabled={busy}>
            Batal
          </Button>
        </p>
      </Modal>
    </div>
  );
}
