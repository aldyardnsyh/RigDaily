'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, FilePlus2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Card } from '@rigdaily/ui';
import { formatHours, formatMeters, formatUsd } from '@rigdaily/shared';
import { KpiCardRow, type KpiCardItem } from '@/components/KpiCardRow';
import { TrendBars } from '@/components/TrendBars';
import { StatusBadge } from '@/components/StatusBadge';
import { apiUrl } from '@/lib/api-client';
import { useApi } from '@/lib/hooks/useApi';
import { useActiveWell } from '@/lib/hooks/useActiveWell';
import type {
  DashboardKpi,
  ReportListItem,
  TimeMix,
  TrendPoint,
} from '@/lib/repo/types';

type DashboardPayload = {
  kpi: DashboardKpi;
  reports: ReportListItem[];
  trend: TrendPoint[];
  timeMix: TimeMix | null;
  wellId: string | null;
};

type MePayload = {
  user: { id: string; name: string; email: string; role: string };
  permissions: string[];
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const TIME_MIX_ROWS: Array<{ key: keyof TimeMix; label: string; color: string }> = [
  { key: 'productive', label: 'Produktif (PRD)', color: 'var(--chart-2)' },
  { key: 'npt', label: 'NPT', color: 'var(--danger)' },
  { key: 'wow', label: 'Wait on Weather (WOW)', color: 'var(--chart-3)' },
  { key: 'standby', label: 'Standby', color: 'var(--chart-6)' },
  { key: 'disputed', label: 'Disengketakan', color: 'var(--danger-deep)' },
  { key: 'gap', label: 'Celah belum terisi (Gap)', color: 'var(--chart-5)' },
];

/** `YYYY-MM-DD` → `10 Sep`. */
function shortDate(value: string): string {
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function signed(value: number, digits = 1, unit = ''): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}${unit}`;
}

function SkeletonBlock({ h, w = '100%' }: { h: number; w?: number | string }) {
  // Skeleton berdenyut (bukan abu statis) memberi kesan sedang memuat.
  return <div aria-hidden className="rd-skeleton" style={{ height: h, width: w }} />;
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card>
      <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--danger-deep)' }}>
        {message}
      </p>
      <p style={{ margin: '10px 0 0' }}>
        <Button variant="secondary" onClick={onRetry}>
          <RefreshCw size={16} aria-hidden /> Coba lagi
        </Button>
      </p>
    </Card>
  );
}

function EmptyBox({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
        {children}
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function DashboardPage() {
  const router = useRouter();
  const activeWell = useActiveWell();
  // Dashboard mengikuti sumur aktif yang dipilih di topbar (fallback: portofolio).
  const dash = useApi<DashboardPayload>(activeWell.wellId ? `/api/dashboard?wellId=${activeWell.wellId}` : '/api/dashboard');
  const me = useApi<MePayload>('/api/auth/me');

  const data = dash.data;
  const kpi = data?.kpi ?? null;
  const reports = data?.reports ?? [];
  const trend = useMemo(() => data?.trend ?? [], [data]);
  const timeMix = data?.timeMix ?? null;

  const latestReport = reports[0] ?? null;

  const kpiItems: KpiCardItem[] = useMemo(() => {
    if (!kpi) return [];
    return [
      {
        label: 'Kedalaman Hari Ini',
        value: formatMeters(kpi.depthToday),
        sub: `${signed(kpi.depthDelta, 1, ' m')} vs laporan sebelumnya`,
        tone: kpi.depthDelta >= 0 ? 'success' : 'warning',
      },
      {
        label: 'NPT %',
        value: `${kpi.nptPercent.toFixed(2)}%`,
        sub: `${signed(kpi.nptDelta, 2, ' pp')} vs laporan sebelumnya`,
        tone: kpi.nptDelta > 0 ? 'danger' : 'success',
      },
      {
        label: 'Biaya Harian vs AFE',
        value: formatUsd(kpi.dailyCost),
        sub:
          kpi.afeConsumedPercent === null
            ? 'Anggaran AFE belum tersedia'
            : `${kpi.afeConsumedPercent.toFixed(2)}% dari AFE ${
                kpi.afeBudget !== null ? formatUsd(kpi.afeBudget) : '-'
              } (kumulatif ${formatUsd(kpi.cumulativeCost)})`,
        progress: kpi.afeConsumedPercent ?? undefined,
        tone:
          kpi.afeConsumedPercent !== null && kpi.afeConsumedPercent >= 100 ? 'danger' : 'default',
      },
      {
        label: 'Rig Aktif',
        value: `${kpi.activeRigs} / ${kpi.totalRigs}`,
        sub: 'Rig dengan DDR dalam 7 hari terakhir',
        tone: 'default',
      },
    ];
  }, [kpi]);

  const trendData = useMemo(
    () =>
      trend.map((p) => ({
        label: shortDate(p.date),
        value: p.depthMd,
        tone: 'default' as const,
      })),
    [trend],
  );

  const nptTrendData = useMemo(
    () =>
      trend.map((p) => ({
        label: shortDate(p.date),
        value: p.nptPercent,
        tone: (p.nptPercent > 0 ? 'danger' : 'success') as 'danger' | 'success',
      })),
    [trend],
  );

  const mixTotal = useMemo(() => {
    if (!timeMix) return 0;
    return TIME_MIX_ROWS.reduce((acc, row) => acc + (timeMix[row.key] ?? 0), 0);
  }, [timeMix]);

  const greetingName = me.data?.user.name ?? null;

  function exportLatestPdf() {
    if (!latestReport) {
      toast.info('Belum ada laporan untuk diekspor. Buat DDR terlebih dahulu.');
      return;
    }
    window.open(apiUrl(`/api/reports/${latestReport.id}/pdf?type=ddr`), '_blank', 'noopener');
  }

  function reloadAll() {
    dash.reload();
    me.reload();
  }

  const loading = dash.loading;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
        OPERASI SUMUR &gt; DASHBOARD
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>
          {greetingName ? `Selamat datang, ${greetingName}` : 'Dashboard Operasional'}
        </h1>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={reloadAll} disabled={loading} aria-label="Muat ulang dashboard">
            <RefreshCw size={16} aria-hidden /> {loading ? 'Memuat...' : 'Muat Ulang'}
          </Button>
          <Button
            variant="secondary"
            onClick={exportLatestPdf}
            disabled={!latestReport}
            aria-label="Unduh PDF laporan terbaru"
          >
            <Download size={16} aria-hidden /> Unduh PDF
          </Button>
          <Button onClick={() => router.push('/ddr')} aria-label="Buat Daily Drilling Report baru">
            <FilePlus2 size={16} aria-hidden /> Buat DDR Baru
          </Button>
        </span>
      </div>

      {dash.error && <ErrorBox message={dash.error} onRetry={() => dash.reload()} />}

      {/* ---------- KPI ---------- */}
      {loading && !kpi ? (
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16 }}
          aria-hidden
        >
          {[0, 1, 2, 3].map((i) => (
            <Card key={i}>
              <SkeletonBlock h={12} w="50%" />
              <div style={{ height: 12 }} />
              <SkeletonBlock h={28} w="70%" />
              <div style={{ height: 10 }} />
              <SkeletonBlock h={12} />
            </Card>
          ))}
        </div>
      ) : kpi ? (
        <KpiCardRow items={kpiItems} />
      ) : (
        !dash.error && (
          <EmptyBox>
            Belum ada data KPI. Buat DDR pertama untuk mulai mengisi dashboard.
          </EmptyBox>
        )
      )}

      {/* ---------- Charts ---------- */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16 }}>
        <Card>
          <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>Kedalaman vs Tanggal</h2>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-secondary)' }}>
            Kedalaman akhir (m MD) per tanggal laporan · {trend.length} titik terakhir
          </p>
          {loading && trend.length === 0 ? (
            <SkeletonBlock h={160} />
          ) : trendData.length === 0 ? (
            <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
              Belum ada tren kedalaman. Data muncul setelah ada minimal satu DDR.
            </p>
          ) : (
            <>
              <TrendBars data={trendData} height={170} valueLabel={(v) => formatMeters(v)} showAverage averageLabel="rata-rata" />
              <h3 style={{ margin: '16px 0 6px', fontSize: 13 }}>NPT % per hari</h3>
              <TrendBars data={nptTrendData} height={90} valueLabel={(v) => `${v.toFixed(2)}%`} />
            </>
          )}
        </Card>

        <Card>
          <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>Komposisi Waktu</h2>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-secondary)' }}>
            Komposisi 24 jam laporan terbaru (jam dan persen)
          </p>
          {loading && !timeMix ? (
            <>
              <SkeletonBlock h={14} />
              <div style={{ height: 8 }} />
              <SkeletonBlock h={14} />
              <div style={{ height: 8 }} />
              <SkeletonBlock h={14} />
            </>
          ) : !timeMix || mixTotal <= 0 ? (
            <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
              Belum ada time breakdown pada laporan terbaru. Lengkapi di{' '}
              <a href="/time" style={{ color: 'var(--accent-teal)', fontWeight: 600 }}>
                Time Breakdown
              </a>
              .
            </p>
          ) : (
            <>
              <div
                role="img"
                aria-label="Stacked bar komposisi waktu"
                style={{
                  display: 'flex',
                  height: 18,
                  borderRadius: 999,
                  overflow: 'hidden',
                  background: 'var(--bg-surface-2)',
                }}
              >
                {TIME_MIX_ROWS.map((row) => {
                  const minutes = timeMix[row.key] ?? 0;
                  const pct = mixTotal > 0 ? (minutes / mixTotal) * 100 : 0;
                  if (pct <= 0) return null;
                  return (
                    <span
                      key={row.key}
                      title={`${row.label}: ${formatHours(minutes)} jam (${pct.toFixed(1)}%)`}
                      style={{ width: `${pct}%`, background: row.color }}
                    />
                  );
                })}
              </div>
              <table style={{ width: '100%', fontSize: 13, marginTop: 10 }}>
                <tbody>
                  {TIME_MIX_ROWS.map((row) => {
                    const minutes = timeMix[row.key] ?? 0;
                    const pct = mixTotal > 0 ? (minutes / mixTotal) * 100 : 0;
                    return (
                      <tr key={row.key} style={{ height: 30 }}>
                        <td>
                          <span
                            aria-hidden
                            style={{
                              display: 'inline-block',
                              width: 8,
                              height: 8,
                              borderRadius: 2,
                              background: row.color,
                              marginRight: 6,
                            }}
                          />
                          {row.label}
                        </td>
                        <td className="tnum" style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                          {formatHours(minutes)} jam
                        </td>
                        <td className="tnum" style={{ textAlign: 'right', fontWeight: 700 }}>
                          {pct.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </Card>
      </div>

      {/* ---------- Today's Reports ---------- */}
      <Card>
        <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Laporan Hari Ini</h2>
        {loading && reports.length === 0 ? (
          <>
            <SkeletonBlock h={12} />
            <div style={{ height: 8 }} />
            <SkeletonBlock h={12} />
            <div style={{ height: 8 }} />
            <SkeletonBlock h={12} />
          </>
        ) : reports.length === 0 ? (
          <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
            Belum ada laporan. Klik &quot;Buat DDR Baru&quot; untuk membuat DDR pertama.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr
                  style={{
                    textAlign: 'left',
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    borderBottom: '1px solid var(--border-default)',
                  }}
                >
                  <th style={{ padding: '8px 6px' }}>Sumur</th>
                  <th style={{ padding: '8px 6px' }}>Rig</th>
                  <th style={{ padding: '8px 6px' }}>Tanggal</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>Kedalaman</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>NPT%</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>Biaya</th>
                  <th style={{ padding: '8px 6px' }}>Status</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id} style={{ height: 'var(--row-h)', borderBottom: '1px solid var(--border-default)' }}>
                    <td style={{ padding: '0 6px', fontWeight: 600 }}>
                      {r.wellName}
                      <span className="tnum" style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>
                        {' '}
                        · #{r.reportNo}
                      </span>
                    </td>
                    <td style={{ padding: '0 6px' }}>{r.rigName ?? '-'}</td>
                    <td className="tnum" style={{ padding: '0 6px' }}>
                      {r.reportDate}
                    </td>
                    <td className="tnum" style={{ padding: '0 6px', textAlign: 'right' }}>
                      {formatMeters(r.depthMdEnd)}
                    </td>
                    <td
                      className="tnum"
                      style={{
                        padding: '0 6px',
                        textAlign: 'right',
                        color: r.nptPercent > 0 ? 'var(--danger)' : undefined,
                      }}
                    >
                      {r.nptPercent.toFixed(2)}%
                    </td>
                    <td className="tnum" style={{ padding: '0 6px', textAlign: 'right' }}>
                      {formatUsd(r.costDailyUsd)}
                    </td>
                    <td style={{ padding: '0 6px' }}>
                      <StatusBadge status={r.status} />
                    </td>
                    <td style={{ padding: '0 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Link
                        href="/ddr"
                        style={{ color: 'var(--accent-teal)', fontWeight: 700, marginRight: 8 }}
                        aria-label={`Buka DDR ${r.reportNo} ${r.wellName}`}
                      >
                        Buka
                      </Link>
                      <a
                        href={apiUrl(`/api/reports/${r.id}/pdf?type=ddr`)}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: 'var(--accent-teal)', fontWeight: 700 }}
                        aria-label={`Unduh PDF DDR ${r.reportNo} ${r.wellName}`}
                      >
                        PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {me.error && (
        <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--danger-deep)' }}>
          Gagal memuat profil sesi: {me.error}. Muat ulang halaman atau masuk kembali.
        </p>
      )}
    </div>
  );
}
