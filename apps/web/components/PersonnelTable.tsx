'use client';
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Badge, Card } from '@rigdaily/ui';
import { DataTable, type Column } from '@/components/DataTable';
import { inStyle } from '@/components/controls';

/**
 * Bentuk DTO dari `GET /api/personnel` (lihat repo `PersonnelDto`).
 *
 * Dideklarasikan lokal (bukan import dari `@/lib/repo` yang `server-only`)
 * agar komponen client bebas impor tanpa menarik kode server ke bundle.
 */
export type PersonnelDto = {
  id: string;
  name: string;
  position: string;
  company: string | null;
  shift: string;
  hours: number;
  pobStatus: string;
  musterStation: string | null;
  reportId: string;
  reportDate: string;
};

/**
 * PersonnelTable - daftar POB (Person On Board) per laporan DDR.
 *
 * Read-only. Pencarian & filter bekerja di sisi klien karena `/api/personnel`
 * sudah mengembalikan himpunan POB untuk filter rig/well/report/tanggal yang
 * aktif; penyaringan nama/company/status cukup ringan tanpa round-trip ulang.
 * Angka (hours) memakai `className="tnum"` agar kolom sejajar.
 */

const IN_STATUS = 'in';

function StatusPobBadge({ status }: { status: string }) {
  const isIn = status === IN_STATUS;
  const label = isIn ? 'DI RIG' : 'SUDAH KELUAR';
  return <Badge kind={isIn ? 'Productive' : 'Draft'}>{label}</Badge>;
}

export function PersonnelTable({
  items,
  companies,
}: {
  items: PersonnelDto[];
  /** Daftar company unik untuk opsi filter (biasanya dari `summary.byCompany`). */
  companies: string[];
}) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'in' | 'out'>('all');
  const [companyFilter, setCompanyFilter] = useState('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((p) => {
      if (statusFilter !== 'all') {
        const isIn = p.pobStatus === IN_STATUS;
        if (statusFilter === 'in' && !isIn) return false;
        if (statusFilter === 'out' && isIn) return false;
      }
      if (companyFilter !== 'all' && (p.company ?? '') !== companyFilter) return false;
      if (q.length > 0) {
        const haystack = `${p.name} ${p.company ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [items, query, statusFilter, companyFilter]);

  const columns: Column<PersonnelDto>[] = [
    {
      key: 'name',
      header: 'Nama',
      render: (p) => <span style={{ fontWeight: 600 }}>{p.name}</span>,
    },
    { key: 'position', header: 'Posisi', render: (p) => p.position },
    { key: 'company', header: 'Perusahaan', render: (p) => p.company ?? '-' },
    { key: 'shift', header: 'Shift', render: (p) => p.shift },
    { key: 'hours', header: 'Jam', align: 'right', render: (p) => p.hours.toFixed(2) },
    { key: 'musterStation', header: 'Muster Station', render: (p) => p.musterStation ?? '-' },
    {
      key: 'pobStatus',
      header: 'Status',
      render: (p) => <StatusPobBadge status={p.pobStatus} />,
    },
    {
      key: 'reportDate',
      header: 'Tanggal Laporan',
      align: 'right',
      render: (p) => p.reportDate,
    },
  ];

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Register POB</h2>
        <Badge kind="Draft">
          {filtered.length} / {items.length} orang
        </Badge>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 240, flex: '1 1 240px' }}>
          <span className="field-label" style={{ marginBottom: 0 }}>Cari nama / perusahaan</span>
          <span style={{ position: 'relative', display: 'block' }}>
            <span aria-hidden style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', display: 'inline-flex' }}>
              <Search size={16} />
            </span>
            <input
              type="search"
              style={{ ...inStyle(), paddingLeft: 34 }}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nama atau perusahaan"
              aria-label="Cari nama atau perusahaan personel"
            />
          </span>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="field-label" style={{ marginBottom: 0 }}>Status</span>
          <select
            style={{ ...inStyle(), width: 'auto', minWidth: 150 }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'in' | 'out')}
            aria-label="Filter status POB"
          >
            <option value="all">Semua status</option>
            <option value="in">Di rig</option>
            <option value="out">Sudah keluar</option>
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="field-label" style={{ marginBottom: 0 }}>Perusahaan</span>
          <select
            style={{ ...inStyle(), width: 'auto', minWidth: 180 }}
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            aria-label="Filter perusahaan personel"
          >
            <option value="all">Semua perusahaan</option>
            {companies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(p, i) => `${p.id}-${i}`}
        zebra
        maxHeight={560}
        empty={
          items.length === 0
            ? 'Belum ada data POB untuk laporan ini. Tambahkan data kru lewat halaman DDR.'
            : 'Tidak ada personel yang cocok dengan pencarian atau filter saat ini. Ubah kata kunci atau filter.'
        }
      />
    </Card>
  );
}
