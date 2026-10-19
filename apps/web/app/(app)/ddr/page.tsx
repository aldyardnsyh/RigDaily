'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileText,
  PenTool,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card } from '@rigdaily/ui';
import { formatHours, formatMeters, formatUsd, type Permission, type RoleId } from '@rigdaily/shared';
import { Labeled, Modal, Note, ProgressBar, inStyle } from '@/components/controls';
import { StatusBadge, TimeClassBadge } from '@/components/StatusBadge';
import { ValidationPanel } from '@/components/ValidationPanel';
import { ApiClientError, apiGet, apiSend, apiUrl } from '@/lib/api-client';
import { todayIsoLocal } from '@/lib/date';
import { useApi } from '@/lib/hooks/useApi';
import { useActiveWell } from '@/lib/hooks/useActiveWell';
import type {
  AuditEntryDto,
  BhaDto,
  CostLineDto,
  CrewDto,
  DashboardKpi,
  ReportDetail,
  ReportListItem,
  TimeMix,
  WellDto,
} from '@/lib/repo/types';

type ReportsList = { items: ReportListItem[]; total: number };
type DashboardPayload = {
  kpi: DashboardKpi;
  reports: ReportListItem[];
  trend: unknown[];
  timeMix: TimeMix | null;
  wellId: string | null;
};
type ValidationResult = {
  ok: boolean;
  totalMinutes: number;
  issues: Array<{ severity: string; code: string; message: string; rowIndex?: number }>;
};
type CreatedReport = { id: string; reportNo: number };
/** GET /api/auth/me - hanya bagian yang dipakai halaman ini. */
type MeDto = { user: { id: string; name: string; role: RoleId }; permissions: Permission[] };

type CbhaApi = { reportId: string; items: BhaDto[] };

const AMENDABLE = new Set(['approved', 'distributed', 'locked']);

/* ------------------------------------------------------------------ */
/* Enum DDR - nilai DB bisa "kotor" (impor CSV / sync), jadi dinormalkan */
/* ------------------------------------------------------------------ */

const SHIFTS = ['Day', 'Night'] as const;
type Shift = (typeof SHIFTS)[number];

const POB_STATUSES = ['in', 'out'] as const;
type PobStatus = (typeof POB_STATUSES)[number];

/** Shift selain `Day`/`Night` → `Day` (memperbaiki bucket POB/man-hours). */
function normShift(value: unknown): Shift {
  return (SHIFTS as readonly string[]).includes(String(value)) ? (String(value) as Shift) : 'Day';
}

/** POB selain `in`/`out` → `in`. */
function normPob(value: unknown): PobStatus {
  return (POB_STATUSES as readonly string[]).includes(String(value)) ? (String(value) as PobStatus) : 'in';
}

