'use client';

import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { ApiClientError, apiSend } from '@/lib/api-client';

/**
 * Strip kecil di atas konten saat RIGDAILY_DEMO aktif.
 *
 * Dua tugas:
 *  1. memberi tahu bahwa data ini contoh dan boleh diubah,
 *  2. menyediakan reset ke kondisi seed tanpa akses server.
 */
export function DemoBanner() {
  const [busy, setBusy] = useState(false);

  async function resetDemo() {
    if (busy) return;
    if (!window.confirm('Reset semua data demo? Perubahan yang dibuat pengguna akan hilang.')) return;

    setBusy(true);
    const toastId = toast.loading('Menyiapkan ulang data demo...');
    try {
      await apiSend('/api/demo/reset', 'POST');
      toast.success('Data demo berhasil direset.', { id: toastId });
      window.location.assign('/login?reset=1');
    } catch (cause) {
      toast.error(
        cause instanceof ApiClientError ? cause.message : 'Reset gagal. Coba lagi beberapa saat.',
        { id: toastId },
      );
      setBusy(false);
    }
  }

  return (
    <div className="demo-banner" role="status">
      <span className="demo-banner-text">
        <strong>MODE DEMO</strong> Data contoh berjalan di memori instance ini. Semua fitur boleh
        dicoba dan dapat dikembalikan ke kondisi awal.
      </span>
      <button
        type="button"
        className="demo-banner-reset"
        onClick={resetDemo}
        disabled={busy}
        aria-busy={busy}
      >
        <RotateCcw size={14} aria-hidden />
        {busy ? 'Mereset...' : 'Reset data demo'}
      </button>
    </div>
  );
}
