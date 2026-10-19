'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Database, Layers, MapPin, Pencil, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card } from '@rigdaily/ui';
import { Labeled, Modal, Note, inStyle } from '@/components/controls';
import { DataTable, type Column } from '@/components/DataTable';
import { ApiClientError, apiGet, apiSend } from '@/lib/api-client';
import { useApi } from '@/lib/hooks/useApi';
import type { WellDto } from '@/lib/repo/types';

/**
 * Well Header - identitas sumur.
 *
 * Empat field inti yang diminta:
 *   WELL ID   : kode unik internal operator (kolom `wellCode`)
 *   WELL NAME : nama tampilan sumur (kolom `name`)
 *   DIVISION  : unit bisnis pemilik sumur (kolom `division`)
 *   FIELD     : lapangan tempat sumur berada (relasi `fieldId`)
 *
 * Sebelumnya hanya WELL NAME dan FIELD yang tersedia. WELL ID dan DIVISION
 * ditambahkan ke schema + API, dan halaman ini menjadi tempat mengelolanya.
 *
 * Data diambil dari `/api/wells`. Field list (untuk dropdown FIELD) diambil
 * dari `/api/master/fields` bila tersedia; bila belum, input teks biasa.
 */

type FieldsPayload = Array<{ id: string; name: string }>;

type WellForm = {
  wellCode: string;
  name: string;
  division: string;
  fieldId: string;
  type: string;
  phase: string;
  operator: string;
  spudDate: string;
  tdPlannedM: string;
  afeBudgetUsd: string;
  apiNo: string;
};

const EMPTY: WellForm = {
  wellCode: '',
  name: '',
  division: '',
  fieldId: '',
  type: 'oil',
  phase: 'drilling',
  operator: '',
  spudDate: '',
  tdPlannedM: '',
  afeBudgetUsd: '',
  apiNo: '',
};

const TYPE_OPTIONS = ['oil', 'gas', 'geothermal', 'ccs', 'mining', 'water'];
const PHASE_OPTIONS = ['planning', 'drilling', 'completion', 'workover', 'fracking', 'flowback', 'facility', 'closed'];

const TYPE_LABEL: Record<string, string> = {
  oil: 'Oil',
  gas: 'Gas',
  geothermal: 'Geothermal',
  ccs: 'CCS',
  mining: 'Mining',
  water: 'Water Well',
};

const PHASE_LABEL: Record<string, string> = {
  planning: 'Planning',
  drilling: 'Drilling',
  completion: 'Completion',
  workover: 'Workover',
  fracking: 'Fracking',
  flowback: 'Flowback',
  facility: 'Facilities',
  closed: 'Closed',
};

function toForm(w: WellDto): WellForm {
  return {
    wellCode: w.wellCode ?? '',
    name: w.name,
    division: w.division ?? '',
    fieldId: '',
    type: w.type,
    phase: w.phase,
    operator: w.operator ?? '',
    spudDate: w.spudDate ?? '',
    tdPlannedM: w.tdPlannedM != null ? String(w.tdPlannedM) : '',
    afeBudgetUsd: w.afeBudgetUsd != null ? String(w.afeBudgetUsd) : '',
    apiNo: w.apiNo ?? '',
  };
}

