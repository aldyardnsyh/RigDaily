'use client';
import Link from 'next/link';
import { Users } from 'lucide-react';
import { Button, Card } from '@rigdaily/ui';
import { KpiCardRow, type KpiCardItem } from '@/components/KpiCardRow';
import { PersonnelTable, type PersonnelDto } from '@/components/PersonnelTable';
import { useApi } from '@/lib/hooks/useApi';

/** Ringkasan POB dari `GET /api/personnel` (lihat repo `PobSummary`). */
type PobSummary = {
  total: number;
  inCount: number;
  outCount: number;
  manHours: number;
  byCompany: Array<{ company: string; count: number }>;
  byMuster: Array<{ station: string; count: number }>;
};

type PersonnelPayload = { items: PersonnelDto[]; summary: PobSummary };

/** Jam kerja ringkas: 1.234,50 jam dengan pemisah ribuan. */
function formatManHours(value: number): string {
  return `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} jam`;
}

/**
 * Bar horizontal sederhana untuk hitungan ORANG (bukan uang).
 *
 * `MoneyBar` dari komponen bersama selalu memformat nilai dengan `formatUsd()`,
 * sehingga tidak cocok untuk POB. Bar ini proporsional terhadap `max` (= count
 * tertinggi) dan menampilkan jumlah orang apa adanya.
 */
function CountBar({ label, count, max }: { label: string; count: number; max: number }) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
  const pct = Math.max(0, Math.min(100, (count / safeMax) * 100));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
        <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span className="tnum" style={{ fontWeight: 700 }}>
          {count} orang
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={count}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-label={`${label}: ${count} orang`}
        style={{ height: 8, background: 'var(--bg-surface-2)', borderRadius: 999, overflow: 'hidden' }}
      >
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent-teal)', borderRadius: 999 }} />
      </div>
    </div>
  );
}

function BreakdownCard({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; count: number }>;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return (
    <Card>
      <h2 style={{ fontSize: 16, margin: '0 0 10px' }}>{title}</h2>
      {rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Belum ada data untuk ditampilkan.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((r) => (
            <li key={r.label}>
              <CountBar label={r.label} count={r.count} max={max} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function PersonnelPage() {
  const personnel = useApi<PersonnelPayload>('/api/personnel?limit=500');

  const items = personnel.data?.items ?? [];
  const summary = personnel.data?.summary ?? null;

  const kpiItems: KpiCardItem[] = [
    {
      label: 'Total POB',
      value: summary ? String(summary.total) : '-',
      sub: 'Personel tercatat pada laporan aktif',
      tone: 'default',
    },
    {
      label: 'Di Rig (On Board)',
      value: summary ? String(summary.inCount) : '-',
      sub: 'Status mustering: di dalam rig',
      tone: 'success',
    },
    {
      label: 'Sudah Keluar (Signed Out)',
      value: summary ? String(summary.outCount) : '-',
      sub: 'Sudah keluar / demobilisasi',
      tone: summary && summary.outCount > 0 ? 'warning' : 'default',
    },
    {
      label: 'Man-Hours',
      value: summary ? formatManHours(summary.manHours) : '-',
      sub: 'Akumulasi jam kerja personel',
      tone: 'default',
    },
  ];

  const companyRows = (summary?.byCompany ?? []).map((c) => ({ label: c.company, count: c.count }));
  const musterRows = (summary?.byMuster ?? []).map((m) => ({ label: m.station, count: m.count }));
  const companies = (summary?.byCompany ?? []).map((c) => c.company);

  const loading = personnel.loading && !personnel.data;
  const error = personnel.error;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>KESELAMATAN &amp; SURVEY &gt; PERSONEL &amp; POB</p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Personel &amp; POB</h1>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            Daftar personel di rig (POB) dan mustering dari laporan Daily Drilling Report.
          </p>
        </div>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={() => personnel.reload()} disabled={personnel.loading}>
            <Users size={16} aria-hidden /> {personnel.loading ? 'Memuat...' : 'Muat Ulang'}
          </Button>
        </span>
      </div>

      {error && (
        <div
          role="alert"
          style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 8, padding: 12, color: 'var(--danger-deep)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
        >
          <span>{error}</span>
          <Button variant="secondary" onClick={() => personnel.reload()}>
            Coba lagi
          </Button>
        </div>
      )}

      {loading ? (
        <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <div aria-hidden style={{ height: 52, background: 'var(--bg-surface-2)', borderRadius: 4 }} />
              </Card>
            ))}
          </div>
          <Card>
            <div aria-hidden style={{ height: 220, background: 'var(--bg-surface-2)', borderRadius: 6 }} />
          </Card>
        </div>
      ) : items.length === 0 ? (
        <Card>
          <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
            Belum ada data POB untuk laporan ini. Tambahkan data kru pada{' '}
            <Link href="/ddr" style={{ color: 'var(--accent-teal)', fontWeight: 700 }}>
              Daily Drilling Report
            </Link>
            .
          </p>
        </Card>
      ) : (
        <>
          <KpiCardRow items={kpiItems} />

          <PersonnelTable items={items} companies={companies} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <BreakdownCard title="Per Perusahaan" rows={companyRows} />
            <BreakdownCard title="Per Muster Station" rows={musterRows} />
          </div>
        </>
      )}
    </div>
  );
}
