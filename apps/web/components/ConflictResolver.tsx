'use client';

import { useState } from 'react';
import { GitMerge, Laptop, Server } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Card } from '@rigdaily/ui';
import { ApiClientError, apiSend } from '@/lib/api-client';

export type ConflictView = {
  id: string;
  deviceId: string;
  entity: string;
  reason: string;
  createdAt: string;
  rigPayload: Record<string, unknown>;
  serverPayload: Record<string, unknown>;
};

type Resolution = 'keep_rig' | 'keep_server' | 'merge';

const RESOLUTION_OPTIONS: Array<{ id: Resolution; label: string }> = [
  { id: 'keep_rig', label: 'Pakai data Rig' },
  { id: 'keep_server', label: 'Pakai data Server' },
  { id: 'merge', label: 'Gabung (merge)' },
];

/** Nilai payload JSON → teks pendek untuk tampilan diff. */
function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  } catch {
    return false;
  }
}

function rowStyle(different: boolean): React.CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: 'minmax(90px, 0.9fr) minmax(0, 1.4fr) minmax(0, 1.4fr)',
    gap: 8,
    alignItems: 'start',
    padding: '6px 8px',
    borderTop: '1px solid var(--border-default)',
    background: different ? 'var(--warning-soft)' : undefined,
    fontSize: 12,
  };
}

const cellStyle: React.CSSProperties = {
  wordBreak: 'break-word',
  fontFamily: 'var(--font-mono)',
};

/**
 * Resolver konflik sync (Sync Center).
 *
 * Menampilkan diff per key `rigPayload` vs `serverPayload` (key yang nilainya
 * berbeda disorot amber) lalu mengirim keputusan ke `POST /api/sync/conflicts`.
 * Setelah sukses, pemanggil diminta reload lewat `onResolved()`.
 */
export function ConflictResolver({
  conflicts,
  onResolved,
}: {
  conflicts: ConflictView[];
  onResolved: () => void;
}) {
  const [decision, setDecision] = useState<Record<string, Resolution>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  if (conflicts.length === 0) {
    return (
      <Card>
        <p
          role="status"
          style={{
            margin: 0,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            fontSize: 13,
            color: 'var(--success)',
            background: 'var(--success-soft)',
            borderRadius: 4,
            padding: '10px 12px',
          }}
        >
          <GitMerge size={16} aria-hidden /> Tidak ada konflik terbuka. Semua perangkat sudah
          tersinkron dengan data master.
        </p>
      </Card>
    );
  }

  async function resolve(conflict: ConflictView) {
    const resolution: Resolution = decision[conflict.id] ?? 'merge';
    setBusyId(conflict.id);
    try {
      await apiSend<{ ok: boolean }>('/api/sync/conflicts', 'POST', {
        id: conflict.id,
        resolution,
      });
      toast.success(`Konflik ${conflict.entity} diselesaikan dengan pilihan ${resolution}.`);
      onResolved();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Gagal menyelesaikan konflik. Coba lagi.',
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {conflicts.map((conflict) => {
        const keys = Array.from(
          new Set([...Object.keys(conflict.rigPayload), ...Object.keys(conflict.serverPayload)]),
        );
        const chosen: Resolution = decision[conflict.id] ?? 'merge';
        const groupName = `resolution-${conflict.id}`;

        return (
          <Card key={conflict.id}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 14 }}>{conflict.entity}</strong>
              <span className="tnum" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {conflict.deviceId}
              </span>
              <span className="tnum" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                {new Date(conflict.createdAt).toLocaleString()}
              </span>
            </div>
            <p style={{ margin: '4px 0 8px', fontSize: 12, color: 'var(--text-secondary)' }}>
              {conflict.reason}
            </p>

            <div style={rowStyle(false)}>
              <span className="field-label" style={{ margin: 0 }}>
                Kolom
              </span>
              <span className="field-label" style={{ margin: 0, display: 'flex', gap: 4, alignItems: 'center' }}>
                <Laptop size={12} aria-hidden /> Rig
              </span>
              <span className="field-label" style={{ margin: 0, display: 'flex', gap: 4, alignItems: 'center' }}>
                <Server size={12} aria-hidden /> Server
              </span>
            </div>

            {keys.length === 0 ? (
              <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
                Data kosong pada kedua sisi.
              </p>
            ) : (
              keys.map((key) => {
                const rig = conflict.rigPayload[key];
                const server = conflict.serverPayload[key];
                const different = !sameValue(rig, server);
                return (
                  <div key={key} style={rowStyle(different)}>
                    <span style={{ fontWeight: 600, wordBreak: 'break-word' }}>{key}</span>
                    <span style={{ ...cellStyle, fontWeight: different ? 700 : 400 }}>
                      {renderValue(rig)}
                    </span>
                    <span style={{ ...cellStyle, fontWeight: different ? 700 : 400 }}>
                      {renderValue(server)}
                    </span>
                  </div>
                );
              })
            )}

            <fieldset style={{ border: 0, padding: 0, margin: '10px 0 0' }}>
              <legend className="field-label">Keputusan penyelesaian</legend>
              <div role="radiogroup" aria-label={`Keputusan penyelesaian konflik ${conflict.entity}`} style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {RESOLUTION_OPTIONS.map((option) => (
                  <label
                    key={option.id}
                    style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}
                  >
                    <input
                      type="radio"
                      name={groupName}
                      value={option.id}
                      checked={chosen === option.id}
                      onChange={() => setDecision((prev) => ({ ...prev, [conflict.id]: option.id }))}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <p style={{ margin: '10px 0 0' }}>
              <Button
                onClick={() => void resolve(conflict)}
                disabled={busyId === conflict.id}
                aria-label={`Selesaikan konflik ${conflict.entity} dari ${conflict.deviceId}`}
              >
                <GitMerge size={16} aria-hidden /> {busyId === conflict.id ? 'Menyimpan...' : 'Resolve'}
              </Button>
            </p>
          </Card>
        );
      })}
    </div>
  );
}
