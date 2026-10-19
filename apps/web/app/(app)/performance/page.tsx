'use client';

/**
 * Performance - analitik kinerja pengeboran untuk sumur aktif.
 *
 * SEMUA angka berasal dari API nyata (tidak ada nilai contoh yang di-hardcode):
 * - `GET /api/dashboard?wellId=`  -> `kpi`, `trend`, `timeMix`
 * - `GET /api/insights`           -> `benchmark` (perbandingan antar sumur) & `baselines`
 * - `GET /api/reports?wellId=`    -> daftar laporan (untuk ROP per laporan)
 * - `GET /api/personnel?wellId=`  -> jumlah POB terakhir (konteks operasi)
 *
 * Rumus mengikuti repo `insights.ts` supaya layar dan PDF memakai angka yang sama:
 * - ROP (m/hr)  = `progress24h / 24`
 * - NPT %       = `(nptMinutes + wowMinutes) / totalMinutes * 100` (sudah dihitung server)
 * Delta benchmark = selisih nilai sumur terhadap rata-rata seluruh sumur ber-laporan.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Gauge,
  Minus,
  RefreshCw,
  Scale,
  Timer,
  TrendingUp,
  Users,
} from 'lucide-react';
import { Button, Card } from '@rigdaily/ui';
import { formatHours, formatMeters, formatUsd } from '@rigdaily/shared';
import { KpiCardRow, type KpiCardItem } from '@/components/KpiCardRow';
import { TrendBars, type TrendBarDatum } from '@/components/TrendBars';
import { useApi } from '@/lib/hooks/useApi';
import { useActiveWell } from '@/lib/hooks/useActiveWell';
import type {
  DashboardKpi,
  ReportListItem,
  TimeMix,
  TrendPoint,
} from '@/lib/repo/types';

/* ------------------------------------------------------------------ */
/* DTO (dideklarasikan lokal - repo adalah `server-only`)              */
/* ------------------------------------------------------------------ */

type DashboardPayload = {
  kpi: DashboardKpi;
  reports: ReportListItem[];
  trend: TrendPoint[];
  timeMix: TimeMix | null;
  wellId: string | null;
};

type BenchmarkRow = {
  wellId: string;
  wellName: string;
  wellType: string;
  phase: string;
  reportCount: number;
  avgNptPercent: number;
  avgDailyCost: number;
  avgRopMHr: number;
};

type BaselineComparison = {
  name: string;
  actual: number;
  baseline: number | null;
  deltaPercent: number | null;
  unit: string | null;
};

type InsightsPayload = {
  benchmark: BenchmarkRow[];
  baselines: BaselineComparison[];
};

type ReportsList = { items: ReportListItem[]; total: number };

type PersonnelPayload = { summary: { total: number; inCount: number; outCount: number; manHours: number } };

/* ------------------------------------------------------------------ */
/* Konstanta tampilan                                                  */
/* ------------------------------------------------------------------ */

const TIME_MIX_ROWS: Array<{ key: keyof TimeMix; label: string; color: string }> = [
  { key: 'productive', label: 'Produktif (PRD)', color: 'var(--chart-2)' },
  { key: 'npt', label: 'NPT', color: 'var(--danger)' },
  { key: 'wow', label: 'Wait on Weather (WOW)', color: 'var(--chart-3)' },
  { key: 'standby', label: 'Standby', color: 'var(--chart-6)' },
  { key: 'disputed', label: 'Disengketakan', color: 'var(--danger-deep)' },
  { key: 'gap', label: 'Celah belum terisi (Gap)', color: 'var(--chart-5)' },
];

/* ------------------------------------------------------------------ */
/* Helper format & hitung                                              */
/* ------------------------------------------------------------------ */

