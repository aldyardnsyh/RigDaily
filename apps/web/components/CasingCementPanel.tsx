'use client';
import { useEffect, useMemo, useState } from 'react';
import { Plus, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card, type StatusKind } from '@rigdaily/ui';
import { DataTable, type Column } from '@/components/DataTable';
import { Labeled, Modal, Note, inStyle } from '@/components/controls';
import { apiSend } from '@/lib/api-client';
import { useApi } from '@/lib/hooks/useApi';

/* ------------------------------------------------------------------ */
/* Tipe DTO (lokal - komponen client tidak boleh impor '@/lib/repo')    */
/* ------------------------------------------------------------------ */

export type CasingRow = {
  id: string;
  wellId: string;
  section: string;
  sortOrder: number;
  sizeIn: number;
  weightPpf: number | null;
  grade: string | null;
  connection: string | null;
  shoeMd: number | null;
  topMd: number | null;
  holeSizeIn: number | null;
  joints: number | null;
  cementRequired: boolean;
  notes: string | null;
};

export type CementRow = {
  id: string;
  wellId: string;
  casingDesignId: string | null;
  section: string;
  jobType: string;
  plannedDate: string | null;
  executedDate: string | null;
  slurryType: string | null;
  slurryDensityPpg: number | null;
  yieldFt3Sx: number | null;
  volumeBbl: number | null;
  sacksSx: number | null;
  mixWaterBbl: number | null;
  additive: string | null;
  plugBumpedPsi: number | null;
  topOfCementMd: number | null;
  evaluation: string;
  status: string;
  notes: string | null;
};

type CasingPayload = { wellId: string; items: CasingRow[] };
type CementPayload = { wellId: string; items: CementRow[] };

/* ------------------------------------------------------------------ */
/* Konstanta                                                           */
/* ------------------------------------------------------------------ */

const CASING_SECTIONS = ['conductor', 'surface', 'intermediate', 'production', 'liner'] as const;
const JOB_TYPES = ['primary', 'squeeze', 'plug', 'liner'] as const;
const EVALUATIONS = ['good', 'partial', 'poor', 'unknown'] as const;
const CEMENT_STATUSES = ['planned', 'executed', 'cancelled'] as const;

const SECTION_LABEL: Record<string, string> = {
  conductor: 'Conductor',
  surface: 'Surface',
  intermediate: 'Intermediate',
  production: 'Production',
  liner: 'Liner',
};

const JOB_TYPE_LABEL: Record<string, string> = {
  primary: 'Primary',
  squeeze: 'Squeeze',
  plug: 'Plug',
  liner: 'Liner',
};

const EVALUATION_LABEL: Record<string, string> = {
  good: 'GOOD',
  partial: 'PARTIAL',
  poor: 'POOR',
  unknown: 'UNKNOWN',
};

const EVALUATION_KIND: Record<string, StatusKind> = {
  good: 'Productive',
  partial: 'Submitted',
  poor: 'NPT',
  unknown: 'Draft',
};

const CEMENT_STATUS_LABEL: Record<string, string> = {
  planned: 'RENCANA',
  executed: 'TEREKSEKUSI',
  cancelled: 'BATAL',
};

const CEMENT_STATUS_KIND: Record<string, StatusKind> = {
  planned: 'Draft',
  executed: 'Productive',
  cancelled: 'Locked',
};

/* ------------------------------------------------------------------ */
/* Helper tampilan & konversi                                          */
/* ------------------------------------------------------------------ */

function fmt(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value) ? '-' : value.toFixed(digits);
}

function fmtInt(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '-' : String(value);
}

/** Teks kosong → null; angka tidak sah → null + catat error. */
function numOrNull(raw: string, label: string, errors: string[], max = 100000): number | null {
  const trimmed = raw.trim().replace(',', '.');
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || n > max) {
    errors.push(`${label} harus angka 0 sampai ${max}.`);
    return null;
  }
  return n;
}

