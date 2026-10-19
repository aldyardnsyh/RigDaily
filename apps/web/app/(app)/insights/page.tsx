'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, TrendingUp } from 'lucide-react';
import { Button, Card } from '@rigdaily/ui';
import { formatUsd } from '@rigdaily/shared';
import { BenchmarkTable, type WellBenchmarkRow } from '@/components/BenchmarkTable';
import { PillGroup } from '@/components/controls';
import { TrendBars } from '@/components/TrendBars';
import { useApi } from '@/lib/hooks/useApi';

/* ------------------------------------------------------------------ */
/* DTO (dideklarasikan lokal - lihat repo `insights.ts`)              */
/* ------------------------------------------------------------------ */

export type BaselineComparison = {
  name: string;
  actual: number;
  baseline: number | null;
  deltaPercent: number | null;
  unit: string | null;
};

export type KpiBaseline = {
  id: string;
  name: string;
  formula: string;
  baseline: number | null;
  unit: string | null;
  category: string | null;
};

type InsightsPayload = { benchmark: WellBenchmarkRow[]; baselines: BaselineComparison[]; kpiDefinitions: KpiBaseline[] };

type TrendMetric = 'npt' | 'cost' | 'depth' | 'rop';
type BenchmarkPayload = { metric: string; points: Array<{ date: string; value: number; wellName: string }> };

/* ------------------------------------------------------------------ */
/* Arah KPI: apakah nilai naik = membaik?                              */
/* ------------------------------------------------------------------ */

/**
 * Peta nama KPI → `higherIsBetter`.
 *
 * - "NPT %"          → naik = BURUK (false)
 * - "Cost per Meter" → naik = BURUK (false)
 * - "Rig Uptime %"   → naik = BAIK  (true)
 *
 * KPI lain tidak diasumsikan - fallback diperlakukan netral (abu) supaya
 * tidak salah warna. Pencocokan substring agar toleran variasi spasi kapital.
 */
function higherIsBetter(kpiName: string): boolean | null {
  const n = kpiName.toLowerCase();
  if (n.includes('npt')) return false;
  if (n.includes('cost per meter')) return false;
  if (n.includes('uptime')) return true;
  return null;
}

/** Tentukan apakah delta menunjukkan perbaikan secara arah KPI. */
function deltaIsGood(kpiName: string, deltaPercent: number): boolean | null {
  const hib = higherIsBetter(kpiName);
  if (hib === null || deltaPercent === 0) return null;
  return hib ? deltaPercent > 0 : deltaPercent < 0;
}

const TONE_COLOR = {
  good: 'var(--success)',
  bad: 'var(--danger)',
  neutral: 'var(--text-secondary)',
} as const;

/* ------------------------------------------------------------------ */
/* Metrik tren                                                         */
/* ------------------------------------------------------------------ */

const METRIC_OPTIONS: Array<{ id: TrendMetric; label: string }> = [
  { id: 'npt', label: 'NPT %' },
  { id: 'cost', label: 'Biaya Harian' },
  { id: 'depth', label: 'Kedalaman' },
  { id: 'rop', label: 'ROP m/hr' },
];

const METRIC_VALUE_LABEL: Record<TrendMetric, (v: number) => string> = {
  npt: (v) => `${v.toFixed(2)}%`,
  cost: (v) => formatUsd(v),
  depth: (v) => `${v.toFixed(2)} m`,
  rop: (v) => `${v.toFixed(2)} m/hr`,
};

const METRIC_TITLE: Record<TrendMetric, string> = {
  npt: 'Tren NPT % harian',
  cost: 'Tren biaya harian (USD)',
  depth: 'Tren progres 24 jam (m)',
  rop: 'Tren ROP (m/hr)',
};

