'use client';
import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card } from '@rigdaily/ui';
import type { Permission } from '@rigdaily/shared';
import { KpiCardRow, type KpiCardItem } from '@/components/KpiCardRow';
import { BitsTable, BIT_TYPE_LABEL, type BitRow } from '@/components/BitsTable';
import { Labeled, Modal, Note, inStyle } from '@/components/controls';
import { apiSend } from '@/lib/api-client';
import { useApi } from '@/lib/hooks/useApi';
import { useActiveWell } from '@/lib/hooks/useActiveWell';

/* ------------------------------------------------------------------ */
/* Tipe payload                                                        */
/* ------------------------------------------------------------------ */

type BitSummary = {
  totalBits: number;
  totalHours: number;
  totalFootage: number;
  avgRopMhr: number;
  activeBitNo: number | null;
};

type BitsPayload = { items: BitRow[]; summary: BitSummary };
type MePayload = { user: { id: string; role: string }; permissions: Permission[] };

const BIT_TYPES = ['PDC', 'tricone', 'impregnated', 'core', 'reamer'] as const;
const BIT_STATUSES = ['active', 'pulled', 'available'] as const;

const STATUS_LABEL: Record<string, string> = {
  active: 'Aktif (di lubang)',
  pulled: 'Ditarik',
  available: 'Tersedia',
};

/** Form bit: semua nilai disimpan sebagai teks/angka lokal, dikonversi saat simpan. */
type BitForm = {
  bitNo: string;
  bitType: string;
  iadcBitCode: string;
  sizeIn: string;
  manufacturer: string;
  model: string;
  serialNo: string;
  nozzleCount: string;
  tfaIn2: string;
  depthInMd: string;
  depthOutMd: string;
  rotatingHours: string;
  footageM: string;
  dullGrade: string;
  status: string;
  notes: string;
};

function emptyForm(nextBitNo: number): BitForm {
  return {
    bitNo: String(nextBitNo),
    bitType: 'PDC',
    iadcBitCode: '',
    sizeIn: '',
    manufacturer: '',
    model: '',
    serialNo: '',
    nozzleCount: '',
    tfaIn2: '',
    depthInMd: '',
    depthOutMd: '',
    rotatingHours: '',
    footageM: '',
    dullGrade: '',
    status: 'active',
    notes: '',
  };
}

function formFromRow(row: BitRow): BitForm {
  const text = (v: string | number | null): string => (v === null || v === undefined ? '' : String(v));
  return {
    bitNo: text(row.bitNo),
    bitType: row.bitType,
    iadcBitCode: row.iadcBitCode ?? '',
    sizeIn: text(row.sizeIn),
    manufacturer: row.manufacturer ?? '',
    model: row.model ?? '',
    serialNo: row.serialNo ?? '',
    nozzleCount: text(row.nozzleCount),
    tfaIn2: text(row.tfaIn2),
    depthInMd: text(row.depthInMd),
    depthOutMd: text(row.depthOutMd),
    rotatingHours: row.rotatingHours > 0 ? text(row.rotatingHours) : '',
    footageM: row.footageM > 0 ? text(row.footageM) : '',
    dullGrade: row.dullGrade ?? '',
    status: row.status,
    notes: row.notes ?? '',
  };
}

/* ------------------------------------------------------------------ */
/* Konversi & validasi                                                 */
/* ------------------------------------------------------------------ */

/** Teks kosong → null; selain itu harus angka sah (0..max). Error ditulis ke `errors`. */
function numOrNull(
  raw: string,
  label: string,
  errors: string[],
  max = 100000,
): number | null {
  const trimmed = raw.trim().replace(',', '.');
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || n > max) {
    errors.push(`${label} harus angka 0 sampai ${max}.`);
    return null;
  }
  return n;
}

/** Teks kosong → null (kolom opsional). */
function textOrNull(raw: string): string | null {
  const t = raw.trim();
  return t.length === 0 ? null : t;
}

function formatNumber(value: number, digits = 2): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/* ------------------------------------------------------------------ */
/* Halaman                                                             */
/* ------------------------------------------------------------------ */