function textOrNull(raw: string): string | null {
  const t = raw.trim();
  return t.length === 0 ? null : t;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/* ---------- baris desain casing (state editable) ---------- */

type CasingDraft = {
  key: string;
  section: string;
  sizeIn: string;
  weightPpf: string;
  grade: string;
  connection: string;
  topMd: string;
  shoeMd: string;
  holeSizeIn: string;
  joints: string;
  cementRequired: boolean;
  notes: string;
};

function draftFromRow(row: CasingRow): CasingDraft {
  const text = (v: string | number | null): string => (v === null || v === undefined ? '' : String(v));
  return {
    key: row.id,
    section: row.section,
    sizeIn: text(row.sizeIn),
    weightPpf: text(row.weightPpf),
    grade: row.grade ?? '',
    connection: row.connection ?? '',
    topMd: text(row.topMd),
    shoeMd: text(row.shoeMd),
    holeSizeIn: text(row.holeSizeIn),
    joints: text(row.joints),
    cementRequired: row.cementRequired,
    notes: row.notes ?? '',
  };
}

function emptyCasingDraft(index: number): CasingDraft {
  return {
    key: `new-${Date.now()}-${index}`,
    section: 'surface',
    sizeIn: '',
    weightPpf: '',
    grade: '',
    connection: '',
    topMd: '',
    shoeMd: '',
    holeSizeIn: '',
    joints: '',
    cementRequired: true,
    notes: '',
  };
}

/* ---------- form job semen ---------- */

type CementForm = {
  section: string;
  jobType: string;
  plannedDate: string;
  executedDate: string;
  slurryType: string;
  slurryDensityPpg: string;
  yieldFt3Sx: string;
  volumeBbl: string;
  sacksSx: string;
  mixWaterBbl: string;
  additive: string;
  plugBumpedPsi: string;
  topOfCementMd: string;
  evaluation: string;
  status: string;
  notes: string;
};

function emptyCementForm(): CementForm {
  return {
    section: 'surface',
    jobType: 'primary',
    plannedDate: '',
    executedDate: '',
    slurryType: '',
    slurryDensityPpg: '',
    yieldFt3Sx: '',
    volumeBbl: '',
    sacksSx: '',
    mixWaterBbl: '',
    additive: '',
    plugBumpedPsi: '',
    topOfCementMd: '',
    evaluation: 'unknown',
    status: 'planned',
    notes: '',
  };
}

function cementFormFromRow(row: CementRow): CementForm {
  const text = (v: string | number | null): string => (v === null || v === undefined ? '' : String(v));
  return {
    section: row.section,
    jobType: row.jobType,
    plannedDate: row.plannedDate ?? '',
    executedDate: row.executedDate ?? '',
    slurryType: row.slurryType ?? '',
    slurryDensityPpg: text(row.slurryDensityPpg),
    yieldFt3Sx: text(row.yieldFt3Sx),
    volumeBbl: text(row.volumeBbl),
    sacksSx: text(row.sacksSx),
    mixWaterBbl: text(row.mixWaterBbl),
    additive: row.additive ?? '',
    plugBumpedPsi: text(row.plugBumpedPsi),
    topOfCementMd: text(row.topOfCementMd),
    evaluation: row.evaluation,
    status: row.status,
    notes: row.notes ?? '',
  };
}

function EvaluationBadge({ value }: { value: string }) {
  return <Badge kind={EVALUATION_KIND[value] ?? 'Draft'}>{EVALUATION_LABEL[value] ?? value.toUpperCase()}</Badge>;
}

function CementStatusBadge({ value }: { value: string }) {
  return <Badge kind={CEMENT_STATUS_KIND[value] ?? 'Draft'}>{CEMENT_STATUS_LABEL[value] ?? value.toUpperCase()}</Badge>;
}

function RowAction({ label, onClick, tone, title }: { label: string; onClick: () => void; tone?: 'danger'; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        height: 26,
        padding: '0 8px',
        fontSize: 12,
        fontWeight: 600,
        fontFamily: 'inherit',
        cursor: 'pointer',
        borderRadius: 'var(--radius-input)',
        border: '1px solid var(--border-default)',
        background: 'var(--bg-surface)',
        color: tone === 'danger' ? 'var(--danger)' : 'var(--text-primary)',
      }}
    >
      {label}
    </button>
  );
}

/** Input sel tabel desain casing (lebih tipis dari kontrol form). */
function cellInput(extra?: React.CSSProperties): React.CSSProperties {
  return {
    height: 'var(--control-h-cell)',
    width: '100%',
    minWidth: 72,
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-input)',
    padding: '0 8px',
    fontFamily: 'inherit',
    fontSize: 13,
    background: 'var(--bg-surface)',
    color: 'var(--text-primary)',
    ...extra,
  };
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

