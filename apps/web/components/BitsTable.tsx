'use client';
import React from 'react';
import { Badge, Card, type StatusKind } from '@rigdaily/ui';
import { DataTable, type Column } from '@/components/DataTable';

/**
 * Bentuk DTO dari `GET /api/wells/[id]/bits` (lihat repo `BitDto`).
 *
 * Dideklarasikan lokal (bukan import dari `@/lib/repo` yang `server-only`) agar
 * komponen client bebas impor tanpa menarik kode server ke bundle.
 */
export type BitRow = {
  id: string;
  wellId: string;
  bitNo: number;
  bitType: string;
  iadcBitCode: string | null;
  sizeIn: number | null;
  manufacturer: string | null;
  model: string | null;
  serialNo: string | null;
  nozzleCount: number | null;
  tfaIn2: number | null;
  depthInMd: number | null;
  depthOutMd: number | null;
  rotatingHours: number;
  footageM: number;
  dullGrade: string | null;
  status: string;
  notes: string | null;
  reportId: string | null;
  createdAt: string;
};

/** Label tipe bit (istilah industri dibiarkan Inggris). */
export const BIT_TYPE_LABEL: Record<string, string> = {
  PDC: 'PDC',
  tricone: 'Tricone',
  impregnated: 'Impregnated',
  core: 'Core',
  reamer: 'Reamer',
};

const BIT_STATUS_LABEL: Record<string, string> = {
  active: 'AKTIF',
  pulled: 'DITARIK',
  available: 'TERSEDIA',
};

const BIT_STATUS_KIND: Record<string, StatusKind> = {
  active: 'Productive',
  pulled: 'NPT',
  available: 'Draft',
};

/** Angka 2 desimal; `-` bila nilai kosong. */
function fmt(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value) ? '-' : value.toFixed(digits);
}

function fmtInt(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '-' : String(value);
}

/** ROP = footage / jam putar. `-` bila jam putar 0 (pembagi tidak sah). */
function ropOf(footageM: number, rotatingHours: number): string {
  if (!Number.isFinite(rotatingHours) || rotatingHours <= 0) return '-';
  return (footageM / rotatingHours).toFixed(2);
}

function depthRange(depthIn: number | null, depthOut: number | null): string {
  if (depthIn === null && depthOut === null) return '-';
  return `${fmt(depthIn)} - ${fmt(depthOut)}`;
}

function StatusBit({ status }: { status: string }) {
  return <Badge kind={BIT_STATUS_KIND[status] ?? 'Draft'}>{BIT_STATUS_LABEL[status] ?? status.toUpperCase()}</Badge>;
}

function RowAction({
  label,
  onClick,
  tone,
  disabled,
  title,
}: {
  label: string;
  onClick: () => void;
  tone?: 'danger';
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title ?? label}
      style={{
        height: 26,
        padding: '0 8px',
        fontSize: 12,
        fontWeight: 600,
        fontFamily: 'inherit',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        borderRadius: 'var(--radius-input)',
        border: '1px solid var(--border-default)',
        background: 'var(--bg-surface)',
        color: tone === 'danger' ? 'var(--danger)' : 'var(--text-primary)',
      }}
    >
      {label}
    </button>
  );
}

/** Warna aksen kiri per status: bit aktif (masih di lubang) memakai teal. */
function accentOf(status: string): string {
  if (status === 'active') return 'var(--accent-teal)';
  return 'transparent';
}

/**
 * BitsTable - riwayat matabor (bit) satu sumur.
 *
 * Kolom angka memakai `align: 'right'` sehingga otomatis `className="tnum"`.
 * Baris berstatus `active` diberi aksen kiri teal agar bit yang masih di
 * lubang langsung terbaca. Aksi Edit/Hapus hanya muncul untuk `canEdit`.
 */
