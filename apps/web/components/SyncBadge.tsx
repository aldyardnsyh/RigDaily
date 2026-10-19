'use client';

import { useEffect, useState } from 'react';
import { Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { useApi } from '@/lib/hooks/useApi';

/**
 * Indikator sinkronisasi topbar - data NYATA.
 *
 * Sebelumnya label "Synced 2m ago" di-hardcode sehingga selalu tampak
 * tersinkron walau kenyataannya tidak. Sekarang status diturunkan dari
 * `/api/sync/devices`:
 *
 *   hijau  : semua perangkat aktif, tidak ada konflik tertunda
 *   kuning : ada perubahan tertunda / perangkat lama tidak terlihat
 *   merah  : ada konflik yang menunggu penyelesaian
 *
 * Label sengaja pendek dan dipotong (`maxWidth`) agar tidak menembus topbar.
 */

type DeviceStatus = {
  id: string;
  deviceId: string;
  name: string;
  active: boolean;
  lastSeenAt: string | null;
  pendingCount: number;
  openConflicts?: number;
  pendingMutations?: number;
};

type DevicesPayload = {
  devices?: DeviceStatus[];
  totals?: { devices: number; active: number; openConflicts: number; pendingMutations: number };
};

type Tone = 'ok' | 'warn' | 'error' | 'unknown';

function toneOf(totals: DevicesPayload['totals']): Tone {
  if (!totals) return 'unknown';
  if ((totals.openConflicts ?? 0) > 0) return 'error';
  if ((totals.pendingMutations ?? 0) > 0) return 'warn';
  return 'ok';
}

const TONE_STYLE: Record<Tone, { bg: string; fg: string }> = {
  ok: { bg: 'var(--success-soft)', fg: 'var(--success)' },
  warn: { bg: 'var(--warning-soft)', fg: 'var(--warning)' },
  error: { bg: 'var(--danger-soft)', fg: 'var(--danger)' },
  unknown: { bg: 'var(--bg-surface-2)', fg: 'var(--text-secondary)' },
};

export function SyncBadge() {
  const res = useApi<DevicesPayload>('/api/sync/devices');
  const totals = res.data?.totals;
  const tone = toneOf(totals);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    // Placeholder stabil supaya markup server == klien (hindari hydration mismatch).
    return (
      <span
        className="inline-flex items-center gap-2"
        style={{
          height: 34,
          padding: '0 10px',
          borderRadius: 'var(--radius-badge)',
          background: 'var(--bg-surface-2)',
          color: 'var(--text-secondary)',
          fontSize: 12,
          fontWeight: 600,
        }}
        aria-label="Status sinkronisasi memuat"
      >
        <Cloud size={14} aria-hidden />
        ...
      </span>
    );
  }

  const style = TONE_STYLE[tone];
  const label =
    tone === 'ok'
      ? 'Tersinkron'
      : tone === 'error'
        ? `Konflik ${totals?.openConflicts ?? 0}`
        : tone === 'warn'
          ? `Tertunda ${totals?.pendingMutations ?? 0}`
          : 'Status tidak diketahui';

  const Icon = tone === 'ok' ? Cloud : tone === 'error' ? CloudOff : RefreshCw;

  return (
    <span
      className="inline-flex items-center gap-2"
      style={{
        height: 34,
        maxWidth: 168,
        padding: '0 10px',
        borderRadius: 'var(--radius-badge)',
        background: style.bg,
        color: style.fg,
        fontSize: 12,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        flex: '0 0 auto',
      }}
      title={
        totals
          ? `${totals.active}/${totals.devices} perangkat aktif. Konflik terbuka: ${totals.openConflicts}. Mutasi tertunda: ${totals.pendingMutations}.`
          : 'Status sinkronisasi tidak tersedia'
      }
      aria-label={label}
    >
      <Icon size={14} aria-hidden style={{ flex: '0 0 auto' }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </span>
  );
}