/**
 * CasingCementPanel - mengelola DUA bagian dalam satu komponen:
 * A. Desain casing (tabel editable, simpan sekaligus via PUT).
 * B. Program semen (tabel dari API, CRUD per baris).
 *
 * Fetch sendiri berdasarkan `wellId`; `canEdit` menentukan tombol aktif.
 */
export function CasingCementPanel({ wellId, canEdit }: { wellId: string; canEdit: boolean }) {
  /* ---------------- A. Desain casing ---------------- */
  const casing = useApi<CasingPayload>(`/api/wells/${wellId}/casing`);
  const [draft, setDraft] = useState<CasingDraft[]>([]);
  const [savingCasing, setSavingCasing] = useState(false);

  const casingSignature = (casing.data?.items ?? [])
    .map((c) => `${c.id}:${c.section}:${c.sortOrder}:${c.sizeIn}:${c.weightPpf ?? ''}:${c.joints ?? ''}`)
    .join('|');

  useEffect(() => {
    setDraft((casing.data?.items ?? []).map(draftFromRow));
  }, [casingSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalJoints = useMemo(
    () => draft.reduce((acc, r) => acc + (Number(r.joints) > 0 && Number.isFinite(Number(r.joints)) ? Number(r.joints) : 0), 0),
    [draft],
  );

  function updateDraft(key: string, patch: Partial<CasingDraft>) {
    setDraft((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addCasingRow() {
    setDraft((prev) => [...prev, emptyCasingDraft(prev.length)]);
  }

  function removeCasingRow(key: string) {
    setDraft((prev) => prev.filter((r) => r.key !== key));
  }

  async function saveCasing() {
    const errors: string[] = [];
    const items = draft.map((r, index) => {
      const sizeIn = numOrNull(r.sizeIn, `Ukuran casing baris ${index + 1}`, errors, 100) ?? 0;
      const weightPpf = numOrNull(r.weightPpf, `Weight baris ${index + 1}`, errors, 500);
      const topMd = numOrNull(r.topMd, `Top MD baris ${index + 1}`, errors, 20000);
      const shoeMd = numOrNull(r.shoeMd, `Shoe MD baris ${index + 1}`, errors, 20000);
      const holeSizeIn = numOrNull(r.holeSizeIn, `Hole size baris ${index + 1}`, errors, 100);
      const jointsRaw = numOrNull(r.joints, `Joints baris ${index + 1}`, errors, 10000);
      return {
        section: r.section,
        sortOrder: index + 1,
        sizeIn,
        weightPpf,
        grade: textOrNull(r.grade),
        connection: textOrNull(r.connection),
        topMd,
        shoeMd,
        holeSizeIn,
        joints: jointsRaw === null ? null : Math.trunc(jointsRaw),
        cementRequired: r.cementRequired,
        notes: textOrNull(r.notes),
      };
    });

    if (errors.length > 0) {
      toast.error(errors[0]);
      return;
    }

    setSavingCasing(true);
    try {
      await apiSend(`/api/wells/${wellId}/casing`, 'PUT', { items });
      toast.success(`Desain casing tersimpan (${items.length} baris).`);
      casing.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan desain casing.');
    } finally {
      setSavingCasing(false);
    }
  }

  const casingColumns: Column<CasingDraft>[] = [
    {
      key: 'section',
      header: 'Section',
      width: 130,
      render: (r) => (
        <select
          aria-label={`Section baris ${r.key}`}
          style={cellInput({ minWidth: 118 })}
          value={r.section}
          disabled={!canEdit}
          onChange={(e) => updateDraft(r.key, { section: e.target.value })}
        >
          {CASING_SECTIONS.map((s) => (
            <option key={s} value={s}>
              {SECTION_LABEL[s] ?? s}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: 'sizeIn',
      header: 'Ukuran (in)',
      align: 'right',
      width: 100,
      render: (r) => (
        <input
          aria-label="Ukuran casing (in)"
          type="number"
          step="0.001"
          min={0}
          className="tnum"
          style={cellInput({ textAlign: 'right' })}
          value={r.sizeIn}
          disabled={!canEdit}
          onChange={(e) => updateDraft(r.key, { sizeIn: e.target.value })}
        />
      ),
    },
    {
      key: 'weightPpf',
      header: 'Weight (ppf)',
      align: 'right',
      width: 100,
      render: (r) => (
        <input
          aria-label="Weight casing (ppf)"
          type="number"
          step="0.01"
          min={0}
          className="tnum"
          style={cellInput({ textAlign: 'right' })}
          value={r.weightPpf}
          disabled={!canEdit}
          onChange={(e) => updateDraft(r.key, { weightPpf: e.target.value })}
        />
      ),
    },
    {
      key: 'grade',
      header: 'Grade',
      width: 90,
      render: (r) => (
        <input
          aria-label="Grade casing"
          type="text"
          maxLength={40}
          style={cellInput()}
          value={r.grade}
          disabled={!canEdit}
          onChange={(e) => updateDraft(r.key, { grade: e.target.value })}
        />
      ),
    },
    {
      key: 'connection',
      header: 'Connection',
      width: 120,
      render: (r) => (
        <input
          aria-label="Connection casing"
          type="text"
          maxLength={60}
          style={cellInput()}
          value={r.connection}
          disabled={!canEdit}
          onChange={(e) => updateDraft(r.key, { connection: e.target.value })}
        />
      ),
    },
    {
      key: 'topMd',
      header: 'Top MD (m)',
      align: 'right',
      width: 105,
      render: (r) => (
        <input
          aria-label="Top MD (m)"
          type="number"
          step="0.01"
          min={0}
          className="tnum"
          style={cellInput({ textAlign: 'right' })}
          value={r.topMd}
          disabled={!canEdit}
          onChange={(e) => updateDraft(r.key, { topMd: e.target.value })}
        />
      ),
    },
    {
      key: 'shoeMd',
      header: 'Shoe MD (m)',
      align: 'right',
      width: 105,
      render: (r) => (
        <input
          aria-label="Shoe MD (m)"
          type="number"
          step="0.01"
          min={0}
          className="tnum"
          style={cellInput({ textAlign: 'right' })}
          value={r.shoeMd}
          disabled={!canEdit}
          onChange={(e) => updateDraft(r.key, { shoeMd: e.target.value })}
        />
      ),
    },
    {
      key: 'holeSizeIn',
      header: 'Hole size (in)',
      align: 'right',
      width: 105,
      render: (r) => (
        <input
          aria-label="Hole size (in)"
          type="number"
          step="0.001"
          min={0}
          className="tnum"
          style={cellInput({ textAlign: 'right' })}
          value={r.holeSizeIn}
          disabled={!canEdit}
          onChange={(e) => updateDraft(r.key, { holeSizeIn: e.target.value })}
        />
      ),
    },
    {
      key: 'joints',
      header: 'Joints',
      align: 'right',
      width: 80,
      render: (r) => (
        <input
          aria-label="Jumlah joints"
          type="number"
          step={1}
          min={0}
          className="tnum"
          style={cellInput({ textAlign: 'right' })}
          value={r.joints}
          disabled={!canEdit}
          onChange={(e) => updateDraft(r.key, { joints: e.target.value })}
        />
      ),
    },
    {
      key: 'cementRequired',
      header: 'Cement',
      width: 90,
      render: (r) => (
        <input
          type="checkbox"
          aria-label="Cement required"
          checked={r.cementRequired}
          disabled={!canEdit}
          onChange={(e) => updateDraft(r.key, { cementRequired: e.target.checked })}
        />
      ),
    },
    {
      key: 'notes',
      header: 'Catatan',
      maxWidth: 200,
      render: (r) => (
        <input
          aria-label="Catatan casing"
          type="text"
          maxLength={4000}
          style={cellInput({ minWidth: 160 })}
          value={r.notes}
          disabled={!canEdit}
          onChange={(e) => updateDraft(r.key, { notes: e.target.value })}
        />
      ),
    },
    {
      key: 'actions',
      header: 'Aksi',
      width: 90,
      render: (r) =>
        canEdit ? (
          <RowAction label="Hapus" tone="danger" onClick={() => removeCasingRow(r.key)} title="Hapus baris casing" />
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>-</span>
        ),
    },
  ];

  /* ---------------- B. Program semen ---------------- */
  const cement = useApi<CementPayload>(`/api/wells/${wellId}/cement`);
  const cementItems = cement.data?.items ?? [];

  const [cementModalOpen, setCementModalOpen] = useState(false);
  const [editingCement, setEditingCement] = useState<CementRow | null>(null);
  const [cementForm, setCementForm] = useState<CementForm>(() => emptyCementForm());
  const [savingCement, setSavingCement] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CementRow | null>(null);
  const [deletingCement, setDeletingCement] = useState(false);

  useEffect(() => {
    setCementModalOpen(false);
    setEditingCement(null);
    setDeleteTarget(null);
  }, [wellId]);

  function openCreateCement() {
    setEditingCement(null);
    setCementForm(emptyCementForm());
    setCementModalOpen(true);
  }

  function openEditCement(row: CementRow) {
    setEditingCement(row);
    setCementForm(cementFormFromRow(row));
    setCementModalOpen(true);
  }

  function setCementField<K extends keyof CementForm>(key: K, value: CementForm[K]) {
    setCementForm((prev) => ({ ...prev, [key]: value }));
  }

  async function saveCement() {
    const errors: string[] = [];
    if (cementForm.plannedDate !== '' && !isIsoDate(cementForm.plannedDate)) {
      errors.push('Tanggal rencana harus format YYYY-MM-DD.');
    }
    if (cementForm.executedDate !== '' && !isIsoDate(cementForm.executedDate)) {
      errors.push('Tanggal aktual harus format YYYY-MM-DD.');
    }

    const density = numOrNull(cementForm.slurryDensityPpg, 'Slurry density (ppg)', errors, 30);
    const yieldFt3Sx = numOrNull(cementForm.yieldFt3Sx, 'Yield (ft3/sx)', errors, 10000);
    const volumeBbl = numOrNull(cementForm.volumeBbl, 'Volume (bbl)', errors, 100000);
    const sacksRaw = numOrNull(cementForm.sacksSx, 'Sacks (sx)', errors, 1000000);
    const mixWater = numOrNull(cementForm.mixWaterBbl, 'Mix water (bbl)', errors, 100000);
    const plugPsi = numOrNull(cementForm.plugBumpedPsi, 'Plug bumped (psi)', errors, 100000);
    const tocMd = numOrNull(cementForm.topOfCementMd, 'TOC (m)', errors, 20000);

    if (errors.length > 0) {
      toast.error(errors[0]);
      return;
    }

    const body: Record<string, unknown> = {
      section: cementForm.section,
      jobType: cementForm.jobType,
      plannedDate: cementForm.plannedDate === '' ? null : cementForm.plannedDate,
      executedDate: cementForm.executedDate === '' ? null : cementForm.executedDate,
      slurryType: textOrNull(cementForm.slurryType),
      slurryDensityPpg: density,
      yieldFt3Sx,
      volumeBbl,
      sacksSx: sacksRaw === null ? null : Math.trunc(sacksRaw),
      mixWaterBbl: mixWater,
      additive: textOrNull(cementForm.additive),
      plugBumpedPsi: plugPsi,
      topOfCementMd: tocMd,
      evaluation: cementForm.evaluation,
      status: cementForm.status,
      notes: textOrNull(cementForm.notes),
    };

    setSavingCement(true);
    try {
      if (editingCement) {
        await apiSend(`/api/wells/${wellId}/cement?cementId=${encodeURIComponent(editingCement.id)}`, 'PATCH', body);
        toast.success('Job semen diperbarui.');
      } else {
        await apiSend(`/api/wells/${wellId}/cement`, 'POST', body);
        toast.success('Job semen ditambahkan.');
      }
      setCementModalOpen(false);
      setEditingCement(null);
      cement.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan job semen. Periksa isian lalu coba lagi.');
    } finally {
      setSavingCement(false);
    }
  }

  async function confirmDeleteCement() {
    if (!deleteTarget) return;
    setDeletingCement(true);
    try {
      await apiSend(`/api/wells/${wellId}/cement?cementId=${encodeURIComponent(deleteTarget.id)}`, 'DELETE');
      toast.success('Job semen dihapus.');
      setDeleteTarget(null);
      cement.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus job semen.');
    } finally {
      setDeletingCement(false);
    }
  }

  const cementColumns: Column<CementRow>[] = [
    {
      key: 'section',
      header: 'Section',
      width: 120,
      render: (r) => SECTION_LABEL[r.section] ?? r.section,
    },
    {
      key: 'jobType',
      header: 'Job Type',
      width: 100,
      render: (r) => JOB_TYPE_LABEL[r.jobType] ?? r.jobType,
    },
    {
      key: 'plannedDate',
      header: 'Rencana',
      align: 'right',
      width: 110,
      render: (r) => r.plannedDate ?? <span style={{ color: 'var(--text-muted)' }}>-</span>,
    },
    {
      key: 'executedDate',
      header: 'Aktual',
      align: 'right',
      width: 110,
      render: (r) => r.executedDate ?? <span style={{ color: 'var(--text-muted)' }}>-</span>,
    },
    {
      key: 'slurry',
      header: 'Slurry',
      maxWidth: 200,
      render: (r) => {
        const parts: string[] = [];
        if (r.slurryType) parts.push(r.slurryType);
        if (r.slurryDensityPpg !== null) parts.push(`${fmt(r.slurryDensityPpg, 3)} ppg`);
        if (r.yieldFt3Sx !== null) parts.push(`yield ${fmt(r.yieldFt3Sx, 3)} ft3/sx`);
        return parts.length > 0 ? parts.join(' - ') : <span style={{ color: 'var(--text-muted)' }}>-</span>;
      },
    },
    { key: 'volumeBbl', header: 'Volume (bbl)', align: 'right', width: 115, render: (r) => fmt(r.volumeBbl) },
    { key: 'sacksSx', header: 'Sacks (sx)', align: 'right', width: 100, render: (r) => fmtInt(r.sacksSx) },
    { key: 'mixWaterBbl', header: 'Mix water (bbl)', align: 'right', width: 130, render: (r) => fmt(r.mixWaterBbl) },
    {
      key: 'additive',
      header: 'Additive',
      maxWidth: 180,
      render: (r) => r.additive ?? <span style={{ color: 'var(--text-muted)' }}>-</span>,
    },
    {
      key: 'plugBumpedPsi',
      header: 'Plug bumped (psi)',
      align: 'right',
      width: 145,
      render: (r) => fmt(r.plugBumpedPsi),
    },
    { key: 'topOfCementMd', header: 'TOC (m)', align: 'right', width: 105, render: (r) => fmt(r.topOfCementMd) },
    {
      key: 'evaluation',
      header: 'Evaluasi',
      width: 110,
      render: (r) => <EvaluationBadge value={r.evaluation} />,
    },
    {
      key: 'status',
      header: 'Status',
      width: 130,
      render: (r) => <CementStatusBadge value={r.status} />,
    },
    {
      key: 'actions',
      header: 'Aksi',
      width: 130,
      render: (r) =>
        canEdit ? (
          <span style={{ display: 'inline-flex', gap: 6 }}>
            <RowAction label="Edit" onClick={() => openEditCement(r)} title={`Edit job semen ${r.section}`} />
            <RowAction label="Hapus" tone="danger" onClick={() => setDeleteTarget(r)} title={`Hapus job semen ${r.section}`} />
          </span>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>-</span>
        ),
    },
  ];

  const casingError = casing.error;
  const cementError = cement.error;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!canEdit && (
        <Note kind="info">
          Anda hanya dapat melihat desain casing dan program semen. Perubahan membutuhkan izin <strong>wellfile:edit</strong>.
        </Note>
      )}

      {/* ---------------- A. Desain casing ---------------- */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Desain Casing</h2>
          <Badge kind="Draft">{draft.length} section</Badge>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={addCasingRow} disabled={!canEdit || savingCasing}>
              <Plus size={16} aria-hidden /> Tambah Baris
            </Button>
            <Button variant="primary" onClick={saveCasing} loading={savingCasing} disabled={!canEdit}>
              <Save size={16} aria-hidden /> Simpan Desain
            </Button>
          </span>
        </div>

        {casingError && (
          <div
            role="alert"
            style={{
              background: 'var(--danger-soft)',
              border: '1px solid var(--danger)',
              borderRadius: 8,
              padding: 12,
              color: 'var(--danger-deep)',
              fontSize: 13,
              marginBottom: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <span>{casingError}</span>
            <Button variant="secondary" onClick={() => casing.reload()}>
              Coba lagi
            </Button>
          </div>
        )}

        <DataTable
          columns={casingColumns}
          rows={draft}
          rowKey={(r) => r.key}
          loading={casing.loading && !casing.data}
          dense
          maxHeight={420}
          empty="Belum ada desain casing untuk sumur ini. Tambahkan baris conductor, surface, intermediate, atau production lalu simpan."
        />

        <div
          style={{
            display: 'flex',
            gap: 16,
            flexWrap: 'wrap',
            borderTop: '1px solid var(--border-default)',
            marginTop: 12,
            paddingTop: 12,
            fontSize: 13,
          }}
        >
          <span style={{ fontWeight: 700 }}>Total joints</span>
          <span className="tnum" style={{ fontWeight: 800, color: 'var(--accent-teal)' }}>
            {totalJoints.toLocaleString('en-US')}
          </span>
          <span style={{ color: 'var(--text-secondary)' }}>
            Urutan baris disimpan sebagai sortOrder (1..n) saat tombol Simpan Desain ditekan.
          </span>
        </div>
      </Card>

      {/* ---------------- B. Program semen ---------------- */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Program Semen</h2>
          <Badge kind="Draft">{cementItems.length} job</Badge>
          <span style={{ marginLeft: 'auto' }}>
            <Button
              variant="primary"
              onClick={openCreateCement}
              disabled={!canEdit || savingCement}
              title={canEdit ? 'Tambah job semen' : 'Anda tidak memiliki izin mengubah data sumur'}
            >
              <Plus size={16} aria-hidden /> Tambah Job Semen
            </Button>
          </span>
        </div>

        {cementError && (
          <div
            role="alert"
            style={{
              background: 'var(--danger-soft)',
              border: '1px solid var(--danger)',
              borderRadius: 8,
              padding: 12,
              color: 'var(--danger-deep)',
              fontSize: 13,
              marginBottom: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <span>{cementError}</span>
            <Button variant="secondary" onClick={() => cement.reload()}>
              Coba lagi
            </Button>
          </div>
        )}

        <DataTable
          columns={cementColumns}
          rows={cementItems}
          rowKey={(r) => r.id}
          zebra
          dense
          loading={cement.loading && !cement.data}
          maxHeight={480}
          empty="Belum ada job semen untuk sumur ini. Tambahkan job primary, squeeze, plug, atau liner."
        />
      </Card>

      {/* ---------------- Modal job semen ---------------- */}
      <Modal
        open={cementModalOpen}
        onClose={() => setCementModalOpen(false)}
        title={editingCement ? 'Edit Job Semen' : 'Tambah Job Semen'}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
          <Labeled label="Section" htmlFor="cement-section">
            <select
              id="cement-section"
              style={inStyle()}
              value={cementForm.section}
              onChange={(e) => setCementField('section', e.target.value)}
            >
              {CASING_SECTIONS.map((s) => (
                <option key={s} value={s}>
                  {SECTION_LABEL[s] ?? s}
                </option>
              ))}
            </select>
          </Labeled>

          <Labeled label="Job Type" htmlFor="cement-job-type">
            <select
              id="cement-job-type"
              style={inStyle()}
              value={cementForm.jobType}
              onChange={(e) => setCementField('jobType', e.target.value)}
            >
              {JOB_TYPES.map((t) => (
                <option key={t} value={t}>
                  {JOB_TYPE_LABEL[t] ?? t}
                </option>
              ))}
            </select>
          </Labeled>

          <Labeled label="Tanggal Rencana" htmlFor="cement-planned">
            <input
              id="cement-planned"
              type="date"
              className="tnum"
              style={inStyle()}
              value={cementForm.plannedDate}
              onChange={(e) => setCementField('plannedDate', e.target.value)}
            />
          </Labeled>

          <Labeled label="Tanggal Aktual" htmlFor="cement-executed">
            <input
              id="cement-executed"
              type="date"
              className="tnum"
              style={inStyle()}
              value={cementForm.executedDate}
              onChange={(e) => setCementField('executedDate', e.target.value)}
            />
          </Labeled>

          <Labeled label="Slurry type" htmlFor="cement-slurry-type">
            <input
              id="cement-slurry-type"
              type="text"
              maxLength={40}
              placeholder="mis. Class G"
              style={inStyle()}
              value={cementForm.slurryType}
              onChange={(e) => setCementField('slurryType', e.target.value)}
            />
          </Labeled>

          <Labeled label="Slurry density (ppg)" htmlFor="cement-density">
            <input
              id="cement-density"
              type="number"
              step="0.001"
              min={0}
              className="tnum"
              style={inStyle()}
              value={cementForm.slurryDensityPpg}
              onChange={(e) => setCementField('slurryDensityPpg', e.target.value)}
            />
          </Labeled>

          <Labeled label="Yield (ft3/sx)" htmlFor="cement-yield">
            <input
              id="cement-yield"
              type="number"
              step="0.001"
              min={0}
              className="tnum"
              style={inStyle()}
              value={cementForm.yieldFt3Sx}
              onChange={(e) => setCementField('yieldFt3Sx', e.target.value)}
            />
          </Labeled>

          <Labeled label="Volume (bbl)" htmlFor="cement-volume">
            <input
              id="cement-volume"
              type="number"
              step="0.01"
              min={0}
              className="tnum"
              style={inStyle()}
              value={cementForm.volumeBbl}
              onChange={(e) => setCementField('volumeBbl', e.target.value)}
            />
          </Labeled>

          <Labeled label="Sacks (sx)" htmlFor="cement-sacks">
            <input
              id="cement-sacks"
              type="number"
              step={1}
              min={0}
              className="tnum"
              style={inStyle()}
              value={cementForm.sacksSx}
              onChange={(e) => setCementField('sacksSx', e.target.value)}
            />
          </Labeled>

          <Labeled label="Mix water (bbl)" htmlFor="cement-mix-water">
            <input
              id="cement-mix-water"
              type="number"
              step="0.01"
              min={0}
              className="tnum"
              style={inStyle()}
              value={cementForm.mixWaterBbl}
              onChange={(e) => setCementField('mixWaterBbl', e.target.value)}
            />
          </Labeled>

          <Labeled label="Plug bumped (psi)" htmlFor="cement-plug-psi">
            <input
              id="cement-plug-psi"
              type="number"
              step="0.01"
              min={0}
              className="tnum"
              style={inStyle()}
              value={cementForm.plugBumpedPsi}
              onChange={(e) => setCementField('plugBumpedPsi', e.target.value)}
            />
          </Labeled>

          <Labeled label="TOC (m MD)" htmlFor="cement-toc">
            <input
              id="cement-toc"
              type="number"
              step="0.01"
              min={0}
              className="tnum"
              style={inStyle()}
              value={cementForm.topOfCementMd}
              onChange={(e) => setCementField('topOfCementMd', e.target.value)}
            />
          </Labeled>

          <Labeled label="Evaluasi" htmlFor="cement-evaluation">
            <select
              id="cement-evaluation"
              style={inStyle()}
              value={cementForm.evaluation}
              onChange={(e) => setCementField('evaluation', e.target.value)}
            >
              {EVALUATIONS.map((v) => (
                <option key={v} value={v}>
                  {EVALUATION_LABEL[v] ?? v}
                </option>
              ))}
            </select>
          </Labeled>

          <Labeled label="Status" htmlFor="cement-status">
            <select
              id="cement-status"
              style={inStyle()}
              value={cementForm.status}
              onChange={(e) => setCementField('status', e.target.value)}
            >
              {CEMENT_STATUSES.map((v) => (
                <option key={v} value={v}>
                  {CEMENT_STATUS_LABEL[v] ?? v}
                </option>
              ))}
            </select>
          </Labeled>

          <div style={{ gridColumn: '1 / -1' }}>
            <Labeled label="Additive" htmlFor="cement-additive">
              <textarea
                id="cement-additive"
                rows={2}
                maxLength={4000}
                style={{ ...inStyle(), height: 'auto', padding: '8px 12px', resize: 'vertical' }}
                value={cementForm.additive}
                onChange={(e) => setCementField('additive', e.target.value)}
              />
            </Labeled>
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <Labeled label="Catatan" htmlFor="cement-notes">
              <textarea
                id="cement-notes"
                rows={2}
                maxLength={4000}
                style={{ ...inStyle(), height: 'auto', padding: '8px 12px', resize: 'vertical' }}
                value={cementForm.notes}
                onChange={(e) => setCementField('notes', e.target.value)}
              />
            </Labeled>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <Button variant="secondary" onClick={() => setCementModalOpen(false)} disabled={savingCement}>
            Batal
          </Button>
          <Button variant="primary" onClick={saveCement} loading={savingCement}>
            {editingCement ? 'Simpan Perubahan' : 'Tambah Job Semen'}
          </Button>
        </div>
      </Modal>

      {/* ---------------- Konfirmasi hapus job semen ---------------- */}
      <Modal open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="Hapus Job Semen">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p role="alert" style={{ margin: 0, fontSize: 13 }}>
            Hapus job semen <strong>{deleteTarget ? (SECTION_LABEL[deleteTarget.section] ?? deleteTarget.section) : ''}</strong>
            {deleteTarget ? ` (${JOB_TYPE_LABEL[deleteTarget.jobType] ?? deleteTarget.jobType})` : ''}? Data hilang dari daftar,
            jejak audit tetap tersimpan.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={deletingCement}>
              Batal
            </Button>
            <Button variant="danger-ghost" onClick={confirmDeleteCement} loading={deletingCement}>
              Hapus
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
