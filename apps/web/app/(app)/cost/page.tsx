'use client';
import { useCallback, useMemo, useState } from 'react';
import { Plus, Trash2, TrendingUp, Wallet, Target, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card, KpiCard } from '@rigdaily/ui';
import { COST_CATEGORIES, formatUsd } from '@rigdaily/shared';
import { Labeled, Modal, Note, inStyle } from '@/components/controls';
import { StatusBadge } from '@/components/StatusBadge';
import { apiSend } from '@/lib/api-client';
import { useApi } from '@/lib/hooks/useApi';
import { useActiveWell } from '@/lib/hooks/useActiveWell';
import type {
  CostLineDto,
  DashboardKpi,
  ReportDetail,
  ReportListItem,
  TimeMix,
  TrendPoint,
  WellDto,
} from '@/lib/repo/types';

type ReportsList = { items: ReportListItem[]; total: number };
type CostsPayload = { reportId: string; lines: CostLineDto[]; dailyTotal: number; cumulativeTotal: number };
type DashboardPayload = {
  kpi: DashboardKpi;
  reports: ReportListItem[];
  trend: TrendPoint[];
  timeMix: TimeMix | null;
  wellId: string | null;
};

const CATEGORY_OPTIONS = COST_CATEGORIES as readonly string[];
/** Jumlah titik tren yang diminta ke API - server yang memotong, klien tidak. */
const TREND_DAYS = 14;

