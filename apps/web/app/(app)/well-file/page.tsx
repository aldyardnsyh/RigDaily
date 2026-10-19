'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Clock,
  Compass,
  CreditCard,
  Crosshair,
  FileText,
  Flag,
  GitFork,
  Layers,
  LayoutDashboard,
  ListChecks,
  Paperclip,
  ClipboardList,
  SlidersHorizontal,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card, KpiCard } from '@rigdaily/ui';
import { WELL_PHASE_LABEL, WELL_TYPE_LABEL, WELL_PHASES, formatUsd } from '@rigdaily/shared';
import { Labeled, Modal, Note, ProgressBar, inStyle } from '@/components/controls';
import { WellboreDrillingAnimation } from '@/components/WellboreDrillingAnimation';
import { DataTable, type Column } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import { apiSend, apiUrl } from '@/lib/api-client';
import { useApi } from '@/lib/hooks/useApi';
import { useActiveWell } from '@/lib/hooks/useActiveWell';
import type {
  BhaDto,
  DashboardKpi,
  ReportDetail,
  ReportListItem,
  TimeMix,
  WellDto,
} from '@/lib/repo/types';

type TabId = 'overview' | 'planning' | 'schema' | 'inventory' | 'milestones' | 'attachments';
type ReportsList = { items: ReportListItem[]; total: number };
type DashboardPayload = {
  kpi: DashboardKpi;
  reports: ReportListItem[];
  trend: unknown[];
  timeMix: TimeMix | null;
  wellId: string | null;
};
type WellMilestoneDerived = { label: string; date: string | null; status: 'done' | 'active' | 'planned'; depthM?: number };

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: 'overview', label: 'Ringkasan', icon: <LayoutDashboard size={14} /> },
  { id: 'planning', label: 'Perencanaan', icon: <ClipboardList size={14} /> },
  { id: 'schema', label: 'Skema Lubang Bor', icon: <GitFork size={14} /> },
  { id: 'inventory', label: 'Inventori BHA', icon: <ListChecks size={14} /> },
  { id: 'milestones', label: 'Milestone', icon: <Clock size={14} /> },
  { id: 'attachments', label: 'Lampiran', icon: <Paperclip size={14} /> },
];

/** Ukuran casing standar per section; kedalaman aktual berasal dari data sumur. */
const CASING_SECTIONS: Array<{ label: string; frac: number; color: string; size: string }> = [
  { label: 'Conductor', frac: 0.15, color: 'var(--bg-sidebar)', size: '30"' },
  { label: 'Surface', frac: 0.35, color: 'var(--chart-6)', size: '20"' },
  { label: 'Intermediate', frac: 0.6, color: 'var(--accent-teal)', size: '13-3/8"' },
  { label: 'Production', frac: 0.85, color: 'var(--chart-4)', size: '9-5/8"' },
];

function fmtDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function WellFilePage() {
  // `?id=` dibaca di client (tanpa useSearchParams) agar halaman tetap prerender-safe.
  const [forcedId, setForcedId] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    if (id) setForcedId(id);
  }, []);

  const activeWell = useActiveWell();
  const wells = activeWell.wells;
  // Prioritas: ?id= eksplisit, lalu sumur aktif dari topbar.
  const wellId = forcedId ?? activeWell.wellId;
  const well = wells.find((w) => w.id === wellId) ?? null;

  const me = useApi<{ permissions: string[] }>('/api/auth/me');
  const canEdit = me.data?.permissions.includes('wellfile:edit') ?? false;

  const reportsList = useApi<ReportsList>(wellId ? `/api/reports?wellId=${wellId}&limit=20` : null);
  const latest = reportsList.data?.items?.[0] ?? null;
  const detail = useApi<ReportDetail>(latest ? `/api/reports/${latest.id}` : null);
  const dash = useApi<DashboardPayload>(wellId ? `/api/dashboard?wellId=${wellId}` : null);

  const [tab, setTab] = useState<TabId>('overview');
  const [editOpen, setEditOpen] = useState(false);

  const report = detail.data;
  const kpi = dash.data?.kpi ?? null;

  /* Milestone diturunkan dari data nyata (spud, laporan terakhir, TD planned). */
  const milestones = useMemo<WellMilestoneDerived[]>(() => {
    if (!well) return [];
    const out: WellMilestoneDerived[] = [];
    out.push({ label: 'Spud', date: well.spudDate, status: well.spudDate ? 'done' : 'planned' });

    if (latest) {
      const depth = latest.depthMdEnd;
      out.push({
        label: `Laporan terakhir (#${latest.reportNo})`,
        date: latest.reportDate,
        status: 'done',
        depthM: depth,
      });
    }

    if (well.latestDepthMd != null) {
      const done = well.progressPercent != null && well.progressPercent >= 100;
      out.push({
        label: 'Progres kedalaman',
        date: latest?.reportDate ?? null,
        status: done ? 'done' : 'active',
        depthM: well.latestDepthMd,
      });
    }

    if (well.tdPlannedM != null) {
      out.push({ label: 'Target TD Planned', date: null, status: 'planned', depthM: well.tdPlannedM });
    }
    return out;
  }, [well, latest]);

  const reloadAll = () => {
    activeWell.reload();
    reportsList.reload();
    detail.reload();
    dash.reload();
  };

  /* ---------- state errors / loading ---------- */
  const loading = activeWell.loading;
  const loadError = activeWell.error ?? reportsList.error;

  if (loading) {
    return <PageSkeleton />;
  }

  if (loadError) {
    return (
      <div role="alert" style={errorBoxStyle}>
        {loadError}
      </div>
    );
  }

  if (!well) {
    return (
      <Card>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>Belum ada sumur terdaftar.</p>
      </Card>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Sumur {well.name}</h1>
        <Badge kind="Approved">{(WELL_PHASE_LABEL[well.phase] ?? well.phase).toUpperCase()}</Badge>
        <Badge kind="Draft">{WELL_TYPE_LABEL[well.type] ?? well.type}</Badge>
        {well.rigName && (
          <span className="tnum" style={{ fontSize: 12, background: 'var(--bg-sidebar)', color: '#fff', padding: '4px 10px', borderRadius: 999 }}>
            {well.rigName}
          </span>
        )}
        {well.fieldName && (
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 4, alignItems: 'center' }}>
            <Compass size={14} /> {well.fieldName}
          </span>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href="/admin" style={{ display: 'inline-flex' }}>
            <Button variant="secondary">
              <Layers size={16} /> Data Master
            </Button>
          </Link>
          <Button onClick={() => setEditOpen(true)} disabled={!canEdit}>
            <SlidersHorizontal size={16} /> Edit Sumur
          </Button>
        </span>
      </div>

      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <Flag size={14} /> Spud: {fmtDate(well.spudDate)}
        </span>
        {well.apiNo && <span className="tnum">API: {well.apiNo}</span>}
        {well.lat != null && well.lon != null && (
          <span style={{ display: 'flex', gap: 4, alignItems: 'center' }} className="tnum">
            <Crosshair size={14} /> {well.lat.toFixed(4)}, {well.lon.toFixed(4)}
          </span>
        )}
        {well.operator && <span>Operator: {well.operator}</span>}
      </p>

      {/* Depth progress + tabs */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>
            PROGRES KEDALAMAN MD: {well.latestDepthMd != null ? `${well.latestDepthMd.toFixed(2)} m` : '-'} / Target TD Rencana{' '}
            {well.tdPlannedM != null ? `${well.tdPlannedM.toFixed(2)} m` : '-'}
          </p>
          {well.progressPercent != null && (
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>
              <Badge kind="Distributed">{well.progressPercent.toFixed(1)}% Dibor</Badge>{' '}
              {well.tdPlannedM != null && well.latestDepthMd != null
                ? `${Math.max(0, well.tdPlannedM - well.latestDepthMd).toFixed(1)} m menuju TD`
                : ''}
            </p>
          )}
        </div>
        <div style={{ marginTop: 8 }}>
          <ProgressBar value={well.progressPercent ?? 0} label="Progress kedalaman sumur" />
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 12, borderBottom: '1px solid var(--border-default)', flexWrap: 'wrap' }} role="tablist" aria-label="Tab data sumur">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              style={tabStyle(tab === t.id)}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </Card>

      {tab === 'overview' && <OverviewTab well={well} kpi={kpi} reports={reportsList.data?.items ?? []} reportsLoading={reportsList.loading} />}
      {tab === 'planning' && <PlanningTab well={well} />}
      {tab === 'schema' && <SchemaTab well={well} latest={latest} />}
      {tab === 'inventory' && <InventoryTab report={report} loading={detail.loading} />}
      {tab === 'milestones' && <MilestonesTab milestones={milestones} />}
      {tab === 'attachments' && <AttachmentsTab latest={latest} report={report} />}

      <EditWellModal
        open={editOpen}
        well={well}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          reloadAll();
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                 */
/* ------------------------------------------------------------------ */

function OverviewTab({
  well,
  kpi,
  reports,
  reportsLoading,
}: {
  well: WellDto;
  kpi: DashboardKpi | null;
  reports: ReportListItem[];
  reportsLoading: boolean;
}) {
  const reportColumns: Column<ReportListItem>[] = [
    { key: 'reportNo', header: '#', render: (r) => <strong className="tnum">{r.reportNo}</strong> },
    { key: 'reportDate', header: 'Tanggal', render: (r) => <span className="tnum">{r.reportDate}</span> },
    { key: 'rigName', header: 'Rig', render: (r) => r.rigName ?? '-' },
    { key: 'depthMdEnd', header: 'Kedalaman Akhir', align: 'right', render: (r) => `${r.depthMdEnd.toFixed(1)} m` },
    { key: 'progress24h', header: 'Progres', align: 'right', render: (r) => `${r.progress24h.toFixed(1)} m` },
    { key: 'nptPercent', header: 'NPT %', align: 'right', render: (r) => `${r.nptPercent.toFixed(1)}%` },
    { key: 'costDailyUsd', header: 'Biaya Harian', align: 'right', render: (r) => formatUsd(r.costDailyUsd) },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <KpiCard label="Kedalaman Hari Ini" value={kpi ? `${kpi.depthToday.toFixed(1)} m` : '-'} sub={kpi ? `${kpi.depthDelta >= 0 ? '+' : ''}${kpi.depthDelta.toFixed(1)} m / 24h` : undefined} icon={<TrendingUp size={20} color="var(--accent-teal)" aria-hidden />} />
        <KpiCard label="NPT %" value={kpi ? `${kpi.nptPercent.toFixed(1)}%` : '-'} valueColor={kpi && kpi.nptPercent > 10 ? 'var(--danger)' : undefined} sub={kpi ? `Δ ${kpi.nptDelta.toFixed(1)} pp` : undefined} icon={<Clock size={20} color="var(--text-muted)" aria-hidden />} />
        <KpiCard label="Biaya Harian" value={kpi ? formatUsd(kpi.dailyCost) : '-'} sub={kpi ? `Δ ${formatUsd(kpi.dailyCostDelta)}` : undefined} icon={<CreditCard size={20} color="var(--text-muted)" aria-hidden />} />
        <KpiCard
          label="Anggaran AFE"
          value={kpi?.afeBudget != null ? formatUsd(kpi.afeBudget) : well.afeBudgetUsd != null ? formatUsd(well.afeBudgetUsd) : '-'}
          progress={kpi?.afeConsumedPercent ?? undefined}
          sub={kpi?.afeConsumedPercent != null ? `${kpi.afeConsumedPercent.toFixed(1)}% terpakai` : 'Belum ada AFE'}
          icon={<Layers size={20} color="var(--text-muted)" aria-hidden />}
        />
      </div>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Laporan Sumur {well.name}</h2>
          <Badge kind="Draft">{reports.length} laporan</Badge>
          <Link href="/reports" style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--accent-teal)', fontWeight: 700, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            Semua laporan <ArrowRight size={14} />
          </Link>
        </div>
        <div style={{ marginTop: 8 }}>
          {reportsLoading ? (
            <TableSkeleton rows={6} />
          ) : (
            <DataTable columns={reportColumns} rows={reports} rowKey={(r) => r.id} zebra maxHeight={420} empty="Belum ada laporan DDR untuk sumur ini. Buat DDR pertama lewat halaman DDR." />
          )}
        </div>
      </Card>
    </div>
  );
}