export default function WellHeaderPage() {
  const wells = useApi<WellDto[]>('/api/wells');
  const me = useApi<{ permissions: string[] }>('/api/auth/me');
  const canEdit = me.data?.permissions?.includes('master:manage') ?? false;

  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<WellDto | null>(null);
  const [form, setForm] = useState<WellForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WellDto | null>(null);

  const rows = useMemo(() => {
    const all = wells.data ?? [];
    const s = q.trim().toLowerCase();
    if (!s) return all;
    return all.filter(
      (w) =>
        w.name.toLowerCase().includes(s) ||
        (w.wellCode ?? '').toLowerCase().includes(s) ||
        (w.division ?? '').toLowerCase().includes(s) ||
        (w.fieldName ?? '').toLowerCase().includes(s),
    );
  }, [wells.data, q]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
  };

  const openEdit = (w: WellDto) => {
    setEditing(w);
    setForm(toForm(w));
    setOpen(true);
  };

  const submit = useCallback(async () => {
    if (!form.name.trim()) {
      toast.error('WELL NAME wajib diisi.');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        wellCode: form.wellCode.trim() || null,
        name: form.name.trim(),
        division: form.division.trim() || null,
        type: form.type,
        phase: form.phase,
        operator: form.operator.trim() || null,
        spudDate: form.spudDate || null,
        tdPlannedM: form.tdPlannedM ? Number(form.tdPlannedM) : null,
        afeBudgetUsd: form.afeBudgetUsd ? Number(form.afeBudgetUsd) : null,
        apiNo: form.apiNo.trim() || null,
        fieldId: form.fieldId || null,
      };

      if (editing) {
        await apiSend(`/api/wells/${editing.id}`, 'PATCH', payload);
        toast.success(`Sumur ${payload.name} diperbarui.`);
      } else {
        await apiSend('/api/wells', 'POST', payload);
        toast.success(`Sumur ${payload.name} dibuat.`);
      }
      setOpen(false);
      wells.reload();
    } catch (err) {
      const msg =
        err instanceof ApiClientError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Gagal menyimpan sumur.';
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }, [editing, form, wells]);

  const destroy = useCallback(async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await apiSend(`/api/wells?id=${deleteTarget.id}`, 'DELETE');
      toast.success(`Sumur ${deleteTarget.name} dihapus.`);
      setDeleteTarget(null);
      wells.reload();
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : 'Gagal menghapus sumur.';
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }, [deleteTarget, wells]);

  const columns: Array<Column<WellDto>> = [
    {
      key: 'wellCode',
      header: 'Well ID',
      width: 150,
      render: (w) => (
        <span className="tnum" style={{ fontWeight: 700 }}>
          {w.wellCode ?? '-'}
        </span>
      ),
    },
    { key: 'name', header: 'Well Name', width: 160, render: (w) => <strong>{w.name}</strong> },
    { key: 'division', header: 'Division', width: 170, render: (w) => w.division ?? '-' },
    { key: 'fieldName', header: 'Field', width: 160, render: (w) => w.fieldName ?? '-' },
    {
      key: 'type',
      header: 'Type',
      width: 110,
      render: (w) => TYPE_LABEL[w.type] ?? w.type,
    },
    {
      key: 'phase',
      header: 'Phase',
      width: 120,
      render: (w) => (
        <span
          style={{
            background: 'var(--info-soft)',
            color: 'var(--info)',
            borderRadius: 999,
            padding: '2px 9px',
            fontSize: 11,
            fontWeight: 700,
            whiteSpace: 'nowrap',
          }}
        >
          {PHASE_LABEL[w.phase] ?? w.phase}
        </span>
      ),
    },
    {
      key: 'operator',
      header: 'Operator',
      width: 190,
      render: (w) => w.operator ?? '-',
    },
    {
      key: 'actions',
      header: 'Aksi',
      align: 'right',
      width: 96,
      render: (w) => (
        <span style={{ display: 'inline-flex', gap: 4, justifyContent: 'flex-end' }}>
          <Button
            variant="tertiary"
            size="sm"
            aria-label={`Edit ${w.name}`}
            title="Edit identitas sumur"
            disabled={!canEdit}
            onClick={() => openEdit(w)}
          >
            <Pencil size={14} />
          </Button>
          <Button
            variant="danger-ghost"
            size="sm"
            aria-label={`Hapus ${w.name}`}
            title="Hapus sumur"
            disabled={!canEdit}
            onClick={() => setDeleteTarget(w)}
          >
            <Trash2 size={14} />
          </Button>
        </span>
      ),
    },
  ];

  const total = wells.data?.length ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
        WELL ENGINEERING &gt; WELL HEADER
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Well Header</h1>
        <Badge kind="Draft">{total} sumur</Badge>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={wells.reload} disabled={wells.loading} aria-label="Muat ulang daftar sumur">
            <RefreshCw size={16} /> Muat ulang
          </Button>
          <Button onClick={openCreate} disabled={!canEdit} title={canEdit ? 'Buat sumur baru' : 'Butuh izin master:manage'}>
            <Plus size={16} /> Tambah Sumur
          </Button>
        </span>
      </div>

      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
        Identitas sumur: <strong>WELL ID</strong> (kode unik operator), <strong>WELL NAME</strong> (nama tampilan),{' '}
        <strong>DIVISION</strong> (unit bisnis), dan <strong>FIELD</strong> (lapangan). Keempatnya dipakai konsisten di
        seluruh modul.
      </p>

      {!canEdit && (
        <Note kind="warn">
          Anda tidak memiliki izin <strong>master:manage</strong>, jadi hanya dapat melihat daftar. Hubungi administrator
          untuk mengubah identitas sumur.
        </Note>
      )}

      {wells.error && <Note kind="error">Gagal memuat sumur: {wells.error}</Note>}

      <Card>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="sr-only" htmlFor="well-search">
            Cari sumur
          </label>
          <input
            id="well-search"
            className="in"
            style={{ ...inStyle(), maxWidth: 280 }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari WELL ID, nama, division, atau field"
          />
          <span className="tnum" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-secondary)' }}>
            Menampilkan {rows.length} dari {total}
          </span>
        </div>

        <div style={{ marginTop: 12 }}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(w) => w.id}
            loading={wells.loading}
            zebra
            empty="Belum ada sumur. Tambahkan sumur pertama untuk mulai membuat laporan harian."
          />
        </div>
      </Card>

      {/* --- Modal tambah/edit --- */}
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? `Edit Sumur ${editing.name}` : 'Tambah Sumur'}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Labeled label="WELL ID" htmlFor="wh-code">
            <input
              id="wh-code"
              className="in tnum"
              style={inStyle()}
              value={form.wellCode}
              onChange={(e) => setForm({ ...form, wellCode: e.target.value })}
              placeholder="mis. ARN-07-HZ"
            />
          </Labeled>
          <Labeled label="WELL NAME" htmlFor="wh-name">
            <input
              id="wh-name"
              className="in"
              style={inStyle()}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="mis. ARUN-07"
            />
          </Labeled>
          <Labeled label="DIVISION" htmlFor="wh-division">
            <input
              id="wh-division"
              className="in"
              style={inStyle()}
              value={form.division}
              onChange={(e) => setForm({ ...form, division: e.target.value })}
              placeholder="mis. Sumatera Operations"
            />
          </Labeled>
          <Labeled label="FIELD (ID lapangan)" htmlFor="wh-field">
            <input
              id="wh-field"
              className="in"
              style={inStyle()}
              value={form.fieldId}
              onChange={(e) => setForm({ ...form, fieldId: e.target.value })}
              placeholder="kosongkan bila belum dipetakan"
            />
          </Labeled>
          <Labeled label="Type" htmlFor="wh-type">
            <select id="wh-type" className="in" style={inStyle()} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </Labeled>
          <Labeled label="Phase" htmlFor="wh-phase">
            <select id="wh-phase" className="in" style={inStyle()} value={form.phase} onChange={(e) => setForm({ ...form, phase: e.target.value })}>
              {PHASE_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {PHASE_LABEL[p]}
                </option>
              ))}
            </select>
          </Labeled>
          <Labeled label="Operator" htmlFor="wh-operator">
            <input
              id="wh-operator"
              className="in"
              style={inStyle()}
              value={form.operator}
              onChange={(e) => setForm({ ...form, operator: e.target.value })}
              placeholder="mis. Medco E&P"
            />
          </Labeled>
          <Labeled label="API Number" htmlFor="wh-api">
            <input
              id="wh-api"
              className="in tnum"
              style={inStyle()}
              value={form.apiNo}
              onChange={(e) => setForm({ ...form, apiNo: e.target.value })}
              placeholder="00-000-00000-00-00"
            />
          </Labeled>
          <Labeled label="Spud Date" htmlFor="wh-spud">
            <input
              id="wh-spud"
              className="in tnum"
              style={inStyle()}
              type="date"
              value={form.spudDate}
              onChange={(e) => setForm({ ...form, spudDate: e.target.value })}
            />
          </Labeled>
          <Labeled label="TD Planned (m)" htmlFor="wh-td">
            <input
              id="wh-td"
              className="in tnum"
              style={inStyle()}
              inputMode="decimal"
              value={form.tdPlannedM}
              onChange={(e) => setForm({ ...form, tdPlannedM: e.target.value })}
              placeholder="3200"
            />
          </Labeled>
          <Labeled label="AFE Budget (USD)" htmlFor="wh-afe">
            <input
              id="wh-afe"
              className="in tnum"
              style={inStyle()}
              inputMode="decimal"
              value={form.afeBudgetUsd}
              onChange={(e) => setForm({ ...form, afeBudgetUsd: e.target.value })}
              placeholder="1600000"
            />
          </Labeled>
        </div>

        <p style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button onClick={submit} loading={busy}>
            <Save size={16} /> {editing ? 'Simpan perubahan' : 'Buat sumur'}
          </Button>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
            Batal
          </Button>
        </p>
      </Modal>

      {/* --- Konfirmasi hapus --- */}
      <Modal open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="Hapus Sumur">
        <p style={{ fontSize: 13, margin: 0 }}>
          Hapus sumur <strong>{deleteTarget?.name}</strong>? Tindakan ini dinonaktifkan (soft delete) dan tercatat di
          audit log. Sumur yang masih punya laporan harian tidak dapat dihapus.
        </p>
        <p style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button variant="danger-ghost" onClick={destroy} loading={busy}>
            <Trash2 size={16} /> Hapus
          </Button>
          <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={busy}>
            Batal
          </Button>
        </p>
      </Modal>
    </div>
  );
}
