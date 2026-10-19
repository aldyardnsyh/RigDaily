'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  CreditCard,
  Download,
  FileSpreadsheet,
  History,
  Copy,
  KeyRound,
  Layers,
  MonitorSmartphone,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Search,
  ShieldCheck,
  Sigma,
  SlidersHorizontal,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card } from '@rigdaily/ui';
import {
  ROLE_IDS,
  ROLES,
  formatUsd,
  WELL_TYPE_LABEL,
  WELL_PHASE_LABEL,
  type Permission,
  type RoleId,
} from '@rigdaily/shared';
import { Labeled, Modal, Note, ProgressBar, inStyle } from '@/components/controls';
import { DataTable, type Column } from '@/components/DataTable';
import { apiSend } from '@/lib/api-client';
import { currentMonthIsoLocal, todayIsoLocal } from '@/lib/date';
import { useApi } from '@/lib/hooks/useApi';
import type {
  AuditEntryDto,
  BillingSummary,
  IadcCodeDto,
  ReportListItem,
  RigDto,
  SyncDeviceDto,
  UserDto,
  WellDto,
} from '@/lib/repo/types';

/* ------------------------------------------------------------------ */
/* Tipe respons API                                                     */
/* ------------------------------------------------------------------ */

type MePayload = {
  user: { id: string; name: string; email: string; role: string; rigScope: string[] };
  permissions: Permission[];
};

type ReportsList = { items: ReportListItem[]; total: number };

/* ------------------------------------------------------------------ */
/* Konstanta tampilan                                                   */
/* ------------------------------------------------------------------ */

type Domain = 'monitor' | 'users' | 'rigs' | 'iadc' | 'contracts' | 'kpi' | 'devices' | 'audit';

const DOMAINS: Array<{ id: Domain; label: string; icon: React.ReactNode }> = [
  { id: 'monitor', label: 'Monitoring Sistem', icon: <Activity size={16} /> },
  { id: 'users', label: 'Pengguna & Akses', icon: <Users size={16} /> },
  { id: 'rigs', label: 'Rig & Sumur', icon: <Layers size={16} /> },
  { id: 'iadc', label: 'Kode IADC', icon: <FileSpreadsheet size={16} /> },
  { id: 'contracts', label: 'Rate Card Kontrak', icon: <CreditCard size={16} /> },
  { id: 'kpi', label: 'Definisi Formula KPI', icon: <Sigma size={16} /> },
  { id: 'devices', label: 'Perangkat Sinkronisasi', icon: <MonitorSmartphone size={16} /> },
  { id: 'audit', label: 'Jejak Audit Regulasi', icon: <History size={16} /> },
];

/** Nada badge role (memakai token, tanpa hex baru). */
const ROLE_BADGE_STYLE: Record<string, { background: string; color: string }> = {
  Admin: { background: 'var(--bg-sidebar)', color: '#fff' },
  CompanyMan: { background: 'var(--info)', color: '#fff' },
  RigClerk: { background: 'var(--info-soft)', color: 'var(--info)' },
  DrillingEngineer: { background: 'var(--accent-tonal)', color: 'var(--bg-sidebar)' },
  CostController: { background: 'var(--success-soft)', color: 'var(--success)' },
  HSE: { background: 'var(--warning-soft)', color: 'var(--warning)' },
  Viewer: { background: 'var(--bg-surface-2)', color: 'var(--text-secondary)' },
};

