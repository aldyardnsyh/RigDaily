'use client';
import React, { useState } from 'react';

/**
 * Tabel data bersama.
 *
 * ATURAN TAMPILAN YANG DITEGAKKAN
 * 1. OVERFLOW: setiap sel punya `maxWidth` + pemotongan, dan seluruh tabel
 *    berada di dalam container ber-border radius yang meng-clip, sehingga isi
 *    tidak pernah "keluar" dari kartu pembungkusnya.
 * 2. STATE: hover (baris disorot), selected (baris terpilih diberi aksen),
 *    disabled, empty (dengan alasan + aksi), dan loading skeleton.
 * 3. Aksesibilitas: header `scope="col"`, baris interaktif memakai
 *    `role="button"` dan bisa diaktifkan dengan Enter/Space.
 */

export type Column<T> = {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
  /** Batas lebar sel (px) supaya teks panjang tidak melebarkan tabel. */
  maxWidth?: number;
  render?: (row: T, index: number) => React.ReactNode;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  zebra,
  onRowClick,
  maxHeight,
  loading,
  selectedKey,
  dense,
}: {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T, i: number) => string;
  empty?: React.ReactNode;
  zebra?: boolean;
  onRowClick?: (row: T) => void;
  maxHeight?: number;
  /** Tampilkan skeleton saat data sedang dimuat. */
  loading?: boolean;
  /** Key baris yang sedang dipilih (aksen + aria-selected). */
  selectedKey?: string | null;
  /** Tinggi baris 38px untuk tabel padat (banyak kolom). */
  dense?: boolean;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  const shellStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: '100%',
    overflow: 'auto',
    overflowX: 'auto',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-input)',
    ...(maxHeight ? { maxHeight } : {}),
  };

  if (loading) {
    return (
      <div style={shellStyle} aria-busy="true" aria-label="Memuat data tabel">
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              style={{
                height: dense ? 34 : 40,
                borderRadius: 4,
                background: 'var(--bg-surface-2)',
                opacity: 1 - i * 0.15,
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div
        style={{
          padding: '28px 16px',
          textAlign: 'center',
          border: '1px dashed var(--border-strong)',
          borderRadius: 'var(--radius-input)',
          background: 'var(--bg-surface-2)',
          color: 'var(--text-secondary)',
          fontSize: 13,
        }}
        role="status"
      >
        {empty ?? 'Belum ada data untuk ditampilkan.'}
      </div>
    );
  }

  const rowHeight = dense ? 38 : 44;

  return (
    <div style={shellStyle}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'auto' }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 1,
                  background: 'var(--bg-surface-2)',
                  color: 'var(--text-muted)',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  textAlign: c.align ?? 'left',
                  padding: '0 12px',
                  height: 36,
                  whiteSpace: 'nowrap',
                  borderBottom: '1px solid var(--border-default)',
                  width: c.width,
                }}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const key = rowKey(row, i);
            const interactive = typeof onRowClick === 'function';
            const isSelected = selectedKey != null && selectedKey === key;
            const isHovered = hovered === key;

            const background = isSelected
              ? 'var(--accent-tonal)'
              : isHovered && interactive
                ? 'var(--bg-surface-2)'
                : zebra && i % 2 === 1
                  ? 'var(--row-alt)'
                  : undefined;

            return (
              <tr
                key={key}
                onClick={interactive ? () => onRowClick?.(row) : undefined}
                onMouseEnter={() => setHovered(key)}
                onMouseLeave={() => setHovered((h) => (h === key ? null : h))}
                onKeyDown={
                  interactive
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onRowClick?.(row);
                        }
                      }
                    : undefined
                }
                tabIndex={interactive ? 0 : undefined}
                role={interactive ? 'button' : undefined}
                aria-selected={isSelected || undefined}
                aria-label={interactive ? 'Buka baris' : undefined}
                style={{
                  height: rowHeight,
                  background,
                  borderBottom: '1px solid var(--border-default)',
                  borderLeft: isSelected ? '3px solid var(--accent-teal)' : '3px solid transparent',
                  cursor: interactive ? 'pointer' : undefined,
                  transition: 'background 120ms ease',
                }}
              >
                {columns.map((c) => {
                  const align = c.align ?? 'left';
                  return (
                    <td
                      key={c.key}
                      className={align === 'right' ? 'tnum' : undefined}
                      style={{
                        padding: '0 12px',
                        textAlign: align,
                        verticalAlign: 'middle',
                        maxWidth: c.maxWidth ?? 320,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={typeof (row as Record<string, unknown>)[c.key] === 'string' ? String((row as Record<string, unknown>)[c.key]) : undefined}
                    >
                      {c.render ? c.render(row, i) : ((row as Record<string, unknown>)[c.key] as React.ReactNode)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
