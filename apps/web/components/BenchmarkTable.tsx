'use client';
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Card } from '@rigdaily/ui';
import { formatUsd } from '@rigdaily/shared';

/**
 * Bentuk DTO dari `GET /api/insights` (lihat repo `WellBenchmarkRow`).
 *
 * Dideklarasikan lokal (bukan import dari `@/lib/repo` yang `server-only`)
 * agar komponen client bebas impor tanpa menarik kode server ke bundle.
 */
export type WellBenchmarkRow = {
  wellId: string;
  wellName: string;
  wellType: string;
  phase: string;
  reportCount: number;
  avgDepthProgress: number;
  avgNptPercent: number;
  avgDailyCost: number;
  totalCost: number;
  daysDrilling: number;
  avgRopMHr: number;
  lastReportDate: string | null;
};

/**
 * BenchmarkTable - perbandingan kinerja antar sumur.
 *
 * Sortable di klien per kolom (klik header). Tidak memakai `DataTable` karena
 * butuh header interaktif (tombol sort + aria-sort) dan pewarnaan baris
 * khusus NPT tertinggi/terendah. Angka memakai `className="tnum"`.
 *
 * Pewarnaan baris:
 * - NPT tertinggi  → latar `--danger-soft` (rose) - perlu perhatian.
 * - NPT terendah   → latar `--success-soft` (hijau) - pembanding terbaik.
 * Hanya sumur yang sudah punya laporan (reportCount > 0) yang ikut ditandai,
 * agar sumur kosong tidak salah dianggap "NPT terendah".
 */

type SortKey =
  | 'wellName'
  | 'wellType'
  | 'phase'
  | 'reportCount'
  | 'avgDepthProgress'
  | 'avgNptPercent'
  | 'avgRopMHr'
  | 'avgDailyCost'
  | 'totalCost'
  | 'lastReportDate';

type SortDir = 'asc' | 'desc';

const COLUMNS: Array<{ key: SortKey; header: string; align: 'left' | 'right'; width?: number }> = [
  { key: 'wellName', header: 'Sumur', align: 'left' },
  { key: 'wellType', header: 'Tipe', align: 'left' },
  { key: 'phase', header: 'Fase', align: 'left' },
  { key: 'reportCount', header: 'Jumlah Laporan', align: 'right', width: 90 },
  { key: 'avgDepthProgress', header: 'Rata-rata Progres (m)', align: 'right' },
  { key: 'avgNptPercent', header: 'Rata-rata NPT %', align: 'right' },
  { key: 'avgRopMHr', header: 'Rata-rata ROP (m/jam)', align: 'right' },
  { key: 'avgDailyCost', header: 'Rata-rata Biaya Harian', align: 'right' },
  { key: 'totalCost', header: 'Total Biaya', align: 'right' },
  { key: 'lastReportDate', header: 'Laporan Terakhir', align: 'right' },
];

/** Nilai pembanding untuk sorting; tanggal kosong dianggap paling kecil. */
function sortValue(row: WellBenchmarkRow, key: SortKey): number | string {
  switch (key) {
    case 'wellName':
      return row.wellName;
    case 'wellType':
      return row.wellType;
    case 'phase':
      return row.phase;
    case 'lastReportDate':
      return row.lastReportDate ?? '';
    default:
      return row[key];
  }
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
      <span aria-hidden style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: color }} />
      {label}
    </span>
  );
}

