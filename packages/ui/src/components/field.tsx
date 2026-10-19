import React from 'react';
import { cn } from '../lib/cn';

type Props = React.InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string };

export function Field({ label, error, className, ...rest }: Props) {
  return (
    <div className={cn('flex flex-col', className)}>
      {label && <label className="field-label">{label}</label>}
      <input
        className={cn(
          'h-[var(--control-h)] rounded-[var(--radius-input)] border bg-white px-3 text-[14px]',
          error ? 'border-[var(--danger)]' : 'border-[var(--border-default)]'
        )}
        {...rest}
      />
      {error && <span className="mt-1 text-[13px] text-[var(--danger)]">{error}</span>}
    </div>
  );
}
