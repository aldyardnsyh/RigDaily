import React from 'react';
import { cn } from '../lib/cn';

/**
 * Tombol dengan tiga tingkat hierarki visual yang tegas.
 *
 * primary   : aksi utama layar (teal solid). Maksimal satu per area.
 * secondary : aksi pendukung (putih + border). Boleh beberapa.
 * tertiary  : aksi ringan / navigasi (tanpa border).
 * danger    : aksi merusak (rose), hanya untuk hapus/keluar.
 *
 * STATE yang ditangani eksplisit: hover, active (tekan), focus-visible
 * (cincin teal), disabled (redup + kursor terlarang), dan loading (teks +
 * tombol tidak bisa diklik ganda).
 */
type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'tertiary' | 'danger-ghost';
  size?: 'sm' | 'md' | 'lg';
  /** Tampilkan indikator sibuk dan nonaktifkan tombol. */
  loading?: boolean;
};

export function Button({ variant = 'primary', size = 'md', className, loading, disabled, children, ...rest }: Props) {
  const base =
    'inline-flex items-center justify-center gap-2 font-medium rounded-[var(--radius-btn)] ' +
    'transition-colors select-none whitespace-nowrap ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-teal)] focus-visible:ring-offset-1 ' +
    'active:translate-y-[0.5px] ' +
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:translate-y-0';

  const sizes: Record<string, string> = {
    sm: 'h-8 px-3 text-[12px]',
    md: 'h-[var(--control-h)] px-4 text-[14px]',
    lg: 'h-[var(--control-h-lg)] px-5 text-[14px]',
  };

  const variants: Record<string, string> = {
    primary:
      'bg-[var(--accent-teal)] text-white border border-transparent hover:bg-[var(--accent-teal-hover)]',
    secondary:
      'bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-2)] hover:border-[var(--border-strong)]',
    tertiary:
      'bg-transparent border border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-surface-2)] hover:text-[var(--text-primary)]',
    'danger-ghost':
      'bg-transparent border border-transparent text-[var(--danger)] hover:bg-[var(--danger-soft)]',
  };

  return (
    <button
      className={cn(base, sizes[size], variants[variant], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden
          style={{
            width: 14,
            height: 14,
            borderRadius: '50%',
            border: '2px solid currentColor',
            borderTopColor: 'transparent',
            display: 'inline-block',
            animation: 'rd-spin 700ms linear infinite',
          }}
        />
      ) : null}
      {children}
    </button>
  );
}
