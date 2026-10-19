'use client';
import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatHours } from '@rigdaily/shared';

export type ValidationIssueView = {
  severity: string;
  code: string;
  message: string;
  rowIndex?: number;
};

/**
 * Ringkasan validasi DDR (hasil `POST /validate` atau `report.validation`).
 *
 * Angka & daftar issue berasal dari server (`validateTimeBreakdown` di shared),
 * jadi panel ini murni presentasional - tidak menghitung ulang apa pun.
 */
export function ValidationPanel({
  ok,
  totalMinutes,
  issues,
}: {
  ok: boolean;
  totalMinutes: number;
  issues: ValidationIssueView[];
}) {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity !== 'error');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span
          style={
            ok
              ? { background: 'var(--success-soft)', color: 'var(--success)', fontWeight: 700, padding: '2px 8px', borderRadius: 999, fontSize: 12 }
              : { background: 'var(--danger)', color: '#fff', fontWeight: 700, padding: '2px 8px', borderRadius: 999, fontSize: 12 }
          }
        >
          {ok ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <CheckCircle2 size={12} aria-hidden /> LOLOS
            </span>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <AlertCircle size={12} aria-hidden /> {errors.length} kesalahan, {warnings.length} peringatan
            </span>
          )}
        </span>
        <span className="tnum" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {formatHours(totalMinutes)} jam / 24.0 jam
        </span>
      </div>

      {/* Ringkasan teks selalu tampil agar jelas berapa error/warning. */}
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
        {errors.length} kesalahan, {warnings.length} peringatan
        {ok ? ', laporan siap dikirim.' : ', perbaiki kesalahan sebelum dikirim.'}
      </p>

      {issues.length === 0 ? (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13 }}>
          <li style={{ display: 'flex', gap: 8, color: 'var(--success)' }}>
            <CheckCircle2 size={16} style={{ flexShrink: 0 }} aria-hidden />
            <span>Semua butir validasi lolos. Laporan siap dikirim untuk persetujuan.</span>
          </li>
        </ul>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {issues.map((issue, idx) => {
            const isError = issue.severity === 'error';
            return (
              <li
                key={`${issue.code}-${idx}`}
                style={{
                  display: 'flex',
                  gap: 8,
                  fontSize: 13,
                  color: isError ? 'var(--danger-deep)' : 'var(--warning)',
                  background: isError ? 'var(--danger-soft)' : 'var(--warning-soft)',
                  borderRadius: 4,
                  padding: '6px 8px',
                  alignItems: 'flex-start',
                }}
              >
                {isError ? (
                  <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden />
                ) : (
                  <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden />
                )}
                <span>
                  <strong>{issue.code}</strong>
                  {typeof issue.rowIndex === 'number' ? ` (baris ${issue.rowIndex + 1})` : ''}: {issue.message}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
