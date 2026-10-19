'use client';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, KeyRound, Laptop, LogOut, Pencil, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card } from '@rigdaily/ui';
import { ROLES, type Permission, type RoleId } from '@rigdaily/shared';
import { Labeled, Modal, Note, inStyle } from '@/components/controls';
import { ApiClientError, apiSend } from '@/lib/api-client';
import { useApi } from '@/lib/hooks/useApi';

/* ------------------------------------------------------------------ */
/* Tipe respons API                                                     */
/* ------------------------------------------------------------------ */

type ProfileDto = {
  id: string;
  email: string;
  name: string;
  role: string;
  rigScope: string[];
  mfaEnabled: boolean;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  companyName: string | null;
  permissions: Permission[];
};

type SessionDto = {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
};

type MePayload = {
  user: { id: string; name: string; email: string; role: string; rigScope: string[] };
  permissions: Permission[];
  profile: ProfileDto;
};

const PASSWORD_MIN = 8;

/* ------------------------------------------------------------------ */
/* Util tampilan                                                        */
/* ------------------------------------------------------------------ */

function initialsOf(name: string, email: string): string {
  const fromName = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
  return fromName || (email[0] ?? '?').toUpperCase();
}

function fmtDate(iso: string | null, fallback = '-'): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(iso: string | null, fallback = '-'): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Parser user-agent sederhana → "Chrome · Windows", "Firefox · macOS", dsb. */
function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return 'Perangkat tak dikenal';
  const ua = userAgent.toLowerCase();

  const browser = /edg\//.test(ua)
    ? 'Edge'
    : /opr\/|opera/.test(ua)
      ? 'Opera'
      : /chrome\/|crios\//.test(ua) && !/chromium/.test(ua)
        ? 'Chrome'
        : /firefox\/|fxios\//.test(ua)
          ? 'Firefox'
          : /safari\//.test(ua)
            ? 'Safari'
            : /curl\/|wget\//.test(ua)
              ? 'CLI'
              : /node|undici/.test(ua)
                ? 'Server'
                : 'Browser';

  const os = /windows/.test(ua)
    ? 'Windows'
    : /iphone|ipad|ios/.test(ua)
      ? 'iOS'
      : /mac os x|macintosh/.test(ua)
        ? 'macOS'
        : /android/.test(ua)
          ? 'Android'
          : /linux/.test(ua)
            ? 'Linux'
            : 'OS tak dikenal';

  return `${browser} · ${os}`;
}

