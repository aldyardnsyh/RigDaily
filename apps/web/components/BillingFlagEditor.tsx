'use client';
import { useMemo, useState } from 'react';
import { Flag } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button } from '@rigdaily/ui';
import { Labeled, Modal, Note, inStyle } from '@/components/controls';
import { apiSend } from '@/lib/api-client';
import { useApi } from '@/lib/hooks/useApi';
import type { BillingRow, ReportDetail, ReportListItem } from '@/lib/repo/types';

type ReportsList = { items: ReportListItem[]; total: number };
type FlagsPayload = {
  reportId: string;
  flags: Array<{
    id: string;
    timeRowId: string | null;
    forceMajeure: boolean;
    disputed: boolean;
    rebillable: boolean;
    note: string | null;
  }>;
};

type FlagDraft = { forceMajeure: boolean; disputed: boolean; rebillable: boolean; note: string };

/**
 * Modal penandaan flag billing untuk SATU baris ledger (tanggal + kode IADC).
 *
 * Billing baris = agregat per (tanggal, kode), sehingga penandaan dilakukan di
 * level TIME ROW milik laporan tanggal tersebut:
 *  1. `GET /api/reports?wellId=&from=&to=` → temukan laporan pada tanggal baris,
 *  2. `GET /api/reports/{id}` → daftar `timeRows`,
 *  3. checkbox per time row → `POST /api/reports/{id}/billing-flags`.
 * Setelah simpan, `onSaved()` memicu reload billing dari server (totals berubah).
 */
export function FlagEditorModal({
  open,
  row,
  rigId,
  onClose,
  onSaved,
}: {
  open: boolean;
  row: BillingRow | null;
  rigId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Hanya laporan RIG INI pada tanggal baris (agregat billing filter per rig).
  const listPath =
    open && row && rigId
      ? `/api/reports?rigId=${rigId}&from=${row.date}&to=${row.date}&limit=20`
      : null;
  const reports = useApi<ReportsList>(listPath);

  const candidates = useMemo(
    () => (reports.data?.items ?? []).filter((r) => r.reportDate === row?.date),
    [reports.data, row?.date],
  );

  // Laporan pertama (revisi tertinggi tampil paling awal) dipakai default.
  const reportId = candidates[0]?.id ?? null;
  const detail = useApi<ReportDetail>(open && reportId ? `/api/reports/${reportId}` : null, [reportId]);
  const flags = useApi<FlagsPayload>(open && reportId ? `/api/reports/${reportId}/billing-flags` : null, [reportId]);

  const timeRows = useMemo(
    () => (detail.data?.timeRows ?? []).filter((t) => t.iadcCode === row?.iadcCode),
    [detail.data, row?.iadcCode],
  );

  const flagsByRow = useMemo(() => {
    const map = new Map<string | null, FlagsPayload['flags'][number]>();
    for (const f of flags.data?.flags ?? []) map.set(f.timeRowId, f);
    return map;
  }, [flags.data]);

  return (
    <Modal open={open} onClose={onClose} title={row ? `Penanda Billing · ${row.date} · IADC ${row.iadcCode}` : 'Penanda Billing'}>
      {!row ? null : !rigId ? (
        <Note kind="warn">Pilih rig terlebih dahulu untuk mengelola penanda billing.</Note>
      ) : reports.loading ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Mencari laporan tanggal {row.date}...</p>
      ) : reports.error ? (
        <Note kind="error">{reports.error}</Note>
      ) : candidates.length === 0 ? (
        <Note kind="info">Tidak ada laporan rig ini pada {row.date}, sehingga penanda tidak bisa diisi. Pilih tanggal lain.</Note>
      ) : detail.loading || flags.loading ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Memuat baris waktu laporan...</p>
      ) : detail.error ? (
        <Note kind="error">{detail.error}</Note>
      ) : timeRows.length === 0 ? (
        <Note kind="info">
          Laporan {detail.data?.reportNo ?? ''} tidak punya baris waktu berkode {row.iadcCode}. Penanda hanya bisa diisi untuk
          kode yang ada di time breakdown.
        </Note>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
            Baris ledger ini gabungan per tanggal + kode. Tandai per baris waktu di bawah - penanda akan berlaku untuk baris
            yang dipilih.
          </p>
          {timeRows.map((t) => (
            <TimeRowFlagRow
              key={t.id}
              reportId={detail.data?.id ?? ''}
              rowId={t.id}
              label={`${t.start}-${t.end} · ${t.iadcName}`}
              sub={[t.iadcSubcode, t.vendor, `${t.durationMin} menit`].filter(Boolean).join(' · ')}
              initial={flagsByRow.get(t.id) ?? null}
              onSaved={() => {
                flags.reload();
                onSaved();
              }}
            />
          ))}
        </div>
      )}
    </Modal>
  );
}