/** Jam kerja → angka 0..24 (di luar rentang dijepit, bukan dibuang). */
function clampHours(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** String input angka → number | null (kosong/tidak valid = null). */
function numOrNull(text: string): number | null {
  if (text.trim() === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** Baris crew yang sedang diedit di tabel (semua field berupa teks input). */
type CrewDraft = {
  key: string;
  name: string;
  position: string;
  company: string;
  shift: Shift;
  hours: string;
  pobStatus: PobStatus;
  musterStation: string;
};

let draftSeq = 0;
function nextCrewKey(): string {
  draftSeq += 1;
  return `crew-${draftSeq}`;
}

/** CrewDto server → baris editable (shift/POB dinormalkan ke enum zod). */
function crewToDraft(c: CrewDto): CrewDraft {
  return {
    key: c.id,
    name: c.name,
    position: c.position,
    company: c.company ?? '',
    shift: normShift(c.shift),
    hours: String(c.hours),
    pobStatus: normPob(c.pobStatus),
    musterStation: c.musterStation ?? '',
  };
}

function emptyCrewDraft(): CrewDraft {
  return { key: nextCrewKey(), name: '', position: '', company: '', shift: 'Day', hours: '12', pobStatus: 'in', musterStation: '' };
}

type MudDraft = {
  weightPpg: string;
  viscositySecQt: string;
  ph: string;
  pv: string;
  yp: string;
  chemicalsAdded: string;
  costUsd: string;
};

/* ------------------------------------------------------------------ */
/* Helper error & izin                                                 */
/* ------------------------------------------------------------------ */

/** True bila error API berstatus tertentu (mis. 403 = izin kurang). */
function isApiClientError(err: unknown, status: number): boolean {
  return err instanceof ApiClientError && err.status === status;
}

/** Pesan 403 yang eksplisit per permission. */
function forbiddenMessage(permission: Permission): string {
  return `Anda tidak memiliki izin "${permission}" untuk mengubah data ini. Minta Administrator menambahkan permission tersebut pada role Anda.`;
}

/** Bahasa manusia untuk tombol yang dinonaktifkan karena role. */
function roleReason(permission: Permission): string {
  return `Role Anda tidak memiliki izin "${permission}".`;
}

/* ------------------------------------------------------------------ */
/* Small presentational helpers                                        */
/* ------------------------------------------------------------------ */

function Skeleton({ h = 16, w = '100%' }: { h?: number; w?: number | string }) {
  return <div aria-hidden style={{ height: h, width: w, background: 'var(--bg-surface-2)', borderRadius: 4 }} />;
}

function SectionSkeleton() {
  return (
    <Card>
      <Skeleton h={18} w="40%" />
      <div style={{ height: 12 }} />
      <Skeleton h={12} />
      <div style={{ height: 6 }} />
      <Skeleton h={12} w="80%" />
      <div style={{ height: 6 }} />
      <Skeleton h={12} w="60%" />
    </Card>
  );
}

function Param({ k, v, hot }: { k: string; v: string; hot?: boolean }) {
  return (
    <div style={{ background: hot ? 'var(--success-soft)' : 'var(--bg-surface-2)', borderRadius: 4, padding: '8px 10px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>{k}</div>
      <div className="tnum" style={{ fontSize: 13, fontWeight: 600, color: hot ? 'var(--success)' : undefined }}>
        {v}
      </div>
    </div>
  );
}

/**
 * Payload POST /api/reports untuk copy-forward: depth start = depth end sebelumnya.
 *
 * SANITASI WAJIB - nilai bisa datang dari impor CSV / sync device sehingga:
 * - `shift` dipaksa `Day|Night`, `pobStatus` dipaksa `in|out` (enum `zCrewRow`);
 * - `nptFlag` jadi boolean sungguhan;
 * - semua field numerik jadi number (bukan string `"12.40"` dari numeric DB);
 * - field di luar schema `zDailyReportPayload` TIDAK ikut (payload dibangun
 *   eksplisit per field, tanpa spread objek DTO).
 */
function copyForwardPayload(prev: ReportDetail, wellId: string, reportDate: string): Record<string, unknown> {
  const start = prev.depthMdEnd;

  const timeRows = prev.timeRows.map((r) => ({
    start: r.start,
    end: r.end,
    iadcCode: r.iadcCode,
    iadcSubcode: r.iadcSubcode ?? null,
    vendor: r.vendor ?? null,
    nptFlag: Boolean(r.nptFlag),
    remarks: r.remarks ?? null,
  }));

  const crew = prev.crew
    // Nama kosong akan ditolak `zCrewRow.name.min(1)` - buang baris rusak.
    .filter((c) => c.name.trim().length > 0)
    .map((c) => ({
      name: c.name.trim(),
      position: c.position?.trim() ? c.position.trim() : 'Crew',
      company: c.company ?? null,
      shift: normShift(c.shift),
      hours: clampHours(Number(c.hours), 0, 24),
      pobStatus: normPob(c.pobStatus),
      musterStation: c.musterStation ?? null,
    }));

  const mud = prev.mud
    ? {
        weightPpg: prev.mud.weightPpg === null ? null : Number(prev.mud.weightPpg),
        viscositySecQt: prev.mud.viscositySecQt === null ? null : Number(prev.mud.viscositySecQt),
        ph: prev.mud.ph === null ? null : Number(prev.mud.ph),
        pv: prev.mud.pv === null ? null : Number(prev.mud.pv),
        yp: prev.mud.yp === null ? null : Number(prev.mud.yp),
        chemicalsAdded: prev.mud.chemicalsAdded ?? null,
        costUsd: prev.mud.costUsd === null ? null : Number(prev.mud.costUsd),
      }
    : null;

  const costLines = prev.costLines
    // `zCostLine.amount` menolak 0 - baris tanpa nominal tidak berguna bila disalin.
    .filter((c) => Number(c.amount) !== 0)
    .map((c) => ({
      category: c.category,
      description: c.description,
      vendor: c.vendor ?? null,
      afeCode: c.afeCode ?? null,
      billingType: c.billingType ?? null,
      amount: Number(c.amount),
      rebillable: Boolean(c.rebillable),
    }));

  return {
    wellId,
    rigId: prev.rigId ?? null,
    reportDate,
    periodFrom: prev.periodFrom,
    periodTo: prev.periodTo,
    depthMdStart: Number(start),
    depthMdEnd: Number(start),
    depthTvd: prev.depthTvd === null ? null : Number(prev.depthTvd),
    summary: null,
    planNext: prev.planNext ?? null,
    geologyNotes: null,
    equipmentStatus: prev.equipmentStatus ?? null,
    timeRows,
    crew,
    mud,
    bha: prev.bha.map((b) => ({
      component: b.component,
      odIn: b.odIn === null ? null : Number(b.odIn),
      lengthM: b.lengthM === null ? null : Number(b.lengthM),
      hours: b.hours === null ? null : Number(b.hours),
    })),
    costLines,
  };
}

function parseEquipment(text: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      if (key) out[key] = val;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function DdrPage() {
  const router = useRouter();

  /* ---------- data fetch ---------- */

  /*
   * Sumur aktif berasal dari `useActiveWell` yang REAKTIF terhadap ?wellId=.
   * Sebelumnya nilai URL dibaca dengan useMemo([]) sehingga tidak berubah saat
   * user mengganti sumur lewat WellSwitcher di topbar.
   */
  const activeWell = useActiveWell();
  const wells: WellDto[] = activeWell.wells;
  const wellId = activeWell.wellId;
  const well = activeWell.well;

  const reportsList = useApi<ReportsList>(wellId ? `/api/reports?wellId=${wellId}&limit=1` : null);
  const latest = reportsList.data?.items?.[0] ?? null;
  const reportId = latest?.id ?? null;

  const detail = useApi<ReportDetail>(reportId ? `/api/reports/${reportId}` : null);
  const dash = useApi<DashboardPayload>(wellId ? `/api/dashboard?wellId=${wellId}` : null);
  const audit = useApi<AuditEntryDto[]>(reportId ? `/api/audit?entity=daily_report&entityId=${reportId}&limit=8` : null);

  const report = detail.data;

  const reloadAll = useCallback(() => {
    reportsList.reload();
    detail.reload();
    dash.reload();
    audit.reload();
  }, [reportsList.reload, detail.reload, dash.reload, audit.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- identitas & permission sesi ---------- */
  const me = useApi<MeDto>('/api/auth/me');
  const perms = useMemo(() => new Set<Permission>(me.data?.permissions ?? []), [me.data]);
  const canCreate = perms.has('report:create');
  const canApprove = perms.has('report:approve');
  const canEditDraft = perms.has('report:edit-draft');
  const canPersonnel = perms.has('personnel:edit');
  const canTime = perms.has('time:edit');

  /* ---------- editable header state ---------- */
  const [depthStart, setDepthStart] = useState('');
  const [depthEnd, setDepthEnd] = useState('');
  const [summary, setSummary] = useState('');
  const [planNext, setPlanNext] = useState('');
  const [equip, setEquip] = useState('');
  const [geology, setGeology] = useState('');
  const [saving, setSaving] = useState(false);

  /* ---------- editable child state (crew / mud / BHA) ---------- */
  const [crewRows, setCrewRows] = useState<CrewDraft[]>([]);
  const [savingCrew, setSavingCrew] = useState(false);

  const [mud, setMud] = useState<MudDraft>({
    weightPpg: '',
    viscositySecQt: '',
    ph: '',
    pv: '',
    yp: '',
    chemicalsAdded: '',
    costUsd: '',
  });
  const [savingMud, setSavingMud] = useState(false);

  const [bhaRows, setBhaRows] = useState<Array<{ key: string; component: string; odIn: string; lengthM: string; hours: string }>>([]);
  const [savingBha, setSavingBha] = useState(false);

  const detailKey = report ? `${report.id}:${report.revision}` : null;
  const [formKey, setFormKey] = useState<string | null>(null);
  useEffect(() => {
    if (!report || formKey === detailKey) return;
    setDepthStart(String(report.depthMdStart));
    setDepthEnd(String(report.depthMdEnd));
    setSummary(report.summary ?? '');
    setPlanNext(report.planNext ?? '');
    setGeology(report.geologyNotes ?? '');
    setEquip(
      report.equipmentStatus
        ? Object.entries(report.equipmentStatus)
            .map(([k, v]) => `${k}: ${v}`)
            .join('\n')
        : '',
    );
    setCrewRows(report.crew.map(crewToDraft));
    setMud({
      weightPpg: report.mud?.weightPpg != null ? String(report.mud.weightPpg) : '',
      viscositySecQt: report.mud?.viscositySecQt != null ? String(report.mud.viscositySecQt) : '',
      ph: report.mud?.ph != null ? String(report.mud.ph) : '',
      pv: report.mud?.pv != null ? String(report.mud.pv) : '',
      yp: report.mud?.yp != null ? String(report.mud.yp) : '',
      chemicalsAdded: report.mud?.chemicalsAdded ?? '',
      costUsd: report.mud?.costUsd != null ? String(report.mud.costUsd) : '',
    });
    setBhaRows(
      report.bha.map((b) => ({
        key: b.id,
        component: b.component,
        odIn: b.odIn != null ? String(b.odIn) : '',
        lengthM: b.lengthM != null ? String(b.lengthM) : '',
        hours: b.hours != null ? String(b.hours) : '',
      })),
    );
    setFormKey(detailKey);
  }, [report, detailKey, formKey]);

  /* ---------- validation banner state (local override) ---------- */
  const [validateResult, setValidateResult] = useState<ValidationResult | null>(null);
  const validation: ValidationResult | null = validateResult ?? (report ? report.validation : null);

  const isDraft = report?.status === 'draft';
  /** Edit anak laporan butuh draft + izin header draft. */
  const canEditChildren = isDraft && canEditDraft;

  /* ---------- live man-hours (dihitung dari input jam yang sedang diisi) ---------- */
  const manHours = useMemo(
    () => crewRows.reduce((acc, c) => acc + clampHours(Number(c.hours || '0'), 0, 24), 0),
    [crewRows],
  );
  const pobIn = useMemo(() => crewRows.filter((c) => c.pobStatus === 'in').length, [crewRows]);

  /* ---------- actions ---------- */
  async function saveHeader() {
    if (!report) return;
    const s = Number(depthStart);
    const e = Number(depthEnd);
    if (!Number.isFinite(s) || !Number.isFinite(e)) {
      toast.error('Kedalaman awal/akhir harus berupa angka.');
      return;
    }
    setSaving(true);
    try {
      await apiSend<ReportDetail>(`/api/reports/${report.id}`, 'PATCH', {
        depthMdStart: s,
        depthMdEnd: e,
        summary: summary.trim() ? summary : null,
        planNext: planNext.trim() ? planNext : null,
        // `geologyNotes` diterima PATCH /api/reports/[id] (lihat route.ts:23).
        geologyNotes: geology.trim() ? geology : null,
        equipmentStatus: parseEquipment(equip),
      });
      toast.success('Header DDR tersimpan.');
      reloadAll();
    } catch (err) {
      toast.error(isApiClientError(err, 403) ? forbiddenMessage('report:edit-draft') : err instanceof Error ? err.message : 'Gagal menyimpan header.');
    } finally {
      setSaving(false);
    }
  }

  /* ---------- crew / POB ---------- */

  function addCrewRow() {
    setCrewRows((rows) => [...rows, emptyCrewDraft()]);
  }

  function updateCrewRow(key: string, patch: Partial<CrewDraft>) {
    setCrewRows((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeCrewRow(key: string) {
    setCrewRows((rows) => rows.filter((r) => r.key !== key));
  }

  async function saveCrew() {
    if (!report) return;
    const rows = crewRows.filter((c) => c.name.trim().length > 0);
    if (rows.length !== crewRows.length) {
      toast.error('Setiap baris kru wajib punya nama. Kosongkan atau hapus baris tersebut.');
      return;
    }
    setSavingCrew(true);
    try {
      await apiSend(`/api/reports/${report.id}/crew`, 'PUT', {
        // Enum dipaksa: shift ∈ {Day,Night}, pobStatus ∈ {in,out} (zCrewRow).
        crew: rows.map((c) => ({
          name: c.name.trim(),
          position: c.position.trim() ? c.position.trim() : 'Crew',
          company: c.company.trim() ? c.company.trim() : null,
          shift: normShift(c.shift),
          hours: clampHours(Number(c.hours || '0'), 0, 24),
          pobStatus: normPob(c.pobStatus),
          musterStation: c.musterStation.trim() ? c.musterStation.trim() : null,
        })),
      });
      toast.success(`Data kru & POB tersimpan (${rows.length} orang, ${manHours.toFixed(1)} man-hours).`);
      reloadAll();
    } catch (err) {
      toast.error(isApiClientError(err, 403) ? forbiddenMessage('personnel:edit') : err instanceof Error ? err.message : 'Gagal menyimpan data kru.');
    } finally {
      setSavingCrew(false);
    }
  }

  /* ---------- mud ---------- */

  async function saveMud() {
    if (!report) return;
    const toNum = (text: string, label: string, max: number): number | null | undefined => {
      const n = numOrNull(text);
      if (n === null && text.trim() !== '') {
        toast.error(`${label} harus berupa angka.`);
        return undefined;
      }
      if (n !== null && (n < 0 || n > max)) {
        toast.error(`${label} harus di antara 0 dan ${max}.`);
        return undefined;
      }
      return n;
    };

    const weightPpg = toNum(mud.weightPpg, 'Mud weight', 30);
    const viscositySecQt = toNum(mud.viscositySecQt, 'Viskositas', 300);
    const ph = toNum(mud.ph, 'pH', 14);
    const pv = toNum(mud.pv, 'PV', 1000);
    const yp = toNum(mud.yp, 'YP', 1000);
    const costUsd = toNum(mud.costUsd, 'Biaya lumpur', 100_000_000);
    if (weightPpg === undefined || viscositySecQt === undefined || ph === undefined || pv === undefined || yp === undefined || costUsd === undefined) {
      return;
    }

    setSavingMud(true);
    try {
      await apiSend(`/api/reports/${report.id}/mud`, 'PUT', {
        weightPpg,
        viscositySecQt,
        ph,
        pv,
        yp,
        chemicalsAdded: mud.chemicalsAdded.trim() ? mud.chemicalsAdded.trim() : null,
        costUsd,
      });
      toast.success('Data lumpur (mud) tersimpan.');
      reloadAll();
    } catch (err) {
      toast.error(isApiClientError(err, 403) ? forbiddenMessage('time:edit') : err instanceof Error ? err.message : 'Gagal menyimpan data lumpur.');
    } finally {
      setSavingMud(false);
    }
  }

  /* ---------- BHA ---------- */

  function addBhaRow() {
    draftSeq += 1;
    setBhaRows((rows) => [...rows, { key: `bha-${draftSeq}`, component: '', odIn: '', lengthM: '', hours: '' }]);
  }

  function updateBhaRow(key: string, patch: Partial<{ component: string; odIn: string; lengthM: string; hours: string }>) {
    setBhaRows((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeBhaRow(key: string) {
    setBhaRows((rows) => rows.filter((r) => r.key !== key));
  }

  async function saveBha() {
    if (!report) return;
    const rows = bhaRows.filter((b) => b.component.trim().length > 0);
    if (rows.length !== bhaRows.length) {
      toast.error('Setiap komponen BHA wajib punya nama komponen.');
      return;
    }
    const items: Array<{ component: string; odIn: number | null; lengthM: number | null; hours: number | null }> = [];
    for (const [i, b] of rows.entries()) {
      const odIn = numOrNull(b.odIn);
      const lengthM = numOrNull(b.lengthM);
      const hours = numOrNull(b.hours);
      if ((b.odIn.trim() !== '' && odIn === null) || (b.lengthM.trim() !== '' && lengthM === null) || (b.hours.trim() !== '' && hours === null)) {
        toast.error(`Baris BHA ${i + 1}: OD, panjang, dan jam harus berupa angka.`);
        return;
      }
      if (odIn !== null && (odIn < 0 || odIn > 60)) {
        toast.error(`Baris BHA ${i + 1}: OD harus di antara 0 dan 60 inci.`);
        return;
      }
      if (hours !== null && (hours < 0 || hours > 24)) {
        toast.error(`Baris BHA ${i + 1}: jam harus di antara 0 dan 24.`);
        return;
      }
      items.push({ component: b.component.trim(), odIn, lengthM, hours });
    }

    setSavingBha(true);
    try {
      await apiSend<CbhaApi>(`/api/reports/${report.id}/bha`, 'PUT', { items });
      toast.success(`Komponen BHA tersimpan (${items.length} baris).`);
      reloadAll();
    } catch (err) {
      toast.error(isApiClientError(err, 403) ? forbiddenMessage('time:edit') : err instanceof Error ? err.message : 'Gagal menyimpan komponen BHA.');
    } finally {
      setSavingBha(false);
    }
  }

  const [validating, setValidating] = useState(false);
  async function runValidate() {
    if (!report) return;
    setValidating(true);
    try {
      const res = await apiSend<ValidationResult>(`/api/reports/${report.id}/validate`, 'POST');
      setValidateResult(res);
      const errorCount = res.issues.filter((i) => i.severity === 'error').length;
      toast[res.ok ? 'success' : 'warning'](
        res.ok ? 'Validasi lolos: total 24.0 jam terkonfirmasi.' : `Validasi gagal: ${errorCount} kesalahan harus diperbaiki.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Validasi gagal dijalankan. Coba lagi.');
    } finally {
      setValidating(false);
    }
  }

  const [submitting, setSubmitting] = useState(false);
  async function submit() {
    if (!report) return;
    setSubmitting(true);
    try {
      await apiSend(`/api/reports/${report.id}/submit`, 'POST');
      toast.success('DDR dikirim untuk disetujui Company Man.');
      setValidateResult(null);
      reloadAll();
    } catch (err) {
      // 422 → server mengirim daftar issue di `details`.
      if (err instanceof ApiClientError && err.status === 422 && Array.isArray(err.details)) {
        setValidateResult({ ok: false, totalMinutes: report.totalMinutes, issues: err.details as ValidationResult['issues'] });
      }
      toast.error(err instanceof Error ? err.message : 'Gagal mengirim DDR. Periksa validasi 24 jam lalu coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }

  const [approveOpen, setApproveOpen] = useState(false);
  const [signatureName, setSignatureName] = useState('');
  const [approving, setApproving] = useState(false);
  async function approve() {
    if (!report) return;
    if (signatureName.trim().length < 3) {
      toast.error('Nama penanda tangan minimal 3 karakter.');
      return;
    }
    setApproving(true);
    try {
      await apiSend(`/api/reports/${report.id}/approve`, 'POST', { signatureName: signatureName.trim() });
      toast.success('DDR disetujui dan ditandatangani.');
      setApproveOpen(false);
      setSignatureName('');
      reloadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyetujui DDR. Coba lagi.');
    } finally {
      setApproving(false);
    }
  }

  const [amendOpen, setAmendOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [amending, setAmending] = useState(false);
  async function amend() {
    if (!report) return;
    if (reason.trim().length < 10) {
      toast.error('Alasan amendemen minimal 10 karakter.');
      return;
    }
    setAmending(true);
    try {
      const created = await apiSend<CreatedReport>(`/api/reports/${report.id}/amend`, 'POST', {
        reportId: report.id,
        reason: reason.trim(),
        changes: {},
      });
      toast.success(`Amendemen dibuat: DDR #${created.reportNo}.`);
      setAmendOpen(false);
      setReason('');
      // Pindah ke report terbaru (halaman fetch limit=1) lalu paksa refresh penuh.
      router.push('/ddr');
      router.refresh();
      reloadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal membuat amendemen. Coba lagi.');
    } finally {
      setAmending(false);
    }
  }

  const [copying, setCopying] = useState(false);
  async function copyForward() {
    if (!wellId) return;
    const today = todayIsoLocal();

    if (!canCreate) {
      toast.error(forbiddenMessage('report:create'));
      return;
    }

    setCopying(true);
    try {
      /* Sumber salinan SELALU dari server (laporan terakhir sebelum hari ini),
         bukan dari laporan yang kebetulan terbuka - jadi status laporan sumber
         (draft/submitted/approved) tidak lagi menghalangi copy-forward. */
      const prev = await apiGet<ReportDetail | null>(
        `/api/reports/previous?wellId=${encodeURIComponent(wellId)}&before=${today}`,
      );
      if (!prev) {
        toast.info('Belum ada laporan sebelumnya untuk sumur ini. Buat DDR pertama lewat tombol Buat DDR Pertama.');
        return;
      }
      if (prev.reportDate === today) {
        toast.info('Sudah ada laporan untuk hari ini.');
        return;
      }
      const created = await apiSend<CreatedReport>('/api/reports', 'POST', copyForwardPayload(prev, wellId, today));
      toast.success(`Draft baru dibuat: DDR #${created.reportNo}. lengkapi 24 jam di Time Breakdown.`);
      reloadAll();
      // Laporan terbaru kini draft baru - pindah ke daftar hari ini.
      router.refresh();
    } catch (err) {
      toast.error(isApiClientError(err, 403) ? forbiddenMessage('report:create') : err instanceof Error ? err.message : 'Gagal menyalin laporan sebelumnya ke hari ini. Coba lagi.');
    } finally {
      setCopying(false);
    }
  }

  /* ---------- DDR pertama untuk sumur baru (P0-6) ---------- */
  const [firstOpen, setFirstOpen] = useState(false);
  const [firstDate, setFirstDate] = useState(() => todayIsoLocal());
  const [firstDepthStart, setFirstDepthStart] = useState('0');
  const [firstDepthEnd, setFirstDepthEnd] = useState('0');
  const [creatingFirst, setCreatingFirst] = useState(false);

  /**
   * Buat DDR pertama lalu arahkan ke `/time`.
   *
   * `POST /api/reports` TIDAK memanggil `validateTimeBreakdown` (hanya
   * `parseBody(zDailyReportPayload)`, lihat reports/route.ts:63-66), jadi skema
   * hanya menuntut `timeRows.min(1)` dengan `start`/`end` format HH:MM. Satu baris
   * placeholder 1 menit (`06:00` → `06:01`, kode IADC 01) dipakai sebagai titik
   * awal; user langsung diarahkan melengkapi 24 jam di Time Breakdown.
   */
  async function createFirstReport() {
    if (!wellId) return;
    if (!canCreate) {
      toast.error(forbiddenMessage('report:create'));
      return;
    }
    const s = Number(firstDepthStart);
    const e = Number(firstDepthEnd);
    if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e < 0) {
      toast.error('Kedalaman awal/akhir harus berupa angka ≥ 0.');
      return;
    }
    if (e < s) {
      toast.error('Kedalaman akhir tidak boleh lebih kecil dari kedalaman awal.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDate)) {
      toast.error('Tanggal laporan harus berformat YYYY-MM-DD.');
      return;
    }
    setCreatingFirst(true);
    try {
      const created = await apiSend<CreatedReport>('/api/reports', 'POST', {
        wellId,
        reportDate: firstDate,
        depthMdStart: s,
        depthMdEnd: e,
        timeRows: [
          {
            start: '06:00',
            end: '06:01',
            iadcCode: '01',
            nptFlag: false,
            remarks: 'Baris awal - lengkapi 24 jam di Time Breakdown',
          },
        ],
      });
      toast.success(`DDR #${created.reportNo} dibuat. lengkapi 24 jam di Time Breakdown.`);
      setFirstOpen(false);
      reloadAll();
      router.push('/time');
    } catch (err) {
      toast.error(isApiClientError(err, 403) ? forbiddenMessage('report:create') : err instanceof Error ? err.message : 'Gagal membuat DDR pertama.');
    } finally {
      setCreatingFirst(false);
    }
  }

  /* ---------- derived ---------- */
  const kpi = dash.data?.kpi ?? null;
  const costLines: CostLineDto[] = report?.costLines ?? [];
  const catTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of costLines) map.set(l.category, (map.get(l.category) ?? 0) + l.amount);
    return [...map.entries()];
  }, [costLines]);

  const today = todayIsoLocal();
  const reportsToday = latest ? latest.reportDate === today : false;

  const loadingMain = activeWell.loading || reportsList.loading || detail.loading;
  const loadError = activeWell.error ?? reportsList.error ?? detail.error;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ------------ Header bar ------------ */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 data-testid="ddr-title" style={{ margin: 0, fontSize: 20 }}>
          Daily Drilling Report {report ? `#${report.reportNo}` : ''}
        </h1>
        {report && (
          <span data-testid="ddr-status">
            <StatusBadge status={report.status} />
          </span>
        )}
        {report && report.revision > 1 && <Badge kind="Submitted">REV {report.revision}</Badge>}
        {report && (
          <span
            data-testid="ddr-total-hours"
            style={{ display: 'inline-flex', flex: '0 0 auto', minWidth: 0 }}
          >
            <Badge kind={report.validation.ok ? 'Distributed' : 'NPT'}>
              {/*
                Teks badge dibuat satu baris utuh (`whiteSpace: nowrap`) supaya
                tidak melipat ke bawah saat ruang header menyempit.
                Format jam diseragamkan: satu angka desimal di kedua sisi.
              */}
              <span
                className="tnum"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
                title={`Total ${formatHours(report.totalMinutes)} jam dari 24.0 jam`}
              >
                {report.validation.ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                {report.validation.ok
                  ? `${formatHours(report.totalMinutes)} / 24.0 jam`
                  : `${formatHours(report.totalMinutes)} dari 24.0 jam`}
              </span>
            </Badge>
          </span>
        )}
        <span
          style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', minWidth: 0 }}
        >
          {/*
            HIERARKI AKSI (mengurangi kebingungan):
            - 1 aksi UTAMA berwarna ( Submit / Setujui ) sesuai status laporan.
            - Aksi SEKUNDER dikelompokkan menjadi satu baris ringkas.
            - Aksi TERSIER (cetak) masuk dropdown agar tidak memenuhi header.
          */}
          {report && isDraft && (
            <Button
              data-testid="ddr-btn-save"
              variant="secondary"
              onClick={saveHeader}
              disabled={saving}
              title="Simpan perubahan header laporan"
            >
              <Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}
            </Button>
          )}

          <Button
            data-testid="ddr-btn-validate"
            variant="secondary"
            onClick={runValidate}
            disabled={!report || validating}
            title="Periksa kelengkapan 24 jam dan isian wajib"
          >
            <SlidersHorizontal size={16} /> {validating ? 'Memeriksa...' : 'Periksa'}
          </Button>

          {report && AMENDABLE.has(report.status) && (
            <Button data-testid="ddr-btn-amend" variant="secondary" onClick={() => setAmendOpen(true)} title="Buat revisi baru dari laporan final">
              <PenTool size={16} /> Amendemen
            </Button>
          )}

          {report && (
            <details style={{ position: 'relative', display: 'inline-block' }}>
              <summary
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 'var(--control-h)',
                  padding: '0 12px',
                  borderRadius: 'var(--radius-btn)',
                  border: '1px solid var(--border-default)',
                  background: 'var(--bg-surface)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  listStyle: 'none',
                }}
                title="Unduh laporan sebagai PDF"
              >
                <Printer size={16} /> Cetak
              </summary>
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 'calc(100% + 4px)',
                  minWidth: 190,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-input)',
                  boxShadow: 'var(--shadow-pop)',
                  zIndex: 40,
                  padding: 4,
                }}
              >
                <a
                  href={apiUrl(`/api/reports/${report.id}/pdf?type=ddr`)}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: 'block', padding: '8px 10px', fontSize: 13, borderRadius: 4, color: 'var(--text-primary)' }}
                >
                  DDR (Daily Drilling Report)
                </a>
                <a
                  href={apiUrl(`/api/reports/${report.id}/pdf?type=iadc`)}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: 'block', padding: '8px 10px', fontSize: 13, borderRadius: 4, color: 'var(--text-primary)' }}
                >
                  IADC Time Sheet
                </a>
              </div>
            </details>
          )}

          {report?.status === 'submitted' && (
            <Button
              data-testid="ddr-btn-approve"
              onClick={() => setApproveOpen(true)}
              disabled={!canApprove}
              title={canApprove ? 'Setujui dan tanda tangani laporan' : roleReason('report:approve')}
            >
              <PenTool size={16} /> Setujui
            </Button>
          )}

          {report && isDraft && (
            <Button
              data-testid="ddr-btn-submit"
              onClick={submit}
              disabled={submitting || !report.validation.ok}
              title={!report.validation.ok ? 'Validasi 24 jam belum lolos. Perbaiki Time Breakdown lebih dulu.' : 'Kirim laporan untuk disetujui'}
            >
              <Send size={16} /> {submitting ? 'Mengirim...' : 'Kirim'}
            </Button>
          )}
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
        {well ? `Sumur ${well.name}${report?.rigName ? `, Rig ${report.rigName}` : ''}` : 'Memuat sumur...'} - ringkasan operasi 24 jam
      </p>

      {/* ------------ Error ------------ */}
      {loadError && (
        <div role="alert" style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 8, padding: 12, color: 'var(--danger-deep)', fontSize: 13 }}>
          {loadError}{' '}
          <Button variant="secondary" onClick={reloadAll} style={{ marginLeft: 8 }}>
            <RefreshCw size={14} /> Coba Lagi
          </Button>
        </div>
      )}

      {/* Banner validasi rose */}
      {report && validation && !validation.ok && (
        <div role="alert" style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 8, padding: 12, display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <AlertCircle size={20} color="var(--danger)" aria-hidden />
          <div style={{ flex: 1, minWidth: 240 }}>
            <strong style={{ fontSize: 13, color: 'var(--danger-deep)' }}>Validasi belum lolos - submit terkunci.</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13, color: 'var(--danger-deep)' }}>
              {validation.issues
                .filter((i) => i.severity === 'error')
                .map((i, k) => (
                  <li key={k}>{i.message}</li>
                ))}
            </ul>
            <Link href="/time" style={{ fontSize: 13, fontWeight: 700 }}>
              Buka Time Breakdown untuk memperbaiki
            </Link>
          </div>
        </div>
      )}

      {/* Copy-forward bila belum ada report hari ini.
          SENGAJA tidak memakai `!isDraft`: sumber salinan diambil dari server
          (laporan terakhir sebelum hari ini), jadi status laporan yang terbuka
          tidak relevan. Permission diperiksa lebih dulu. */}
      {report && !reportsToday && (
        <Card>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13 }}>
              Belum ada laporan untuk hari ini. Buat draft dari laporan terakhir sebelum hari ini (kedalaman awal = kedalaman akhir
              laporan sebelumnya)?
            </span>
            <Button
              data-testid="ddr-btn-copyforward"
              variant="secondary"
              onClick={copyForward}
              disabled={copying || me.loading}
              title={
                me.loading
                  ? 'Memeriksa izin akun...'
                  : canCreate
                    ? !isDraft
                      ? 'Sumber salinan diambil dari server, bukan dari laporan yang sedang dibuka.'
                      : undefined
                    : roleReason('report:create')
              }
            >
              <RefreshCw size={16} /> {copying ? 'Membuat...' : 'Salin ke Hari Ini'}
            </Button>
          </div>
          {!me.loading && !canCreate && <Note kind="warn">Role Anda tidak memiliki izin &quot;report:create&quot;.</Note>}
        </Card>
      )}

      {loadingMain ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SectionSkeleton />
            <SectionSkeleton />
            <SectionSkeleton />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SectionSkeleton />
            <SectionSkeleton />
          </div>
        </div>
      ) : report ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16 }}>
          {/* ================= LEFT COLUMN ================= */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 01 General Information & Progress */}
            <Card>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: 16, margin: 0 }}>01 General Information &amp; Progress</h2>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginTop: 8 }}>
                <Param k="Rig" v={report.rigName ?? '-'} />
                <Param k="Well Identifier" v={report.wellName} />
                <Param k="Report Date" v={report.reportDate} />
                <Param k="Report Sequence" v={`${report.reportNo} (Rev ${report.revision})`} />
                <Param k="Operational Period" v={`${report.periodFrom}-${report.periodTo} (24 jam)`} />
                <Param k="Depth Start MD" v={formatMeters(report.depthMdStart)} />
                <Param k="Depth End MD" v={formatMeters(report.depthMdEnd)} />
                <Param k="TVD" v={report.depthTvd != null ? formatMeters(report.depthTvd) : '-'} />
                <Param k="24H Footage Gain" v={`${report.progress24h >= 0 ? '+' : ''}${formatMeters(report.progress24h)}`} hot />
              </div>
              {isDraft ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
                  <Labeled label="Depth Start MD (m)" htmlFor="ddr-depth-start">
                    <input id="ddr-depth-start" className="tnum" style={inStyle()} inputMode="decimal" value={depthStart} onChange={(e) => setDepthStart(e.target.value)} />
                  </Labeled>
                  <Labeled label="Depth End MD (m)" htmlFor="ddr-depth-end">
                    <input id="ddr-depth-end" className="tnum" style={inStyle()} inputMode="decimal" value={depthEnd} onChange={(e) => setDepthEnd(e.target.value)} />
                  </Labeled>
                </div>
              ) : (
                <Note kind="info">Laporan submitted/approved hanya bisa diubah lewat amendemen.</Note>
              )}
              <p style={{ fontSize: 12, color: 'var(--success)', fontWeight: 700, display: 'flex', gap: 6, alignItems: 'center', margin: '8px 0 0' }}>
                <TrendingUp size={14} /> Pertambahan kedalaman {formatMeters(report.progress24h)} dari {formatMeters(report.depthMdStart)} ke {formatMeters(report.depthMdEnd)}.
              </p>
            </Card>

            {/* 02 Rig Crew & POB - editable (P0-1) */}
            <Card>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: 16, margin: 0 }}>02 Rig Crew &amp; POB</h2>
                <Badge kind="Draft">
                  <span className="tnum">
                    {crewRows.length} tercatat · {manHours.toFixed(1)} man-hours · POB {pobIn}
                  </span>
                </Badge>
              </div>

              <div style={{ overflowX: 'auto', marginTop: 8 }}>
                <table data-testid="crew-table" style={{ width: '100%', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', fontSize: 12, color: 'var(--text-muted)' }}>
                      <th style={{ paddingBottom: 4 }}>Nama</th>
                      <th style={{ paddingBottom: 4 }}>Posisi</th>
                      <th style={{ paddingBottom: 4 }}>Perusahaan</th>
                      <th style={{ paddingBottom: 4 }}>Shift</th>
                      <th style={{ paddingBottom: 4 }}>Jam</th>
                      <th style={{ paddingBottom: 4 }}>Status POB</th>
                      <th style={{ paddingBottom: 4 }}>Muster Station</th>
                      {canEditChildren && canPersonnel && <th style={{ paddingBottom: 4 }}>Aksi</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {crewRows.length === 0 ? (
                      <tr>
                        <td colSpan={canEditChildren && canPersonnel ? 8 : 7} style={{ color: 'var(--text-muted)', padding: '8px 0' }}>
                          Belum ada data kru. Tambahkan baris lewat tombol Tambah Kru di bawah tabel.
                        </td>
                      </tr>
                    ) : canEditChildren && canPersonnel ? (
                      crewRows.map((c, i) => (
                        <tr key={c.key} style={{ height: 'var(--row-h)' }}>
                          <td>
                            <Labeled label={`Nama kru ${i + 1}`} htmlFor={`crew-name-${i}`}>
                              <input
                                id={`crew-name-${i}`}
                                aria-label={`Nama kru ${i + 1}`}
                                placeholder="Nama lengkap"
                                style={inStyle()}
                                value={c.name}
                                onChange={(e) => updateCrewRow(c.key, { name: e.target.value })}
                              />
                            </Labeled>
                          </td>
                          <td>
                            <input
                              aria-label={`Posisi kru ${i + 1}`}
                              placeholder="Posisi"
                              style={inStyle()}
                              value={c.position}
                              onChange={(e) => updateCrewRow(c.key, { position: e.target.value })}
                            />
                          </td>
                          <td>
                            <input
                              aria-label={`Perusahaan kru ${i + 1}`}
                              placeholder="Perusahaan"
                              style={inStyle()}
                              value={c.company}
                              onChange={(e) => updateCrewRow(c.key, { company: e.target.value })}
                            />
                          </td>
                          <td>
                            <select
                              aria-label={`Shift kru ${i + 1}`}
                              style={inStyle()}
                              value={c.shift}
                              onChange={(e) => updateCrewRow(c.key, { shift: normShift(e.target.value) })}
                            >
                              {SHIFTS.map((s) => (
                                <option key={s} value={s}>
                                  {s === 'Day' ? 'Siang (Day)' : 'Malam (Night)'}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              aria-label={`Jam kerja kru ${i + 1}`}
                              className="tnum"
                              style={{ ...inStyle(), minWidth: 72 }}
                              inputMode="decimal"
                              type="number"
                              min={0}
                              max={24}
                              step={0.5}
                              value={c.hours}
                              onChange={(e) => updateCrewRow(c.key, { hours: e.target.value })}
                            />
                          </td>
                          <td>
                            <select
                              aria-label={`Status POB kru ${i + 1}`}
                              style={inStyle()}
                              value={c.pobStatus}
                              onChange={(e) => updateCrewRow(c.key, { pobStatus: normPob(e.target.value) })}
                            >
                              {POB_STATUSES.map((p) => (
                                <option key={p} value={p}>
                                  {p === 'in' ? 'Di rig (in)' : 'Keluar (out)'}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              aria-label={`Muster station kru ${i + 1}`}
                              placeholder="Muster station"
                              style={inStyle()}
                              value={c.musterStation}
                              onChange={(e) => updateCrewRow(c.key, { musterStation: e.target.value })}
                            />
                          </td>
                          <td>
                            <Button
                              variant="danger-ghost"
                              onClick={() => removeCrewRow(c.key)}
                              aria-label={`Hapus kru ${i + 1}`}
                              title="Hapus baris kru"
                            >
                              <Trash2 size={14} /> Hapus
                            </Button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      crewRows.map((c) => (
                        <tr key={c.key} style={{ height: 'var(--row-h)' }}>
                          <td>
                            <strong>{c.name || '-'}</strong>
                          </td>
                          <td>{c.position || '-'}</td>
                          <td>{c.company || '-'}</td>
                          <td>{c.shift}</td>
                          <td className="tnum">{clampHours(Number(c.hours || '0'), 0, 24).toFixed(1)}</td>
                          <td>{c.pobStatus}</td>
                          <td>{c.musterStation || '-'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                {canEditChildren && canPersonnel ? (
                  <>
                    <Button data-testid="crew-add" variant="secondary" onClick={addCrewRow}>
                      <Plus size={16} /> Tambah Kru
                    </Button>
                    <Button onClick={saveCrew} disabled={savingCrew}>
                      <Save size={16} /> {savingCrew ? 'Menyimpan...' : 'Simpan Kru & POB'}
                    </Button>
                    <span className="tnum" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                      Total man-hours: {manHours.toFixed(1)} jam
                    </span>
                  </>
                ) : (
                  <Note kind="info">
                    {!isDraft
                      ? 'Laporan submitted/approved hanya bisa diubah lewat amendemen - data kru read-only.'
                      : !canEditDraft
                        ? roleReason('report:edit-draft')
                        : 'Anda tidak memiliki izin "personnel:edit" untuk mengubah data kru.'}
                  </Note>
                )}
              </div>
            </Card>

            {/* 03 Drilling Progress & Mud - mud editable (P0-2) */}
            <Card>
              <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>03 Drilling Progress &amp; Mud</h2>

              <div style={{ border: '1px solid var(--border-default)', borderRadius: 4, padding: 12 }}>
                <p style={{ fontSize: 13, fontWeight: 700, margin: '0 0 8px' }}>Lumpur Pemboran</p>
                {!canEditChildren || !canTime ? (
                  report.mud ? (
                    <div className="tnum" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: 13 }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>BERAT (PPG)</div>
                        <div>{report.mud.weightPpg ?? '-'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>VISKOSITAS (SEC/QT)</div>
                        <div>{report.mud.viscositySecQt ?? '-'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>pH</div>
                        <div>{report.mud.ph ?? '-'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>PV</div>
                        <div>{report.mud.pv ?? '-'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>YP</div>
                        <div>{report.mud.yp ?? '-'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>BIAYA LUMPUR</div>
                        <div>{report.mud.costUsd != null ? formatUsd(report.mud.costUsd) : '-'}</div>
                      </div>
                      <div style={{ gridColumn: '1 / -1' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>KIMIA DITAMBAHKAN</div>
                        <div>{report.mud.chemicalsAdded ?? '-'}</div>
                      </div>
                    </div>
                  ) : (
                    <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Belum ada data lumpur. Isi form di bawah lalu tekan Simpan Lumpur.</p>
                  )
                ) : (
                  <div data-testid="mud-form" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                    <Labeled label="Berat lumpur (ppg)" htmlFor="mud-weight">
                      <input
                        id="mud-weight"
                        className="tnum"
                        style={inStyle()}
                        inputMode="decimal"
                        value={mud.weightPpg}
                        onChange={(e) => setMud({ ...mud, weightPpg: e.target.value })}
                      />
                    </Labeled>
                    <Labeled label="Viskositas (sec/qt)" htmlFor="mud-visc">
                      <input
                        id="mud-visc"
                        className="tnum"
                        style={inStyle()}
                        inputMode="decimal"
                        value={mud.viscositySecQt}
                        onChange={(e) => setMud({ ...mud, viscositySecQt: e.target.value })}
                      />
                    </Labeled>
                    <Labeled label="pH" htmlFor="mud-ph">
                      <input
                        id="mud-ph"
                        className="tnum"
                        style={inStyle()}
                        inputMode="decimal"
                        value={mud.ph}
                        onChange={(e) => setMud({ ...mud, ph: e.target.value })}
                      />
                    </Labeled>
                    <Labeled label="Plastic viscosity / PV (cP)" htmlFor="mud-pv">
                      <input
                        id="mud-pv"
                        className="tnum"
                        style={inStyle()}
                        inputMode="decimal"
                        value={mud.pv}
                        onChange={(e) => setMud({ ...mud, pv: e.target.value })}
                      />
                    </Labeled>
                    <Labeled label="Yield point / YP (lb/100ft²)" htmlFor="mud-yp">
                      <input
                        id="mud-yp"
                        className="tnum"
                        style={inStyle()}
                        inputMode="decimal"
                        value={mud.yp}
                        onChange={(e) => setMud({ ...mud, yp: e.target.value })}
                      />
                    </Labeled>
                    <Labeled label="Biaya lumpur (USD)" htmlFor="mud-cost">
                      <input
                        id="mud-cost"
                        className="tnum"
                        style={inStyle()}
                        inputMode="decimal"
                        value={mud.costUsd}
                        onChange={(e) => setMud({ ...mud, costUsd: e.target.value })}
                      />
                    </Labeled>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <Labeled label="Kimia yang ditambahkan" htmlFor="mud-chemicals">
                        <textarea
                          id="mud-chemicals"
                          style={{ ...inStyle(), height: 'auto', minHeight: 56, padding: 8 }}
                          rows={2}
                          value={mud.chemicalsAdded}
                          onChange={(e) => setMud({ ...mud, chemicalsAdded: e.target.value })}
                        />
                      </Labeled>
                    </div>
                    <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Button onClick={saveMud} disabled={savingMud}>
                        <Save size={16} /> {savingMud ? 'Menyimpan...' : 'Simpan Lumpur'}
                      </Button>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        Perubahan disimpan ke data lumpur laporan ini (butuh izin <code>time:edit</code>).
                      </span>
                    </div>
                  </div>
                )}
                {(!isDraft || !canEditDraft || (!canTime && canEditChildren)) && (
                  <Note kind={!isDraft ? 'info' : 'warn'}>
                    {!isDraft
                      ? 'Laporan submitted/approved hanya bisa diubah lewat amendemen - data lumpur read-only.'
                      : !canEditDraft
                        ? roleReason('report:edit-draft')
                        : 'Anda tidak memiliki izin "time:edit" untuk mengubah data lumpur.'}
                  </Note>
                )}
              </div>
            </Card>

            {/* 03b BHA components - editable (P0-2) */}
            <Card>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: 16, margin: 0 }}>BHA - Bottom Hole Assembly</h2>
                <Badge kind="Draft">
                  <span className="tnum">{bhaRows.length} komponen</span>
                </Badge>
              </div>
              <div style={{ overflowX: 'auto', marginTop: 8 }}>
                <table data-testid="bha-table" style={{ width: '100%', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', fontSize: 12, color: 'var(--text-muted)' }}>
                      <th style={{ paddingBottom: 4 }}>Komponen</th>
                      <th style={{ paddingBottom: 4 }}>OD (in)</th>
                      <th style={{ paddingBottom: 4 }}>Panjang (m)</th>
                      <th style={{ paddingBottom: 4 }}>Jam</th>
                      {canEditChildren && canTime && <th style={{ paddingBottom: 4 }}>Aksi</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {bhaRows.length === 0 ? (
                      <tr>
                        <td colSpan={canEditChildren && canTime ? 5 : 4} style={{ color: 'var(--text-muted)', padding: '8px 0' }}>
                          Belum ada komponen BHA. Tambahkan baris lewat tombol Tambah Komponen di bawah tabel.
                        </td>
                      </tr>
                    ) : canEditChildren && canTime ? (
                      bhaRows.map((b, i) => (
                        <tr key={b.key} style={{ height: 'var(--row-h)' }}>
                          <td>
                            <input
                              aria-label={`Komponen BHA ${i + 1}`}
                              placeholder="Nama komponen"
                              style={inStyle()}
                              value={b.component}
                              onChange={(e) => updateBhaRow(b.key, { component: e.target.value })}
                            />
                          </td>
                          <td>
                            <input
                              aria-label={`OD BHA ${i + 1} (inci)`}
                              className="tnum"
                              style={inStyle()}
                              inputMode="decimal"
                              value={b.odIn}
                              onChange={(e) => updateBhaRow(b.key, { odIn: e.target.value })}
                            />
                          </td>
                          <td>
                            <input
                              aria-label={`Panjang BHA ${i + 1} (m)`}
                              className="tnum"
                              style={inStyle()}
                              inputMode="decimal"
                              value={b.lengthM}
                              onChange={(e) => updateBhaRow(b.key, { lengthM: e.target.value })}
                            />
                          </td>
                          <td>
                            <input
                              aria-label={`Jam BHA ${i + 1}`}
                              className="tnum"
                              style={inStyle()}
                              inputMode="decimal"
                              value={b.hours}
                              onChange={(e) => updateBhaRow(b.key, { hours: e.target.value })}
                            />
                          </td>
                          <td>
                            <Button
                              variant="danger-ghost"
                              onClick={() => removeBhaRow(b.key)}
                              aria-label={`Hapus komponen BHA ${i + 1}`}
                              title="Hapus baris BHA"
                            >
                              <Trash2 size={14} /> Hapus
                            </Button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      bhaRows.map((b) => (
                        <tr key={b.key} style={{ height: 30 }}>
                          <td>{b.component}</td>
                          <td className="tnum">{b.odIn || '-'}</td>
                          <td className="tnum">{b.lengthM || '-'}</td>
                          <td className="tnum">{b.hours || '-'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                {canEditChildren && canTime ? (
                  <>
                    <Button variant="secondary" onClick={addBhaRow}>
                      <Plus size={16} /> Tambah Komponen
                    </Button>
                    <Button onClick={saveBha} disabled={savingBha}>
                      <Save size={16} /> {savingBha ? 'Menyimpan...' : 'Simpan BHA'}
                    </Button>
                  </>
                ) : (
                  <Note kind={!isDraft ? 'info' : 'warn'}>
                    {!isDraft
                      ? 'Laporan submitted/approved hanya bisa diubah lewat amendemen - BHA read-only.'
                      : !canEditDraft
                        ? roleReason('report:edit-draft')
                        : 'Anda tidak memiliki izin "time:edit" untuk mengubah BHA.'}
                  </Note>
                )}
              </div>
            </Card>

            {/* 04 Geological Evaluation - geologyNotes editable (P0-2) */}
            <Card>
              <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>04 Geological Evaluation</h2>
              {isDraft && canEditDraft ? (
                <>
                  <Labeled label="Catatan geologi / litologi" htmlFor="geology-input">
                    <textarea
                      data-testid="geology-input"
                      id="geology-input"
                      aria-label="Catatan geologi / litologi"
                      style={{ ...inStyle(), height: 'auto', minHeight: 88, padding: 8 }}
                      rows={3}
                      value={geology}
                      onChange={(e) => setGeology(e.target.value)}
                    />
                  </Labeled>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '6px 0 0' }}>
                    Catatan geologi tersimpan bersama header lewat tombol &quot;Simpan Header&quot;.
                  </p>
                </>
              ) : (
                <>
                  <p className="tnum" style={{ fontSize: 13, margin: 0 }}>
                    {report.geologyNotes ?? 'Belum ada catatan geologi.'}
                  </p>
                  <Note kind="info">
                    {!isDraft
                      ? 'Laporan submitted/approved hanya bisa diubah lewat amendemen - catatan geologi read-only.'
                      : roleReason('report:edit-draft')}
                  </Note>
                </>
              )}
              {report.survey.length > 0 && (
                <table style={{ width: '100%', fontSize: 12, marginTop: 8 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th>MD (m)</th>
                      <th>Incl (°)</th>
                      <th>Azim (°)</th>
                      <th>TVD (m)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.survey.map((s) => (
                      <tr key={s.id} style={{ height: 30 }}>
                        <td className="tnum">{s.md}</td>
                        <td className="tnum">{s.inclination ?? '-'}</td>
                        <td className="tnum">{s.azimuth ?? '-'}</td>
                        <td className="tnum">{s.tvd ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            {/* 05 Time Breakdown (ringkas) */}
            <Card>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: 16, margin: 0 }}>05 Time Summary</h2>
                <Badge kind={report.validation.ok ? 'Distributed' : 'NPT'}>
                  {report.validation.ok ? 'Total 24.0 jam terpenuhi' : 'Ada selisih jam'}
                </Badge>
                <Link href="/time" style={{ marginLeft: 'auto', fontSize: 13, display: 'flex', gap: 4, alignItems: 'center' }}>
                  Buka Time Breakdown Lengkap <ExternalLink size={14} />
                </Link>
              </div>
              <div className="tnum" style={{ display: 'flex', gap: 16, fontSize: 13, margin: '8px 0' }}>
                <span>
                  Total <strong>{formatHours(report.totalMinutes)} jam</strong>
                </span>
                <span style={{ color: 'var(--success)' }}>PRD {formatHours(report.productiveMinutes)} jam</span>
                <span style={{ color: 'var(--danger)' }}>NPT {formatHours(report.nptMinutes)} jam</span>
                <span style={{ color: 'var(--warning)' }}>WOW {formatHours(report.wowMinutes)} jam</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', fontSize: 12, color: 'var(--text-muted)' }}>
                      <th>Rentang Waktu</th>
                      <th>Jam</th>
                      <th>Klasifikasi</th>
                      <th>Keterangan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.timeRows.slice(0, 6).map((r) => (
                      <tr key={r.id} style={{ height: 'var(--row-h)', background: r.timeClass === 'NPT' ? 'var(--npt-bg)' : undefined }}>
                        <td className="tnum">
                          {r.start} - {r.end}
                        </td>
                        <td className="tnum" style={{ color: r.timeClass === 'NPT' ? 'var(--danger)' : undefined }}>
                          {formatHours(r.durationMin)}
                        </td>
                        <td>
                          <TimeClassBadge timeClass={r.timeClass} />
                        </td>
                        <td>{r.remarks ?? r.iadcName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {report.timeRows.length > 6 && (
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '6px 0 0' }}>
                  +{report.timeRows.length - 6} baris lainnya di <Link href="/time">Time Breakdown</Link>.
                </p>
              )}
            </Card>

            {/* 06 Narrative, Equipment & Forecast */}
            <Card>
              <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>06 Narrative, Equipment &amp; Forecast</h2>
              <Labeled label="Narasi 24 jam" htmlFor="summary-input">
                <textarea
                  id="summary-input"
                  aria-label="Narasi 24 jam"
                  style={{ ...inStyle(), height: 'auto', minHeight: 88, padding: 8 }}
                  rows={4}
                  value={summary}
                  disabled={!isDraft}
                  onChange={(e) => setSummary(e.target.value)}
                />
              </Labeled>
              <div style={{ marginTop: 12 }}>
                <Labeled label="Status peralatan utama (satu per baris: Nama: Status)" htmlFor="equip-input">
                  <textarea
                    id="equip-input"
                    aria-label="Status peralatan utama"
                    style={{ ...inStyle(), height: 'auto', minHeight: 72, padding: 8 }}
                    rows={3}
                    value={equip}
                    disabled={!isDraft}
                    onChange={(e) => setEquip(e.target.value)}
                  />
                </Labeled>
              </div>
              <div style={{ marginTop: 12 }}>
                <Labeled label="Rencana operasi 24 jam berikutnya" htmlFor="plan-input">
                  <textarea
                    id="plan-input"
                    aria-label="Rencana operasi 24 jam berikutnya"
                    style={{ ...inStyle(), height: 'auto', minHeight: 64, padding: 8 }}
                    rows={2}
                    value={planNext}
                    disabled={!isDraft}
                    onChange={(e) => setPlanNext(e.target.value)}
                  />
                </Labeled>
              </div>
              {!isDraft && <Note kind="info">Laporan submitted/approved hanya bisa diubah lewat amendemen.</Note>}
              <p style={{ fontSize: 13, background: 'var(--success-soft)', borderRadius: 4, padding: '8px 10px', display: 'flex', gap: 8, color: 'var(--success)', margin: '12px 0 0' }}>
                <ShieldCheck size={16} style={{ flexShrink: 0 }} />
                <span>
                  {report.incidents.length === 0
                    ? 'Laporan ini tidak mencatat insiden. Status keselamatan rig tetap mengacu ke register insiden HSE.'
                    : `${report.incidents.length} insiden tercatat pada laporan ini.`}
                </span>
              </p>
            </Card>
          </div>

          {/* ================= RIGHT RAIL ================= */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Card>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                <h2 style={{ fontSize: 16, margin: 0 }}>Daftar Periksa Validasi</h2>
              </div>
              <ValidationPanel
                ok={validation ? validation.ok : report.validation.ok}
                totalMinutes={validation ? validation.totalMinutes : report.validation.totalMinutes}
                issues={validation ? validation.issues : report.validation.issues}
              />
              <div style={{ marginTop: 8 }}>
                <Note kind="info">Tombol &quot;Periksa Validasi&quot; ada di bilah atas - hanya satu tombol, tanpa duplikat.</Note>
              </div>
            </Card>

            <Card>
              <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Financial &amp; AFE</h2>
              {kpi ? (
                <>
                  <p className="tnum" style={{ fontSize: 13, margin: '0 0 4px' }}>
                    Hari ini <strong>{formatUsd(kpi.dailyCost)}</strong> | Kumulatif <strong>{formatUsd(kpi.cumulativeCost)}</strong> | Anggaran {kpi.afeBudget != null ? formatUsd(kpi.afeBudget) : '-'}
                  </p>
                  <p className="tnum" style={{ fontSize: 12, fontWeight: 700, margin: '0 0 4px' }}>
                    AFE terpakai: {kpi.afeConsumedPercent != null ? `${kpi.afeConsumedPercent.toFixed(2)}%` : '-'}
                    {kpi.afeBudget != null && kpi.afeConsumedPercent != null ? ` | Sisa ${formatUsd(kpi.afeBudget - kpi.cumulativeCost)}` : ''}
                  </p>
                  {kpi.afeConsumedPercent != null && <ProgressBar value={kpi.afeConsumedPercent} label="AFE terpakai" />}
                </>
              ) : dash.loading ? (
                <Skeleton h={40} />
              ) : (
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sumur ini belum punya anggaran AFE. Tetapkan anggaran lewat tombol Edit Well di halaman Well File.</p>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                {catTotals.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Belum ada baris biaya (cost line) pada laporan ini.</p>
                ) : (
                  catTotals.map(([cat, amt]) => (
                    <div key={cat} style={{ border: '1px solid var(--border-default)', borderRadius: 4, padding: '6px 8px' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 700 }}>{cat}</div>
                      <div className="tnum" style={{ fontSize: 13, fontWeight: 700 }}>
                        {formatUsd(amt)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card>
              <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Pengesahan (Authorizations)</h2>
              <p style={{ fontSize: 13 }}>
                Persetujuan:{' '}
                {report.signatureName ? (
                  <Badge kind="Approved">DITANDATANGANI {report.signatureName.toUpperCase()}</Badge>
                ) : report.status === 'submitted' ? (
                  <Badge kind="Submitted">Menunggu persetujuan</Badge>
                ) : (
                  <Badge kind="Draft">-</Badge>
                )}
              </p>
              {report.approvedAt && (
                <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Disetujui: {new Date(report.approvedAt).toLocaleString('id-ID')}</p>
              )}
              {report.submittedAt && (
                <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Dikirim: {new Date(report.submittedAt).toLocaleString('id-ID')}</p>
              )}
              {report.status === 'submitted' && (
                <p style={{ margin: '8px 0 0' }}>
                  <Button
                    onClick={() => setApproveOpen(true)}
                    disabled={!canApprove}
                    title={canApprove ? undefined : roleReason('report:approve')}
                  >
                    <PenTool size={16} /> Tanda Tangan &amp; Setujui
                  </Button>
                </p>
              )}
            </Card>

            <Card>
              <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Jejak Audit (Audit Trail)</h2>
              {audit.loading ? (
                <Skeleton h={60} />
              ) : audit.error ? (
                <p role="alert" style={{ fontSize: 13, color: 'var(--danger-deep)', margin: 0 }}>
                  Jejak audit gagal dimuat: {audit.error} Periksa izin &quot;audit:read&quot; pada role Anda, lalu muat ulang halaman.
                </p>
              ) : (audit.data ?? []).length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Belum ada aktivitas tercatat untuk laporan ini. Jejak muncul setelah laporan disimpan, dikirim, atau disetujui.</p>
              ) : (
                <ul style={{ fontSize: 13, paddingLeft: 0, margin: 0, listStyle: 'none' }}>
                  {(audit.data ?? []).map((a) => (
                    <li key={a.id} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'flex-start' }}>
                      <span
                        aria-hidden
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: a.action === 'submit' || a.action === 'approve' ? 'var(--success)' : 'var(--info)',
                          marginTop: 5,
                          flexShrink: 0,
                        }}
                      />
                      <span>
                        <strong>{a.action}</strong> - {a.actorName ?? 'sistem'}{' '}
                        <span style={{ color: 'var(--text-muted)' }}>{new Date(a.at).toLocaleString('id-ID')}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      ) : (
        /* P0-6: sumur baru belum punya DDR - tawarkan pembuatan laporan pertama. */
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>Belum ada laporan DDR untuk sumur ini</h2>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
              Sumur {well?.name ?? 'ini'} belum punya satu pun Daily Drilling Report. Buat DDR pertama, lalu lengkapi rincian 24 jam di
              Time Breakdown.
            </p>
            <Button
              data-testid="ddr-btn-first-report"
              onClick={() => setFirstOpen(true)}
              disabled={!wellId || me.loading}
              title={me.loading ? 'Memeriksa izin akun...' : canCreate ? undefined : roleReason('report:create')}
            >
              <Plus size={16} /> Buat DDR Pertama
            </Button>
            {!me.loading && !canCreate && <Note kind="warn">Role Anda tidak memiliki izin &quot;report:create&quot;.</Note>}
          </div>
        </Card>
      )}

      {/* ------------ DDR pertama modal (P0-6) ------------ */}
      <Modal open={firstOpen} onClose={() => setFirstOpen(false)} title="Buat DDR Pertama">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Labeled label="Tanggal laporan" htmlFor="first-report-date">
            <input
              id="first-report-date"
              className="tnum"
              type="date"
              style={inStyle()}
              value={firstDate}
              onChange={(e) => setFirstDate(e.target.value)}
            />
          </Labeled>
          <Labeled label="Kedalaman awal MD (m)" htmlFor="first-depth-start">
            <input
              id="first-depth-start"
              className="tnum"
              style={inStyle()}
              inputMode="decimal"
              value={firstDepthStart}
              onChange={(e) => setFirstDepthStart(e.target.value)}
            />
          </Labeled>
          <Labeled label="Kedalaman akhir MD (m)" htmlFor="first-depth-end">
            <input
              id="first-depth-end"
              className="tnum"
              style={inStyle()}
              inputMode="decimal"
              value={firstDepthEnd}
              onChange={(e) => setFirstDepthEnd(e.target.value)}
            />
          </Labeled>
          <Note kind="info">
            DDR dibuat dengan satu baris waktu awal (06:00 → 06:01). Setelah tersimpan Anda diarahkan ke Time Breakdown untuk
            melengkapi 24 jam sebelum laporan bisa dikirim.
          </Note>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={createFirstReport} disabled={creatingFirst}>
              <Plus size={16} /> {creatingFirst ? 'Membuat...' : 'Buat DDR'}
            </Button>
            <Button variant="secondary" onClick={() => setFirstOpen(false)}>
              Batal
            </Button>
          </div>
        </div>
      </Modal>

      {/* ------------ Approve modal ------------ */}
      <Modal open={approveOpen} onClose={() => setApproveOpen(false)} title="Tanda Tangan &amp; Setujui DDR">
        <Labeled label="Nama penanda tangan (min 3 karakter)" htmlFor="signature-name">
          <input
            id="signature-name"
            aria-label="Nama penanda tangan"
            style={inStyle()}
            value={signatureName}
            onChange={(e) => setSignatureName(e.target.value)}
            placeholder="Dave Miller"
          />
        </Labeled>
        <p style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Button onClick={approve} disabled={approving}>
            <PenTool size={16} /> {approving ? 'Menandatangani...' : 'Setujui'}
          </Button>
          <Button variant="secondary" onClick={() => setApproveOpen(false)}>
            Batal
          </Button>
        </p>
      </Modal>

      {/* ------------ Amend modal ------------ */}
      <Modal open={amendOpen} onClose={() => setAmendOpen(false)} title="Buat Amendemen">
        <Labeled label="Alasan amendemen (min 10 karakter)" htmlFor="amend-reason">
          <textarea
            id="amend-reason"
            aria-label="Alasan amendemen"
            style={{ ...inStyle(), height: 'auto', minHeight: 72, padding: 8 }}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="mis. Koreksi kedalaman setelah verifikasi ulang survey"
          />
        </Labeled>
        <Note kind="info">Amendemen membuat DDR baru (revisi + 1, berstatus draft); laporan induk tidak diubah.</Note>
        <p style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Button onClick={amend} disabled={amending}>
            <PenTool size={16} /> {amending ? 'Membuat...' : 'Buat Amendemen'}
          </Button>
          <Button variant="secondary" onClick={() => setAmendOpen(false)}>
            Batal
          </Button>
        </p>
      </Modal>
    </div>
  );
}