export function BenchmarkTable({ rows }: { rows: WellBenchmarkRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('wellName');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Kolom teks naik A→Z; kolom angka mulai dari nilai terbesar dulu.
      setSortDir(key === 'wellName' || key === 'wellType' || key === 'phase' ? 'asc' : 'desc');
    }
  }

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [rows, sortKey, sortDir]);

  // Sumur dengan NPT tertinggi/terendah (hanya yang punya laporan).
  const { maxNptWellId, minNptWellId } = useMemo(() => {
    const withReports = rows.filter((r) => r.reportCount > 0);
    if (withReports.length === 0) return { maxNptWellId: null as string | null, minNptWellId: null as string | null };
    let max = withReports[0];
    let min = withReports[0];
    for (const r of withReports) {
      if (r.avgNptPercent > max.avgNptPercent) max = r;
      if (r.avgNptPercent < min.avgNptPercent) min = r;
    }
    // Bila semua sama, jangan tandai apa pun (tidak ada pembanding).
    if (max.avgNptPercent === min.avgNptPercent) {
      return { maxNptWellId: null as string | null, minNptWellId: null as string | null };
    }
    return { maxNptWellId: max.wellId, minNptWellId: min.wellId };
  }, [rows]);

  const showHighlightLegend = maxNptWellId !== null && minNptWellId !== null;

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Benchmark Antar Sumur</h2>
        <span className="tnum" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {rows.length} sumur
        </span>
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-secondary)' }}>
        Klik judul kolom untuk mengurutkan. Angka diturunkan dari DDR tersimpan (nilai layar = nilai PDF).
      </p>

      {showHighlightLegend && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
          <LegendSwatch color="var(--danger-soft)" label="NPT tertinggi (perlu perhatian)" />
          <LegendSwatch color="var(--success-soft)" label="NPT terendah (pembanding terbaik)" />
        </div>
      )}

      <div style={{ overflowX: 'auto', border: '1px solid var(--border-default)', borderRadius: 6 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {COLUMNS.map((col) => {
                const active = col.key === sortKey;
                const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
                const ariaSort = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={ariaSort}
                    style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 1,
                      background: 'var(--bg-surface-2)',
                      color: 'var(--text-muted)',
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      textAlign: col.align,
                      padding: 0,
                      height: 40,
                      whiteSpace: 'nowrap',
                      borderBottom: '1px solid var(--border-default)',
                      width: col.width,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      aria-label={`Urutkan berdasarkan ${col.header}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        width: '100%',
                        justifyContent: col.align === 'right' ? 'flex-end' : 'flex-start',
                        height: 40,
                        padding: '0 12px',
                        border: 0,
                        background: 'transparent',
                        color: active ? 'var(--text-primary)' : 'inherit',
                        font: 'inherit',
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        cursor: 'pointer',
                      }}
                    >
                      {col.header}
                      <Icon size={12} aria-hidden style={{ opacity: active ? 1 : 0.5 }} />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} style={{ padding: 16, textAlign: 'center', color: 'var(--text-secondary)' }}>
                  Belum ada data sumur untuk dibandingkan. Tambahkan sumur dan laporan DDR terlebih dahulu.
                </td>
              </tr>
            ) : (
              sorted.map((r) => {
                const isMax = r.wellId === maxNptWellId;
                const isMin = r.wellId === minNptWellId;
                const bg = isMax ? 'var(--danger-soft)' : isMin ? 'var(--success-soft)' : undefined;
                return (
                  <tr
                    key={r.wellId}
                    style={{ height: 44, borderBottom: '1px solid var(--border-default)', background: bg }}
                  >
                    <td style={{ padding: '0 12px', fontWeight: 600 }}>{r.wellName}</td>
                    <td style={{ padding: '0 12px' }}>{r.wellType}</td>
                    <td style={{ padding: '0 12px' }}>{r.phase}</td>
                    <td className="tnum" style={{ padding: '0 12px', textAlign: 'right' }}>{r.reportCount}</td>
                    <td className="tnum" style={{ padding: '0 12px', textAlign: 'right' }}>{r.avgDepthProgress.toFixed(2)}</td>
                    <td
                      className="tnum"
                      style={{
                        padding: '0 12px',
                        textAlign: 'right',
                        fontWeight: isMax ? 700 : undefined,
                        color: isMax ? 'var(--danger-deep)' : undefined,
                      }}
                    >
                      {r.avgNptPercent.toFixed(2)}%
                    </td>
                    <td className="tnum" style={{ padding: '0 12px', textAlign: 'right' }}>{r.avgRopMHr.toFixed(2)}</td>
                    <td className="tnum" style={{ padding: '0 12px', textAlign: 'right' }}>{formatUsd(r.avgDailyCost)}</td>
                    <td className="tnum" style={{ padding: '0 12px', textAlign: 'right' }}>{formatUsd(r.totalCost)}</td>
                    <td className="tnum" style={{ padding: '0 12px', textAlign: 'right' }}>{r.lastReportDate ?? '-'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
