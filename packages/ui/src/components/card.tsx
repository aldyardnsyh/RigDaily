import { cn } from '../lib/cn';

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-card)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-[var(--card-pad)] shadow-[var(--shadow-card)]',
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * Kartu KPI.
 *
 * ATURAN OVERFLOW (bug yang diperbaiki):
 * Sebelumnya label/nilai/sub bisa melebar keluar kartu ketika teks panjang
 * (mis. "AFE Budget Authority", "Prognosis Variance") atau saat ikon + teks
 * berdesakan di kolom sempit. Sekarang setiap area teks diberi `minWidth: 0`
 * dan pemotongan eksplisit dengan tooltip (`title`) supaya tidak pernah
 * menembus batas kartu.
 */
export function KpiCard({
  label,
  value,
  sub,
  icon,
  valueColor,
  progress,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  valueColor?: string;
  progress?: number;
}) {
  return (
    <Card className="min-w-0">
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div
          className="field-label min-w-0"
          style={{
            marginBottom: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={label}
        >
          {label}
        </div>
        {icon ? <span className="flex shrink-0 items-center">{icon}</span> : null}
      </div>

      <div
        className="kpi-value tnum min-w-0"
        style={{
          fontSize: 26,
          fontWeight: 700,
          lineHeight: 1.2,
          letterSpacing: '-0.02em',
          marginTop: 2,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          ...(valueColor ? { color: valueColor } : {}),
        }}
        title={value}
      >
        {value}
      </div>

      {typeof progress === 'number' && (
        <div
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
          style={{ height: 6, background: 'var(--bg-surface-2)', borderRadius: 999, overflow: 'hidden', marginTop: 8 }}
        >
          <div
            style={{
              width: `${Math.max(0, Math.min(100, progress))}%`,
              height: '100%',
              background: 'var(--accent-teal)',
              borderRadius: 999,
              transition: 'width 240ms ease',
            }}
          />
        </div>
      )}

      {sub ? (
        <div
          className="mt-1 text-[12px] text-[var(--text-secondary)]"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            overflowWrap: 'anywhere',
            lineHeight: 1.4,
          }}
          title={typeof sub === 'string' ? sub : undefined}
        >
          {sub}
        </div>
      ) : null}
    </Card>
  );
}
