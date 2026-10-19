'use client';
import { formatUsd } from '@rigdaily/shared';

const TONE_COLOR: Record<'default' | 'success' | 'danger' | 'warning' | 'info', string> = {
  default: 'var(--accent-teal)',
  success: 'var(--success)',
  danger: 'var(--danger)',
  warning: 'var(--warning)',
  info: 'var(--info)',
};

/**
 * MoneyBar - baris label + progress bar proporsional terhadap `max` + nilai uang.
 *
 * Nilai selalu diformat dengan `formatUsd()` dari @rigdaily/shared supaya konsisten
 * dengan PDF/laporan. Bar di-clamp 0..100 agar data tak wajar tidak merusak layout.
 */
export function MoneyBar({
  label,
  value,
  max,
  tone = 'default',
  suffix,
}: {
  label: string;
  value: number;
  max: number;
  tone?: 'default' | 'success' | 'danger' | 'warning' | 'info';
  suffix?: string;
}) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
  const pct = Math.max(0, Math.min(100, (value / safeMax) * 100));
  const color = TONE_COLOR[tone];
  const formatted = formatUsd(Number.isFinite(value) ? value : 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
        <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span className="tnum" style={{ fontWeight: 700 }}>
          {formatted}
          {suffix ? <span style={{ marginLeft: 4, color: 'var(--text-muted)', fontWeight: 400 }}>{suffix}</span> : null}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        style={{ height: 8, background: 'var(--bg-surface-2)', borderRadius: 999, overflow: 'hidden' }}
      >
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 999 }} />
      </div>
    </div>
  );
}