export default function CostPage() {
  const activeWell = useActiveWell();
  const wells = activeWell.wells;
  const wellId = activeWell.wellId;
  const well = wells.find((w) => w.id === wellId) ?? null;

  const reportsList = useApi<ReportsList>(wellId ? `/api/reports?wellId=${wellId}&limit=1` : null);
  const latest = reportsList.data?.items?.[0] ?? null;
  const reportId = latest?.id ?? null;

  const detail = useApi<ReportDetail>(reportId ? `/api/reports/${reportId}` : null);
  const costs = useApi<CostsPayload>(reportId ? `/api/reports/${reportId}/costs` : null);
  const dash = useApi<DashboardPayload>(wellId ? `/api/dashboard?wellId=${wellId}&days=${TREND_DAYS}` : null);

  const report = detail.data;
  const kpi = dash.data?.kpi ?? null;
  // P1-3: server SUDAH mengembalikan tepat `days` titik - jangan slice lagi.
  const trend = useMemo(() => dash.data?.trend ?? [], [dash.data]);
  const lines = costs.data?.lines ?? report?.costLines ?? [];

  const isDraft = report?.status === 'draft';

  /* ---------- derived KPI (semua dari API) ---------- */
  const dailyCost = kpi?.dailyCost ?? costs.data?.dailyTotal ?? report?.costDailyUsd ?? 0;
  const cumulativeCost = kpi?.cumulativeCost ?? costs.data?.cumulativeTotal ?? report?.costCumulativeUsd ?? 0;
  const afeBudget = kpi?.afeBudget ?? well?.afeBudgetUsd ?? null;
  // P1-2: `afeConsumedPercent` dari KPI bisa null (mis. `/api/dashboard` gagal).
  // Fallback = kumulatif ÷ budget, dengan sumber kumulatif yang SAMA
  // (`costs.data.cumulativeTotal` = sum cost line) sehingga angka tidak berbeda.
  const consumedPct =
    kpi?.afeConsumedPercent ?? (afeBudget != null && afeBudget > 0 ? (cumulativeCost / afeBudget) * 100 : null);
  const variance = afeBudget != null ? afeBudget - cumulativeCost : null;

  const catTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of lines) map.set(l.category, (map.get(l.category) ?? 0) + l.amount);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [lines]);

  const maxTrendCost = useMemo(() => trend.reduce((m, p) => Math.max(m, p.dailyCost), 0) || 1, [trend]);

  /* ---------- reload after mutation ---------- */
  const reloadAll = useCallback(() => {
    costs.reload();
    detail.reload();
    dash.reload();
    reportsList.reload();
  }, [costs.reload, detail.reload, dash.reload, reportsList.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- add cost modal ---------- */
  const emptyForm = { category: CATEGORY_OPTIONS[0] ?? 'Drilling', description: '', vendor: '', afeCode: '', amount: '', rebillable: false };
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(emptyForm);

  async function addLine() {
    if (!report) return;
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      toast.error('Nominal harus berupa angka dan tidak boleh 0.');
      return;
    }
    if (!form.description.trim()) {
      toast.error('Deskripsi baris biaya wajib diisi.');
      return;
    }
    setBusy(true);
    try {
      await apiSend(`/api/reports/${report.id}/costs`, 'POST', {
        category: form.category,
        description: form.description.trim(),
        vendor: form.vendor.trim() ? form.vendor.trim() : null,
        afeCode: form.afeCode.trim() ? form.afeCode.trim() : null,
        billingType: null,
        amount,
        rebillable: form.rebillable,
      });
      toast.success('Baris biaya ditambahkan.');
      setAddOpen(false);
      setForm(emptyForm);
      reloadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menambah baris biaya. Periksa nominal dan deskripsi lalu coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteLine(id: string) {
    if (!report) return;
    setBusy(true);
    try {
      await apiSend(`/api/reports/${report.id}/costs?costLineId=${encodeURIComponent(id)}`, 'DELETE');
      toast.success('Baris biaya dihapus.');
      reloadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus baris biaya. Coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  const loading = activeWell.loading || reportsList.loading;
  const loadError = activeWell.error ?? reportsList.error ?? dash.error ?? detail.error ?? costs.error;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Ledger Biaya &amp; AFE {report ? `- DDR #${report.reportNo}` : ''}</h1>
        {report && <StatusBadge status={report.status} />}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button onClick={() => setAddOpen(true)} disabled={!isDraft || busy}>
            <Plus size={16} /> Tambah Baris Biaya
          </Button>
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
        {report ? `Sumur ${report.wellName}${report.rigName ? ` · Rig ${report.rigName}` : ''} · ${report.reportDate}` : 'Memuat...'}
      </p>

      {loadError && (
        <div role="alert" style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 8, padding: 12, color: 'var(--danger-deep)', fontSize: 13 }}>
          {loadError}
        </div>
      )}

      {!isDraft && report && <Note kind="info">Laporan berstatus {report.status} - baris biaya hanya bisa diubah lewat amendemen.</Note>}

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }} aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <div aria-hidden style={{ height: 56, background: 'var(--bg-surface-2)', borderRadius: 4 }} />
            </Card>
          ))}
        </div>
      ) : (
        <>
          {/* KPI */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
            <KpiCard label="Biaya Harian" value={formatUsd(dailyCost)} icon={<Wallet size={18} color="var(--accent-teal)" />} sub="24 jam terakhir" />
            <KpiCard label="Kumulatif" value={formatUsd(cumulativeCost)} icon={<TrendingUp size={18} color="var(--info)" />} sub="Total sumur sampai saat ini" />
            <KpiCard
              label="Anggaran AFE"
              value={afeBudget != null ? formatUsd(afeBudget) : '-'}
              icon={<Target size={18} color="var(--accent-teal)" />}
              progress={consumedPct ?? undefined}
              sub={consumedPct != null ? `${consumedPct.toFixed(2)}% terpakai` : 'Belum ada AFE'}
            />
            <KpiCard
              label="Selisih"
              value={variance != null ? formatUsd(variance) : '-'}
              valueColor={variance != null && variance < 0 ? 'var(--danger)' : 'var(--success)'}
              icon={<Receipt size={18} color="var(--text-secondary)" />}
              sub={afeBudget != null && consumedPct != null ? `AFE ${consumedPct.toFixed(2)}% terpakai` : '-'}
            />
          </div>

          {/* 14-day trend bar chart (div, tanpa library) */}
          <Card>
            <h2 style={{ fontSize: 16, margin: '0 0 4px' }}>Tren Biaya Harian</h2>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px' }}>{trend.length} laporan</p>
            {trend.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Belum ada data tren biaya. Data muncul setelah ada DDR dengan baris biaya.</p>
            ) : (
              <div
                role="img"
                aria-label="Grafik batang biaya harian 14 hari"
                style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120, overflowX: 'auto', paddingTop: 4 }}
              >
                {trend.map((p) => {
                  const h = Math.max(2, (p.dailyCost / maxTrendCost) * 100);
                  return (
                    <div
                      key={p.date}
                      title={`${p.date}: ${formatUsd(p.dailyCost)}`}
                      style={{ flex: '1 0 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 18 }}
                    >
                      <div style={{ width: '100%', height: `${h}%`, minHeight: 2, background: 'var(--accent-teal)', borderRadius: '2px 2px 0 0' }} />
                      <span style={{ fontSize: 9, color: 'var(--text-muted)', writingMode: 'vertical-rl', height: 32 }}>{p.date.slice(5)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
            {/* Cost lines table */}
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: 16, margin: 0 }}>Baris Biaya</h2>
                <Badge kind="Draft">{lines.length} baris</Badge>
                <span style={{ marginLeft: 'auto' }} className="tnum">
                  <strong>{formatUsd(costs.data?.dailyTotal ?? lines.reduce((a, l) => a + l.amount, 0))}</strong>
                </span>
              </div>
              <div style={{ overflowX: 'auto', marginTop: 8 }}>
                <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', fontSize: 12, color: 'var(--text-muted)' }}>
                      <th>Kategori</th>
                      <th>Deskripsi</th>
                      <th>Vendor</th>
                      <th>AFE</th>
                      <th style={{ textAlign: 'right' }}>Nilai (USD)</th>
                      <th style={{ width: 52 }}>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ padding: '8px 0', color: 'var(--text-muted)' }}>
                          Belum ada baris biaya. Tambahkan lewat tombol Tambah Baris Biaya.
                        </td>
                      </tr>
                    ) : (
                      lines.map((l) => (
                        <tr key={l.id} style={{ height: 'var(--row-h)' }}>
                          <td>
                            <strong>{l.category}</strong>
                          </td>
                          <td>
                            {l.description}
                            {l.rebillable ? (
                              <span style={{ marginLeft: 6, background: 'var(--info-soft)', color: 'var(--info)', borderRadius: 999, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>
                                Rebill
                              </span>
                            ) : null}
                          </td>
                          <td>{l.vendor ?? '-'}</td>
                          <td className="tnum">{l.afeCode ?? '-'}</td>
                          <td className="tnum" style={{ textAlign: 'right' }}>
                            {formatUsd(l.amount)}
                          </td>
                          <td>
                            <button
                              type="button"
                              aria-label={`Hapus baris biaya ${l.category}`}
                              onClick={() => deleteLine(l.id)}
                              disabled={!isDraft || busy}
                              style={{ background: 'none', border: 'none', cursor: isDraft && !busy ? 'pointer' : 'not-allowed', color: 'var(--danger)', padding: 4 }}
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Category breakdown */}
            <Card>
              <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Per Kategori</h2>
              {catTotals.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Belum ada baris biaya untuk dikelompokkan.</p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {catTotals.map(([cat, amt]) => {
                    const pct = dailyCost > 0 ? (amt / dailyCost) * 100 : 0;
                    return (
                      <li key={cat}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                          <span>{cat}</span>
                          <span className="tnum">{formatUsd(amt)}</span>
                        </div>
                        <div
                          role="progressbar"
                          aria-valuenow={Math.round(pct)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`Porsi ${cat}`}
                          style={{ height: 6, background: 'var(--bg-surface-2)', borderRadius: 999, marginTop: 4 }}
                        >
                          <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: 'var(--accent-teal)', borderRadius: 999 }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}

      {/* Add cost modal */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Tambah Baris Biaya">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Labeled label="Kategori">
            <select style={inStyle()} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Labeled>
          <Labeled label="Nominal (USD)">
            <input className="tnum" style={inStyle()} inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </Labeled>
        </div>
        <div style={{ marginTop: 12 }}>
          <Labeled label="Deskripsi">
            <input style={inStyle()} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Labeled>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <Labeled label="Vendor (opsional)">
            <input style={inStyle()} value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
          </Labeled>
          <Labeled label="Kode AFE (opsional)">
            <input style={inStyle()} value={form.afeCode} onChange={(e) => setForm({ ...form, afeCode: e.target.value })} />
          </Labeled>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, fontSize: 13 }}>
          <input type="checkbox" checked={form.rebillable} onChange={(e) => setForm({ ...form, rebillable: e.target.checked })} /> Dapat ditagih ulang
        </label>
        <p style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Button onClick={addLine} disabled={busy}>
            {busy ? 'Menyimpan...' : 'Tambah'}
          </Button>
          <Button variant="secondary" onClick={() => setAddOpen(false)}>
            Batal
          </Button>
        </p>
      </Modal>
    </div>
  );
}
