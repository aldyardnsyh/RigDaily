'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Activity, ArrowRight, Calendar, Clock, Layers, RotateCcw, Share2, Wrench, Zap } from 'lucide-react';
import { Badge, Button, Card, KpiCard } from '@rigdaily/ui';
import { WELL_TYPE_LABEL, formatUsd } from '@rigdaily/shared';
import { Note } from '@/components/controls';
import { DataTable, type Column } from '@/components/DataTable';
import { StatusBadge, TimeClassBadge } from '@/components/StatusBadge';
import { useApi } from '@/lib/hooks/useApi';
import { useActiveWell } from '@/lib/hooks/useActiveWell';
import type { ReportDetail, ReportListItem, TimeRowDto, WellDto } from '@/lib/repo/types';

type Phase = 'drilling' | 'completion' | 'workover' | 'fracking' | 'flowback' | 'facilities';
type ReportsList = { items: ReportListItem[]; total: number };

const PHASES: Array<{ id: Phase; label: string; icon: React.ReactNode }> = [
  { id: 'drilling', label: 'Pemboran', icon: <Layers size={14} /> },
  { id: 'completion', label: 'Penyelesaian Sumur (Completion)', icon: <Activity size={14} /> },
  { id: 'workover', label: 'Workover / Intervensi', icon: <Wrench size={14} /> },
  { id: 'fracking', label: 'Fracking / Stimulasi', icon: <Zap size={14} /> },
  { id: 'flowback', label: 'Flowback & Uji Sumur', icon: <RotateCcw size={14} /> },
  { id: 'facilities', label: 'Fasilitas & Tie-In', icon: <Share2 size={14} /> },
];

/**
 * Kode IADC yang relevan dengan tiap fase non-drilling (filter client-side).
 * Drilling memakai halaman /ddr penuh sehingga tidak butuh filter di sini.
 */
const PHASE_IADC: Record<Exclude<Phase, 'drilling'>, string[]> = {
  completion: ['11', '12', '16'],
  workover: ['17', '18', '19', '20', '21', '22'],
  fracking: ['31'],
  flowback: ['32'],
  facilities: ['33'],
};

function fmtDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function DailyOpsPage() {
  const [phase, setPhase] = useState<Phase>('completion');

  const activeWell = useActiveWell();
  const wells = activeWell.wells;
  const wellId = activeWell.wellId;
  const well = wells.find((w) => w.id === wellId) ?? null;

  const reportsList = useApi<ReportsList>(wellId ? `/api/reports?wellId=${wellId}&limit=1` : null);
  const latest = reportsList.data?.items?.[0] ?? null;
  const detail = useApi<ReportDetail>(latest ? `/api/reports/${latest.id}` : null);

  const report = detail.data;
  const loadError = activeWell.error ?? reportsList.error ?? detail.error;
  const loading = activeWell.loading || reportsList.loading || detail.loading;

  // Baris time breakdown yang relevan dengan fase terpilih.
  const phaseRows = useMemo<TimeRowDto[]>(() => {
    if (!report || phase === 'drilling') return [];
    const codes = PHASE_IADC[phase];
    return report.timeRows.filter((r) => codes.includes(r.iadcCode));
  }, [report, phase]);

  const phaseLabel = PHASES.find((p) => p.id === phase)?.label ?? phase;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span aria-hidden style={{ display: 'flex', width: 36, height: 36, borderRadius: 4, background: 'var(--bg-sidebar)', color: '#fff', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Layers size={18} />
        </span>
        <div>
          <h1 style={{ margin: 0, fontSize: 18 }}>
            {well ? `Sumur ${well.name}` : 'Operasi Harian'}
            {well?.rigName ? ` • ${well.rigName}` : ''}
            {well?.fieldName ? ` • ${well.fieldName}` : ''}
          </h1>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {well && <span>{WELL_TYPE_LABEL[well.type] ?? well.type}</span>}
            {well && <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}><Calendar size={14} /> {fmtDate(well.spudDate)}</span>}
            {report && <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}><Clock size={14} /> DDR #{report.reportNo} · {fmtDate(report.reportDate)}</span>}
          </p>
        </div>
        {report && <StatusBadge status={report.status} />}
      </div>

      {loadError && (
        <div role="alert" style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 8, padding: 12, color: 'var(--danger-deep)', fontSize: 13 }}>
          {loadError}
        </div>
      )}

      {/* Phase switcher */}
      <Card>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }} role="tablist" aria-label="Pemilih fase operasi">
          {PHASES.map((p) => {
            const active = phase === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setPhase(p.id)}
                style={{
                  display: 'flex',
                  gap: 6,
                  alignItems: 'center',
                  height: 40,
                  padding: '0 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  background: active ? 'var(--bg-sidebar)' : 'transparent',
                  color: active ? '#fff' : 'var(--text-secondary)',
                  border: 0,
                  borderRadius: 4,
                }}
              >
                {p.icon} {p.label}
                {active && <span style={{ background: 'var(--accent-teal)', color: '#fff', fontSize: 10, borderRadius: 999, padding: '1px 6px', fontWeight: 700 }}>AKTIF</span>}
              </button>
            );
          })}
        </div>
      </Card>

      {phase === 'drilling' ? (
        <Card>
          <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Pemboran</h2>
          <Note kind="info">Fase pemboran dicatat pada Daily Drilling Report (DDR), termasuk time breakdown 24 jam dan validasi IADC.</Note>
          <p style={{ marginTop: 8 }}>
            <Link href="/ddr" style={{ display: 'inline-flex' }}>
              <Button>
                Buka Daily Drilling Report <ArrowRight size={16} />
              </Button>
            </Link>
          </p>
        </Card>
      ) : loading ? (
        <Card>
          <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} aria-hidden style={{ height: 32, background: 'var(--bg-surface-2)', borderRadius: 4 }} />
            ))}
          </div>
        </Card>
      ) : !report ? (
        <Card>
          <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Fase {phaseLabel}</h2>
          <Note kind="info">Belum ada DDR untuk sumur ini. Fase {phaseLabel} baru terbaca setelah laporan harian pertama dibuat.</Note>
        </Card>
      ) : (
        <PhasePanel phase={phase} phaseLabel={phaseLabel} report={report} rows={phaseRows} />
      )}
    </div>
  );
}