function PlanningTab({ well }: { well: WellDto }) {
  const rows: Array<[string, string]> = [
    ['Target TD Rencana', well.tdPlannedM != null ? `${well.tdPlannedM.toFixed(2)} m MD` : '-'],
    ['Anggaran AFE', well.afeBudgetUsd != null ? formatUsd(well.afeBudgetUsd) : '-'],
    ['Kedalaman terkini (MD)', well.latestDepthMd != null ? `${well.latestDepthMd.toFixed(2)} m` : '-'],
    ['Progres ke TD', well.progressPercent != null ? `${well.progressPercent.toFixed(1)}%` : '-'],
    ['Operator', well.operator ?? '-'],
    ['Tanggal Spud', fmtDate(well.spudDate)],
    ['Lapangan', well.fieldName ?? '-'],
    ['Tipe Sumur', WELL_TYPE_LABEL[well.type] ?? well.type],
    ['Fase', WELL_PHASE_LABEL[well.phase] ?? well.phase],
  ];
  return (
    <Card>
      <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Perencanaan (hanya baca)</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ border: '1px solid var(--border-default)', borderRadius: 4, padding: '8px 12px' }}>
            <div className="field-label" style={{ marginBottom: 2 }}>{k}</div>
            <div className="tnum" style={{ fontWeight: 700 }}>{v}</div>
          </div>
        ))}
      </div>
      <Note kind="info">
        Nilai perencanaan diambil langsung dari data sumur. Ubah fase / TD rencana / AFE / operator lewat tombol <strong>Edit Sumur</strong>
        (butuh izin <code>wellfile:edit</code>); perubahan tercatat di jejak audit.
      </Note>
    </Card>
  );
}

