'use client';
import { Badge, Button, Card } from '@rigdaily/ui';
import type { Permission } from '@rigdaily/shared';
import { CasingCementPanel } from '@/components/CasingCementPanel';
import { useApi } from '@/lib/hooks/useApi';
import { useActiveWell } from '@/lib/hooks/useActiveWell';

type MePayload = { user: { id: string; role: string }; permissions: Permission[] };

/**
 * Halaman `/casing-cement` - "Casing & Cement".
 *
 * Dua bagian dalam satu layar (dikelola `CasingCementPanel`):
 * A. Desain casing per section (tabel editable, simpan sekaligus).
 * B. Program semen per job (CRUD per baris).
 */
export default function CasingCementPage() {
  const activeWell = useActiveWell();
  const me = useApi<MePayload>('/api/auth/me');
  const wellId = activeWell.wellId;

  const canEdit = me.data?.permissions.includes('wellfile:edit') ?? false;

  const loadError = activeWell.error;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>OPERASI PENGEBORAN &gt; CASING &amp; CEMENT</p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Casing &amp; Cement</h1>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            Desain casing (section, ukuran, shoe MD) dan program penyemenan: job type, slurry, volume, sampai TOC dan evaluasi.
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            Sumur aktif:{' '}
            <strong>{activeWell.well ? activeWell.well.name : activeWell.loading ? 'memuat...' : 'belum dipilih'}</strong>
            {activeWell.well?.apiNo ? ` - API ${activeWell.well.apiNo}` : ''}
          </p>
        </div>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Badge kind="Draft">{canEdit ? 'Boleh edit' : 'Hanya lihat'}</Badge>
          <Button
            variant="secondary"
            onClick={() => activeWell.reload()}
            disabled={activeWell.loading}
            title="Muat ulang daftar sumur dan data terkait"
          >
            {activeWell.loading ? 'Memuat...' : 'Muat Ulang'}
          </Button>
        </span>
      </div>

      {loadError && (
        <div
          role="alert"
          style={{
            background: 'var(--danger-soft)',
            border: '1px solid var(--danger)',
            borderRadius: 8,
            padding: 12,
            color: 'var(--danger-deep)',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <span>{loadError}</span>
          <Button variant="secondary" onClick={() => activeWell.reload()}>
            Coba lagi
          </Button>
        </div>
      )}

      {activeWell.loading && !wellId ? (
        <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <div aria-hidden style={{ height: 200, background: 'var(--bg-surface-2)', borderRadius: 6 }} />
            </Card>
          ))}
        </div>
      ) : !wellId ? (
        <Card>
          <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
            Belum ada sumur yang bisa dipilih. Tambahkan sumur terlebih dahulu pada well file.
          </p>
        </Card>
      ) : (
        <CasingCementPanel wellId={wellId} canEdit={canEdit} />
      )}
    </div>
  );
}