function PhasePanel({
  phase,
  phaseLabel,
  report,
  rows,
}: {
  phase: Exclude<Phase, 'drilling'>;
  phaseLabel: string;
  report: ReportDetail;
  rows: TimeRowDto[];
}) {
  const totalMinutes = report.totalMinutes;
  const mix = [
    { label: 'PRD', minutes: report.productiveMinutes, tone: 'var(--success)' },
    { label: 'NPT', minutes: report.nptMinutes, tone: 'var(--danger)' },
    { label: 'WOW', minutes: report.wowMinutes, tone: 'var(--warning)' },
  ];

  const columns: Column<TimeRowDto>[] = [
    { key: 'start', header: 'Mulai', render: (r) => <span className="tnum">{r.start}</span> },
    { key: 'end', header: 'Selesai', render: (r) => <span className="tnum">{r.end}</span> },
    { key: 'durationMin', header: 'Jam', align: 'right', render: (r) => (r.durationMin / 60).toFixed(2) },
    {
      key: 'iadcCode',
      header: 'IADC',
      render: (r) => (
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ background: 'var(--info-soft)', color: 'var(--info)', borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: 700 }}>{r.iadcCode}</span>
          <span>{r.iadcName}</span>
        </span>
      ),
    },
    { key: 'timeClass', header: 'Klasifikasi', render: (r) => <TimeClassBadge timeClass={r.timeClass} /> },
    { key: 'remarks', header: 'Keterangan', render: (r) => r.remarks ?? <span style={{ color: 'var(--text-muted)' }}>-</span> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Ringkasan laporan terbaru */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 16 }}>
        <KpiCard label="Kedalaman Akhir (MD)" value={`${report.depthMdEnd.toFixed(1)} m`} sub={`Progres +${report.progress24h.toFixed(1)} m / 24 jam`} />
        <KpiCard label="NPT %" value={`${report.nptPercent.toFixed(1)}%`} valueColor={report.nptPercent > 10 ? 'var(--danger)' : undefined} sub={`PRD ${(report.productiveMinutes / 60).toFixed(1)} jam`} />
        <KpiCard label="Biaya Harian" value={formatUsd(report.costDailyUsd)} sub={`Kumulatif ${formatUsd(report.costCumulativeUsd)}`} />
        <KpiCard label="Aktivitas Fase" value={`${rows.length} baris`} sub={`Total ${(rows.reduce((a, r) => a + r.durationMin, 0) / 60).toFixed(2)}h`} />
      </div>

      <Card>
        <h2 style={{ fontSize: 16, margin: '0 0 4px' }}>Fase {phaseLabel} - Komposisi Waktu Laporan #{report.reportNo}</h2>
        <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-secondary)' }}>
          Laporan {fmtDate(report.reportDate)} · rig {report.rigName ?? '-'} · total {(totalMinutes / 60).toFixed(2)}h
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {mix.map((m) => (
            <div key={m.label} style={{ border: '1px solid var(--border-default)', borderRadius: 4, padding: '6px 10px', minWidth: 120 }}>
              <div className="field-label" style={{ marginBottom: 2 }}>{m.label}</div>
              <div className="tnum" style={{ fontWeight: 800, color: m.tone }}>{(m.minutes / 60).toFixed(2)} jam</div>
            </div>
          ))}
        </div>
        <div aria-hidden style={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', marginTop: 8, background: 'var(--bg-surface-2)' }}>
          {mix.map((m) => (
            <div key={m.label} style={{ width: `${totalMinutes > 0 ? (m.minutes / totalMinutes) * 100 : 0}%`, background: m.tone }} />
          ))}
        </div>
      </Card>

      {/* Tabel time breakdown relevan fase */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Aktivitas {phaseLabel}</h2>
          <Badge kind="Draft">{rows.length} baris</Badge>
          <Link href="/time" style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--accent-teal)', fontWeight: 700, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            Kelola di Time Breakdown <ArrowRight size={14} />
          </Link>
        </div>
        <p style={{ margin: '4px 0 8px', fontSize: 12, color: 'var(--text-secondary)' }}>
          Baris disaring client-side berdasarkan kode IADC yang relevan dengan fase ({PHASE_IADC[phase].join(', ')}).
        </p>
        {rows.length === 0 ? (
          <>
            <Note kind="info">Belum ada aktivitas {phaseLabel} tercatat pada laporan ini (DDR #{report.reportNo}). Tambahkan lewat Time Breakdown.</Note>
            <p style={{ marginTop: 8 }}>
              <Link href="/time" style={{ display: 'inline-flex' }}>
                <Button variant="secondary">
                  Tambah aktivitas di Time Breakdown <ArrowRight size={16} />
                </Button>
              </Link>
            </p>
          </>
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} zebra maxHeight={420} empty="Tidak ada baris aktivitas pada fase ini." />
        )}
      </Card>
    </div>
  );
}
