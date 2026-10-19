'use client';
import { useMemo, useState } from 'react';
import { AlertTriangle, Calendar, CheckCheck, Download, Flag, Printer, Receipt, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card, KpiCard } from '@rigdaily/ui';
import { formatUsd, type Permission } from '@rigdaily/shared';
import { Note, inStyle } from '@/components/controls';
import { apiUrl } from '@/lib/api-client';
import { FlagEditorModal } from '@/components/BillingFlagEditor';
import { DataTable, type Column } from '@/components/DataTable';
import { currentMonthIsoLocal } from '@/lib/date';
import { useApi } from '@/lib/hooks/useApi';
import type { BillingRow, BillingSummary, ReportListItem, RigDto } from '@/lib/repo/types';

type ReportsList = { items: ReportListItem[]; total: number };
type MePayload = { user: { id: string; role: string }; permissions: Permission[] };

/** Bulan berjalan YYYY-MM dari laporan terbaru, fallback ke bulan WIB sistem. */
function resolveDefaultMonth(reports: ReportsList | null): string {
  const latestDate = reports?.items?.[0]?.reportDate ?? null;
  if (latestDate) return latestDate.slice(0, 7);
  // P1-4: `toISOString()` = UTC â†’ bulan bisa mundur pada 1 Jan 00:00-06:59 WIB.
  return currentMonthIsoLocal();
}

  /** Nama bulan panjang (Bahasa Indonesia) dari "YYYY-MM" untuk header periode. */
function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