/** `YYYY-MM-DD` -> `10 Sep`. */
function shortDate(value: string): string {
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function signed(value: number, digits = 2, unit = ''): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}${unit}`;
}

function safeAvg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** ROP meter per jam dari progres 24 jam (rumus sama dengan repo insights). */
function ropOf(progress24h: number): number {
  return Number.isFinite(progress24h) && progress24h > 0 ? progress24h / 24 : 0;
}

/**
 * Arah KPI: `true` = naik itu baik.
 *
 * - NPT %  dan Cost per Meter: NAIK = BURUK (`false`).
 * - Rig Uptime %: NAIK = BAIK (`true`).
 * KPI lain tidak diasumsikan supaya tidak salah warna (netral).
 */
function higherIsBetter(kpiName: string): boolean | null {
  const n = kpiName.toLowerCase();
  if (n.includes('npt')) return false;
  if (n.includes('cost per meter')) return false;
  if (n.includes('uptime')) return true;
  return null;
}

function deltaIsGood(kpiName: string, deltaPercent: number): boolean | null {
  const hib = higherIsBetter(kpiName);
  if (hib === null || deltaPercent === 0) return null;
  return hib ? deltaPercent > 0 : deltaPercent < 0;
}

/* ------------------------------------------------------------------ */
/* Sub-komponen tata letak                                             */
/* ------------------------------------------------------------------ */

function SectionTitle({
  icon,
  title,
  note,
  right,
}: {
  icon: React.ReactNode;
  title: string;
  note: string;
  right?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 9 }}>
      <span aria-hidden style={{ color: 'var(--accent-teal)', display: 'inline-flex', marginTop: 1 }}>
        {icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>
        <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>{note}</p>
      </div>
      {right ? <span style={{ marginLeft: 'auto', flexShrink: 0 }}>{right}</span> : null}
    </div>
  );
}

function SkeletonBlock({ h, w = '100%' }: { h: number; w?: number | string }) {
  return <div aria-hidden className="rd-skeleton" style={{ height: h, width: w }} />;
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
      {children}
    </p>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card>
      <p
        role="alert"
        style={{ margin: 0, fontSize: 13, color: 'var(--danger-deep)', display: 'flex', gap: 8, alignItems: 'flex-start' }}
      >
        <AlertTriangle size={16} aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />
        <span>{message}</span>
      </p>
      <p style={{ margin: '10px 0 0' }}>
        <Button variant="secondary" onClick={onRetry} aria-label="Coba muat ulang data">
          <RefreshCw size={16} aria-hidden /> Coba lagi
        </Button>
      </p>
    </Card>
  );
}

/**
 * Stacked bar komposisi waktu (produktif / NPT / WOW / standby / disengketakan / gap).
 * Lebar tiap segmen = porsi menit terhadap total menit laporan terbaru.
 */
function TimeMixChart({ timeMix }: { timeMix: TimeMix }) {
  const total = TIME_MIX_ROWS.reduce((acc, row) => acc + (timeMix[row.key] ?? 0), 0);
  if (total <= 0) {
    return (
      <Muted>
        Belum ada time breakdown pada laporan terbaru. Lengkapi di{' '}
        <Link href="/time" style={{ color: 'var(--accent-teal)', fontWeight: 700 }}>
          Time Breakdown
        </Link>
        .
      </Muted>
    );
  }
  return (
    <>
      <div
        role="img"
        aria-label={`Komposisi waktu ${formatHours(total)} menit: ${TIME_MIX_ROWS.map((row) => {
          const pct = ((timeMix[row.key] ?? 0) / total) * 100;
          return `${row.label} ${pct.toFixed(1)}%`;
        }).join(', ')}`}
        style={{
          display: 'flex',
          height: 20,
          borderRadius: 999,
          overflow: 'hidden',
          background: 'var(--bg-surface-2)',
        }}
      >
        {TIME_MIX_ROWS.map((row) => {
          const minutes = timeMix[row.key] ?? 0;
          const pct = (minutes / total) * 100;
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
      <table style={{ width: '100%', fontSize: 13, marginTop: 10, borderCollapse: 'collapse' }}>
        <caption className="sr-only">Rincian komposisi waktu laporan terbaru</caption>
        <thead>
          <tr style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'left' }}>
            <th scope="col" style={{ padding: '4px 0', fontWeight: 700 }}>
              Klasifikasi
            </th>
            <th scope="col" style={{ padding: '4px 0', fontWeight: 700, textAlign: 'right' }}>
              Jam
            </th>
            <th scope="col" style={{ padding: '4px 0', fontWeight: 700, textAlign: 'right' }}>
              Porsi
            </th>
          </tr>
        </thead>
        <tbody>
          {TIME_MIX_ROWS.map((row) => {
            const minutes = timeMix[row.key] ?? 0;
            const pct = (minutes / total) * 100;
            return (
              <tr key={row.key} style={{ height: 28, borderTop: '1px solid var(--border-default)' }}>
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
                  {formatHours(minutes)}
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
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function PerformancePage() {
  const activeWell = useActiveWell();
  const wellId = activeWell.wellId;

  const dash = useApi<DashboardPayload>(wellId ? `/api/dashboard?wellId=${wellId}` : '/api/dashboard');
  const insights = useApi<InsightsPayload>('/api/insights');
  const reports = useApi<ReportsList>(wellId ? `/api/reports?wellId=${wellId}&limit=50` : '/api/reports?limit=50');
  const personnel = useApi<PersonnelPayload>(wellId ? `/api/personnel?wellId=${wellId}` : null);

  const data = dash.data;
  const kpi = data?.kpi ?? null;
  const trend = useMemo(() => data?.trend ?? [], [data]);
  const timeMix = data?.timeMix ?? null;

  const reportItems = useMemo(() => reports.data?.items ?? [], [reports.data]);
  const benchmark = useMemo(() => insights.data?.benchmark ?? [], [insights.data]);
  const baselines = useMemo(() => insights.data?.baselines ?? [], [insights.data]);

  /* ---------- KPI ---------- */

  const kpiItems: KpiCardItem[] = useMemo(() => {
    if (!kpi) return [];
    const afeTone: KpiCardItem['tone'] =
      kpi.afeConsumedPercent !== null && kpi.afeConsumedPercent >= 100
        ? 'danger'
        : kpi.afeConsumedPercent !== null && kpi.afeConsumedPercent >= 85
          ? 'warning'
          : 'default';
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
        label: 'Biaya Harian',
        value: formatUsd(kpi.dailyCost),
        sub: `Perubahan ${signed(kpi.dailyCostDelta, 0, ' USD')} vs laporan sebelumnya`,
        tone: kpi.dailyCostDelta > 0 ? 'warning' : 'default',
      },
      {
        label: 'Kumulatif vs AFE',
        value: kpi.afeConsumedPercent === null ? formatUsd(kpi.cumulativeCost) : `${kpi.afeConsumedPercent.toFixed(1)}%`,
        sub:
          kpi.afeBudget === null
            ? `Biaya kumulatif ${formatUsd(kpi.cumulativeCost)} - anggaran AFE belum tersedia`
            : `${formatUsd(kpi.cumulativeCost)} dari AFE ${formatUsd(kpi.afeBudget)}`,
        progress: kpi.afeConsumedPercent ?? undefined,
        tone: afeTone,
      },
    ];
  }, [kpi]);

  /* ---------- ROP per laporan ---------- */

  const ropData: TrendBarDatum[] = useMemo(() => {
    // API mengembalikan laporan terbaru lebih dulu; grafik dibaca kiri ke kanan
    // dari yang terlama supaya arah waktu konsisten dengan TrendBars lain.
    return [...reportItems]
      .sort((a, b) => a.reportDate.localeCompare(b.reportDate))
      .map((r) => ({
        label: shortDate(r.reportDate),
        value: ropOf(r.progress24h),
        tone: 'default' as const,
      }));
  }, [reportItems]);

  const ropAverage = useMemo(() => safeAvg(ropData.map((d) => d.value)), [ropData]);
  const latestRop = ropData.length > 0 ? ropData[ropData.length - 1].value : 0;
  const totalProgress = useMemo(
    () => reportItems.reduce((acc, r) => acc + (Number.isFinite(r.progress24h) ? r.progress24h : 0), 0),
    [reportItems],
  );

  /* ---------- NPT trend ---------- */

  const nptData: TrendBarDatum[] = useMemo(
    () =>
      trend.map((p) => ({
        label: shortDate(p.date),
        value: p.nptPercent,
        tone: (p.nptPercent > 0 ? 'danger' : 'success') as 'danger' | 'success',
      })),
    [trend],
  );

  /* ---------- Benchmark antar sumur ---------- */

  const benchmarkRows = useMemo(() => {
    const withReports = benchmark.filter((b) => b.reportCount > 0);
    const avgNpt = safeAvg(withReports.map((b) => b.avgNptPercent));
    const avgCost = safeAvg(withReports.map((b) => b.avgDailyCost));
    const avgRop = safeAvg(withReports.map((b) => b.avgRopMHr));
    return {
      avgNpt,
      avgCost,
      avgRop,
      hasComparison: withReports.length >= 2,
      rows: withReports,
    };
  }, [benchmark]);

  /* ---------- KPI vs baseline ---------- */

  const baselineRows = useMemo(
    () =>
      baselines.map((b) => {
        const good = b.deltaPercent === null ? null : deltaIsGood(b.name, b.deltaPercent);
        return { ...b, good, higher: higherIsBetter(b.name) };
      }),
    [baselines],
  );

  /* ---------- Status muat ---------- */

  const loadingCore = dash.loading && !data;
  const coreError = dash.error;
  const perfError = insights.error;
  const personnelSummary = personnel.data?.summary ?? null;
  const personnelError = personnel.error;

  function reloadAll() {
    dash.reload();
    insights.reload();
    reports.reload();
    personnel.reload();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
        ANALISIS &gt; PERFORMANCE
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 20 }}>Performance</h1>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            Sumur aktif:{' '}
            <strong style={{ color: 'var(--text-primary)' }}>
              {activeWell.well?.name ?? (activeWell.loading ? 'Memuat sumur...' : 'Belum dipilih')}
            </strong>
            {activeWell.well?.fieldName ? ` - ${activeWell.well.fieldName}` : ''}
            {activeWell.well?.progressPercent !== null && activeWell.well?.progressPercent !== undefined
              ? ` - progres ${activeWell.well.progressPercent.toFixed(1)}% dari TD rencana`
              : ''}
          </p>
        </div>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {personnelSummary ? (
            <span
              className="tnum"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                height: 32,
                padding: '0 12px',
                borderRadius: 'var(--radius-badge)',
                background: 'var(--bg-surface-2)',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-secondary)',
              }}
              title={`POB: ${personnelSummary.inCount} on board, ${personnelSummary.outCount} keluar`}
            >
              <Users size={14} aria-hidden /> POB {personnelSummary.total}
            </span>
          ) : null}
          <Button
            variant="secondary"
            onClick={reloadAll}
            disabled={dash.loading || insights.loading}
            aria-label="Muat ulang seluruh data performance"
          >
            <RefreshCw size={16} aria-hidden /> {dash.loading ? 'Memuat...' : 'Muat Ulang'}
          </Button>
        </span>
      </div>

      {activeWell.error && (
        <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--danger-deep)' }}>
          Gagal memuat konteks sumur: {activeWell.error}
        </p>
      )}
      {personnelError && (
        <p role="status" style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
          Ringkasan POB tidak tersedia: {personnelError}
        </p>
      )}

      {/* ---------- KPI ---------- */}
      {loadingCore ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16 }} aria-busy="true">
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
      ) : coreError ? (
        <ErrorBox message={coreError} onRetry={() => dash.reload()} />
      ) : kpi ? (
        <KpiCardRow items={kpiItems} />
      ) : (
        <Card>
          <Muted>
            Belum ada data KPI untuk sumur ini. Buat DDR pertama di{' '}
            <Link href="/ddr" style={{ color: 'var(--accent-teal)', fontWeight: 700 }}>
              Daily Reports
            </Link>
            .
          </Muted>
        </Card>
      )}

      {/* ---------- ROP & NPT ---------- */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
        <Card>
          <SectionTitle
            icon={<Activity size={17} />}
            title="ROP & Progress"
            note="Rate of Penetration per laporan = progres 24 jam / 24"
            right={
              ropData.length > 0 ? (
                <span className="tnum" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  rata-rata {ropAverage.toFixed(2)} m/hr
                </span>
              ) : null
            }
          />
          {reports.error ? (
            <ErrorBox message={reports.error} onRetry={() => reports.reload()} />
          ) : reports.loading && ropData.length === 0 ? (
            <SkeletonBlock h={160} />
          ) : ropData.length === 0 ? (
            <Muted>Belum ada laporan untuk sumur ini sehingga ROP belum dapat dihitung.</Muted>
          ) : (
            <>
              <TrendBars
                data={ropData}
                height={150}
                showAverage
                averageLabel="rata-rata"
                valueLabel={(v) => `${v.toFixed(2)} m/hr`}
              />
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: 8,
                  marginTop: 12,
                  fontSize: 12,
                }}
              >
                <div>
                  <div className="field-label">ROP terbaru</div>
                  <div className="tnum" style={{ fontWeight: 700 }}>
                    {latestRop.toFixed(2)} m/hr
                  </div>
                </div>
                <div>
                  <div className="field-label">Total progres 24 jam</div>
                  <div className="tnum" style={{ fontWeight: 700 }}>
                    {formatMeters(totalProgress)}
                  </div>
                </div>
                <div>
                  <div className="field-label">Laporan dianalisis</div>
                  <div className="tnum" style={{ fontWeight: 700 }}>
                    {ropData.length}
                  </div>
                </div>
              </div>
            </>
          )}
        </Card>

        <Card>
          <SectionTitle
            icon={<Timer size={17} />}
            title="NPT Trend"
            note="Persentase waktu non-produktif (NPT + WOW) per hari laporan"
            right={
              nptData.length > 0 ? (
                <span className="tnum" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  rata-rata {safeAvg(nptData.map((d) => d.value)).toFixed(2)}%
                </span>
              ) : null
            }
          />
          {loadingCore ? (
            <SkeletonBlock h={150} />
          ) : nptData.length === 0 ? (
            <Muted>Belum ada tren NPT. Data muncul setelah ada minimal satu DDR tersimpan.</Muted>
          ) : (
            <TrendBars
              data={nptData}
              height={150}
              showAverage
              averageLabel="rata-rata"
              valueLabel={(v) => `${v.toFixed(2)}%`}
            />
          )}
        </Card>
      </div>

      {/* ---------- Time mix ---------- */}
      <Card>
        <SectionTitle
          icon={<Gauge size={17} />}
          title="Time Mix"
          note="Komposisi 24 jam laporan terbaru dalam jam dan persen"
        />
        {loadingCore ? (
          <>
            <SkeletonBlock h={20} />
            <div style={{ height: 10 }} />
            <SkeletonBlock h={120} />
          </>
        ) : timeMix ? (
          <TimeMixChart timeMix={timeMix} />
        ) : (
          <Muted>Belum ada time breakdown pada laporan terbaru untuk sumur ini.</Muted>
        )}
      </Card>

      {/* ---------- Benchmark antar sumur ---------- */}
      <Card>
        <SectionTitle
          icon={<Scale size={17} />}
          title="Benchmark Antar Sumur"
          note="Perbandingan rata-rata per sumur. Delta = selisih terhadap rata-rata seluruh sumur ber-laporan."
        />
        {insights.loading && benchmark.length === 0 ? (
          <SkeletonBlock h={140} />
        ) : perfError ? (
          <ErrorBox message={perfError} onRetry={() => insights.reload()} />
        ) : benchmarkRows.rows.length < 2 ? (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span aria-hidden style={{ color: 'var(--text-secondary)', display: 'inline-flex', marginTop: 1 }}>
              <TrendingUp size={16} />
            </span>
            <Muted>
              Benchmark memerlukan minimal 2 sumur dengan laporan. Saat ini tersedia {benchmarkRows.rows.length} sumur
              {benchmarkRows.rows.length === 1 ? ` (${benchmarkRows.rows[0].wellName})` : ''}. Impor sumur tambahan lewat{' '}
              <Link href="/reports" style={{ color: 'var(--accent-teal)', fontWeight: 700 }}>
                Reports Library
              </Link>
              .
            </Muted>
          </div>
        ) : (
          <div style={{ overflowX: 'auto', border: '1px solid var(--border-default)', borderRadius: 6 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <caption className="sr-only">
                Benchmark rata-rata NPT, ROP, dan biaya harian per sumur beserta delta terhadap rata-rata
              </caption>
              <thead>
                <tr style={{ background: 'var(--bg-surface-2)', textAlign: 'left' }}>
                  {[
                    { label: 'Sumur', align: 'left' as const },
                    { label: 'Laporan', align: 'right' as const },
                    { label: 'Rata-rata NPT %', align: 'right' as const },
                    { label: 'Delta NPT', align: 'right' as const },
                    { label: 'Rata-rata ROP (m/hr)', align: 'right' as const },
                    { label: 'Delta ROP', align: 'right' as const },
                    { label: 'Rata-rata Biaya Harian', align: 'right' as const },
                    { label: 'Delta Biaya', align: 'right' as const },
                  ].map((col) => (
                    <th
                      key={col.label}
                      scope="col"
                      style={{
                        padding: '0 12px',
                        height: 38,
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        color: 'var(--text-muted)',
                        textAlign: col.align,
                        whiteSpace: 'nowrap',
                        borderBottom: '1px solid var(--border-default)',
                      }}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {benchmarkRows.rows.map((row) => {
                  const dNpt = row.avgNptPercent - benchmarkRows.avgNpt;
                  const dRop = row.avgRopMHr - benchmarkRows.avgRop;
                  const dCost = row.avgDailyCost - benchmarkRows.avgCost;
                  const isActiveWell = row.wellId === wellId;
                  return (
                    <tr
                      key={row.wellId}
                      style={{
                        height: 44,
                        borderBottom: '1px solid var(--border-default)',
                        background: isActiveWell ? 'var(--bg-surface-2)' : undefined,
                      }}
                    >
                      <td style={{ padding: '0 12px', fontWeight: 600 }}>
                        {row.wellName}
                        {isActiveWell && (
                          <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--accent-teal)', fontWeight: 700 }}>
                            (aktif)
                          </span>
                        )}
                      </td>
                      <td className="tnum" style={{ padding: '0 12px', textAlign: 'right' }}>
                        {row.reportCount}
                      </td>
                      <td className="tnum" style={{ padding: '0 12px', textAlign: 'right' }}>
                        {row.avgNptPercent.toFixed(2)}%
                      </td>
                      <DeltaCell value={dNpt} digits={2} unit=" pp" goodWhenNegative showSign />
                      <td className="tnum" style={{ padding: '0 12px', textAlign: 'right' }}>
                        {row.avgRopMHr.toFixed(2)}
                      </td>
                      <DeltaCell value={dRop} digits={2} goodWhenNegative={false} showSign />
                      <td className="tnum" style={{ padding: '0 12px', textAlign: 'right' }}>
                        {formatUsd(row.avgDailyCost)}
                      </td>
                      <DeltaCell value={dCost} digits={0} goodWhenNegative showSign prefix="USD " />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ---------- KPI vs baseline ---------- */}
      <Card>
        <SectionTitle
          icon={<TrendingUp size={17} />}
          title="KPI vs Baseline"
          note="Hijau = membaik sesuai arah KPI, rose = memburuk. NPT % dan Cost per Meter: turun lebih baik. Rig Uptime: naik lebih baik."
        />
        {insights.loading && baselines.length === 0 ? (
          <SkeletonBlock h={110} />
        ) : perfError ? (
          <ErrorBox message={perfError} onRetry={() => insights.reload()} />
        ) : baselineRows.length === 0 ? (
          <Muted>
            Belum ada KPI yang dapat dibandingkan dengan nilai acuan. Tambahkan definisi KPI dan baseline lewat{' '}
            <Link href="/admin" style={{ color: 'var(--accent-teal)', fontWeight: 700 }}>
              Settings / Admin
            </Link>
            .
          </Muted>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            {baselineRows.map((b) => {
              const color =
                b.good === null ? 'var(--text-secondary)' : b.good ? 'var(--success)' : 'var(--danger)';
              const Icon = b.deltaPercent === null ? Minus : (b.deltaPercent ?? 0) > 0 ? ArrowUpRight : ArrowDownRight;
              const dirLabel =
                b.deltaPercent === null
                  ? 'tanpa baseline aktif'
                  : (b.deltaPercent ?? 0) === 0
                    ? 'sama dengan baseline'
                    : b.good === null
                      ? 'arah KPI netral'
                      : b.good
                        ? 'membaik'
                        : 'memburuk';
              return (
                <div
                  key={b.name}
                  style={{
                    border: '1px solid var(--border-default)',
                    borderRadius: 8,
                    padding: 12,
                    background: 'var(--bg-surface)',
                  }}
                >
                  <div className="field-label" style={{ marginBottom: 4 }}>
                    {b.name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <span className="tnum" style={{ fontSize: 22, fontWeight: 700 }}>
                      {b.actual.toFixed(2)}
                      {b.unit ? (
                        <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)' }}> {b.unit}</span>
                      ) : null}
                    </span>
                    {b.deltaPercent !== null && (
                      <span
                        className="tnum"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 13, fontWeight: 700, color }}
                      >
                        <Icon size={14} aria-hidden />
                        {signed(b.deltaPercent, 2)}%
                      </span>
                    )}
                  </div>
                  <div className="tnum" style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                    Baseline: {b.baseline === null ? '-' : `${b.baseline.toFixed(2)}${b.unit ? ` ${b.unit}` : ''}`}
                    {b.higher === null ? '' : b.higher ? ' - naik = baik' : ' - turun = baik'}
                  </div>
                  <div style={{ fontSize: 11, color, fontWeight: 700, marginTop: 2 }}>{dirLabel}</div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * Sel delta terhadap rata-rata.
 *
 * `goodWhenNegative` menentukan arah harapan: NPT dan biaya turun = baik
 * (hijau), ROP naik = baik (hijau). Delta nol dinetralkan.
 */
function DeltaCell({
  value,
  digits,
  unit = '',
  prefix = '',
  goodWhenNegative,
  showSign,
}: {
  value: number;
  digits: number;
  unit?: string;
  prefix?: string;
  goodWhenNegative: boolean;
  showSign: boolean;
}) {
  const isZero = Math.abs(value) < 10 ** -(digits + 1);
  const good = !isZero && (goodWhenNegative ? value < 0 : value > 0);
  const color = isZero ? 'var(--text-muted)' : good ? 'var(--success)' : 'var(--danger)';
  const Icon = isZero ? ArrowRight : value > 0 ? ArrowUpRight : ArrowDownRight;
  const text = isZero ? `0${unit}` : `${prefix}${showSign ? signed(value, digits) : value.toFixed(digits)}${unit}`;
  return (
    <td className="tnum" style={{ padding: '0 12px', textAlign: 'right', color, fontWeight: 700, whiteSpace: 'nowrap' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
        <Icon size={13} aria-hidden />
        {text}
      </span>
    </td>
  );
}
