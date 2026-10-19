'use client';

import { KpiCard } from '@rigdaily/ui';

export type KpiCardTone = 'default' | 'success' | 'danger' | 'warning';

export type KpiCardItem = {
  label: string;
  value: string;
  sub?: string;
  tone?: KpiCardTone;
  /** 0..100 - bila diisi, `KpiCard` menampilkan progress bar (role=progressbar). */
  progress?: number;
};

/** Warna angka KPI mengikuti token semantik (bukan hex baru). */
const VALUE_COLOR: Record<KpiCardTone, string | undefined> = {
  default: undefined,
  success: 'var(--success)',
  danger: 'var(--danger)',
  warning: 'var(--warning)',
};

/**
 * Deretan 4 kartu KPI untuk dashboard.
 *
 * Murni presentasional: semua angka & sub-label datang dari API (dashbaord
 * `/api/dashboard` → `kpi`), komponen ini tidak menghitung apa pun.
 */
export function KpiCardRow({ items }: { items: KpiCardItem[] }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap: 16,
      }}
    >
      {items.map((item) => {
        const tone: KpiCardTone = item.tone ?? 'default';
        return (
          <KpiCard
            key={item.label}
            label={item.label}
            value={item.value}
            sub={item.sub}
            valueColor={VALUE_COLOR[tone]}
            progress={item.progress}
          />
        );
      })}
    </div>
  );
}
