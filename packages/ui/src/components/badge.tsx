import { cn } from '../lib/cn';

export type StatusKind =
  | 'Draft'
  | 'Submitted'
  | 'Approved'
  | 'Distributed'
  | 'Locked'
  | 'NPT'
  | 'Productive';

const map: Record<StatusKind, string> = {
  Draft: 'bg-slate-100 text-slate-600',
  Submitted: 'bg-amber-100 text-amber-800',
  Approved: 'bg-blue-100 text-blue-700',
  Distributed: 'bg-emerald-100 text-emerald-700',
  Locked: 'bg-zinc-200 text-zinc-600',
  NPT: 'bg-[var(--danger-soft)] text-[var(--danger)]',
  Productive: 'bg-[var(--success-soft)] text-[var(--success)]',
};

export function Badge({ kind, children }: { kind: StatusKind; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-[var(--radius-badge)] px-2.5 text-[12px] font-semibold leading-none',
        map[kind]
      )}
    >
      {children}
    </span>
  );
}