/** Satu time row + kontrol 3 toggle flag + catatan. Simpan = upsert, Hapus = soft delete. */
function TimeRowFlagRow({
  reportId,
  rowId,
  label,
  sub,
  initial,
  onSaved,
}: {
  reportId: string;
  rowId: string;
  label: string;
  sub: string;
  initial: { id: string; forceMajeure: boolean; disputed: boolean; rebillable: boolean; note: string | null } | null;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<FlagDraft>({
    forceMajeure: initial?.forceMajeure ?? false,
    disputed: initial?.disputed ?? false,
    rebillable: initial?.rebillable ?? false,
    note: initial?.note ?? '',
  });
  const [busy, setBusy] = useState(false);

  /** State lokal tidak ikut server setelah reload → sinkronkan saat `initial` berganti. */
  const initialKey = initial ? `${initial.id}:${initial.forceMajeure}:${initial.disputed}:${initial.rebillable}:${initial.note ?? ''}` : 'none';
  const [lastKey, setLastKey] = useState(initialKey);
  if (lastKey !== initialKey) {
    setLastKey(initialKey);
    setDraft({
      forceMajeure: initial?.forceMajeure ?? false,
      disputed: initial?.disputed ?? false,
      rebillable: initial?.rebillable ?? false,
      note: initial?.note ?? '',
    });
  }

  async function save() {
    setBusy(true);
    try {
      await apiSend(`/api/reports/${reportId}/billing-flags`, 'POST', {
        timeRowId: rowId,
        forceMajeure: draft.forceMajeure,
        disputed: draft.disputed,
        rebillable: draft.rebillable,
        note: draft.note.trim() ? draft.note.trim() : null,
      });
      toast.success('Penanda billing tersimpan.');
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan penanda billing. Coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!initial) return;
    setBusy(true);
    try {
      await apiSend(`/api/reports/${reportId}/billing-flags?flagId=${initial.id}`, 'DELETE');
      toast.success('Penanda billing dihapus.');
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus penanda billing. Coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        border: '1px solid var(--border-default)',
        borderRadius: 6,
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Flag size={14} color="var(--text-muted)" aria-hidden />
        <strong className="tnum" style={{ fontSize: 13 }}>
          {label}
        </strong>
        {initial && <Badge kind="Draft">Bertanda</Badge>}
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }} className="tnum">
          {sub}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
          <input
            type="checkbox"
            checked={draft.disputed}
            disabled={busy}
            onChange={(e) => setDraft({ ...draft, disputed: e.target.checked })}
          />
          Disengketakan
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
          <input
            type="checkbox"
            checked={draft.forceMajeure}
            disabled={busy}
            onChange={(e) => setDraft({ ...draft, forceMajeure: e.target.checked })}
          />
          Force Majeure
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
          <input
            type="checkbox"
            checked={draft.rebillable}
            disabled={busy}
            onChange={(e) => setDraft({ ...draft, rebillable: e.target.checked })}
          />
          Dapat ditagih ulang
        </label>
      </div>

      <Labeled label="Catatan (opsional)">
        <input
          style={inStyle()}
          value={draft.note}
          disabled={busy}
          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          placeholder="mis. menunggu keputusan klausul kontrak §12"
        />
      </Labeled>

      <p style={{ margin: 0, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button onClick={save} disabled={busy}>
          {busy ? 'Menyimpan...' : initial ? 'Perbarui penanda' : 'Simpan penanda'}
        </Button>
        {initial && (
          <Button variant="secondary" onClick={clear} disabled={busy}>
            Hapus penanda
          </Button>
        )}
      </p>
    </div>
  );
}
