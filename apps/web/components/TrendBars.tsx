'use client';

import { useEffect, useRef, useState } from 'react';

export type TrendBarDatum = {
  label: string;
  value: number;
  tone?: 'default' | 'danger' | 'success';
};

const BAR_COLOR: Record<'default' | 'danger' | 'success', string> = {
  default: 'var(--chart-1)',
  danger: 'var(--danger)',
  success: 'var(--success)',
};

/** 0 tidak boleh hilang total: beri tinggi minimum agar bar tetap terlihat. */
const MIN_PCT = 3;

/**
 * Bar chart beranimasi (tanpa library chart).
 *
 * ANIMASI
 * 1. Bar tumbuh dari 0 ke nilai sebenarnya saat komponen tampil, dengan jeda
 *    bertahap (stagger) sehingga mata mengikuti urutan waktu dari kiri ke
 *    kanan. Ini membantu membaca data deret waktu, bukan sekadar hiasan.
 * 2. Bar yang nilainya berubah (mis. setelah ganti sumur) dianimasikan dari
 *    tinggi sebelumnya ke tinggi baru, bukan melompat.
 * 3. Garis rata-rata bergerak halus.
 *
 * Preferensi `prefers-reduced-motion` dihormati: bila aktif, bar langsung
 * tampil pada tinggi akhir tanpa transisi.
 */
export function TrendBars({
  data,
  height = 160,
  valueLabel,
  showAverage = false,
  averageLabel,
}: {
  data: TrendBarDatum[];
  height?: number;
  valueLabel?: (v: number) => string;
  /** Tampilkan garis putus rata-rata. */
  showAverage?: boolean;
  averageLabel?: string;
}) {
  const fmt = valueLabel ?? ((v: number) => String(v));
  const max = data.reduce((acc, d) => (Number.isFinite(d.value) && d.value > acc ? d.value : acc), 0);

  const [shown, setShown] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Hormati preferensi sistem.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Mulai animasi setelah mount agar transisi CSS sempat berjalan.
  useEffect(() => {
    if (data.length === 0) return;
    setShown(false);
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [data.length]);

  if (data.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>Belum ada data untuk digambar.</p>
    );
  }

  const average = data.reduce((a, d) => a + (Number.isFinite(d.value) ? d.value : 0), 0) / data.length;
  const avgPct = max > 0 ? (average / max) * 100 : 0;

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={`Bar chart ${data.length} titik, nilai tertinggi ${fmt(max)}${
        showAverage ? `, rata-rata ${fmt(average)}` : ''
      }`}
      style={{ display: 'flex', flexDirection: 'column', gap: 6, position: 'relative' }}
    >
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'flex-end',
          gap: 4,
          height,
          borderBottom: '1px solid var(--border-strong)',
          paddingBottom: 2,
        }}
      >
        {/* Garis rata-rata */}
        {showAverage && avgPct > 0 && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: `calc(${avgPct}% + 2px)`,
              borderTop: '1.5px dashed var(--text-muted)',
              transition: reduceMotion ? undefined : 'bottom 500ms cubic-bezier(0.22, 1, 0.36, 1)',
              pointerEvents: 'none',
            }}
          >
            <span
              className="tnum"
              style={{
                position: 'absolute',
                right: 0,
                top: -14,
                fontSize: 9,
                color: 'var(--text-muted)',
                background: 'var(--bg-surface)',
                padding: '0 3px',
                borderRadius: 2,
                whiteSpace: 'nowrap',
              }}
            >
              {averageLabel ?? 'rata-rata'} {fmt(average)}
            </span>
          </div>
        )}

        {data.map((d, i) => {
          const pct = max > 0 ? Math.max((d.value / max) * 100, d.value > 0 ? MIN_PCT : 0) : 0;
          const color = BAR_COLOR[d.tone ?? 'default'];
          const delay = reduceMotion ? 0 : i * 45;

          return (
            <div
              key={`${d.label}-${i}`}
              title={`${d.label}: ${fmt(d.value)}`}
              style={{
                flex: '1 1 0',
                minWidth: 0,
                display: 'flex',
                alignItems: 'flex-end',
                height: '100%',
              }}
            >
              <span
                aria-hidden
                style={{
                  display: 'block',
                  width: '100%',
                  height: `${shown ? pct : 0}%`,
                  background: color,
                  borderRadius: '3px 3px 0 0',
                  opacity: d.tone === 'danger' || d.tone === 'success' ? 1 : 0.88,
                  transition: reduceMotion
                    ? undefined
                    : `height 520ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`,
                  willChange: 'height',
                }}
              />
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 4 }}>
        {data.map((d, i) => (
          <span
            key={`lbl-${d.label}-${i}`}
            className="tnum"
            style={{
              flex: '1 1 0',
              minWidth: 0,
              fontSize: 10,
              textAlign: 'center',
              color: 'var(--text-muted)',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
            }}
          >
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}