/** `YYYY-MM-DD` → `10 Sep`. */
function shortDate(value: string): string {
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function signed(value: number, digits = 2): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}`;
}

/* ------------------------------------------------------------------ */
/* Skeleton / error                                                    */
/* ------------------------------------------------------------------ */

function SkeletonBlock({ h }: { h: number }) {
  return <div aria-hidden style={{ height: h, background: 'var(--bg-surface-2)', borderRadius: 4 }} />;
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

/* ------------------------------------------------------------------ */
/* Insight callout (dihitung dari data nyata)                          */
/* ------------------------------------------------------------------ */

/**
 * Susun kalimat insight NPT dari benchmark + baseline nyata.
 *
 * Mengambil sumur dengan `avgNptPercent` tertinggi dan baseline "NPT %" dari
 * `/api/insights`. Kalimat HANYA dibuat bila angka tersedia; tidak ada nama
 * atau angka yang di-hardcode.
 */
function buildNptInsight(benchmark: WellBenchmarkRow[], baselines: BaselineComparison[]): string | null {
  const withReports = benchmark.filter((b) => b.reportCount > 0);
  if (withReports.length === 0) return null;

  const worst = withReports.reduce((acc, b) => (b.avgNptPercent > acc.avgNptPercent ? b : acc), withReports[0]);
  const baselineNpt = baselines.find((b) => b.name.toLowerCase().includes('npt') && b.baseline !== null && b.baseline !== 0);

  if (!baselineNpt || baselineNpt.baseline === null || baselineNpt.baseline === 0) {
    return `${worst.wellName} mencatat NPT ${worst.avgNptPercent.toFixed(2)}% (belum ada baseline NPT aktif untuk perbandingan).`;
  }

  const delta = ((worst.avgNptPercent - baselineNpt.baseline) / baselineNpt.baseline) * 100;
  const dir = delta > 0 ? 'di atas' : 'di bawah';
  return `${worst.wellName} mencatat NPT ${worst.avgNptPercent.toFixed(2)}% - ${Math.abs(delta).toFixed(0)}% ${dir} baseline ${baselineNpt.baseline.toFixed(2)}%.`;
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function InsightsPage() {
  const insights = useApi<InsightsPayload>('/api/insights');
  const [metric, setMetric] = useState<TrendMetric>('npt');
  const trend = useApi<BenchmarkPayload>(`/api/insights/benchmark?metric=${metric}&days=30`);

  const benchmark = insights.data?.benchmark ?? [];
  const baselines = insights.data?.baselines ?? [];

  const insightText = useMemo(() => buildNptInsight(benchmark, baselines), [benchmark, baselines]);

  const trendData = useMemo(
    () =>
      (trend.data?.points ?? []).map((p) => ({
        label: `${shortDate(p.date)} · ${p.wellName}`,
        value: p.value,
        tone: metric === 'npt' && p.value > 0 ? ('danger' as const) : ('default' as const),
      })),
    [trend.data, metric],
  );

  const loading = insights.loading && !insights.data;
  const loadError = insights.error;
  const needMoreWells = !insights.loading && benchmark.length < 2;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>OPERASIONAL &gt; INSIGHT &amp; BENCHMARKING</p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Insight - Kinerja Sumur</h1>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            KPI aktual vs baseline, tren metrik, dan benchmark antar sumur dari DDR tersimpan.
          </p>
        </div>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button
            variant="secondary"
            onClick={() => {
              insights.reload();
              trend.reload();
            }}
            disabled={insights.loading || trend.loading}
          >
            <RefreshCw size={16} aria-hidden /> {insights.loading ? 'Memuat...' : 'Muat Ulang'}
          </Button>
        </span>
      </div>

      {loadError && <ErrorBox message={loadError} onRetry={() => insights.reload()} />}

      {loading ? (
        <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <SkeletonBlock h={64} />
              </Card>
            ))}
          </div>
          <Card>
            <SkeletonBlock h={180} />
          </Card>
        </div>
      ) : (
        !loadError && (
          <>
            {/* KPI vs Baseline */}
            <Card>
              <h2 style={{ fontSize: 16, margin: '0 0 4px' }}>KPI vs Nilai Acuan</h2>
              <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-secondary)' }}>
                Delta diwarnai sesuai arah KPI: hijau bila membaik, rose bila memburuk.
              </p>
              {baselines.length === 0 ? (
                <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                  Belum ada KPI yang bisa dibandingkan dengan nilai acuan. Tambahkan definisi KPI dan nilai acuannya lewat Admin.
                </p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                  {baselines.map((b) => {
                    const hasDelta = b.deltaPercent !== null;
                    const good = hasDelta ? deltaIsGood(b.name, b.deltaPercent as number) : null;
                    const tone = good === null ? 'neutral' : good ? 'good' : 'bad';
                    const unit = b.unit ?? '';
                    const hib = higherIsBetter(b.name);
                    return (
                      <div
                        key={b.name}
                        style={{ border: '1px solid var(--border-default)', borderRadius: 8, padding: 12 }}
                      >
                        <div className="field-label" style={{ marginBottom: 4 }}>
                          {b.name}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                          <span className="tnum" style={{ fontSize: 22, fontWeight: 700 }}>
                            {b.actual.toFixed(2)}
                            {unit ? <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)' }}> {unit}</span> : null}
                          </span>
                          {hasDelta && (
                            <span className="tnum" style={{ fontSize: 13, fontWeight: 700, color: TONE_COLOR[tone] }}>
                              {signed(b.deltaPercent as number)}%
                            </span>
                          )}
                        </div>
                        <div className="tnum" style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                          Nilai acuan: {b.baseline === null ? '-' : `${b.baseline.toFixed(2)}${unit ? ` ${unit}` : ''}`}
                          {hib !== null ? ` · ${hib ? 'naik = baik' : 'naik = buruk'}` : ''}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* Insight callout */}
            {insightText && (
              <Card>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span aria-hidden style={{ color: 'var(--warning)', display: 'inline-flex', marginTop: 1 }}>
                    <AlertTriangle size={18} />
                  </span>
                  <div>
                    <div className="field-label" style={{ marginBottom: 2 }}>Insight NPT</div>
                    <p className="tnum" style={{ margin: 0, fontSize: 13, color: 'var(--text-primary)' }}>
                      {insightText}
                    </p>
                  </div>
                </div>
              </Card>
            )}

            {/* Metrik toggle + TrendBars */}
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                <h2 style={{ fontSize: 16, margin: 0 }}>{METRIC_TITLE[metric]}</h2>
              </div>
              <div style={{ marginBottom: 12 }}>
                <PillGroup
                  options={METRIC_OPTIONS}
                  value={metric}
                  onChange={(v) => setMetric(v)}
                  ariaLabel="Pilih metrik tren"
                />
              </div>
              {trend.error ? (
                <ErrorBox message={trend.error} onRetry={() => trend.reload()} />
              ) : trend.loading && trendData.length === 0 ? (
                <SkeletonBlock h={160} />
              ) : trendData.length === 0 ? (
                <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                  Belum ada titik data untuk metrik ini. Pilih metrik lain atau pastikan sudah ada DDR tersimpan.
                </p>
              ) : (
                <TrendBars data={trendData} height={170} valueLabel={METRIC_VALUE_LABEL[metric]} />
              )}
            </Card>

            {/* Benchmark table + empty state jujur */}
            {needMoreWells ? (
              <Card>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span aria-hidden style={{ color: 'var(--text-secondary)', display: 'inline-flex', marginTop: 1 }}>
                    <TrendingUp size={18} />
                  </span>
                  <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                    Perbandingan antar sumur memerlukan minimal 2 sumur. Saat ini tersedia {benchmark.length} sumur
                    {benchmark.length === 1 ? ` (${benchmark[0].wellName})` : ''}. Tambahkan sumur lewat{' '}
                    <Link href="/reports" style={{ color: 'var(--accent-teal)', fontWeight: 700 }}>
                      Perpustakaan Laporan &gt; Impor CSV Legacy
                    </Link>
                    .
                  </p>
                </div>
              </Card>
            ) : (
              <BenchmarkTable rows={benchmark} />
            )}
          </>
        )
      )}
    </div>
  );
}