/** Skor kekuatan password 0-4 sederhana (panjang + variasi karakter, tanpa library). */
function passwordScore(value: string): { score: number; label: string; color: string } {
  let score = 0;
  if (value.length >= PASSWORD_MIN) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score += 1;
  const labels = ['Sangat lemah', 'Lemah', 'Cukup', 'Kuat', 'Sangat kuat'];
  const colors = ['var(--danger)', 'var(--danger)', 'var(--warning)', 'var(--success)', 'var(--success)'];
  const idx = Math.min(4, score);
  return { score: idx, label: labels[idx], color: colors[idx] };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Kelompokkan permission per prefix ("report:create" → "report"). */
function groupPermissions(perms: Permission[]): Array<{ prefix: string; items: Permission[] }> {
  const map = new Map<string, Permission[]>();
  for (const p of perms) {
    const prefix = p.split(':')[0] ?? 'other';
    const list = map.get(prefix) ?? [];
    list.push(p);
    map.set(prefix, list);
  }
  return [...map.entries()]
    .map(([prefix, items]) => ({ prefix, items: items.sort() }))
    .sort((a, b) => a.prefix.localeCompare(b.prefix));
}

/* ------------------------------------------------------------------ */
/* Halaman                                                              */
/* ------------------------------------------------------------------ */

export default function ProfilePage() {
  const me = useApi<MePayload>('/api/auth/me');
  const sessions = useApi<SessionDto[]>('/api/auth/sessions');

  const profile = me.data?.profile ?? null;
  const roleLabel = profile ? (ROLES[profile.role as RoleId]?.label ?? profile.role) : '-';

  const groups = useMemo(() => groupPermissions(profile?.permissions ?? []), [profile]);

  /* ---------- modal state ---------- */
  const [editOpen, setEditOpen] = useState(false);
  const [revokeAllOpen, setRevokeAllOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);

  /* ---------- edit profil ---------- */
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  /* ---------- ganti password ---------- */
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwInfo, setPwInfo] = useState<string | null>(null);
  const [savingPw, setSavingPw] = useState(false);

  /* ---------- sesi ---------- */
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);

  const [loggingOut, setLoggingOut] = useState(false);

  // Deep link dari UserMenu: /profile#password → gulir ke kartu password.
  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hash !== '#password') return;
    const el = document.getElementById('password');
    el?.scrollIntoView({ block: 'start' });
    el?.querySelector<HTMLInputElement>('input')?.focus();
  }, [me.loading]);

  function openEdit() {
    setFormName(profile?.name ?? '');
    setFormEmail(profile?.email ?? '');
    setNameError(null);
    setEmailError(null);
    setEditOpen(true);
  }

  async function saveProfile() {
    const name = formName.trim();
    const email = formEmail.trim();
    let bad = false;
    if (name.length < 2) {
      setNameError('Nama minimal 2 karakter.');
      bad = true;
    }
    if (!EMAIL_RE.test(email)) {
      setEmailError('Format email tidak valid. Gunakan bentuk nama@perusahaan.com.');
      bad = true;
    }
    if (bad) return;

    setSavingProfile(true);
    setNameError(null);
    setEmailError(null);
    try {
      await apiSend<ProfileDto>('/api/auth/me', 'PATCH', { name, email });
      toast.success('Profil diperbarui.');
      setEditOpen(false);
      me.reload();
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'EMAIL_TAKEN') {
        setEmailError(err.message);
      } else {
        toast.error(err instanceof Error ? err.message : 'Gagal menyimpan profil. Periksa isian lalu coba lagi.');
      }
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword() {
    setPwError(null);
    setPwInfo(null);
    if (pwNew.length < PASSWORD_MIN) {
      setPwError(`Kata sandi baru minimal ${PASSWORD_MIN} karakter.`);
      return;
    }
    if (pwNew !== pwConfirm) {
      setPwError('Konfirmasi kata sandi tidak sama dengan kata sandi baru.');
      return;
    }
    if (pwNew === pwCurrent) {
      setPwError('Kata sandi baru harus berbeda dari kata sandi saat ini.');
      return;
    }

    setSavingPw(true);
    try {
      const res = await apiSend<{ ok: boolean; revokedSessions: number }>('/api/auth/password', 'POST', {
        currentPassword: pwCurrent,
        newPassword: pwNew,
        confirmPassword: pwConfirm,
      });
      setPwCurrent('');
      setPwNew('');
      setPwConfirm('');
      const info =
        res.revokedSessions > 0
          ? `Kata sandi diperbarui. ${res.revokedSessions} sesi lain dicabut.`
          : 'Kata sandi diperbarui. Tidak ada sesi lain yang perlu dicabut.';
      setPwInfo(info);
      toast.success(info);
      sessions.reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal mengganti kata sandi. Periksa kata sandi saat ini lalu coba lagi.';
      setPwError(msg);
    } finally {
      setSavingPw(false);
    }
  }

  async function revokeOne(id: string) {
    setRevoking(id);
    try {
      await apiSend<{ ok: boolean }>(`/api/auth/sessions/${encodeURIComponent(id)}`, 'DELETE');
      toast.success('Sesi dicabut.');
      sessions.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mencabut sesi. Coba lagi.');
    } finally {
      setRevoking(null);
    }
  }

  async function revokeOthers() {
    setRevokingAll(true);
    try {
      const res = await apiSend<{ revoked: number }>('/api/auth/sessions', 'DELETE');
      toast.success(res.revoked > 0 ? `${res.revoked} sesi lain dicabut.` : 'Tidak ada sesi lain yang perlu dicabut.');
      setRevokeAllOpen(false);
      sessions.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mencabut sesi lain. Coba lagi.');
    } finally {
      setRevokingAll(false);
    }
  }

  async function logout() {
    setLoggingOut(true);
    try {
      await apiSend<{ ok: boolean }>('/api/auth/logout', 'POST');
      window.location.assign('/login');
    } catch (err) {
      setLoggingOut(false);
      toast.error(err instanceof Error ? err.message : 'Gagal keluar dari akun. Coba lagi.');
    }
  }

  const strength = passwordScore(pwNew);
  const otherSessions = (sessions.data ?? []).filter((s) => !s.current);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ---------- Header ---------- */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1 className="type-h1" style={{ margin: 0 }}>
          Profil &amp; Keamanan
        </h1>
        <p className="type-small" style={{ margin: 0, color: 'var(--text-secondary)' }}>
          Kelola identitas akun, kata sandi, dan sesi aktif. Perubahan tercatat di jejak audit perusahaan.
        </p>
      </div>

      {me.error && <Note kind="error">{me.error}</Note>}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 16,
          alignItems: 'start',
        }}
      >
        {/* ---------- Kartu Identitas ---------- */}
        <Card>
          {me.loading && !profile ? (
            <p className="type-small" style={{ margin: 0, color: 'var(--text-muted)' }}>
              Memuat profil...
            </p>
          ) : profile ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span
                  aria-hidden
                  style={{
                    display: 'flex',
                    width: 56,
                    height: 56,
                    flex: '0 0 auto',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 999,
                    background: 'var(--bg-sidebar)',
                    color: 'var(--text-on-dark)',
                    fontSize: 'var(--text-lg)',
                    fontWeight: 'var(--weight-bold)',
                    letterSpacing: 'var(--tracking-wide)',
                  }}
                >
                  {initialsOf(profile.name, profile.email)}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="type-h2" style={{ color: 'var(--text-primary)' }}>
                    {profile.name}
                  </div>
                  <div className="type-small truncate" style={{ color: 'var(--text-secondary)' }} title={profile.email}>
                    {profile.email}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '2px 10px',
                        borderRadius: 'var(--radius-badge)',
                        background: 'var(--accent-tonal)',
                        color: 'var(--bg-sidebar)',
                        fontSize: 'var(--text-xs)',
                        fontWeight: 'var(--weight-semibold)',
                      }}
                    >
                      <ShieldCheck size={12} aria-hidden />
                      {roleLabel}
                    </span>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '2px 10px',
                        borderRadius: 'var(--radius-badge)',
                        background: profile.active ? 'var(--success-soft)' : 'var(--bg-surface-2)',
                        color: profile.active ? 'var(--success)' : 'var(--text-secondary)',
                        fontSize: 'var(--text-xs)',
                        fontWeight: 'var(--weight-semibold)',
                      }}
                    >
                      {profile.active ? 'Aktif' : 'Non-aktif'}
                    </span>
                  </div>
                </div>
                <span style={{ marginLeft: 'auto', alignSelf: 'flex-start' }}>
                  <Button variant="secondary" onClick={openEdit}>
                    <Pencil size={15} aria-hidden /> Edit Profil
                  </Button>
                </span>
              </div>

              <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, margin: 0 }}>
                <div>
                  <dt className="type-label">Perusahaan</dt>
                  <dd className="type-body" style={{ margin: '2px 0 0' }}>
                    {profile.companyName ?? '-'}
                  </dd>
                </div>
                <div>
                  <dt className="type-label">MFA</dt>
                  <dd className="type-body" style={{ margin: '2px 0 0' }}>
                    {profile.mfaEnabled ? 'Aktif' : 'Belum aktif'}
                  </dd>
                </div>
                <div>
                  <dt className="type-label">Login terakhir</dt>
                  <dd className="type-small tnum" style={{ margin: '2px 0 0' }}>
                    {fmtDateTime(profile.lastLoginAt, 'Belum pernah login')}
                  </dd>
                </div>
                <div>
                  <dt className="type-label">Bergabung</dt>
                  <dd className="type-small tnum" style={{ margin: '2px 0 0' }}>
                    {fmtDate(profile.createdAt)}
                  </dd>
                </div>
              </dl>
            </div>
          ) : (
            <Note kind="warn">Data profil tidak tersedia. Muat ulang halaman atau masuk kembali.</Note>
          )}
        </Card>

        {/* ---------- Kartu Ganti Password ---------- */}
        <Card>
          <div id="password" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <KeyRound size={16} aria-hidden style={{ color: 'var(--text-secondary)' }} />
            <h2 className="type-h2" style={{ margin: 0 }}>
              Ganti Kata Sandi
            </h2>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void savePassword();
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            <Labeled label="Kata sandi saat ini">
              <input
                id="current-password"
                type="password"
                autoComplete="current-password"
                style={inStyle()}
                value={pwCurrent}
                onChange={(e) => setPwCurrent(e.target.value)}
                disabled={savingPw}
              />
            </Labeled>
            <Labeled label={`Kata sandi baru (min. ${PASSWORD_MIN} karakter)`}>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                style={inStyle()}
                value={pwNew}
                onChange={(e) => {
                  setPwNew(e.target.value);
                  setPwInfo(null);
                }}
                aria-describedby="pw-strength"
                disabled={savingPw}
              />
            </Labeled>
            {pwNew.length > 0 && (
              <div id="pw-strength" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div
                  role="progressbar"
                  aria-valuenow={strength.score}
                  aria-valuemin={0}
                  aria-valuemax={4}
                  aria-label="Kekuatan kata sandi"
                  style={{ display: 'flex', gap: 3, flex: 1 }}
                >
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      style={{
                        height: 4,
                        flex: 1,
                        borderRadius: 999,
                        background: i < strength.score ? strength.color : 'var(--bg-surface-2)',
                      }}
                    />
                  ))}
                </div>
                <span className="type-small" style={{ color: strength.color, fontWeight: 'var(--weight-medium)' }}>
                  {strength.label}
                </span>
              </div>
            )}
            <Labeled label="Konfirmasi kata sandi baru">
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                style={inStyle()}
                value={pwConfirm}
                onChange={(e) => setPwConfirm(e.target.value)}
                disabled={savingPw}
              />
            </Labeled>

            {pwError && (
              <p role="alert" className="type-small" style={{ margin: 0, color: 'var(--danger-deep)' }}>
                {pwError}
              </p>
            )}
            {pwInfo && <Note kind="success">{pwInfo}</Note>}

            <div style={{ display: 'flex', gap: 8 }}>
              <Button type="submit" disabled={savingPw}>
                {savingPw ? 'Menyimpan...' : 'Simpan Kata Sandi'}
              </Button>
            </div>
            <p className="type-small" style={{ margin: 0, color: 'var(--text-muted)' }}>
              Mengganti kata sandi akan mencabut semua sesi lain, sehingga perangkat lain langsung keluar.
            </p>
          </form>
        </Card>

        {/* ---------- Kartu Sesi Aktif (span 2 kolom) ---------- */}
        <div style={{ gridColumn: '1 / -1', minWidth: 0 }}>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <Laptop size={16} aria-hidden style={{ color: 'var(--text-secondary)' }} />
              <h2 className="type-h2" style={{ margin: 0 }}>
                Sesi Aktif
              </h2>
              <Badge kind="Draft">{sessions.data?.length ?? 0} sesi</Badge>
              <span style={{ marginLeft: 'auto' }}>
                <Button
                  variant="secondary"
                  onClick={() => setRevokeAllOpen(true)}
                  disabled={otherSessions.length === 0 || revokingAll}
                >
                  <Trash2 size={15} aria-hidden /> Cabut semua sesi lain
                </Button>
              </span>
            </div>

            {sessions.error && <Note kind="error">{sessions.error}</Note>}

            {sessions.loading && !sessions.data ? (
              <p className="type-small" style={{ margin: 0, color: 'var(--text-muted)' }}>
                Memuat sesi...
              </p>
            ) : (sessions.data?.length ?? 0) === 0 ? (
              <p className="type-small" style={{ margin: 0, color: 'var(--text-muted)' }}>
                Belum ada sesi aktif yang tercatat.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <caption className="sr-only">Daftar sesi aktif untuk akun ini</caption>
                  <thead>
                    <tr>
                      {['Perangkat', 'IP', 'Dibuat', 'Kedaluwarsa', 'Status', 'Aksi'].map((h) => (
                        <th
                          key={h || 'aksi'}
                          scope="col"
                          className="type-label"
                          style={{
                            textAlign: 'left',
                            padding: '8px 10px',
                            background: 'var(--bg-surface-2)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(sessions.data ?? []).map((s) => (
                      <tr key={s.id} style={{ borderTop: '1px solid var(--border-default)' }}>
                        <td className="type-body" style={{ padding: '8px 10px' }}>
                          {deviceLabel(s.userAgent)}
                        </td>
                        <td className="type-small tnum" style={{ padding: '8px 10px', color: 'var(--text-secondary)' }}>
                          {s.ip ?? '-'}
                        </td>
                        <td className="type-small tnum" style={{ padding: '8px 10px' }}>
                          {fmtDateTime(s.createdAt)}
                        </td>
                        <td className="type-small tnum" style={{ padding: '8px 10px' }}>
                          {fmtDateTime(s.expiresAt)}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          {s.current ? (
                            <span
                              style={{
                                display: 'inline-flex',
                                padding: '2px 10px',
                                borderRadius: 'var(--radius-badge)',
                                background: 'var(--success-soft)',
                                color: 'var(--success)',
                                fontSize: 'var(--text-xs)',
                                fontWeight: 'var(--weight-semibold)',
                              }}
                            >
                              Sesi ini
                            </span>
                          ) : (
                            <span className="type-small" style={{ color: 'var(--text-muted)' }}>
                              Aktif
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                          {!s.current && (
                            <Button
                              variant="danger-ghost"
                              onClick={() => void revokeOne(s.id)}
                              disabled={revoking === s.id}
                              aria-label={`Cabut sesi ${deviceLabel(s.userAgent)}`}
                            >
                              {revoking === s.id ? 'Mencabut...' : 'Cabut'}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* ---------- Kartu Hak Akses ---------- */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <ShieldCheck size={16} aria-hidden style={{ color: 'var(--text-secondary)' }} />
            <h2 className="type-h2" style={{ margin: 0 }}>
              Hak Akses
            </h2>
            <Badge kind="Locked">Hanya Baca</Badge>
          </div>
          {groups.length === 0 ? (
            <p className="type-small" style={{ margin: 0, color: 'var(--text-muted)' }}>
              Belum ada izin akses yang terpetakan untuk akun ini. Hubungi administrator.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {groups.map((g) => (
                <div key={g.prefix}>
                  <div className="type-label" style={{ marginBottom: 4 }}>
                    {g.prefix}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {g.items.map((p) => (
                      <span
                        key={p}
                        className="type-small"
                        style={{
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-input)',
                          border: '1px solid var(--border-default)',
                          background: 'var(--bg-surface-2)',
                          color: 'var(--text-secondary)',
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 'var(--weight-medium)',
                        }}
                      >
                        {p.slice(g.prefix.length + 1)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ---------- Kartu Zona Berbahaya ---------- */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <AlertTriangle size={16} aria-hidden style={{ color: 'var(--danger)' }} />
            <h2 className="type-h2" style={{ margin: 0, color: 'var(--danger)' }}>
              Zona Berbahaya
            </h2>
          </div>
          <p className="type-small" style={{ margin: '0 0 12px', color: 'var(--text-secondary)' }}>
            Keluar dari akun ini di perangkat yang sedang dipakai. Sesi lain tetap aktif hingga kedaluwarsa.
          </p>
          <Button variant="secondary" onClick={() => setLogoutOpen(true)} disabled={loggingOut}>
            <LogOut size={15} aria-hidden /> Keluar dari akun
          </Button>
        </Card>
      </div>

      {/* ---------- Modal Edit Profil ---------- */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit Profil">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label htmlFor="profile-name" className="field-label">
              Nama
            </label>
            <input
              id="profile-name"
              style={inStyle()}
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              autoComplete="name"
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? 'profile-name-error' : undefined}
              disabled={savingProfile}
            />
            {nameError && (
              <p id="profile-name-error" role="alert" className="type-small" style={{ margin: '4px 0 0', color: 'var(--danger)' }}>
                {nameError}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="profile-email" className="field-label">
              Email
            </label>
            <input
              id="profile-email"
              type="email"
              style={inStyle()}
              value={formEmail}
              onChange={(e) => setFormEmail(e.target.value)}
              autoComplete="email"
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? 'profile-email-error' : undefined}
              disabled={savingProfile}
            />
            {emailError && (
              <p id="profile-email-error" role="alert" className="type-small" style={{ margin: '4px 0 0', color: 'var(--danger)' }}>
                {emailError}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={() => void saveProfile()} disabled={savingProfile}>
              {savingProfile ? 'Menyimpan...' : 'Simpan'}
            </Button>
            <Button variant="secondary" onClick={() => setEditOpen(false)} disabled={savingProfile}>
              Batal
            </Button>
          </div>
        </div>
      </Modal>

      {/* ---------- Modal Konfirmasi Cabut Semua Sesi Lain ---------- */}
      <Modal open={revokeAllOpen} onClose={() => setRevokeAllOpen(false)} title="Cabut semua sesi lain?">
        <p className="type-body" style={{ margin: 0 }}>
          {otherSessions.length} sesi selain perangkat ini akan langsung keluar. Sesi yang sedang Anda pakai tetap aktif.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button onClick={() => void revokeOthers()} disabled={revokingAll}>
            {revokingAll ? 'Mencabut...' : 'Ya, cabut semua'}
          </Button>
          <Button variant="secondary" onClick={() => setRevokeAllOpen(false)} disabled={revokingAll}>
            Batal
          </Button>
        </div>
      </Modal>

      {/* ---------- Modal Konfirmasi Logout ---------- */}
      <Modal open={logoutOpen} onClose={() => setLogoutOpen(false)} title="Keluar dari akun?">
        <p className="type-body" style={{ margin: 0 }}>
          Anda akan diarahkan ke halaman login. Sesi lain di perangkat berbeda tidak terpengaruh.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button onClick={() => void logout()} disabled={loggingOut}>
            <LogOut size={15} aria-hidden /> {loggingOut ? 'Keluar...' : 'Keluar'}
          </Button>
          <Button variant="secondary" onClick={() => setLogoutOpen(false)} disabled={loggingOut}>
            Batal
          </Button>
        </div>
      </Modal>
    </div>
  );
}