function SchemaTab({ well, latest }: { well: WellDto; latest: ReportListItem | null }) {
  const td = well.tdPlannedM ?? 0;
  const current = well.latestDepthMd ?? latest?.depthMdEnd ?? 0;

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Penampang Lubang Bor</h2>
        <span className="tnum" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Kedalaman kini {current.toFixed(1)} m MD / TD {td.toFixed(0)} m
        </span>
      </div>
      <div style={{ marginTop: 12 }}>
        <WellboreDrillingAnimation wellName={well.name} tdPlannedMd={td} currentMd={current} />
      </div>
      <Note kind="info">
        Skala mengikuti TD planned. Lebar pipa mengikuti ukuran casing standar
        (30&quot;/20&quot;/13-3/8&quot;/9-5/8&quot;). Posisi bit mengikuti kedalaman laporan terakhir.
      </Note>
    </Card>
  );
}

function InventoryTab({ report, loading }: { report: ReportDetail | null; loading: boolean }) {
  const bha = report?.bha ?? [];
  const columns: Column<BhaDto>[] = [
    { key: 'component', header: 'Komponen', render: (r) => <strong>{r.component}</strong> },
    { key: 'odIn', header: 'OD (in)', align: 'right', render: (r) => (r.odIn != null ? r.odIn.toFixed(2) : '-') },
    { key: 'lengthM', header: 'Panjang (m)', align: 'right', render: (r) => (r.lengthM != null ? r.lengthM.toFixed(2) : '-') },
    { key: 'hours', header: 'Jam', align: 'right', render: (r) => (r.hours != null ? r.hours.toFixed(2) : '-') },
  ];

  return (
    <Card>
      <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Inventori BHA - Laporan Terbaru</h2>
      {loading ? (
        <TableSkeleton rows={6} />
      ) : !report ? (
        <Note kind="info">Belum ada laporan untuk menampilkan inventori BHA. Buat DDR terlebih dahulu.</Note>
      ) : (
        <>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 8px' }}>
            DDR #{report.reportNo} · {report.reportDate} · {bha.length} komponen
          </p>
          <DataTable columns={columns} rows={bha} rowKey={(r) => r.id} zebra empty="Laporan ini belum mencatat komponen BHA. Tambahkan lewat halaman DDR." />
        </>
      )}
    </Card>
  );
}

