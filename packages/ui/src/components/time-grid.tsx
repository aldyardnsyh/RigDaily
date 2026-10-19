import { cn } from '../lib/cn';

// Tabel Time Breakdown - NPT rose tint, productive putih. Total harus 1440 menit (cek di lib/calc.ts nanti).
export type TimeRow = {
  id: string;
  start: string;
  end: string;
  durationMin: number;
  code: string;
  npt: boolean;
};

export function TimeGrid({ rows }: { rows: TimeRow[] }) {
  const total = rows.reduce((a, r) => a + r.durationMin, 0);
  const ok = total === 1440;
  return (
    <div>
      <div
        className={cn(
          'mb-3 rounded-[var(--radius-input)] border px-3 py-2 text-[13px] font-medium',
          ok
            ? 'border-emerald-200 bg-[var(--success-soft)] text-emerald-800'
            : 'border-amber-200 bg-[var(--warning-soft)] text-amber-800'
        )}
      >
        Total {(total / 60).toFixed(1)} / 24.0h {ok ? '- OK' : `- kurang ${((1440 - total) / 60).toFixed(1)}h`}
      </div>
      <table className="w-full text-[14px]">
        <thead>
          <tr className="text-left text-[12px] uppercase tracking-wide text-[var(--text-muted)]">
            <th className="py-2">Start</th>
            <th>End</th>
            <th className="text-right">Dur</th>
            <th>IADC</th>
            <th>NPT</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className={cn('h-[var(--row-h)] border-t border-[var(--border-default)]')}
              style={r.npt ? { background: 'var(--npt-bg)', boxShadow: 'inset 3px 0 0 var(--npt-border-left)' } : undefined}
            >
              <td className="tnum">{r.start}</td>
              <td className="tnum">{r.end}</td>
              <td className="tnum text-right">{(r.durationMin / 60).toFixed(1)}h</td>
              <td>{r.code}</td>
              <td>{r.npt ? 'Ya' : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