/** Format tanggal/waktu ISO → "10 Sep 2026 06:40" (locale tetap, 24 jam). */
function fmtDateTime(iso: string | null): string {
  if (!iso) return 'Belum pernah masuk';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Inisial dari nama (maks 2 karakter) untuk avatar. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** Ringkas nilai JSON audit menjadi chip pendek (string/angka/boolean). */
function chipValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.length > 60 ? `${value.slice(0, 57)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `${value.length} item`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 2);
    return entries.map(([k, v]) => `${k}: ${chipValue(v) ?? '-'}`).join(' · ');
  }
  return String(value);
}

/** Cek permission dari daftar efektif /api/auth/me. */
function hasPermission(me: MePayload | null, perm: Permission): boolean {
  return me?.permissions.includes(perm) ?? false;
}

/* ------------------------------------------------------------------ */
/* Halaman                                                              */
/* ------------------------------------------------------------------ */

export default function AdminPage() {
  const [domain, setDomain] = useState<Domain>('users');

  const me = useApi<MePayload>('/api/auth/me');
  const canManageMaster = hasPermission(me.data, 'master:manage');
  const canManageUsers = hasPermission(me.data, 'user:manage');
  const canReadAudit = hasPermission(me.data, 'audit:read');
  const canManageBilling = hasPermission(me.data, 'billing:manage');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
        ADMINISTRASI SISTEM / TATA KELOLA AKSES &amp; KONFIGURASI
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Konsol Admin - Keamanan &amp; Data Master</h1>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
        Kelola hak akses per role, jejak audit regulasi, dan definisi data master rig dari satu tempat.
      </p>

      {me.error && <Note kind="error">{me.error}</Note>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }} role="tablist" aria-label="Domain admin">
        {DOMAINS.map((d) => {
          const active = domain === d.id;
          return (
            <button
              key={d.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setDomain(d.id)}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                minHeight: 44,
                padding: '0 12px',
                fontSize: 13,
                fontWeight: 600,
                fontFamily: 'inherit',
                cursor: 'pointer',
                textAlign: 'left',
                borderRadius: 4,
                border: active ? '1px solid var(--bg-sidebar)' : '1px solid var(--border-default)',
                background: active ? 'var(--bg-sidebar)' : '#fff',
                color: active ? '#fff' : 'var(--text-primary)',
              }}
            >
              {d.icon} {d.label}
            </button>
          );
        })}
      </div>

      {domain === 'monitor' && <MonitorSection />}
      {domain === 'users' && <UsersSection canManage={canManageUsers} />}
      {domain === 'rigs' && <RigsSection />}
      {domain === 'iadc' && <IadcSection canManage={canManageMaster} meLoading={me.loading} />}
      {domain === 'contracts' && <ContractsSection canManage={canManageBilling} meLoading={me.loading} />}
      {domain === 'kpi' && <KpiSection canManage={canManageMaster} meLoading={me.loading} />}
      {domain === 'devices' && <DevicesSection canManage={canManageMaster} meLoading={me.loading} />}
      {domain === 'audit' && <AuditSection canRead={canReadAudit} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Monitoring Sistem                                                    */
/* ------------------------------------------------------------------ */

type OverviewDto = {
  counts: { wells: number; rigs: number; users: number; reports: number; incidents: number; devices: number; rateCards: number };
  reportsByStatus: Array<{ status: string; count: number }>;
  recentAudit: Array<{ at: string; actorName: string | null; entity: string; action: string }>;
  activeSessions: Array<{ id: string; userName: string; ip: string | null; userAgent: string | null; createdAt: string }>;
  db: { driver: 'postgres' | 'pglite'; ok: boolean; sizeApproxMb: number | null };
  serverTime: string;
};

/**
 * Panel monitoring: ringkasan nyata dari database (bukan angka karangan).
 * Dipakai admin untuk memantau seluruh sistem dalam satu layar.
 */
function MonitorSection() {
  const overview = useApi<OverviewDto>('/api/admin/overview');

  if (overview.error) {
    return <Note kind="error">Gagal memuat ringkasan sistem: {overview.error}</Note>;
  }

  const d = overview.data;
  const statusTone = (s: string) =>
    s === 'approved' || s === 'distributed'
      ? { bg: 'var(--success-soft)', fg: 'var(--success)' }
      : s === 'submitted'
        ? { bg: 'var(--warning-soft)', fg: 'var(--warning)' }
        : { bg: 'var(--bg-surface-2)', fg: 'var(--text-secondary)' };

  const cards: Array<{ label: string; value: number | string; sub?: string }> = d
    ? [
        { label: 'Sumur', value: d.counts.wells },
        { label: 'Rig', value: d.counts.rigs },
        { label: 'Pengguna', value: d.counts.users },
        { label: 'DDR', value: d.counts.reports },
        { label: 'Insiden', value: d.counts.incidents },
        { label: 'Perangkat', value: d.counts.devices },
        { label: 'Rate Card', value: d.counts.rateCards },
        { label: 'Database', value: d.db.driver, sub: d.db.ok ? 'Terhubung' : 'Gangguan' },
      ]
    : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Ringkasan Sistem</h2>
          <Badge kind={d?.db.ok ? 'Distributed' : 'NPT'}>{d?.db.ok ? 'DATABASE TERHUBUNG' : 'DATABASE TERGANGGU'}</Badge>
          <span style={{ marginLeft: 'auto' }}>
            <Button variant="secondary" size="sm" onClick={overview.reload} loading={overview.loading}>
              <RefreshCw size={14} /> Muat ulang
            </Button>
          </span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 12px' }}>
          Semua angka dibaca langsung dari database. Waktu server: <span className="tnum">{d?.serverTime ? fmtDateTime(d.serverTime) : '-'}</span>
        </p>

        {overview.loading ? (
          <TableSkeleton rows={3} />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
            {cards.map((c) => (
              <div
                key={c.label}
                style={{
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-input)',
                  padding: '10px 12px',
                  minWidth: 0,
                }}
              >
                <div className="field-label" style={{ marginBottom: 2 }}>{c.label}</div>
                <div className="tnum" style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>{c.value}</div>
                {c.sub ? <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{c.sub}</div> : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 16 }}>
        <Card>
          <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Status Laporan</h2>
          {!d || d.reportsByStatus.length === 0 ? (
            <Note kind="info">Belum ada laporan.</Note>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {d.reportsByStatus.map((s) => {
                const tone = statusTone(s.status);
                const total = d.reportsByStatus.reduce((a, b) => a + b.count, 0) || 1;
                return (
                  <div key={s.status} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <span
                      style={{
                        minWidth: 88,
                        fontSize: 11,
                        fontWeight: 700,
                        borderRadius: 999,
                        padding: '2px 8px',
                        textAlign: 'center',
                        background: tone.bg,
                        color: tone.fg,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {s.status}
                    </span>
                    <span
                      role="progressbar"
                      aria-valuenow={s.count}
                      aria-valuemin={0}
                      aria-valuemax={total}
                      aria-label={`Laporan ${s.status}`}
                      style={{ flex: 1, height: 8, borderRadius: 999, background: 'var(--bg-surface-2)', overflow: 'hidden', minWidth: 0 }}
                    >
                      <span style={{ display: 'block', width: `${(s.count / total) * 100}%`, height: '100%', background: tone.fg }} />
                    </span>
                    <span className="tnum" style={{ fontSize: 12, fontWeight: 700, minWidth: 20, textAlign: 'right' }}>{s.count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Sesi Aktif</h2>
          {!d || d.activeSessions.length === 0 ? (
            <Note kind="info">Tidak ada sesi aktif tercatat.</Note>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {d.activeSessions.map((s) => (
                <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 }}>
                  <strong style={{ fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.userName}
                  </strong>
                  <span className="tnum" style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    {s.ip ?? '-'}
                  </span>
                  <span className="tnum" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {fmtDateTime(s.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Aktivitas Terakhir</h2>
        {!d || d.recentAudit.length === 0 ? (
          <Note kind="info">Belum ada aktivitas tercatat.</Note>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {d.recentAudit.map((a, i) => (
              <div key={`${a.at}-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12, minWidth: 0 }}>
                <span className="tnum" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtDateTime(a.at)}</span>
                <strong style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.actorName ?? 'Sistem'}</strong>
                <span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{a.action}</span>
                <span className="tnum" style={{ color: 'var(--text-muted)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>{a.entity}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Users & Access                                                       */
/* ------------------------------------------------------------------ */

function UsersSection({ canManage }: { canManage: boolean }) {
  const users = useApi<UserDto[]>('/api/admin/users');
  const [q, setQ] = useState('');
  const [role, setRole] = useState<string>('all');
  const [inviteOpen, setInviteOpen] = useState(false);

  const filtered = useMemo(() => {
    let list = users.data ?? [];
    if (role !== 'all') list = list.filter((u) => u.role === role);
    if (q.trim()) {
      const s = q.toLowerCase();
      list = list.filter((u) => u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s));
    }
    return list;
  }, [users.data, role, q]);

  const columns: Column<UserDto>[] = [
    {
      key: 'name',
      header: 'Pengguna',
      render: (u) => (
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span
            aria-hidden
            style={{
              display: 'flex',
              width: 32,
              height: 32,
              borderRadius: 4,
              background: 'var(--bg-sidebar)',
              color: '#fff',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            {initials(u.name)}
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
            <strong>{u.name}</strong>
            <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{u.email}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (u) => {
        const st = ROLE_BADGE_STYLE[u.role] ?? { background: 'var(--bg-surface-2)', color: 'var(--text-secondary)' };
        return (
          <span style={{ ...st, borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>
            {ROLES[u.role as RoleId]?.label ?? u.role}
          </span>
        );
      },
    },
    {
      key: 'rigScope',
      header: 'Cakupan Rig',
      render: (u) => (
        <span className="tnum" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {u.rigScope.length === 0 ? 'Global / semua rig' : `${u.rigScope.length} rig`}
        </span>
      ),
    },
    {
      key: 'lastLoginAt',
      header: 'Terakhir Masuk',
      render: (u) => <span className="tnum" style={{ fontSize: 12 }}>{fmtDateTime(u.lastLoginAt)}</span>,
    },
    {
      key: 'active',
      header: 'Status',
      render: (u) => (
        <span
          style={{
            borderRadius: 999,
            padding: '2px 10px',
            fontSize: 11,
            fontWeight: 700,
            whiteSpace: 'nowrap',
            background: u.active ? 'var(--success-soft)' : 'var(--bg-surface-2)',
            color: u.active ? 'var(--success)' : 'var(--text-secondary)',
          }}
        >
          {u.active ? 'Aktif' : 'Nonaktif'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Aksi',
      align: 'right',
      width: 132,
      render: (u) => (
        <span style={{ display: 'inline-flex', gap: 4, justifyContent: 'flex-end' }}>
          <Button
            variant="tertiary"
            size="sm"
            aria-label={`Edit ${u.name}`}
            title="Edit nama, email, role, status"
            disabled={!canManage || userBusyId === u.id}
            onClick={() => {
              setUserEditForm({ name: u.name, email: u.email, role: u.role, active: u.active });
              setUserEditTarget(u);
            }}
          >
            <Pencil size={14} />
          </Button>
          <Button
            variant="tertiary"
            size="sm"
            aria-label={`${u.active ? 'Nonaktifkan' : 'Aktifkan'} ${u.name}`}
            title={u.active ? 'Nonaktifkan akun' : 'Aktifkan akun'}
            disabled={!canManage || userBusyId === u.id}
            onClick={() => toggleUserActive(u)}
          >
            <SlidersHorizontal size={14} />
          </Button>
          <Button
            variant="danger-ghost"
            size="sm"
            aria-label={`Hapus ${u.name}`}
            title="Hapus akun (soft delete) dan cabut semua sesinya"
            disabled={!canManage || userBusyId === u.id}
            onClick={() => setDeleteTarget(u)}
          >
            <Trash2 size={14} />
          </Button>
        </span>
      ),
    },
  ];

  const loading = users.loading;

  /* ---------- CRUD pengguna: edit & hapus ---------- */
  const [userEditTarget, setUserEditTarget] = useState<UserDto | null>(null);
  const [userEditForm, setUserEditForm] = useState({ name: '', email: '', role: 'Viewer', active: true });
  const [userBusyId, setUserBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserDto | null>(null);

  async function saveUserEdit() {
    if (!userEditTarget) return;
    if (userEditForm.name.trim().length < 2) {
      toast.error('Nama minimal 2 karakter.');
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(userEditForm.email.trim())) {
      toast.error('Format email belum valid.');
      return;
    }
    setUserBusyId(userEditTarget.id);
    try {
      await apiSend('/api/admin/users', 'PATCH', {
        id: userEditTarget.id,
        name: userEditForm.name.trim(),
        email: userEditForm.email.trim().toLowerCase(),
        role: userEditForm.role,
        active: userEditForm.active,
      });
      toast.success(`Pengguna ${userEditForm.name.trim()} diperbarui.`);
      setUserEditTarget(null);
      users.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memperbarui pengguna.');
    } finally {
      setUserBusyId(null);
    }
  }

  async function deleteUser() {
    if (!deleteTarget) return;
    setUserBusyId(deleteTarget.id);
    try {
      await apiSend(`/api/admin/users?id=${deleteTarget.id}`, 'DELETE');
      toast.success(`Pengguna ${deleteTarget.name} dihapus dan sesinya dicabut.`);
      setDeleteTarget(null);
      users.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus pengguna.');
    } finally {
      setUserBusyId(null);
    }
  }

  async function toggleUserActive(u: UserDto) {
    setUserBusyId(u.id);
    try {
      await apiSend('/api/admin/users', 'PATCH', { id: u.id, active: !u.active });
      toast.success(`Status ${u.name}: ${u.active ? 'dinonaktifkan' : 'diaktifkan'}.`);
      users.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengubah status.');
    } finally {
      setUserBusyId(null);
    }
  }

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Manajemen Pengguna &amp; Hak Akses per Role</h2>
        <Badge kind="Draft">{users.data?.length ?? 0} akun</Badge>
        <span style={{ marginLeft: 'auto' }}>
          <Button onClick={() => setInviteOpen(true)} disabled={!canManage}>
            <UserPlus size={16} /> Undang Pengguna
          </Button>
        </span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 8px' }}>
        Atur hak persetujuan operasional, persetujuan DDR, dan pembatasan akses per rig.
      </p>

      {!canManage && <Note kind="warn">Anda tidak memiliki permission <code>user:manage</code> untuk mengundang user baru.</Note>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0', alignItems: 'center' }}>
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <Search size={14} color="var(--text-muted)" aria-hidden />
          <input
            style={{ ...inStyle(), maxWidth: 220 }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama atau email"
            aria-label="Cari pengguna"
          />
        </span>
        <select style={{ ...inStyle(), maxWidth: 220, width: 'auto' }} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Filter role">
          <option value="all">Role: Semua</option>
          {ROLE_IDS.map((r) => (
            <option key={r} value={r}>
              {ROLES[r].label}
            </option>
          ))}
        </select>
        <span className="tnum" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-secondary)' }}>
          Menampilkan {filtered.length} dari {users.data?.length ?? 0}
        </span>
      </div>

      {users.error && <Note kind="error">{users.error}</Note>}

      {loading ? (
        <TableSkeleton rows={5} />
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(u) => u.id}
          zebra
          empty="Tidak ada pengguna yang cocok dengan filter ini. Ubah kata kunci atau filter role."
        />
      )}

      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onCreated={() => {
          setInviteOpen(false);
          users.reload();
        }}
      />

      <EditUserModal
        target={userEditTarget}
        form={userEditForm}
        setForm={setUserEditForm}
        onSave={saveUserEdit}
        onClose={() => setUserEditTarget(null)}
        busy={userBusyId !== null && userBusyId === userEditTarget?.id}
      />

      <ConfirmDeleteModal
        target={deleteTarget}
        onConfirm={deleteUser}
        onClose={() => setDeleteTarget(null)}
        busy={userBusyId !== null && userBusyId === deleteTarget?.id}
        entityLabel="pengguna"
      />
    </Card>
  );
}

function InviteModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const rigs = useApi<RigDto[]>(open ? '/api/rigs' : null);
  const [form, setForm] = useState<{ name: string; email: string; role: RoleId; rigScope: string[] }>({
    name: '',
    email: '',
    role: 'Viewer',
    rigScope: [],
  });
  const [busy, setBusy] = useState(false);

  function toggleRig(id: string) {
    setForm((f) => ({
      ...f,
      rigScope: f.rigScope.includes(id) ? f.rigScope.filter((r) => r !== id) : [...f.rigScope, id],
    }));
  }

  async function submit() {
    if (!form.name.trim() || !form.email.trim()) {
      toast.error('Nama dan email wajib diisi.');
      return;
    }
    setBusy(true);
    try {
      await apiSend<{ id: string }>('/api/admin/users', 'POST', {
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        rigScope: form.rigScope,
      });
      toast.success(`Undangan terkirim ke ${form.email.trim()} dengan role ${ROLES[form.role].label}.`);
      setForm({ name: '', email: '', role: 'Viewer', rigScope: [] });
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengundang pengguna. Periksa email dan role lalu coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Undang Pengguna">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Labeled label="Nama">
          <input style={inStyle()} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nama lengkap" />
        </Labeled>
        <Labeled label="Email">
          <input
            style={inStyle()}
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="nama@perusahaan.com"
          />
        </Labeled>
      </div>
      <div style={{ marginTop: 12 }}>
        <Labeled label="Role">
          <select style={inStyle()} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as RoleId })}>
            {ROLE_IDS.map((r) => (
              <option key={r} value={r}>
                {ROLES[r].label} - {ROLES[r].scope}
              </option>
            ))}
          </select>
        </Labeled>
      </div>
      <div style={{ marginTop: 12 }}>
        <Labeled label="Cakupan Rig (kosong = akses semua rig)">
          {rigs.loading ? (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Memuat rig...</span>
          ) : rigs.error ? (
            <span role="alert" style={{ fontSize: 12, color: 'var(--danger)' }}>{rigs.error}</span>
          ) : (rigs.data?.length ?? 0) === 0 ? (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Belum ada rig terdaftar.</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border-default)', borderRadius: 4, padding: 8 }}>
              {(rigs.data ?? []).map((r) => (
                <label key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                  <input type="checkbox" checked={form.rigScope.includes(r.id)} onChange={() => toggleRig(r.id)} />
                  {r.name}
                  {r.code ? <span className="tnum" style={{ color: 'var(--text-muted)' }}>({r.code})</span> : null}
                </label>
              ))}
            </div>
          )}
        </Labeled>
      </div>
      <p style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <Button onClick={submit} disabled={busy}>
          {busy ? 'Mengirim...' : 'Kirim undangan'}
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Batal
        </Button>
      </p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Modal Edit Pengguna (CRUD)                                          */
/* ------------------------------------------------------------------ */

type UserEditDto = {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
};

function EditUserModal({
  target,
  form,
  setForm,
  onSave,
  onClose,
  busy,
}: {
  target: UserEditDto | null;
  form: { name: string; email: string; role: string; active: boolean };
  setForm: (f: { name: string; email: string; role: string; active: boolean }) => void;
  onSave: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  return (
    <Modal open={target !== null} onClose={onClose} title="Edit Pengguna">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Labeled label="Nama lengkap" htmlFor="edit-user-name">
          <input
            id="edit-user-name"
            className="in"
            style={inStyle()}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Nama lengkap"
          />
        </Labeled>
        <Labeled label="Email" htmlFor="edit-user-email">
          <input
            id="edit-user-email"
            className="in"
            style={inStyle()}
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="nama@perusahaan.co.id"
          />
        </Labeled>
        <Labeled label="Role" htmlFor="edit-user-role">
          <select
            id="edit-user-role"
            className="in"
            style={inStyle()}
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            {ROLE_IDS.map((r) => (
              <option key={r} value={r}>
                {ROLES[r].label} ({ROLES[r].scope})
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label="Status akun" htmlFor="edit-user-active">
          <select
            id="edit-user-active"
            className="in"
            style={inStyle()}
            value={form.active ? '1' : '0'}
            onChange={(e) => setForm({ ...form, active: e.target.value === '1' })}
          >
            <option value="1">Aktif</option>
            <option value="0">Nonaktif</option>
          </select>
        </Labeled>
      </div>
      <Note kind="info">
        Mengubah email akan mengubah identitas login. Perubahan role berlaku pada sesi berikutnya.
      </Note>
      <p style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <Button onClick={onSave} loading={busy}>
          Simpan perubahan
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Batal
        </Button>
      </p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Modal Konfirmasi Hapus                                              */
/* ------------------------------------------------------------------ */

function ConfirmDeleteModal({
  target,
  onConfirm,
  onClose,
  busy,
  entityLabel,
}: {
  target: { id: string; name: string } | null;
  onConfirm: () => void;
  onClose: () => void;
  busy: boolean;
  entityLabel: string;
}) {
  return (
    <Modal open={target !== null} onClose={onClose} title={`Hapus ${entityLabel}`}>
      <p style={{ fontSize: 13, margin: 0 }}>
        Hapus <strong>{target?.name}</strong>? Data akan dinonaktifkan (soft delete) dan tidak muncul di daftar.
        Tindakan ini tercatat pada audit log.
      </p>
      <p style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <Button variant="danger-ghost" onClick={onConfirm} loading={busy}>
          <Trash2 size={16} /> Hapus
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Batal
        </Button>
      </p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Rigs & Wellbores                                                     */
/* ------------------------------------------------------------------ */

function RigsSection() {
  const rigs = useApi<RigDto[]>('/api/rigs');
  const wells = useApi<WellDto[]>('/api/wells');

  const wellColumns: Column<WellDto>[] = [
    {
      key: 'name',
      header: 'Sumur',
      render: (w) => (
        <Link href={`/well-file?id=${w.id}`} style={{ fontWeight: 700, color: 'var(--accent-teal)' }}>
          {w.name}
        </Link>
      ),
    },
    { key: 'type', header: 'Tipe', render: (w) => WELL_TYPE_LABEL[w.type] ?? w.type },
    {
      key: 'phase',
      header: 'Fase',
      render: (w) => (
        <span style={{ background: 'var(--info-soft)', color: 'var(--info)', borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>
          {WELL_PHASE_LABEL[w.phase] ?? w.phase}
        </span>
      ),
    },
    {
      key: 'tdPlannedM',
      header: 'TD Rencana',
      align: 'right',
      render: (w) => (w.tdPlannedM != null ? `${w.tdPlannedM.toFixed(1)} m` : '-'),
    },
    {
      key: 'afeBudgetUsd',
      header: 'Anggaran AFE',
      align: 'right',
      render: (w) => (w.afeBudgetUsd != null ? formatUsd(w.afeBudgetUsd) : '-'),
    },
    { key: 'operator', header: 'Operator', render: (w) => w.operator ?? '-' },
    {
      key: 'progressPercent',
      header: 'Progres',
      width: 160,
      render: (w) =>
        w.progressPercent != null ? (
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="tnum" style={{ fontSize: 12, fontWeight: 700 }}>{w.progressPercent.toFixed(1)}%</span>
            <ProgressBar value={w.progressPercent} label={`Progres sumur ${w.name}`} />
          </span>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>-</span>
        ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Rigs</h2>
        {rigs.error && <Note kind="error">{rigs.error}</Note>}
        {rigs.loading ? (
          <TableSkeleton rows={3} />
        ) : (
          <DataTable
            columns={[
              { key: 'name', header: 'Rig', render: (r) => <strong>{r.name}</strong> },
              { key: 'code', header: 'Kode', render: (r) => <span className="tnum">{r.code ?? '-'}</span> },
              { key: 'type', header: 'Tipe', render: (r) => r.type },
              { key: 'contractor', header: 'Kontraktor', render: (r) => r.contractor ?? '-' },
              { key: 'contractRef', header: 'Kontrak', render: (r) => <span className="tnum">{r.contractRef ?? '-'}</span> },
              { key: 'activeReports', header: 'DDR 7 hari', align: 'right', render: (r) => r.activeReports },
            ]}
            rows={rigs.data ?? []}
            rowKey={(r) => r.id}
            zebra
            empty="Belum ada rig terdaftar."
          />
        )}
      </Card>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Sumur</h2>
          <Badge kind="Draft">{wells.data?.length ?? 0} sumur</Badge>
          <Link href="/well-file" style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--accent-teal)', fontWeight: 700, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            Buka Well File <ArrowRight size={14} />
          </Link>
        </div>
        <div style={{ marginTop: 8 }}>
          {wells.error && <Note kind="error">{wells.error}</Note>}
          {wells.loading ? (
            <TableSkeleton rows={4} />
          ) : (
            <DataTable columns={wellColumns} rows={wells.data ?? []} rowKey={(w) => w.id} zebra empty="Belum ada sumur terdaftar. Tambahkan sumur lewat data master." />
          )}
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* IADC Codes                                                           */
/* ------------------------------------------------------------------ */

function IadcSection({ canManage, meLoading }: { canManage: boolean; meLoading: boolean }) {
  const iadc = useApi<IadcCodeDto[]>('/api/master/iadc');
  const [pending, setPending] = useState<string | null>(null);

  async function patch(code: string, body: { active?: boolean; nptDefault?: boolean }, label: string) {
    setPending(code);
    try {
      await apiSend(`/api/master/iadc/${encodeURIComponent(code)}`, 'PATCH', body);
      toast.success(`Kode ${code}: ${label} diperbarui.`);
      iadc.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memperbarui kode IADC. Coba lagi.');
    } finally {
      setPending(null);
    }
  }

  const columns: Column<IadcCodeDto>[] = [
    { key: 'code', header: 'Kode', render: (c) => <strong className="tnum">{c.code}</strong> },
    { key: 'name', header: 'Nama', render: (c) => c.name },
    { key: 'category', header: 'Kategori', render: (c) => <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.category}</span> },
    {
      key: 'productive',
      header: 'Produktif',
      align: 'center',
      render: (c) => (
        <span style={{ color: c.productive ? 'var(--success)' : 'var(--text-muted)', fontWeight: 700, fontSize: 12 }}>
          {c.productive ? 'Ya' : 'Tidak'}
        </span>
      ),
    },
    {
      key: 'nptDefault',
      header: 'NPT Bawaan',
      align: 'center',
      render: (c) => (
        <button
          type="button"
          role="switch"
          aria-checked={c.nptDefault}
          aria-label={`Alihkan NPT bawaan kode ${c.code}`}
          disabled={!canManage || pending === c.code}
          onClick={() => patch(c.code, { nptDefault: !c.nptDefault }, `NPT bawaan = ${!c.nptDefault}`)}
          style={switchStyle(c.nptDefault, !canManage || pending === c.code)}
        >
          <span aria-hidden style={knobStyle(c.nptDefault)} />
        </button>
      ),
    },
    {
      key: 'subCodeRequired',
      header: 'Sub-kode',
      align: 'center',
      render: (c) => (
        <span style={{ fontSize: 12, color: c.subCodeRequired ? 'var(--warning)' : 'var(--text-muted)', fontWeight: c.subCodeRequired ? 700 : 400 }}>
          {c.subCodeRequired ? 'Wajib' : '-'}
        </span>
      ),
    },
    {
      key: 'active',
      header: 'Aktif',
      align: 'center',
      render: (c) => (
        <button
          type="button"
          role="switch"
          aria-checked={c.active}
          aria-label={`Alihkan status aktif kode ${c.code}`}
          disabled={!canManage || pending === c.code}
          onClick={() => patch(c.code, { active: !c.active }, `status aktif = ${!c.active}`)}
          style={switchStyle(c.active, !canManage || pending === c.code)}
        >
          <span aria-hidden style={knobStyle(c.active)} />
        </button>
      ),
    },
  ];

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Master Kode IADC</h2>
        <Badge kind="Draft">{iadc.data?.length ?? 0} kode</Badge>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 8px' }}>
        Atur klasifikasi operasi, atribusi NPT, dan status aktif kode. Setiap perubahan tercatat di jejak audit.
      </p>
      {!meLoading && !canManage && <Note kind="warn">Alihkan status dinonaktifkan karena role Anda tidak punya izin <code>master:manage</code>.</Note>}
      {iadc.error && <Note kind="error">{iadc.error}</Note>}
      <div style={{ marginTop: 8 }}>
        {iadc.loading ? (
          <TableSkeleton rows={8} />
        ) : (
          <DataTable columns={columns} rows={iadc.data ?? []} rowKey={(c) => c.code} zebra maxHeight={560} empty="Belum ada kode IADC." />
        )}
      </div>
    </Card>
  );
}

function switchStyle(checked: boolean, disabled: boolean): React.CSSProperties {
  return {
    width: 44,
    height: 24,
    borderRadius: 999,
    border: '1px solid var(--border-default)',
    background: checked ? 'var(--accent-teal)' : 'var(--border-strong)',
    position: 'relative',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    transition: 'background 150ms',
  };
}

function knobStyle(checked: boolean): React.CSSProperties {
  return {
    position: 'absolute',
    top: 2,
    left: checked ? 22 : 2,
    width: 18,
    height: 18,
    borderRadius: '50%',
    background: '#fff',
    transition: 'left 150ms',
  };
}

/* ------------------------------------------------------------------ */
/* Contract Rate Cards (editor tier + rekapitulasi billing)            */
/* ------------------------------------------------------------------ */

type RateTierForm = { fromHour: string; toHour: string; ratePerHour: string; label: string };

type RateCardRow = {
  id: string;
  rigId: string | null;
  activityCode: string;
  label: string | null;
  tiers: Array<{ fromHour: number; toHour: number | null; ratePerHour: number; label?: string }>;
  effectiveDate: string | null;
  active: boolean;
};

type RateCardPayload = RateCardRow[];

/** Tiga tier kosong (form default) - label/rate diisi user, bukan angka tetap. */
function emptyTiers(): RateTierForm[] {
  return [
    { fromHour: '0', toHour: '', ratePerHour: '', label: '' },
    { fromHour: '', toHour: '', ratePerHour: '', label: '' },
    { fromHour: '', toHour: '', ratePerHour: '', label: '' },
  ];
}

/** Angka dari input teks; kosong → null (untuk `toHour` yang boleh tak terbatas). */
function parseNum(raw: string): number | null {
  const value = raw.trim();
  if (value === '') return null;
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function ContractsSection({ canManage, meLoading }: { canManage: boolean; meLoading: boolean }) {
  const rigs = useApi<RigDto[]>('/api/rigs');
  const reports = useApi<ReportsList>('/api/reports?limit=1');
  const latestDate = reports.data?.items?.[0]?.reportDate ?? null;
  // P1-4: fallback bulan WIB (bukan UTC) agar 1 Jan 00:00-06:59 WIB tidak jadi Desember.
  const month = latestDate ? latestDate.slice(0, 7) : currentMonthIsoLocal();
  const rigId = rigs.data && rigs.data.length > 0 ? rigs.data[0].id : null;

  const billing = useApi<BillingSummary>(rigId ? `/api/billing?rigId=${rigId}&month=${month}` : null);

  /* ---------- editor rate card ---------- */
  const rateCards = useApi<RateCardPayload>('/api/master/rate-cards');
  const [formRigId, setFormRigId] = useState<string>('');
  const [activityCode, setActivityCode] = useState('');
  const [label, setLabel] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [tiers, setTiers] = useState<RateTierForm[]>(() => emptyTiers());
  const [saving, setSaving] = useState(false);

  const effectiveRigId = formRigId || rigId || '';

  const visibleCards = useMemo(() => {
    const list = rateCards.data ?? [];
    if (!effectiveRigId) return list;
    return list.filter((c) => c.rigId === effectiveRigId || c.rigId === null);
  }, [rateCards.data, effectiveRigId]);

  function setTier(index: number, patch: Partial<RateTierForm>) {
    setTiers((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }

  async function saveRateCard() {
    if (!/^\d{1,4}$/.test(activityCode.trim())) {
      toast.error('Kode aktivitas harus 1-4 digit angka (mis. 01, 08, 27).');
      return;
    }

    const parsedTiers: Array<{ fromHour: number; toHour: number | null; ratePerHour: number; label?: string }> = [];
    for (let i = 0; i < tiers.length; i += 1) {
      const t = tiers[i];
      const fromHour = parseNum(t.fromHour);
      const rate = parseNum(t.ratePerHour);
      const toHour = parseNum(t.toHour);
      // Baris tier yang benar-benar kosong dilewati.
      if (fromHour === null && rate === null && t.toHour.trim() === '' && t.label.trim() === '') continue;

      if (fromHour === null || rate === null) {
        toast.error(`Tier ${i + 1}: jam mulai dan tarif per jam wajib diisi.`);
        return;
      }
      if (toHour !== null && toHour <= fromHour) {
        toast.error(`Tier ${i + 1}: jam selesai harus lebih besar dari jam mulai (kosongkan bila tanpa batas).`);
        return;
      }
      parsedTiers.push({
        fromHour,
        toHour,
        ratePerHour: rate,
        ...(t.label.trim() ? { label: t.label.trim() } : {}),
      });
    }

    if (parsedTiers.length === 0) {
      toast.error('Isi minimal satu tier tarif agar rate card bisa disimpan.');
      return;
    }

    setSaving(true);
    try {
      await apiSend<{ id: string }>('/api/master/rate-cards', 'POST', {
        rigId: effectiveRigId || null,
        activityCode: activityCode.trim(),
        label: label.trim() ? label.trim() : null,
        tiers: parsedTiers,
        effectiveDate: effectiveDate.trim() ? effectiveDate.trim() : null,
      });
      toast.success(`Rate card ${activityCode.trim()} tersimpan dengan ${parsedTiers.length} tier tarif.`);
      setActivityCode('');
      setLabel('');
      setTiers(emptyTiers());
      rateCards.reload();
      billing.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan rate card. Periksa tier tarif lalu coba lagi.');
    } finally {
      setSaving(false);
    }
  }

  // Ringkas per kode IADC dari baris billing bulan berjalan.
  const byCode = useMemo(() => {
    const map = new Map<string, { code: string; name: string; hours: number; amount: number }>();
    for (const r of billing.data?.rows ?? []) {
      const cur = map.get(r.iadcCode) ?? { code: r.iadcCode, name: r.iadcName, hours: 0, amount: 0 };
      cur.hours += r.hours;
      cur.amount += r.amount;
      map.set(r.iadcCode, cur);
    }
    return [...map.values()].sort((a, b) => b.amount - a.amount);
  }, [billing.data]);

  const maxAmount = useMemo(() => byCode.reduce((m, r) => Math.max(m, r.amount), 0) || 1, [byCode]);

  const columns: Column<{ code: string; name: string; hours: number; amount: number }>[] = [
    { key: 'code', header: 'Kode', render: (r) => <strong className="tnum">{r.code}</strong> },
    { key: 'name', header: 'Aktivitas', render: (r) => r.name },
    { key: 'hours', header: 'Jam', align: 'right', render: (r) => r.hours.toFixed(2) },
    { key: 'amount', header: 'Nilai (USD)', align: 'right', render: (r) => formatUsd(r.amount) },
    {
      key: 'share',
      header: 'Porsi',
      width: 120,
      render: (r) => (
        <div role="progressbar" aria-valuenow={Math.round((r.amount / maxAmount) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`Porsi ${r.code}`} style={{ height: 6, background: 'var(--bg-surface-2)', borderRadius: 999 }}>
          <div style={{ width: `${(r.amount / maxAmount) * 100}%`, height: '100%', background: 'var(--accent-teal)', borderRadius: 999 }} />
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Rate Card Kontrak</h2>
          <Badge kind="Draft">{visibleCards.length} rate card</Badge>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 8px' }}>
          Tarif per jam untuk setiap kode aktivitas IADC. Rate card khusus rig dipakai lebih dulu daripada rate card global.
        </p>

        {!meLoading && !canManage && (
          <Note kind="warn">
            Hanya baca: role Anda tidak punya izin <code>billing:manage</code> untuk menyimpan rate card.
          </Note>
        )}
        {rateCards.error && <Note kind="error">{rateCards.error}</Note>}

        <fieldset disabled={!canManage || saving} style={{ border: 0, padding: 0, margin: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginTop: 8 }}>
            <Labeled label="Rig">
              <select style={inStyle()} value={effectiveRigId} onChange={(e) => setFormRigId(e.target.value)} aria-label="Rig rate card">
                <option value="">Global (semua rig)</option>
                {(rigs.data ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Labeled>
            <Labeled label="Kode aktivitas">
              <input className="tnum" style={inStyle()} value={activityCode} onChange={(e) => setActivityCode(e.target.value)} placeholder="01" maxLength={4} aria-label="Kode aktivitas" />
            </Labeled>
            <Labeled label="Label">
              <input style={inStyle()} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="mis. Rotary Drilling" aria-label="Nama rate card" />
            </Labeled>
            <Labeled label="Tanggal berlaku">
              <input className="tnum" type="date" style={inStyle()} value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} aria-label="Tanggal berlaku rate card" />
            </Labeled>
          </div>

          <span className="field-label" style={{ marginTop: 12 }}>Tier tarif (3 baris; kolom selesai kosong = tanpa batas)</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tiers.map((t, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, alignItems: 'end' }}>
                <Labeled label={`Tier ${i + 1} mulai (jam)`}>
                  <input className="tnum" style={inStyle()} inputMode="decimal" value={t.fromHour} onChange={(e) => setTier(i, { fromHour: e.target.value })} aria-label={`Tier ${i + 1} jam mulai`} />
                </Labeled>
                <Labeled label="Selesai (jam)">
                  <input className="tnum" style={inStyle()} inputMode="decimal" value={t.toHour} onChange={(e) => setTier(i, { toHour: e.target.value })} placeholder="∞" aria-label={`Tier ${i + 1} jam selesai`} />
                </Labeled>
                <Labeled label="Rate / jam (USD)">
                  <input className="tnum" style={inStyle()} inputMode="decimal" value={t.ratePerHour} onChange={(e) => setTier(i, { ratePerHour: e.target.value })} aria-label={`Tier ${i + 1} tarif per jam`} />
                </Labeled>
                <Labeled label="Nama tier">
                  <input style={inStyle()} value={t.label} onChange={(e) => setTier(i, { label: e.target.value })} aria-label={`Nama tier ${i + 1}`} />
                </Labeled>
              </div>
            ))}
          </div>

          <p style={{ margin: '12px 0 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button onClick={saveRateCard} disabled={!canManage || saving}>
              <CreditCard size={16} /> {saving ? 'Menyimpan...' : 'Simpan rate card'}
            </Button>
          </p>
        </fieldset>

        <div style={{ marginTop: 14, overflowX: 'auto' }}>
          {rateCards.loading ? (
            <TableSkeleton rows={4} />
          ) : visibleCards.length === 0 ? (
            <Note kind="info">Belum ada rate card untuk rig ini. Tambahkan lewat form di atas.</Note>
          ) : (
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', fontSize: 12, color: 'var(--text-muted)' }}>
                  <th style={{ padding: '6px 8px' }}>Kode</th>
                  <th style={{ padding: '6px 8px' }}>Label</th>
                  <th style={{ padding: '6px 8px' }}>Tier</th>
                  <th style={{ padding: '6px 8px' }}>Effective</th>
                  <th style={{ padding: '6px 8px', textAlign: 'center' }}>Aktif</th>
                </tr>
              </thead>
              <tbody>
                {visibleCards.map((c) => (
                  <tr key={c.id} style={{ borderTop: '1px solid var(--border-default)' }}>
                    <td className="tnum" style={{ padding: '6px 8px', fontWeight: 700 }}>{c.activityCode}</td>
                    <td style={{ padding: '6px 8px' }}>{c.label ?? '-'}</td>
                    <td className="tnum" style={{ padding: '6px 8px' }}>
                      {c.tiers.length === 0
                        ? '-'
                        : c.tiers
                            .map((t) => `${t.fromHour}-${t.toHour === null ? '∞' : t.toHour}h @ ${formatUsd(t.ratePerHour)}`)
                            .join(' · ')}
                    </td>
                    <td className="tnum" style={{ padding: '6px 8px' }}>{c.effectiveDate ?? '-'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                      <span style={{ color: c.active ? 'var(--success)' : 'var(--text-muted)', fontWeight: 700, fontSize: 12 }}>
                        {c.active ? 'Ya' : 'Tidak'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Card>
        <h2 style={{ fontSize: 16, margin: '0 0 4px' }}>Rekapitulasi Billing</h2>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 8px' }}>
          Ringkasan hanya baca: rate per kode IADC dari billing bulan {month}
          {rigs.data?.[0] ? ` · ${rigs.data[0].name}` : ''}. Nilai dihitung dari time breakdown × rate card (tiered).
        </p>

        {billing.error && <Note kind="error">{billing.error}</Note>}

        <div style={{ marginTop: 12 }}>
          {!rigId && !rigs.loading ? (
            <Note kind="info">Belum ada rig terdaftar, jadi rate card belum bisa ditampilkan. Tambahkan rig terlebih dahulu.</Note>
          ) : billing.loading ? (
            <TableSkeleton rows={6} />
          ) : (
            <DataTable columns={columns} rows={byCode} rowKey={(r) => r.code} zebra empty="Belum ada baris billing untuk bulan ini. Pastikan laporan bulan ini sudah disetujui." />
          )}
        </div>

        {billing.data && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, borderTop: '1px solid var(--border-default)', marginTop: 12, paddingTop: 12 }}>
            <SummaryStat label="Jam dapat ditagih" value={`${billing.data.totals.billableHours.toFixed(2)} h`} />
            <SummaryStat label="Total nilai tagihan" value={formatUsd(billing.data.totals.amount)} />
            <SummaryStat label="Jam force majeure" value={`${billing.data.totals.forceMajeureHours.toFixed(2)} h`} />
            <SummaryStat label="Dapat ditagih ulang" value={formatUsd(billing.data.totals.rebillableAmount)} />
          </div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* KPI Formula Builder (definisi KPI dari database)                     */
/* ------------------------------------------------------------------ */

type KpiRow = {
  id: string;
  name: string;
  formula: string;
  category: string | null;
  baseline: number | null;
  unit: string | null;
  active: boolean;
};

function KpiSection({ canManage, meLoading }: { canManage: boolean; meLoading: boolean }) {
  const kpi = useApi<KpiRow[]>('/api/master/kpi');

  const [name, setName] = useState('');
  const [formula, setFormula] = useState('');
  const [category, setCategory] = useState('');
  const [baseline, setBaseline] = useState('');
  const [unit, setUnit] = useState('');
  const [saving, setSaving] = useState(false);

  async function createKpi() {
    if (!name.trim()) {
      toast.error('Nama KPI wajib diisi.');
      return;
    }
    if (!formula.trim()) {
      toast.error('Formula KPI wajib diisi.');
      return;
    }

    let baselineValue: number | null = null;
    if (baseline.trim() !== '') {
      const parsed = Number(baseline.replace(',', '.'));
      if (!Number.isFinite(parsed)) {
        toast.error('Baseline harus berupa angka.');
        return;
      }
      baselineValue = parsed;
    }

    setSaving(true);
    try {
      await apiSend<{ id: string }>('/api/master/kpi', 'POST', {
        name: name.trim(),
        formula: formula.trim(),
        category: category.trim() ? category.trim() : null,
        baseline: baselineValue,
        unit: unit.trim() ? unit.trim() : null,
      });
      toast.success(`KPI "${name.trim()}" ditambahkan.`);
      setName('');
      setFormula('');
      setCategory('');
      setBaseline('');
      setUnit('');
      kpi.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan definisi KPI. Periksa formula lalu coba lagi.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Definisi Formula KPI</h2>
          <Badge kind="Draft">{kpi.data?.length ?? 0} definisi</Badge>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 8px' }}>
          Definisi KPI tersimpan di data master dan dipakai dashboard/laporan. Rumus kalkulasi yang berlaku tetap di{' '}
          <code>@rigdaily/shared</code>; entri di sini hanya dokumentasi formula yang bisa diubah admin.
        </p>

        {!meLoading && !canManage && (
          <Note kind="warn">
            Hanya baca: role Anda tidak punya izin <code>master:manage</code> untuk menambah definisi KPI.
          </Note>
        )}
        {kpi.error && <Note kind="error">{kpi.error}</Note>}

        <fieldset disabled={!canManage || saving} style={{ border: 0, padding: 0, margin: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginTop: 8 }}>
            <Labeled label="Nama KPI">
              <input style={inStyle()} value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Cost per Meter" aria-label="Nama KPI" />
            </Labeled>
            <Labeled label="Kategori">
              <input style={inStyle()} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="mis. efisiensi / biaya" aria-label="Kategori KPI" />
            </Labeled>
            <Labeled label="Nilai acuan (baseline)">
              <input className="tnum" style={inStyle()} inputMode="decimal" value={baseline} onChange={(e) => setBaseline(e.target.value)} aria-label="Nilai acuan KPI" />
            </Labeled>
            <Labeled label="Satuan">
              <input style={inStyle()} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="% / USD/m" aria-label="Satuan KPI" />
            </Labeled>
          </div>
          <div style={{ marginTop: 12 }}>
            <Labeled label="Formula">
              <textarea
                className="tnum"
                style={{ ...inStyle(), height: 'auto', padding: 8 }}
                rows={2}
                value={formula}
                onChange={(e) => setFormula(e.target.value)}
                placeholder="mis. cost_daily_usd / progress_24h"
                aria-label="Formula KPI"
              />
            </Labeled>
          </div>
          <p style={{ margin: '12px 0 0' }}>
            <Button onClick={createKpi} disabled={!canManage || saving}>
              <Sigma size={16} /> {saving ? 'Menyimpan...' : 'Tambah KPI'}
            </Button>
          </p>
        </fieldset>
      </Card>

      <Card>
        <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Definisi KPI Tersimpan</h2>
        {kpi.loading ? (
          <TableSkeleton rows={4} />
        ) : (kpi.data?.length ?? 0) === 0 ? (
          <Note kind="info">Belum ada definisi KPI. Tambahkan lewat form di atas.</Note>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(kpi.data ?? []).map((k) => (
              <div key={k.id} style={{ border: '1px solid var(--border-default)', borderRadius: 6, overflow: 'hidden' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px', background: 'var(--bg-surface-2)' }}>
                  <strong style={{ fontSize: 13 }}>{k.name}</strong>
                  {k.category && <Badge kind="Draft">{k.category}</Badge>}
                  {!k.active && <Badge kind="Locked">NONAKTIF</Badge>}
                  {k.baseline !== null && (
                    <span className="tnum" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-secondary)' }}>
                      Nilai acuan {k.baseline} {k.unit ?? ''}
                    </span>
                  )}
                </div>
                <pre
                  className="tnum"
                  style={{ margin: 0, padding: 12, background: 'var(--bg-sidebar)', color: '#fff', fontSize: 12, overflow: 'auto', fontFamily: 'var(--font-mono)' }}
                >
                  {k.formula}
                </pre>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Regulatory Audit Log                                                 */
/* ------------------------------------------------------------------ */

function AuditSection({ canRead }: { canRead: boolean }) {
  const audit = useApi<AuditEntryDto[]>(canRead ? '/api/admin/audit?limit=200' : null);
  const [entity, setEntity] = useState('all');
  const [q, setQ] = useState('');

  const entities = useMemo(() => {
    const set = new Set<string>();
    for (const a of audit.data ?? []) set.add(a.entity);
    return [...set].sort();
  }, [audit.data]);

  const filtered = useMemo(() => {
    let list = audit.data ?? [];
    if (entity !== 'all') list = list.filter((a) => a.entity === entity);
    if (q.trim()) {
      const s = q.toLowerCase();
      list = list.filter(
        (a) =>
          a.entity.toLowerCase().includes(s) ||
          (a.entityId ?? '').toLowerCase().includes(s) ||
          (a.actorName ?? '').toLowerCase().includes(s) ||
          a.action.toLowerCase().includes(s),
      );
    }
    return list;
  }, [audit.data, entity, q]);

  function exportCsv() {
    const header = 'at,actorName,entity,entityId,action,oldJson,newJson,ip';
    const body = filtered
      .map((a) =>
        [
          a.at,
          a.actorName ?? '',
          a.entity,
          a.entityId ?? '',
          a.action,
          JSON.stringify(a.oldJson ?? ''),
          JSON.stringify(a.newJson ?? ''),
          a.ip ?? '',
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(','),
      )
      .join('\n');
    const blob = new Blob([`${header}\n${body}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // P1-4: tanggal berkas memakai "hari ini" WIB, bukan UTC.
    a.download = `rigdaily-audit-${todayIsoLocal()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Jejak audit diekspor (${filtered.length} baris).`);
  }

  const columns: Column<AuditEntryDto>[] = [
    { key: 'at', header: 'Waktu', render: (a) => <span className="tnum" style={{ fontSize: 12 }}>{fmtDateTime(a.at)}</span> },
    { key: 'actorName', header: 'Pelaku', render: (a) => a.actorName ?? <span style={{ color: 'var(--text-muted)' }}>sistem</span> },
    {
      key: 'entity',
      header: 'Entitas',
      render: (a) => (
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
          <span style={{ background: '#fff', border: '1px solid var(--border-strong)', borderRadius: 3, padding: '1px 6px', fontSize: 11, alignSelf: 'flex-start' }}>{a.entity}</span>
          {a.entityId ? <span className="tnum" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{a.entityId.slice(0, 20)}</span> : null}
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Aksi',
      render: (a) => (
        <span style={{ background: 'var(--info-soft)', color: 'var(--info)', borderRadius: 3, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>{a.action}</span>
      ),
    },
    {
      key: 'change',
      header: 'Sebelum → Sesudah',
      render: (a) => {
        const oldV = chipValue(a.oldJson);
        const newV = chipValue(a.newJson);
        return (
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', fontSize: 11 }}>
            {oldV ? <span style={{ background: 'var(--danger-soft)', borderRadius: 3, padding: '1px 5px' }}>{oldV}</span> : <span style={{ color: 'var(--text-muted)' }}>-</span>}
            {newV ? (
              <>
                <span aria-hidden>→</span>
                <span style={{ background: 'var(--success-soft)', borderRadius: 3, padding: '1px 5px' }}>{newV}</span>
              </>
            ) : null}
          </span>
        );
      },
    },
    { key: 'ip', header: 'IP', render: (a) => <span className="tnum" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{a.ip ?? '-'}</span> },
  ];

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 16, margin: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
          <ShieldCheck size={16} color="var(--success)" /> Jejak Audit Regulasi
        </h2>
        <Badge kind="Draft">{audit.data?.length ?? 0} entri</Badge>
        <span style={{ marginLeft: 'auto' }}>
          <Button variant="secondary" onClick={exportCsv} disabled={!canRead || filtered.length === 0}>
            <Download size={16} /> Export CSV
          </Button>
        </span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 8px' }}>
        Catatan permanen seluruh persetujuan DDR, perubahan data lumpur, dan penyesuaian AFE.
      </p>

      {!canRead && <Note kind="warn">Role Anda tidak punya izin <code>audit:read</code> untuk melihat jejak audit.</Note>}

      {canRead && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0', alignItems: 'center' }}>
            <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <Search size={14} color="var(--text-muted)" aria-hidden />
              <input
                style={{ ...inStyle(), maxWidth: 220 }}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Cari pelaku, entitas, atau aksi"
                aria-label="Cari jejak audit"
              />
            </span>
            <select style={{ ...inStyle(), maxWidth: 220, width: 'auto' }} value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Filter entitas">
              <option value="all">Entitas: Semua</option>
              {entities.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
            <span className="tnum" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-secondary)' }}>
              {filtered.length} baris
            </span>
          </div>

          {audit.error && <Note kind="error">{audit.error}</Note>}

          {audit.loading ? (
            <TableSkeleton rows={8} />
          ) : (
            <DataTable columns={columns} rows={filtered} rowKey={(a) => a.id} zebra maxHeight={560} empty="Tidak ada entri audit yang cocok dengan filter ini. Ubah kata kunci atau filter entitas." />
          )}
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Sync Devices & API key                                               */
/* ------------------------------------------------------------------ */

/** Hasil pembuatan/rotasi: API key plaintext hanya tampil sekali. */
type ApiKeyResult = { deviceId: string; apiKey: string; mode: 'create' | 'rotate' };

function DevicesSection({ canManage, meLoading }: { canManage: boolean; meLoading: boolean }) {
  const devices = useApi<SyncDeviceDto[]>('/api/admin/devices');
  const [createOpen, setCreateOpen] = useState(false);
  const [keyResult, setKeyResult] = useState<ApiKeyResult | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function toggleActive(d: SyncDeviceDto) {
    setPending(d.id);
    try {
      await apiSend(`/api/admin/devices?id=${d.id}`, 'PATCH', { active: !d.active });
      toast.success(`Perangkat ${d.name} ${d.active ? 'dinonaktifkan' : 'diaktifkan'}.`);
      devices.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengubah status perangkat. Coba lagi.');
    } finally {
      setPending(null);
    }
  }

  async function rotate(d: SyncDeviceDto) {
    setPending(d.id);
    try {
      const res = await apiSend<{ id: string; deviceId: string; apiKey: string }>(
        `/api/admin/devices/${d.id}/rotate`,
        'POST',
      );
      setKeyResult({ deviceId: res.deviceId, apiKey: res.apiKey, mode: 'rotate' });
      devices.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal merotasi API key. Coba lagi.');
    } finally {
      setPending(null);
    }
  }

  const columns: Column<SyncDeviceDto>[] = [
    {
      key: 'deviceId',
      header: 'ID Perangkat',
      render: (d) => (
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
          <strong className="tnum" style={{ fontSize: 12 }}>{d.deviceId}</strong>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{d.name}</span>
        </span>
      ),
    },
    {
      key: 'kind',
      header: 'Jenis',
      render: (d) => (
        <span style={{ background: 'var(--info-soft)', color: 'var(--info)', borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>
          {d.kind}
        </span>
      ),
    },
    { key: 'rigName', header: 'Rig', render: (d) => d.rigName ?? <span style={{ color: 'var(--text-muted)' }}>Semua rig</span> },
    {
      key: 'lastSeenAt',
      header: 'Terakhir Terlihat',
      render: (d) => <span className="tnum" style={{ fontSize: 12 }}>{d.lastSeenAt ? fmtDateTime(d.lastSeenAt) : 'Belum pernah'}</span>,
    },
    { key: 'pendingCount', header: 'Tertunda', align: 'right', render: (d) => <span className="tnum">{d.pendingCount}</span> },
    {
      key: 'active',
      header: 'Status',
      render: (d) => (
        <span
          style={{
            borderRadius: 999,
            padding: '2px 10px',
            fontSize: 11,
            fontWeight: 700,
            background: d.active ? 'var(--success-soft)' : 'var(--bg-surface-2)',
            color: d.active ? 'var(--success)' : 'var(--text-secondary)',
          }}
        >
          {d.active ? 'Aktif' : 'Nonaktif'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Aksi',
      width: 230,
      render: (d) => (
        <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => rotate(d)}
            disabled={!canManage || pending === d.id}
            aria-label={`Rotasi API key perangkat ${d.name}`}
            style={smallActionStyle(!canManage || pending === d.id, 'var(--text-primary)')}
          >
            <RefreshCw size={13} aria-hidden /> Rotasi Key
          </button>
          <button
            type="button"
            onClick={() => toggleActive(d)}
            disabled={!canManage || pending === d.id}
            aria-label={`${d.active ? 'Nonaktifkan' : 'Aktifkan'} perangkat ${d.name}`}
            style={smallActionStyle(!canManage || pending === d.id, d.active ? 'var(--danger)' : 'var(--success)')}
          >
            <Power size={13} aria-hidden /> {d.active ? 'Nonaktifkan' : 'Aktifkan'}
          </button>
        </span>
      ),
    },
  ];

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 16, margin: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
          <MonitorSmartphone size={16} color="var(--accent-teal)" /> Perangkat Sinkronisasi &amp; API Key
        </h2>
        <Badge kind="Draft">{devices.data?.length ?? 0} perangkat</Badge>
        <span style={{ marginLeft: 'auto' }}>
          <Button onClick={() => setCreateOpen(true)} disabled={!canManage}>
            <Plus size={16} /> Tambah Device
          </Button>
        </span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 8px' }}>
        API key dipakai aplikasi desktop di rig untuk mengirim data lewat <code>POST /api/sync/push</code> dengan header{' '}
        <code>x-device-key</code>. Key hanya disimpan dalam bentuk hash SHA-256 - plaintext ditampilkan <strong>sekali</strong>{' '}
        saat dibuat atau dirotasi. Nonaktifkan perangkat untuk memutus akses tanpa menghapus riwayat sinkronisasi.
      </p>

      {!meLoading && !canManage && (
        <Note kind="warn">
          Role Anda tidak punya izin <code>master:manage</code> untuk membuat perangkat atau merotasi API key.
        </Note>
      )}
      {devices.error && <Note kind="error">{devices.error}</Note>}

      <div style={{ marginTop: 8 }}>
        {devices.loading ? (
          <TableSkeleton rows={4} />
        ) : (
          <DataTable columns={columns} rows={devices.data ?? []} rowKey={(d) => d.id} zebra empty="Belum ada perangkat sinkronisasi terdaftar. Tambahkan lewat tombol Tambah Perangkat." />
        )}
      </div>

      <CreateDeviceModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(res) => {
          setCreateOpen(false);
          setKeyResult(res);
          devices.reload();
        }}
      />

      <ApiKeyModal result={keyResult} onClose={() => setKeyResult(null)} />
    </Card>
  );
}

function smallActionStyle(disabled: boolean, color: string): React.CSSProperties {
  return {
    display: 'inline-flex',
    gap: 4,
    alignItems: 'center',
    height: 28,
    padding: '0 8px',
    fontSize: 12,
    fontWeight: 600,
    fontFamily: 'inherit',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    borderRadius: 4,
    border: '1px solid var(--border-default)',
    background: '#fff',
    color,
  };
}

function CreateDeviceModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (result: ApiKeyResult) => void;
}) {
  const rigs = useApi<RigDto[]>(open ? '/api/rigs' : null);
  const [deviceId, setDeviceId] = useState('');
  const [name, setName] = useState('');
  const [rigId, setRigId] = useState('');
  const [kind, setKind] = useState<'electron' | 'office' | 'api'>('electron');
  const [busy, setBusy] = useState(false);

  function reset() {
    setDeviceId('');
    setName('');
    setRigId('');
    setKind('electron');
  }

  async function submit() {
    if (deviceId.trim().length < 3) {
      toast.error('Device ID wajib diisi, minimal 3 karakter.');
      return;
    }
    if (!name.trim()) {
      toast.error('Nama perangkat wajib diisi.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiSend<{ id: string; deviceId: string; apiKey: string }>('/api/admin/devices', 'POST', {
        deviceId: deviceId.trim(),
        name: name.trim(),
        rigId: rigId ? rigId : null,
        kind,
      });
      toast.success(`Perangkat ${res.deviceId} berhasil dibuat.`);
      reset();
      onCreated({ deviceId: res.deviceId, apiKey: res.apiKey, mode: 'create' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal membuat perangkat. Periksa Device ID lalu coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Tambah Perangkat Sinkronisasi">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Labeled label="Device ID">
          <input
            className="tnum"
            style={inStyle()}
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            placeholder="rig-jackup-01"
            maxLength={80}
            aria-label="Device ID"
          />
        </Labeled>
        <Labeled label="Nama perangkat">
          <input
            style={inStyle()}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Laptop Rig Cleric - Jackup 01"
            maxLength={160}
            aria-label="Nama perangkat"
          />
        </Labeled>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <Labeled label="Rig (opsional)">
          <select style={inStyle()} value={rigId} onChange={(e) => setRigId(e.target.value)} aria-label="Rig device">
            <option value="">- tanpa rig -</option>
            {(rigs.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label="Jenis perangkat">
          <select
            style={inStyle()}
            value={kind}
            onChange={(e) => setKind(e.target.value === 'office' ? 'office' : e.target.value === 'api' ? 'api' : 'electron')}
            aria-label="Jenis perangkat"
          >
            <option value="electron">electron</option>
            <option value="office">office</option>
            <option value="api">api</option>
          </select>
        </Labeled>
      </div>
      <Note kind="info">
        Device ID harus sama dengan <code>deviceId</code> yang dikirim aplikasi rig saat sinkronisasi. API key dibuat otomatis
        dan hanya ditampilkan sekali.
      </Note>
      <p style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <Button onClick={submit} disabled={busy}>
          <KeyRound size={16} /> {busy ? 'Membuat...' : 'Buat device + key'}
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Batal
        </Button>
      </p>
    </Modal>
  );
}

function ApiKeyModal({ result, onClose }: { result: ApiKeyResult | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.apiKey);
      setCopied(true);
      toast.success('API key disalin ke clipboard.');
    } catch {
      toast.error('Gagal menyalin otomatis. Salin manual dari kotak di bawah.');
    }
  }

  return (
    <Modal open={result !== null} onClose={onClose} title={result?.mode === 'rotate' ? 'API Key Baru (Rotasi)' : 'API Key Perangkat'}>
      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Note kind="warn">
            Simpan sekarang - API key ini <strong>tidak akan ditampilkan lagi</strong>. Key lama (bila ada) langsung tidak
            berlaku.
          </Note>
          <Labeled label={`API key perangkat ${result.deviceId}`}>
            <textarea
              readOnly
              value={result.apiKey}
              rows={2}
              className="tnum"
              aria-label="API key perangkat"
              onFocus={(e) => e.currentTarget.select()}
              style={{
                width: '100%',
                border: '1px solid var(--border-strong)',
                borderRadius: 4,
                padding: 8,
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                background: 'var(--bg-surface-2)',
                color: 'var(--text-primary)',
                resize: 'none',
              }}
            />
          </Labeled>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
            Kirim sebagai header <code>x-device-key</code> pada <code>POST /api/sync/push</code> dengan{' '}
            <code>deviceId</code> = <span className="tnum">{result.deviceId}</span>.
          </p>
          <p style={{ display: 'flex', gap: 8, margin: 0 }}>
            <Button onClick={copy}>
              <Copy size={16} /> {copied ? 'Tersalin' : 'Salin ke clipboard'}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Selesai
            </Button>
          </p>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Helper tampilan                                                      */
/* ------------------------------------------------------------------ */

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="field-label" style={{ marginBottom: 2 }}>{label}</div>
      <div className="tnum" style={{ fontWeight: 800 }}>{value}</div>
    </div>
  );
}

function TableSkeleton({ rows }: { rows: number }) {
  return (
    <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} aria-hidden style={{ height: 32, background: 'var(--bg-surface-2)', borderRadius: 4 }} />
      ))}
    </div>
  );
}
