'use client';
import React, { useEffect } from 'react';

// Komponen kontrol bersama untuk slicing interaktif RigDaily.
// Semua kontrol punya perilaku nyata: modal bisa ditutup Escape, toggle berubah state,
// pill punya aria-pressed, note menampilkan umpan balik aksi.

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(19,27,46,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 8, border: '1px solid var(--border-default)', maxWidth: 560, width: '100%', maxHeight: '85vh', overflow: 'auto', padding: 20, boxShadow: 'var(--shadow-pop)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup dialog"
            style={{ marginLeft: 'auto', height: 32, padding: '0 12px', borderRadius: 4, border: '1px solid var(--border-default)', background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}
          >
            Tutup (Esc)
          </button>
        </div>
        <div style={{ marginTop: 12, fontSize: 14 }}>{children}</div>
      </div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{
        width: 44,
        height: 24,
        borderRadius: 999,
        border: '1px solid var(--border-default)',
        background: checked ? 'var(--accent-teal)' : 'var(--border-strong)',
        position: 'relative',
        cursor: 'pointer',
        transition: 'background 150ms',
        flexShrink: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 22 : 2,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 150ms',
        }}
      />
    </button>
  );
}

export function PillGroup<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Array<{ id: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={o.id === value}
          onClick={() => onChange(o.id)}
          className="pill"
          style={{
            background: o.id === value ? 'var(--bg-sidebar)' : '#fff',
            color: o.id === value ? '#fff' : 'var(--text-primary)',
            borderColor: o.id === value ? 'var(--bg-sidebar)' : 'var(--border-default)',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Note({ kind, children }: { kind: 'info' | 'success' | 'warn' | 'error'; children: React.ReactNode }) {
  const map = {
    info: { background: 'var(--bg-surface-2)', border: 'var(--border-strong)', color: 'var(--text-secondary)' },
    success: { background: 'var(--success-soft)', border: 'var(--success)', color: 'var(--success)' },
    warn: { background: 'var(--warning-soft)', border: 'var(--warning)', color: 'var(--warning)' },
    error: { background: 'var(--danger-soft)', border: 'var(--danger)', color: 'var(--danger-deep)' },
  }[kind];
  return (
    <p role="status" style={{ margin: '8px 0 0', background: map.background, border: `1px solid ${map.border}`, color: map.color, borderRadius: 4, padding: '8px 12px', fontSize: 13 }}>
      {children}
    </p>
  );
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      style={{ height: 8, background: 'var(--bg-surface-2)', borderRadius: 999, overflow: 'hidden' }}
    >
      <div style={{ width: `${clamped}%`, height: '100%', background: 'var(--accent-teal)', borderRadius: 999 }} />
    </div>
  );
}

export function Labeled({
  label,
  htmlFor,
  children,
}: {
  label: string;
  /** `id` kontrol yang dilabeli - membuat `getByLabel` (Playwright) & a11y bekerja. */
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

export function inStyle(): React.CSSProperties {
  return { height: 'var(--control-h)', width: '100%', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-input)', padding: '0 12px', fontFamily: 'inherit', fontSize: 14, background: '#fff', color: 'var(--text-primary)' };
}