export function BitsTable({
  rows,
  canEdit,
  onEdit,
  onDelete,
  loading,
  skeletonRows,
}: {
  rows: BitRow[];
  canEdit: boolean;
  onEdit: (row: BitRow) => void;
  onDelete: (row: BitRow) => void;
  loading?: boolean;
  /** Render baris skeleton bernomor (dipakai saat `rows` baru placeholder). */
  skeletonRows?: number;
}) {
  const columns: Column<BitRow>[] = [
    {
      key: 'bitNo',
      header: 'Bit #',
      align: 'right',
      width: 70,
      render: (b) => (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontWeight: 700,
            borderLeft: `3px solid ${accentOf(b.status)}`,
            paddingLeft: 6,
            marginLeft: -6,
          }}
          title={b.status === 'active' ? `Bit #${b.bitNo} masih aktif di lubang` : undefined}
        >
          {b.bitNo}
        </span>
      ),
    },
    {
      key: 'bitType',
      header: 'Tipe',
      width: 110,
      render: (b) => BIT_TYPE_LABEL[b.bitType] ?? b.bitType,
    },
    {
      key: 'iadcBitCode',
      header: 'IADC Code',
      width: 100,
      render: (b) =>
        b.iadcBitCode ? (
          <span
            style={{
              background: 'var(--info-soft)',
              color: 'var(--info)',
              borderRadius: 999,
              padding: '1px 8px',
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {b.iadcBitCode}
          </span>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>-</span>
        ),
    },
    { key: 'sizeIn', header: 'Ukuran (in)', align: 'right', width: 100, render: (b) => fmt(b.sizeIn, 3) },
    {
      key: 'manufacturer',
      header: 'Manufacturer / Model',
      maxWidth: 220,
      render: (b) => {
        const text = [b.manufacturer, b.model].filter((v): v is string => Boolean(v)).join(' / ');
        return text.length > 0 ? text : <span style={{ color: 'var(--text-muted)' }}>-</span>;
      },
    },
    {
      key: 'nozzleTfa',
      header: 'Nozzle / TFA',
      align: 'right',
      width: 110,
      render: (b) => `${fmtInt(b.nozzleCount)} / ${fmt(b.tfaIn2, 3)}`,
    },
    {
      key: 'depth',
      header: 'Kedalaman In - Out (m)',
      align: 'right',
      width: 160,
      render: (b) => depthRange(b.depthInMd, b.depthOutMd),
    },
    { key: 'rotatingHours', header: 'Jam Putar', align: 'right', width: 100, render: (b) => fmt(b.rotatingHours) },
    { key: 'footageM', header: 'Footage (m)', align: 'right', width: 110, render: (b) => fmt(b.footageM) },
    {
      key: 'rop',
      header: 'ROP (m/hr)',
      align: 'right',
      width: 100,
      render: (b) => {
        const rop = ropOf(b.footageM, b.rotatingHours);
        return rop === '-' ? <span style={{ color: 'var(--text-muted)' }}>-</span> : rop;
      },
    },
    {
      key: 'dullGrade',
      header: 'Dull Grade',
      width: 110,
      render: (b) =>
        b.dullGrade ? b.dullGrade : <span style={{ color: 'var(--text-muted)' }}>-</span>,
    },
    { key: 'status', header: 'Status', width: 110, render: (b) => <StatusBit status={b.status} /> },
    {
      key: 'actions',
      header: 'Aksi',
      width: 130,
      render: (b) =>
        canEdit ? (
          <span style={{ display: 'inline-flex', gap: 6 }}>
            <RowAction label="Edit" onClick={() => onEdit(b)} title={`Edit bit #${b.bitNo}`} />
            <RowAction label="Hapus" tone="danger" onClick={() => onDelete(b)} title={`Hapus bit #${b.bitNo}`} />
          </span>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>-</span>
        ),
    },
  ];

  const body =
    skeletonRows && skeletonRows > 0
      ? Array.from({ length: skeletonRows }).map((_, i) => ({
          id: `skeleton-${i}`,
          wellId: '',
          bitNo: 0,
          bitType: 'PDC',
          iadcBitCode: null,
          sizeIn: null,
          manufacturer: null,
          model: null,
          serialNo: null,
          nozzleCount: null,
          tfaIn2: null,
          depthInMd: null,
          depthOutMd: null,
          rotatingHours: 0,
          footageM: 0,
          dullGrade: null,
          status: 'available',
          notes: null,
          reportId: null,
          createdAt: '',
        }))
      : rows;

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Riwayat Bit</h2>
        <Badge kind="Draft">{rows.length} bit</Badge>
      </div>

      <DataTable
        columns={columns}
        rows={body}
        rowKey={(b, i) => (b.id.startsWith('skeleton-') ? `${b.id}-${i}` : b.id)}
        zebra
        dense
        loading={loading}
        maxHeight={560}
        empty="Belum ada catatan bit untuk sumur ini. Tambahkan setelah bit keluar dari lubang."
      />

      <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
        ROP dihitung dari footage dibagi jam putar. Bit berstatus aktif (masih di lubang) ditandai aksen teal.
      </p>
    </Card>
  );
}

/** Tinggi placeholder skeleton baris tabel (halaman menampilkannya sebelum data tiba). */
export const BITS_SKELETON_ROWS = 4;