export default function BitsPage() {
  const activeWell = useActiveWell();
  const wellId = activeWell.wellId;
  const me = useApi<MePayload>('/api/auth/me');
  const bits = useApi<BitsPayload>(wellId ? `/api/wells/${wellId}/bits` : null);

  const canReportEdit = me.data?.permissions.includes('report:edit-draft') ?? false;
  const canWellfileEdit = me.data?.permissions.includes('wellfile:edit') ?? false;
  const canCreate = canReportEdit || canWellfileEdit;
  const canEdit = canWellfileEdit;

  const items = bits.data?.items ?? [];
  const summary = bits.data?.summary ?? null;

  const nextBitNo = useMemo(() => items.reduce((max, b) => Math.max(max, b.bitNo), 0) + 1, [items]);

  /* ---------- modal tambah / edit ---------- */
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BitRow | null>(null);
  const [form, setForm] = useState<BitForm>(() => emptyForm(1));
  const [saving, setSaving] = useState(false);

  /* ---------- modal hapus ---------- */
  const [deleteTarget, setDeleteTarget] = useState<BitRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    // Bila sumur aktif berganti, tutup modal agar tidak menyimpan ke sumur salah.
    setModalOpen(false);
    setEditing(null);
    setDeleteTarget(null);
  }, [wellId]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm(nextBitNo));
    setModalOpen(true);
  }

  function openEdit(row: BitRow) {
    setEditing(row);
    setForm(formFromRow(row));
    setModalOpen(true);
  }

  function setField<K extends keyof BitForm>(key: K, value: BitForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    if (!wellId) {
      toast.error('Sumur aktif belum dipilih.');
      return;
    }

    const errors: string[] = [];
    const bitNo = numOrNull(form.bitNo, 'Bit No', errors, 9999);
    if (bitNo === null || bitNo < 1) errors.push('Bit No wajib diisi minimal 1.');

    const sizeIn = numOrNull(form.sizeIn, 'Ukuran (in)', errors, 100);
    const nozzleCount = numOrNull(form.nozzleCount, 'Nozzle count', errors, 50);
    const tfaIn2 = numOrNull(form.tfaIn2, 'TFA (in2)', errors, 10);
    const depthInMd = numOrNull(form.depthInMd, 'Depth in (m)', errors, 20000);
    const depthOutMd = numOrNull(form.depthOutMd, 'Depth out (m)', errors, 20000);
    const rotatingHours = numOrNull(form.rotatingHours, 'Jam putar', errors, 10000);
    const footageM = numOrNull(form.footageM, 'Footage (m)', errors, 20000);

    if (depthInMd !== null && depthOutMd !== null && depthOutMd < depthInMd) {
      errors.push('Depth out tidak boleh lebih kecil dari depth in.');
    }

    if (errors.length > 0) {
      toast.error(errors[0]);
      return;
    }

    const body: Record<string, unknown> = {
      bitNo: bitNo !== null ? Math.trunc(bitNo) : 1,
      bitType: form.bitType,
      iadcBitCode: textOrNull(form.iadcBitCode),
      sizeIn,
      manufacturer: textOrNull(form.manufacturer),
      model: textOrNull(form.model),
      serialNo: textOrNull(form.serialNo),
      nozzleCount: nozzleCount !== null ? Math.trunc(nozzleCount) : null,
      tfaIn2,
      depthInMd,
      depthOutMd,
      rotatingHours,
      footageM,
      dullGrade: textOrNull(form.dullGrade),
      status: form.status,
      notes: textOrNull(form.notes),
    };

    setSaving(true);
    try {
      if (editing) {
        await apiSend(`/api/wells/${wellId}/bits?bitId=${encodeURIComponent(editing.id)}`, 'PATCH', body);
        toast.success(`Bit #${String(body.bitNo)} diperbarui.`);
      } else {
        await apiSend(`/api/wells/${wellId}/bits`, 'POST', body);
        toast.success(`Bit #${String(body.bitNo)} tercatat.`);
      }
      setModalOpen(false);
      setEditing(null);
      bits.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan catatan bit. Periksa isian lalu coba lagi.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!wellId || !deleteTarget) return;
    setDeleting(true);
    try {
      await apiSend(`/api/wells/${wellId}/bits?bitId=${encodeURIComponent(deleteTarget.id)}`, 'DELETE');
      toast.success(`Bit #${deleteTarget.bitNo} dihapus.`);
      setDeleteTarget(null);
      bits.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus catatan bit.');
    } finally {
      setDeleting(false);
    }
  }

  /* ---------- KPI ---------- */
  const kpiItems: KpiCardItem[] = [
    {
      label: 'Total Bit',
      value: summary ? String(summary.totalBits) : '-',
      sub: summary?.activeBitNo ? `Bit aktif: #${summary.activeBitNo}` : 'Belum ada bit aktif',
      tone: 'default',
    },
    {
      label: 'Total Jam Putar',
      value: summary ? `${formatNumber(summary.totalHours)} jam` : '-',
      sub: 'Akumulasi rotating hours',
      tone: 'default',
    },
    {
      label: 'Total Footage',
      value: summary ? `${formatNumber(summary.totalFootage)} m` : '-',
      sub: 'Akumulasi meter yang dibor',
      tone: 'default',
    },
    {
      label: 'Rata-rata ROP',
      value: summary ? `${formatNumber(summary.avgRopMhr)} m/hr` : '-',
      sub: 'Total footage dibagi total jam putar',
      tone: summary && summary.avgRopMhr > 0 ? 'success' : 'default',
    },
  ];

  const loading = activeWell.loading || (bits.loading && !bits.data);
  const loadError = activeWell.error ?? bits.error;
  const notReady = !wellId && !activeWell.loading;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>OPERASI PENGEBORAN &gt; BITS / BHA</p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Bits</h1>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            Riwayat matabor (bit) per sumur: jam putar, footage, ROP, dan kondisi akhir (dull grade).
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            Sumur aktif:{' '}
            <strong>{activeWell.well ? activeWell.well.name : activeWell.loading ? 'memuat...' : 'belum dipilih'}</strong>
            {activeWell.well?.apiNo ? ` - API ${activeWell.well.apiNo}` : ''}
          </p>
        </div>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Badge kind="Draft">{items.length} bit</Badge>
          <Button
            variant="primary"
            onClick={openCreate}
            disabled={!canCreate || !wellId || saving}
            title={canCreate ? 'Tambah catatan bit' : 'Anda tidak memiliki izin mengubah data sumur'}
          >
            <Plus size={16} aria-hidden /> Tambah Bit
          </Button>
        </span>
      </div>

      {!canCreate && (
        <Note kind="info">
          Anda hanya dapat melihat data bit. Untuk menambah catatan bit dibutuhkan izin <strong>report:edit-draft</strong>{' '}
          atau <strong>wellfile:edit</strong>; untuk mengubah dan menghapus dibutuhkan izin <strong>wellfile:edit</strong>.
        </Note>
      )}

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
          <Button variant="secondary" onClick={() => bits.reload()}>
            Coba lagi
          </Button>
        </div>
      )}

      {loading ? (
        <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <div aria-hidden style={{ height: 52, background: 'var(--bg-surface-2)', borderRadius: 4 }} />
              </Card>
            ))}
          </div>
          <Card>
            <div aria-hidden style={{ height: 220, background: 'var(--bg-surface-2)', borderRadius: 6 }} />
          </Card>
        </div>
      ) : notReady ? (
        <Card>
          <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
            Belum ada sumur yang bisa dipilih. Tambahkan sumur terlebih dahulu pada well file.
          </p>
        </Card>
      ) : items.length === 0 ? (
        <>
          <KpiCardRow items={kpiItems} />
          <Card>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
              <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                Belum ada catatan bit untuk sumur ini. Tambahkan setelah bit keluar dari lubang.
              </p>
              <Button variant="primary" onClick={openCreate} disabled={!canCreate || !wellId}>
                <Plus size={16} aria-hidden /> Tambah Bit
              </Button>
            </div>
          </Card>
        </>
      ) : (
        <>
          <KpiCardRow items={kpiItems} />
          <BitsTable rows={items} canEdit={canEdit} onEdit={openEdit} onDelete={(row) => setDeleteTarget(row)} />
        </>
      )}

      {/* ---------- Modal tambah / edit ---------- */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Edit Bit #${editing.bitNo}` : 'Tambah Bit'}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
          <Labeled label="Bit No" htmlFor="bit-no">
            <input
              id="bit-no"
              type="number"
              min={1}
              className="tnum"
              style={inStyle()}
              value={form.bitNo}
              onChange={(e) => setField('bitNo', e.target.value)}
            />
          </Labeled>

          <Labeled label="Tipe" htmlFor="bit-type">
            <select id="bit-type" style={inStyle()} value={form.bitType} onChange={(e) => setField('bitType', e.target.value)}>
              {BIT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {BIT_TYPE_LABEL[t] ?? t}
                </option>
              ))}
            </select>
          </Labeled>

          <Labeled label="IADC Code" htmlFor="bit-iadc">
            <input
              id="bit-iadc"
              type="text"
              maxLength={12}
              placeholder="mis. M323"
              style={inStyle()}
              value={form.iadcBitCode}
              onChange={(e) => setField('iadcBitCode', e.target.value)}
            />
          </Labeled>

          <Labeled label="Ukuran (in)" htmlFor="bit-size">
            <input
              id="bit-size"
              type="number"
              step="0.001"
              min={0}
              className="tnum"
              style={inStyle()}
              value={form.sizeIn}
              onChange={(e) => setField('sizeIn', e.target.value)}
            />
          </Labeled>

          <Labeled label="Manufacturer" htmlFor="bit-manufacturer">
            <input
              id="bit-manufacturer"
              type="text"
              maxLength={160}
              style={inStyle()}
              value={form.manufacturer}
              onChange={(e) => setField('manufacturer', e.target.value)}
            />
          </Labeled>

          <Labeled label="Model" htmlFor="bit-model">
            <input
              id="bit-model"
              type="text"
              maxLength={160}
              style={inStyle()}
              value={form.model}
              onChange={(e) => setField('model', e.target.value)}
            />
          </Labeled>

          <Labeled label="Serial No" htmlFor="bit-serial">
            <input
              id="bit-serial"
              type="text"
              maxLength={120}
              style={inStyle()}
              value={form.serialNo}
              onChange={(e) => setField('serialNo', e.target.value)}
            />
          </Labeled>

          <Labeled label="Nozzle count" htmlFor="bit-nozzle">
            <input
              id="bit-nozzle"
              type="number"
              min={0}
              step={1}
              className="tnum"
              style={inStyle()}
              value={form.nozzleCount}
              onChange={(e) => setField('nozzleCount', e.target.value)}
            />
          </Labeled>

          <Labeled label="TFA (in2)" htmlFor="bit-tfa">
            <input
              id="bit-tfa"
              type="number"
              step="0.001"
              min={0}
              className="tnum"
              style={inStyle()}
              value={form.tfaIn2}
              onChange={(e) => setField('tfaIn2', e.target.value)}
            />
          </Labeled>

          <Labeled label="Depth In (m MD)" htmlFor="bit-depth-in">
            <input
              id="bit-depth-in"
              type="number"
              step="0.01"
              min={0}
              className="tnum"
              style={inStyle()}
              value={form.depthInMd}
              onChange={(e) => setField('depthInMd', e.target.value)}
            />
          </Labeled>

          <Labeled label="Depth Out (m MD)" htmlFor="bit-depth-out">
            <input
              id="bit-depth-out"
              type="number"
              step="0.01"
              min={0}
              className="tnum"
              style={inStyle()}
              value={form.depthOutMd}
              onChange={(e) => setField('depthOutMd', e.target.value)}
            />
          </Labeled>

          <Labeled label="Jam putar" htmlFor="bit-hours">
            <input
              id="bit-hours"
              type="number"
              step="0.01"
              min={0}
              className="tnum"
              style={inStyle()}
              value={form.rotatingHours}
              onChange={(e) => setField('rotatingHours', e.target.value)}
            />
          </Labeled>

          <Labeled label="Footage (m)" htmlFor="bit-footage">
            <input
              id="bit-footage"
              type="number"
              step="0.01"
              min={0}
              className="tnum"
              style={inStyle()}
              value={form.footageM}
              onChange={(e) => setField('footageM', e.target.value)}
            />
          </Labeled>

          <Labeled label="Dull grade" htmlFor="bit-dull">
            <input
              id="bit-dull"
              type="text"
              maxLength={40}
              placeholder="mis. 2-2-WT-A-E-I-BT-TD"
              style={inStyle()}
              value={form.dullGrade}
              onChange={(e) => setField('dullGrade', e.target.value)}
            />
          </Labeled>

          <Labeled label="Status" htmlFor="bit-status">
            <select id="bit-status" style={inStyle()} value={form.status} onChange={(e) => setField('status', e.target.value)}>
              {BIT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s] ?? s}
                </option>
              ))}
            </select>
          </Labeled>

          <div style={{ gridColumn: '1 / -1' }}>
            <Labeled label="Catatan" htmlFor="bit-notes">
              <textarea
                id="bit-notes"
                rows={3}
                maxLength={4000}
                style={{ ...inStyle(), height: 'auto', padding: '8px 12px', resize: 'vertical' }}
                value={form.notes}
                onChange={(e) => setField('notes', e.target.value)}
              />
            </Labeled>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
            Batal
          </Button>
          <Button variant="primary" onClick={save} loading={saving}>
            {editing ? 'Simpan Perubahan' : 'Tambah Bit'}
          </Button>
        </div>
      </Modal>

      {/* ---------- Konfirmasi hapus ---------- */}
      <Modal open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="Hapus Bit">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p role="alert" style={{ margin: 0, fontSize: 13 }}>
            Hapus catatan <strong>Bit #{deleteTarget?.bitNo ?? ''}</strong>
            {deleteTarget?.manufacturer || deleteTarget?.model
              ? ` (${[deleteTarget?.manufacturer, deleteTarget?.model].filter(Boolean).join(' / ')})`
              : ''}
            ? Data hilang dari daftar, jejak audit tetap tersimpan.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Batal
            </Button>
            <Button variant="danger-ghost" onClick={confirmDelete} loading={deleting}>
              Hapus
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