function MilestonesTab({ milestones }: { milestones: WellMilestoneDerived[] }) {
  const STATUS_LABEL: Record<WellMilestoneDerived['status'], string> = { done: 'SELESAI', active: 'AKTIF', planned: 'DIRENCANAKAN' };
  return (
    <Card>
      <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Milestone</h2>
      {milestones.length === 0 ? (
        <Note kind="info">Belum ada data milestone. Data muncul setelah sumur punya tanggal spud dan laporan DDR.</Note>
      ) : (
        <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none', position: 'relative' }}>
          {milestones.map((m) => (
            <li key={m.label} style={{ position: 'relative', paddingLeft: 26, paddingBottom: 12, borderLeft: '1.5px solid var(--border-default)', marginLeft: 7 }}>
              <span style={{ position: 'absolute', left: -9, top: 2, background: '#fff' }}>
                {m.status === 'done' ? (
                  <CheckCircle2 size={16} color="var(--success)" aria-label="Selesai" />
                ) : m.status === 'active' ? (
                  <Circle size={14} color="var(--accent-teal)" fill="var(--accent-teal)" aria-label="Aktif" />
                ) : (
                  <Circle size={14} color="var(--border-strong)" aria-label="Direncanakan" />
                )}
              </span>
              <strong style={{ fontSize: 13, color: m.status === 'active' ? 'var(--accent-teal)' : undefined }}>
                [{STATUS_LABEL[m.status]}] {m.label}
              </strong>{' '}
              {m.date && <span className="tnum" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{fmtDate(m.date)}</span>}
              {m.depthM != null && <span className="tnum" style={{ fontSize: 12, color: 'var(--text-secondary)' }}> · {m.depthM.toFixed(1)} m</span>}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function AttachmentsTab({ latest, report }: { latest: ReportListItem | null; report: ReportDetail | null }) {
  const links = latest
    ? [
        { label: `DDR PDF - laporan #${latest.reportNo}`, href: apiUrl(`/api/reports/${latest.id}/pdf?type=ddr`) },
        { label: `IADC Time Sheet - laporan #${latest.reportNo}`, href: apiUrl(`/api/reports/${latest.id}/pdf?type=iadc`) },
      ]
    : [];

  return (
    <Card>
      <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Lampiran</h2>
      {links.length === 0 ? (
        <Note kind="info">Belum ada laporan terbaru untuk diunduh. Buat DDR terlebih dahulu.</Note>
      ) : (
        <>
          <ul style={{ fontSize: 13, paddingLeft: 18, margin: 0 }}>
            {links.map((l) => (
              <li key={l.href} style={{ marginBottom: 6 }}>
                <a href={l.href} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-teal)', fontWeight: 700, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                  <FileText size={14} /> {l.label}
                </a>
              </li>
            ))}
          </ul>
          {report && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
              Laporan #{report.reportNo} · {report.reportDate} · status <StatusBadge status={report.status} />
            </p>
          )}
          <Note kind="info">
            Dokumen resmi yang dihasilkan sistem{report ? ` untuk laporan #${report.reportNo}` : ''}: DDR dan IADC Time
            Sheet. Unggahan foto/dokumen lapangan memerlukan modul penyimpanan dokumen yang belum termasuk dalam
            cakupan versi ini.
          </Note>
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Edit Well modal                                                      */
/* ------------------------------------------------------------------ */

function EditWellModal({ open, well, onClose, onSaved }: { open: boolean; well: WellDto; onClose: () => void; onSaved: () => void }) {
  const [phase, setPhase] = useState(well.phase);
  const [td, setTd] = useState(well.tdPlannedM != null ? String(well.tdPlannedM) : '');
  const [afe, setAfe] = useState(well.afeBudgetUsd != null ? String(well.afeBudgetUsd) : '');
  const [operator, setOperator] = useState(well.operator ?? '');
  const [busy, setBusy] = useState(false);

  // Sinkronkan form ketika modal dibuka kembali untuk sumur yang sama.
  useEffect(() => {
    if (open) {
      setPhase(well.phase);
      setTd(well.tdPlannedM != null ? String(well.tdPlannedM) : '');
      setAfe(well.afeBudgetUsd != null ? String(well.afeBudgetUsd) : '');
      setOperator(well.operator ?? '');
    }
  }, [open, well.phase, well.tdPlannedM, well.afeBudgetUsd, well.operator]);

  async function save() {
    const patch: Record<string, unknown> = {};
    if (phase !== well.phase) patch.phase = phase;
    if (td.trim() !== (well.tdPlannedM != null ? String(well.tdPlannedM) : '')) {
      const n = td.trim() === '' ? null : Number(td);
      if (n !== null && (!Number.isFinite(n) || n < 0)) {
        toast.error('TD planned harus angka ≥ 0.');
        return;
      }
      patch.tdPlannedM = n;
    }
    if (afe.trim() !== (well.afeBudgetUsd != null ? String(well.afeBudgetUsd) : '')) {
      const n = afe.trim() === '' ? null : Number(afe);
      if (n !== null && (!Number.isFinite(n) || n < 0)) {
        toast.error('AFE budget harus angka ≥ 0.');
        return;
      }
      patch.afeBudgetUsd = n;
    }
    if (operator.trim() !== (well.operator ?? '')) patch.operator = operator.trim() === '' ? null : operator.trim();

    if (Object.keys(patch).length === 0) {
      toast.info('Tidak ada perubahan pada parameter sumur.');
      return;
    }

    setBusy(true);
    try {
      await apiSend<WellDto>(`/api/wells/${well.id}`, 'PATCH', patch);
      toast.success('Parameter sumur diperbarui.');
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memperbarui parameter sumur. Periksa nilai lalu coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit Sumur">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Labeled label="Fase">
          <select style={inStyle()} value={phase} onChange={(e) => setPhase(e.target.value)}>
            {WELL_PHASES.map((p) => (
              <option key={p} value={p}>
                {WELL_PHASE_LABEL[p] ?? p}
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label="Operator">
          <input style={inStyle()} value={operator} onChange={(e) => setOperator(e.target.value)} placeholder="mis. Pertamina Hulu" />
        </Labeled>
        <Labeled label="TD Rencana (m)">
          <input className="tnum" style={inStyle()} inputMode="decimal" value={td} onChange={(e) => setTd(e.target.value)} placeholder="mis. 3200.0" />
        </Labeled>
        <Labeled label="Anggaran AFE (USD)">
          <input className="tnum" style={inStyle()} inputMode="decimal" value={afe} onChange={(e) => setAfe(e.target.value)} placeholder="mis. 1600000.00" />
        </Labeled>
      </div>
      <p style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <Button onClick={save} disabled={busy}>
          {busy ? 'Menyimpan...' : 'Simpan'}
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Batal
        </Button>
      </p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Helper                                                               */
/* ------------------------------------------------------------------ */

function tabStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    height: 40,
    padding: '0 12px',
    fontSize: 14,
    fontWeight: 500,
    background: 'none',
    border: 0,
    borderBottom: active ? '2px solid var(--accent-teal)' : '2px solid transparent',
    color: active ? 'var(--accent-teal)' : 'var(--text-secondary)',
    cursor: 'pointer',
    fontFamily: 'inherit',
  };
}

const errorBoxStyle: React.CSSProperties = {
  background: 'var(--danger-soft)',
  border: '1px solid var(--danger)',
  borderRadius: 8,
  padding: 12,
  color: 'var(--danger-deep)',
  fontSize: 13,
};

function TableSkeleton({ rows }: { rows: number }) {
  return (
    <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} aria-hidden style={{ height: 32, background: 'var(--bg-surface-2)', borderRadius: 4 }} />
      ))}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div aria-hidden style={{ height: 32, width: 260, background: 'var(--bg-surface-2)', borderRadius: 4 }} />
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div aria-hidden style={{ height: 24, width: 320, background: 'var(--bg-surface-2)', borderRadius: 4 }} />
          <div aria-hidden style={{ height: 8, background: 'var(--bg-surface-2)', borderRadius: 999 }} />
        </div>
      </Card>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <div aria-hidden style={{ height: 56, background: 'var(--bg-surface-2)', borderRadius: 4 }} />
          </Card>
        ))}
      </div>
    </div>
  );
}