export default function BillingPage() {
  const rigs = useApi<RigDto[]>('/api/rigs');
  const reports = useApi<ReportsList>('/api/reports?limit=1');
  const me = useApi<MePayload>('/api/auth/me');
  const canManageFlags = me.data?.permissions.includes('billing:manage') ?? false;

  const [selectedRigId, setSelectedRigId] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [flagRow, setFlagRow] = useState<BillingRow | null>(null);

  const rigList = rigs.data ?? [];
  const rigId = selectedRigId ?? (rigList.length > 0 ? rigList[0].id : null);
  const rig = rigList.find((r) => r.id === rigId) ?? null;
  const month = selectedMonth ?? resolveDefaultMonth(reports.data);

  /**
   * Laporan sumber untuk tombol Cetak. Billing baris = agregat per (tanggal, kode),
   * jadi PDF yang paling relevan adalah laporan tanggal terbaru pada periode terpilih.
   */
  const latestReportId = reports.data?.items?.[0]?.id ?? null;

  const billingPath = rigId && month ? `/api/billing?rigId=${rigId}&month=${month}` : null;
  const billing = useApi<BillingSummary>(billingPath);

  const rows = billing.data?.rows ?? [];
  const totals = billing.data?.totals ?? null;

  const disputedCount = useMemo(() => rows.filter((r) => r.disputed).length, [rows]);
  const forceMajeureCount = useMemo(() => rows.filter((r) => r.forceMajeure).length, [rows]);

  function exportCsv() {
    if (rows.length === 0) {
      toast.error('Tidak ada baris untuk diekspor.');
      return;
    }
    const header = 'date,reportNo,iadcCode,iadcName,hours,amount,forceMajeure,disputed,rebillable';
    const body = rows
      .map((r) =>
        [r.date, r.reportNo, r.iadcCode, r.iadcName, r.hours.toFixed(2), r.amount.toFixed(2), r.forceMajeure, r.disputed, r.rebillable]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(','),
      )
      .join('\n');
    const blob = new Blob([`${header}\n${body}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rigdaily-billing-${rig?.code ?? rigId ?? 'rig'}-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Billing ${month} diekspor (${rows.length} baris).`);
  }

  const columns: Column<BillingRow>[] = [
    { key: 'date', header: 'Tanggal', render: (r) => <span className="tnum">{r.date}</span> },
    {
      key: 'iadcCode',
      header: 'Kode & Nama IADC',
      render: (r) => (
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ background: 'var(--info-soft)', color: 'var(--info)', borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: 700 }}>{r.iadcCode}</span>
          <span>{r.iadcName}</span>
        </span>
      ),
    },
    { key: 'hours', header: 'Jam', align: 'right', render: (r) => r.hours.toFixed(2) },
    {
      key: 'amount',
      header: 'Nilai (USD)',
      align: 'right',
      render: (r) => <span style={{ color: r.disputed ? 'var(--danger)' : undefined, fontWeight: 600 }}>{formatUsd(r.amount)}</span>,
    },
    {
      key: 'flags',
      header: 'Penanda',
      render: (r) => {
        const flags: React.ReactNode[] = [];
        if (r.forceMajeure) {
          flags.push(
            <span key="fm" style={{ background: 'var(--warning-soft)', color: 'var(--warning)', borderRadius: 3, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>
              Force Majeure
            </span>,
          );
        }
        if (r.disputed) {
          flags.push(
            <span key="disp" style={{ background: 'var(--danger-soft)', color: 'var(--danger-deep)', borderRadius: 3, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>
              Disengketakan
            </span>,
          );
        }
        if (r.rebillable) {
          flags.push(
            <span key="reb" style={{ background: 'var(--info-soft)', color: 'var(--info)', borderRadius: 3, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>
              Dapat ditagih ulang
            </span>,
          );
        }
        return flags.length > 0 ? <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>{flags}</span> : <span style={{ color: 'var(--text-muted)' }}>-</span>;
      },
    },
    ...(canManageFlags
      ? [
          {
            key: 'actions',
            header: 'Aksi',
            width: 120,
            render: (r: BillingRow) => (
              <button
                type="button"
                onClick={() => setFlagRow(r)}
                aria-label={`Kelola flag billing ${r.date} kode ${r.iadcCode}`}
                style={{
                  display: 'inline-flex',
                  gap: 4,
                  alignItems: 'center',
                  height: 28,
                  padding: '0 8px',
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  borderRadius: 4,
                  border: '1px solid var(--border-default)',
                  background: '#fff',
                  color: 'var(--text-primary)',
                }}
              >
                <Flag size={13} aria-hidden /> Tandai
              </button>
            ),
          } satisfies Column<BillingRow>,
        ]
      : []),
  ];

  const loading = rigs.loading || billing.loading;
  const loadError = rigs.error ?? billing.error;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>
          Billing Bulanan &amp; Rekonsiliasi Dayrate {rig ? `- ${rig.name}` : ''}
        </h1>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
        {rig?.contractRef ? `Kontrak ${rig.contractRef} · ` : ''}
        {rig?.contractor ?? 'Kontrak rig'} · USD ($)
      </p>

      {/* Kontrol rig + bulan */}
      <Card>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 220 }}>
            <span className="field-label" style={{ marginBottom: 0 }}>Rig</span>
            <select
              style={{ ...inStyle(), width: 'auto' }}
              value={rigId ?? ''}
              onChange={(e) => setSelectedRigId(e.target.value)}
              aria-label="Pilih rig"
              disabled={rigs.loading}
            >
              {rigList.length === 0 ? <option value="">- belum ada rig -</option> : null}
              {rigList.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.code ? ` (${r.code})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="field-label" style={{ marginBottom: 0 }}>Bulan billing</span>
            <input
              type="month"
              style={{ ...inStyle(), width: 180 }}
              value={month}
              onChange={(e) => setSelectedMonth(e.target.value)}
              aria-label="Pilih bulan billing"
            />
          </label>
          <span className="tnum" style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, marginLeft: 'auto' }}>
            <Calendar size={14} /> {monthLabel(month)}
          </span>
          <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={exportCsv} disabled={rows.length === 0}>
              <Download size={16} /> Ekspor CSV
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (!latestReportId) {
                  toast.error('Belum ada laporan pada periode ini untuk dicetak.');
                  return;
                }
                window.open(apiUrl(`/api/reports/${latestReportId}/pdf?type=ddr`), '_blank', 'noopener');
              }}
              disabled={!latestReportId}
            >
              <Printer size={16} /> Cetak
            </Button>
          </span>
        </div>
      </Card>

      <Note kind="info">
        Nilai dihitung dari <strong>time breakdown × rate card (bertingkat)</strong> untuk rig &amp; bulan terpilih. Baris
        yang ditandai <strong>disengketakan</strong> tetap ditampilkan di ledger, tetapi nilainya <strong>tidak masuk total tagihan</strong>{' '}
        sampai sengketa diselesaikan.
        {canManageFlags ? ' Gunakan tombol Tandai pada setiap baris untuk menandai Disengketakan / Force Majeure / Dapat ditagih ulang.' : ''}
      </Note>

      {loadError && (
        <div role="alert" style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 8, padding: 12, color: 'var(--danger-deep)', fontSize: 13 }}>
          {loadError}
        </div>
      )}

      {loading ? (
        <div aria-busy="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <div aria-hidden style={{ height: 56, background: 'var(--bg-surface-2)', borderRadius: 4 }} />
            </Card>
          ))}
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 16 }}>
            <KpiCard label="Jam dapat ditagih" value={totals ? `${totals.billableHours.toFixed(2)} jam` : '-'} icon={<Calendar size={20} color="var(--accent-teal)" aria-hidden />} />
            <KpiCard label="Nilai tagihan" value={totals ? formatUsd(totals.amount) : '-'} icon={<Wallet size={20} color="var(--accent-teal)" aria-hidden />} sub={rig?.code ?? undefined} />
            <KpiCard
              label="Jam disengketakan"
              value={totals ? `${totals.disputedHours.toFixed(2)} jam` : '-'}
              valueColor={totals && totals.disputedHours > 0 ? 'var(--danger)' : undefined}
              icon={<AlertTriangle size={20} color="var(--danger)" aria-hidden />}
              sub={`${disputedCount} baris`}
            />
            <KpiCard
              label="Jam force majeure"
              value={totals ? `${totals.forceMajeureHours.toFixed(2)} jam` : '-'}
              icon={<AlertTriangle size={20} color="var(--warning)" aria-hidden />}
              sub={`${forceMajeureCount} baris`}
            />
            <KpiCard label="Nilai dapat ditagih ulang" value={totals ? formatUsd(totals.rebillableAmount) : '-'} icon={<Receipt size={20} color="var(--info)" aria-hidden />} />
          </div>

          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 16, margin: 0 }}>Ledger Billing</h2>
              <Badge kind="Draft">{rows.length} baris</Badge>
              {totals && <span className="tnum" style={{ marginLeft: 'auto', fontWeight: 800 }}>{formatUsd(totals.amount)}</span>}
            </div>
            <div style={{ marginTop: 8 }}>
              <DataTable columns={columns} rows={rows} rowKey={(r, i) => `${r.date}-${r.iadcCode}-${i}`} zebra maxHeight={520} empty="Belum ada baris billing untuk rig dan bulan ini. Pilih rig/bulan lain, atau pastikan laporan bulan ini sudah disetujui." />
            </div>

            {totals && rows.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, borderTop: '1px solid var(--border-default)', marginTop: 12, paddingTop: 12 }}>
                <TotalStat label="Jam dapat ditagih" value={`${totals.billableHours.toFixed(2)} jam`} tone="var(--success)" />
                <TotalStat label="Nilai tagihan" value={formatUsd(totals.amount)} tone="var(--text-primary)" />
                <TotalStat label="Jam disengketakan" value={`${totals.disputedHours.toFixed(2)} jam`} tone="var(--danger)" />
                <TotalStat label="Force majeure" value={`${totals.forceMajeureHours.toFixed(2)} jam`} tone="var(--warning)" />
                <TotalStat label="Dapat ditagih ulang" value={formatUsd(totals.rebillableAmount)} tone="var(--info)" />
              </div>
            )}

            <p style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 6, alignItems: 'center', marginTop: 12 }}>
              <CheckCheck size={14} color="var(--success)" />
              Total dihitung di server memakai rate card bertingkat (tanggal berlaku dihormati); nilai baris disengketakan tidak dijumlahkan ke total tagihan.
            </p>
          </Card>
        </>
      )}

      <FlagEditorModal
        open={flagRow !== null}
        row={flagRow}
        rigId={rigId}
        onClose={() => setFlagRow(null)}
        onSaved={() => billing.reload()}
      />
    </div>
  );
}

function TotalStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <div className="field-label" style={{ marginBottom: 2 }}>{label}</div>
      <div className="tnum" style={{ fontWeight: 800, color: tone }}>{value}</div>
    </div>
  );
}

