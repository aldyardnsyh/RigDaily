'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, Check, CircleHelp, Download, Info, LockKeyhole, Monitor, RefreshCw } from 'lucide-react';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, ROLES, type DemoAccount } from '@rigdaily/shared';
import { BrandMark } from '@rigdaily/ui';
import { toast } from 'sonner';
import { ApiClientError, apiSend } from '@/lib/api-client';
import { useLocalIp } from '@/lib/hooks/useLocalIp';
import { describeIp } from '@/lib/ip';

type LoginDevice = {
  deviceId: string;
  name: string;
  lastSeenAt: string | null;
  pendingCount: number;
};

type LoginActivityEvent = {
  at: string;
  action: 'login' | 'logout';
  name: string;
  initials: string;
  maskedEmail: string;
  ip: string;
  network: string;
  terminal: string | null;
};

type LoginActivity = { events: LoginActivityEvent[]; activeSessions: number; windowDays: number };

type LoginInfo = {
  organization: { name: string; type: string };
  counts: { rigs: number; wells: number; users: number; reports: number };
  ready: boolean;
  demo: boolean;
  devices: LoginDevice[];
};
type SystemContext = {
  ip: string;
  clientIp: string;
  network: string;
  terminal: string;
  userAgent: string | null;
  browser: string;
  platform: string;
  device: string;
  time: { iso: string; epochMs: number; timeZone: string; localDate: string; localTime: string };
  connection: { database: boolean; status: 'online' | 'degraded' };
  appVersion: string;
};

type LoginResponse = { user: { name: string; email: string }; expiresAt: string };

/**
 * Marka produk memakai BrandMark bersama (komponen yang sama dipakai sidebar
 * dashboard, landing page, dan favicon). Sebelumnya halaman ini menampilkan
 * karakter "$" sehingga ikon login tidak sama dengan ikon di tab browser.
 *
 * `className` sengaja dipertahankan agar aturan ukuran responsif di globals.css
 * (mode layar pendek) tetap berlaku: CSS menimpa atribut width/height SVG.
 */
function RigMark({ small = false }: { small?: boolean }) {
  return (
    <BrandMark
      size={small ? 40 : 54}
      className={small ? 'auth-mark auth-mark-small' : 'auth-mark'}
    />
  );
}

/** `?next=` hanya boleh path internal (`/foo`) supaya tidak jadi open redirect. */
function safeNext(raw: string | null): string {
  if (!raw) return '/dashboard';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  return raw;
}

/** 429 → "Terlalu banyak percobaan, coba lagi dalam X menit." */
function rateLimitMessage(err: ApiClientError): string {
  const details = err.details as { retryAfterSec?: unknown } | undefined;
  const seconds = typeof details?.retryAfterSec === 'number' ? details.retryAfterSec : null;
  if (seconds !== null && seconds > 0) {
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    return `Terlalu banyak percobaan masuk. Coba lagi dalam ${minutes} menit.`;
  }
  return 'Terlalu banyak percobaan masuk. Tunggu beberapa menit lalu coba lagi.';
}

function LoginForm() {
  const params = useSearchParams();
  const next = safeNext(params?.get('next') ?? null);

  /*
   * Alasan pengguna sampai di halaman login, supaya pesannya tepat:
   *   expired   -> sesi berakhir / cookie tidak valid (layout mengalihkan)
   *   loggedOut -> keluar secara sengaja
   * Selain itu: kunjungan biasa.
   */
  const reason = params?.get('expired')
    ? ('expired' as const)
    : params?.get('reset')
      ? ('reset' as const)
      : params?.get('loggedOut')
        ? ('loggedOut' as const)
        : null;

  /*
   * Bersihkan cache data di memori setiap kali halaman login dibuka.
   * Ini mencegah sisa data sesi sebelumnya (profil, daftar sumur, laporan)
   * ikut tampil setelah login dengan akun berbeda.
   */
  useEffect(() => {
    let cancelled = false;
    import('@/lib/data-cache')
      .then((m) => {
        if (!cancelled) m.clearAll();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [clock, setClock] = useState('--:--:--');
  const [syncStatus, setSyncStatus] = useState('Menunggu masuk');
  const [loginInfo, setLoginInfo] = useState<LoginInfo | null>(null);
  const [activity, setActivity] = useState<LoginActivity | null>(null);

  /*
   * Tombol "Coba mode demo" di landing page mengarah ke /login?demo=1.
   * Ketika parameter itu ada dan instalasi memang mengaktifkan demo, kita
   * langsung masuk sebagai Administrator supaya pengunjung tidak perlu memilih
   * peran dulu. Penjaga `autoDemoStarted` mencegah pemanggilan ganda (React
   * Strict Mode menjalankan effect dua kali saat pengembangan).
   */
  const demoRequested = params?.get('demo') === '1';
  const autoDemoStarted = useRef(false);

  /*
   * Konteks perangkat & waktu dari SERVER.
   * Menggantikan nilai statis "LAN 10.142.8.204" dan jam UTC perangkat.
   * Semua yang tampil berasal dari /api/system/context (IP nyata klien,
   * identitas terminal turunan IP + user agent, waktu server, status DB).
   */
  const [ctx, setCtx] = useState<SystemContext | null>(null);
  const [ctxError, setCtxError] = useState<string | null>(null);

  /*
   * IP komputer pengguna.
   *
   * Server hanya melihat loopback (`::1`) ketika aplikasi diakses dari mesin
   * yang sama. Peramban bisa melaporkan IPv4 lokalnya lewat WebRTC sehingga
   * yang ditampilkan benar-benar alamat komputer, bukan `::1`.
   * Bila peramban memblokir, `localIp` null dan kita pakai IP dari server.
   */
  const localIp = useLocalIp(true);
  const ipInfo = ctx ? describeIp(ctx.ip, localIp) : null;

  useEffect(() => {
    let alive = true;
    let offsetMs = 0;

    fetch('/api/system/login-activity', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body: { data: LoginActivity }) => {
        if (alive) setActivity(body.data);
      })
      .catch(() => undefined);

    /*
     * Konteks perangkat dibatasi 6 detik. Tanpa timeout, bila API lambat
     * (DB dingin, jaringan rig lemot), header macet selamanya di
     * "mendeteksi..." / "MEMUAT --:--:--" dan pengguna mengira halaman rusak.
     * Bila timeout: tampilkan fallback yang jujur + tombol muat ulang.
     */
    const ctxController = new AbortController();
    const ctxTimer = setTimeout(() => ctxController.abort(), 6000);

    fetch('/api/system/login-info', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body: { data: LoginInfo }) => {
        if (alive) setLoginInfo(body.data);
      })
      .catch(() => undefined);

    fetch('/api/system/context', { cache: 'no-store', signal: ctxController.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body: { data: SystemContext }) => {
        if (!alive) return;
        clearTimeout(ctxTimer);
        offsetMs = body.data.time.epochMs - Date.now();
        setCtx(body.data);
        setCtxError(null);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        clearTimeout(ctxTimer);
        // AbortError = timeout: bedakan pesannya supaya jelas bukan DB rusak.
        const aborted = e instanceof Error && e.name === 'AbortError';
        setCtxError(aborted ? 'timeout' : e instanceof Error ? e.message : 'gagal');
      });

    // Jam berjalan mengikuti offset server (bukan jam perangkat).
    const tick = () => {
      const now = new Date(Date.now() + offsetMs);
      setClock(now.toISOString().slice(11, 19));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
      clearTimeout(ctxTimer);
      ctxController.abort();
    };
  }, []);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    if (busy || demoBusy) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail.includes('@')) {
      setErr('Email belum valid. Masukkan alamat email lengkap, mis. nama@perusahaan.co.id.');
      return;
    }
    if (pass.length < 8) {
      setErr('Kata sandi minimal 8 karakter.');
      return;
    }

    setErr(null);
    setBusy(true);
    try {
      await apiSend<LoginResponse>('/api/auth/login', 'POST', {
        email: trimmedEmail,
        password: pass,
      });
      try {
        localStorage.setItem('rigdaily.keep', keep ? '1' : '0');
      } catch {
        /* storage bisa diblokir browser - tidak fatal. */
      }
      setSyncStatus('Terverifikasi');
      toast.success('Berhasil masuk. Mengalihkan ke dashboard...');
      window.location.assign(next);
    } catch (cause) {
      if (cause instanceof ApiClientError) {
        if (cause.status === 401) setErr('Email atau kata sandi salah. Periksa lalu coba lagi.');
        else if (cause.status === 429) setErr(rateLimitMessage(cause));
        else setErr(cause.message);
      } else {
        setErr('Tidak dapat menghubungi server. Periksa koneksi jaringan lalu coba lagi.');
      }
      setBusy(false);
    }
  }

  function fillDemoCredentials() {
    const admin = DEMO_ACCOUNTS.find((account) => account.role === 'Admin') ?? DEMO_ACCOUNTS[0];
    setEmail(admin.email);
    setPass(DEMO_PASSWORD);
    setErr(null);
  }

  /**
   * Masuk cepat mode demo. Server membuat sesi JWT tanpa password; tombol ini
   * hanya muncul saat /api/system/login-info melaporkan `demo: true`.
   */
  async function demoSignIn(account: DemoAccount) {
    if (busy || demoBusy) return;
    setErr(null);
    setDemoBusy(account.email);
    try {
      await apiSend<LoginResponse>('/api/auth/demo-login', 'POST', { email: account.email });
      try {
        localStorage.setItem('rigdaily.keep', '1');
      } catch {
        /* storage bisa diblokir browser - tidak fatal. */
      }
      toast.success(`Masuk sebagai ${ROLES[account.role].label}. Mengalihkan...`);
      window.location.assign(next);
    } catch (cause) {
      if (cause instanceof ApiClientError) {
        setErr(cause.status === 404 ? 'Akun demo tidak tersedia di instalasi ini.' : cause.message);
      } else {
        setErr('Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.');
      }
      setDemoBusy(null);
    }
  }

  /*
   * Pintu masuk mode demo dari landing page: /login?demo=1.
   * Dijalankan sekali setelah /api/system/login-info memastikan demo aktif.
   * Bila demo tidak aktif, tidak ada yang terjadi dan pengunjung tetap melihat
   * form login biasa beserta catatan bahwa demo tidak tersedia.
   */
  useEffect(() => {
    if (!demoRequested || autoDemoStarted.current) return;
    if (!loginInfo?.demo) return;
    autoDemoStarted.current = true;
    const admin = DEMO_ACCOUNTS.find((account) => account.role === 'Admin') ?? DEMO_ACCOUNTS[0];
    void demoSignIn(admin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoRequested, loginInfo]);

  function syncNow() {
    setSyncStatus('Menyinkronkan');
    const toastId = toast.loading('Memeriksa status perangkat');
    /*
     * Tombol ini hanya MENYEGARKAN data perangkat dari server.
     * Tidak ada lagi entri transaksi palsu: daftar perangkat berasal dari
     * /api/system/login-info sehingga statusnya nyata.
     */
    fetch('/api/system/login-info', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body: { data: LoginInfo }) => {
        setLoginInfo(body.data);
        setSyncStatus('Baru saja diperbarui');
        toast.success('Status perangkat diperbarui dari server.', { id: toastId });
      })
      .catch(() => {
        setSyncStatus('Gagal memuat');
        toast.error('Tidak dapat menghubungi server. Periksa koneksi.', { id: toastId });
      });
  }

  return (
    <div className="auth-page">
      <header className="auth-topbar">
        <div className="auth-brandline">
          <RigMark small />
          <strong className="auth-brand">RigDaily</strong>
          <span className="auth-internal">OPERASIONAL INTERNAL</span>
          <span className="auth-divider" aria-hidden />
          <span className="auth-context">
            {loginInfo ? `${loginInfo.organization.name} - ${loginInfo.counts.rigs} rig, ${loginInfo.counts.wells} sumur` : 'Mendeteksi instalasi...'}
          </span>
        </div>
        <div className="auth-top-status tnum">
          <span
            className="auth-lan"
            title={
              ipInfo
                ? `${ipInfo.network}. IP dilihat dari ${ipInfo.source === 'browser' ? 'peramban' : 'server'}. UA: ${ctx?.userAgent ?? '-'}`
                : 'Mendeteksi jaringan'
            }
          >
            <span
              className="auth-status-dot"
              style={{
                background: !ctx ? 'var(--text-muted)' : ctx.connection.database ? 'var(--success)' : 'var(--danger)',
              }}
            />
            {ipInfo ? ipInfo.ip : ctxError ? 'tidak terdeteksi' : 'mendeteksi...'}{' '}
            <strong>{!ctx ? (ctxError ? 'GAGAL MEMUAT' : 'MEMUAT') : ctx.connection.database ? 'TERHUBUNG' : 'DB TERGANGGU'}</strong>
          </span>
          <span>{ctx ? `${ctx.time.localTime} ${ctx.time.timeZone.replace('Asia/', 'WIB ')}` : ctxError ? '--:--:--' : '--:--:--'}</span>
          {ctxError && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              title={ctxError === 'timeout' ? 'Server terlalu lama menjawab (lebih dari 6 detik)' : `Gagal memuat info perangkat: ${ctxError}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                height: 28,
                padding: '0 10px',
                borderRadius: 'var(--radius-input)',
                border: '1px solid var(--border-default)',
                background: 'var(--bg-surface)',
                color: 'var(--text-secondary)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Coba lagi
            </button>
          )}
        </div>
      </header>

      <main className="auth-main">
        <div className="auth-intro">
          <div>
            <p className="auth-eyebrow">AKSES STASIUN &amp; TELEMETRI</p>
            <h1>Autentikasi Operator &amp; Sinkronisasi Lokal Rig</h1>
          </div>
          <div className="auth-terminal">
            <Monitor size={24} aria-hidden />
            <span style={{ minWidth: 0 }}>
              Terminal:{' '}
              <strong>
                {ctx
                  ? ctx.terminal
                  : ctxError
                    ? ctxError === 'timeout'
                      ? 'server tidak menjawab'
                      : 'info perangkat gagal dimuat'
                    : 'mendeteksi perangkat...'}
              </strong>
              {ctx ? (
                <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', fontWeight: 400 }}>
                  {ctx.device} / {ctx.platform} / {ctx.browser}
                  {ipInfo ? ` / ${ipInfo.network}` : ''}
                </span>
              ) : ctxError ? (
                <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', fontWeight: 400 }}>
                  {ctxError === 'timeout'
                    ? 'Respons server melebihi 6 detik. Periksa koneksi lalu tekan Coba lagi.'
                    : 'Klik Coba lagi di kanan atas untuk memuat ulang info perangkat.'}
                </span>
              ) : null}
            </span>
          </div>
        </div>

        <div className="auth-grid">
          <section className="auth-card auth-login-card" aria-labelledby="login-title">
            <div className="auth-product">
              <RigMark />
              <div>
                <h2>RigDaily Internal</h2>
                <p>Manajemen Operasi Lapangan</p>
              </div>
            </div>
            <div className="auth-section-intro">
              <h2 id="login-title">Masuk ke stasiun Anda</h2>
              <p>Gunakan kredensial kontraktor atau operator yang telah terdaftar.</p>
            </div>
            <div className="auth-rule" />

            {demoRequested && (
              <p className="auth-demo-entry" role="status">
                <Info size={16} aria-hidden style={{ flexShrink: 0 }} />
                <span>
                  {loginInfo?.demo
                    ? demoBusy
                      ? 'Menyiapkan mode demo sebagai Administrator...'
                      : 'Mode demo aktif. Memilih peran di bawah juga membuka data contoh.'
                    : loginInfo
                      ? 'Mode demo tidak aktif pada instalasi ini. Masuk dengan kredensial dari administrator.'
                      : 'Memeriksa ketersediaan mode demo...'}
                </span>
              </p>
            )}

            <form onSubmit={signIn} className="auth-form" noValidate>
              <label className="auth-label" htmlFor="login-email">
                EMAIL ATAU ID OPERATOR
              </label>
              <input
                id="login-email"
                className="auth-input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                autoFocus
                required
                aria-invalid={err !== null}
                aria-describedby={err ? 'login-error' : undefined}
              />
              <div className="auth-password-label">
                <label className="auth-label" htmlFor="login-pass">
                  KATA SANDI
                </label>
                <button
                  type="button"
                  className="auth-link"
                  onClick={() =>
                    toast.info('Hubungi administrator rig untuk mengatur ulang kredensial stasiun.')
                  }
                >
                  Lupa kata sandi?
                </button>
              </div>
              <input
                id="login-pass"
                className="auth-input"
                type="password"
                value={pass}
                onChange={(event) => setPass(event.target.value)}
                autoComplete="current-password"
                required
                aria-invalid={err !== null}
                aria-describedby={err ? 'login-error' : undefined}
              />
              <label className="auth-check">
                <input
                  type="checkbox"
                  checked={keep}
                  onChange={(event) => setKeep(event.target.checked)}
                />
                <span className="auth-check-box" aria-hidden>
                  <Check size={15} />
                </span>
                <span>Tetap masuk di stasiun ini selama shift 12 jam</span>
              </label>

              {loginInfo?.demo && (
                <section className="auth-demo" aria-labelledby="demo-title">
                  <div className="auth-demo-head">
                    <strong id="demo-title">MASUK CEPAT DEMO</strong>
                    <span className="tnum">TANPA KATA SANDI</span>
                  </div>
                  <p className="auth-demo-note">
                    Data contoh sudah terisi. Pilih peran untuk melihat menu dan hak aksesnya.
                  </p>
                  <div className="auth-demo-grid">
                    {DEMO_ACCOUNTS.map((account) => (
                      <button
                        key={account.email}
                        type="button"
                        className="auth-demo-item"
                        onClick={() => demoSignIn(account)}
                        disabled={busy || demoBusy !== null}
                        aria-busy={demoBusy === account.email}
                        title={account.focus}
                      >
                        <span className="auth-demo-role">{ROLES[account.role].label}</span>
                        <span className="auth-demo-name">
                          {demoBusy === account.email ? 'Menyiapkan...' : account.name}
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="auth-status-detail" style={{ margin: 0 }}>
                    Login manual: <strong>admin@rigdaily.local</strong> / <strong>{DEMO_PASSWORD}</strong>{' '}
                    <button type="button" className="auth-link" onClick={fillDemoCredentials}>
                      Isi otomatis
                    </button>
                  </p>
                </section>
              )}

              {err && (
                <p className="auth-error" role="alert" id="login-error">
                  {err}
                </p>
              )}

              {/* Penjelasan kenapa kembali ke halaman login. */}
              {!err && reason && (
                <p className="auth-offline-note" role="status" id="login-reason">
                  <Info size={16} aria-hidden style={{ flexShrink: 0 }} />
                  <span>
                    {reason === 'expired'
                      ? 'Sesi Anda berakhir atau tidak valid lagi. Silakan masuk kembali untuk melanjutkan.'
                      : reason === 'reset'
                        ? 'Data demo telah direset ke kondisi awal. Silakan masuk lagi dengan salah satu akun demo.'
                        : 'Anda telah keluar. Terima kasih, dan sampai jumpa di shift berikutnya.'}
                  </span>
                </p>
              )}

              <button className="auth-primary" type="submit" disabled={busy || demoBusy !== null} aria-busy={busy}>
                {busy ? (
                  'Sedang masuk...'
                ) : (
                  <>
                    Masuk <ArrowRight size={27} strokeWidth={1.8} aria-hidden />
                  </>
                )}
              </button>
            </form>

            <div className="auth-enterprise">
              <span /> <strong>KEAMANAN PERUSAHAAN</strong> <span />
            </div>
            <button
              className="auth-secondary"
              type="button"
              onClick={() =>
                toast.info('Masuk dengan SSO operator hanya tersedia saat rig terhubung ke VSAT.')
              }
            >
              <LockKeyhole size={24} strokeWidth={1.8} aria-hidden /> Masuk dengan SSO Operator
              (Azure AD / Okta)
            </button>
            <div className="auth-offline-note">
              <Info size={25} strokeWidth={1.7} aria-hidden />
              <span>
                Satellite disconnected? Cached field credentials allow full doghouse operation
                without active VSAT.
              </span>
            </div>
            <div className="auth-version tnum">
              <span>RigDaily Core</span>
              <span>v0.1.0</span>
            </div>
          </section>

          <section className="auth-card auth-sync-card" aria-labelledby="sync-title">
            <div className="auth-sync-heading">
              <div className="auth-sync-title">
                <span className="auth-status-dot" />
                <h2 id="sync-title">Status Sinkronisasi Rig</h2>
              </div>
              <div className="auth-device">
                <span>PERANGKAT TERDAFTAR</span>
                <strong className="tnum">RIG-12-LAPTOP</strong>
              </div>
            </div>
            <p className="auth-sync-description">
              Sinkronisasi dua arah antara basis data lokal doghouse dan server kantor.
            </p>
            <div className="auth-rule" />
            <div className="auth-status-grid">
              <div className="auth-status-card auth-status-healthy">
                <div className="auth-status-head">
                  <strong>STATUS SINKRONISASI</strong>
                  <span className="auth-status-badge">SEHAT</span>
                </div>
                <div className="auth-status-value">
                  <Check size={22} aria-hidden />
                  <strong className="tnum">{syncStatus}</strong>
                </div>
                <div className="auth-status-detail tnum">Data terakhir: mengikuti sinkronisasi terakhir yang tercatat di server</div>
              </div>
              <div className="auth-status-card auth-status-outbox">
                <div className="auth-status-head">
                  <strong>ANTREAN TERTUNDA</strong>
                  <span className="auth-outbox-badge">TERKONSILIASI</span>
                </div>
                <div className="auth-outbox-value tnum">
                  <strong>0</strong> records queued
                </div>
                <div className="auth-status-detail tnum">Cache lokal SQLite cocok 100%</div>
              </div>
            </div>
            <div className="auth-sync-actions">
              <button
                className="auth-sync-button"
                type="button"
                onClick={syncNow}
                disabled={syncStatus === 'Menyinkronkan'}
              >
                <RefreshCw size={24} aria-hidden /> Sinkronkan Sekarang
              </button>
              <button
                className="auth-export-button"
                type="button"
                onClick={() => toast.info('Paket ekspor USB sedang disiapkan untuk pengiriman data offline.')}
              >
                <Download size={24} aria-hidden /> Export USB Zip
              </button>
            </div>
            <div className="auth-history-heading">
              <strong>RIWAYAT SINKRONISASI (5 KEJADIAN TERAKHIR)</strong>
              <span className="tnum">Protokol: HTTPS / TLS 1.3</span>
            </div>
            <div className="auth-table-wrap">
              <table className="auth-history">
                <thead>
                  <tr>
                    <th>Waktu</th>
                    <th>Kejadian / Target</th>
                    <th>Perangkat</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(loginInfo?.devices ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
                        Belum ada perangkat terdaftar. Perangkat muncul setelah aplikasi desktop rig tersambung.
                      </td>
                    </tr>
                  ) : (
                    (loginInfo?.devices ?? []).map((d) => (
                      <tr key={d.deviceId}>
                        <td className="tnum">
                          {d.lastSeenAt
                            ? new Date(d.lastSeenAt).toLocaleTimeString('id-ID', {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                                timeZone: ctx?.time.timeZone ?? 'Asia/Jakarta',
                              })
                            : '-'}
                        </td>
                        <td>{d.name}</td>
                        <td className="tnum">{d.deviceId}</td>
                        <td>
                          <span className="auth-success-badge">
                            {d.pendingCount > 0 ? `${d.pendingCount} tertunda` : 'Tersinkron'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="auth-ledger-footer">
              <span className="tnum">Jadwal sinkron otomatis mengikuti pengaturan Reporter di server</span>
              <span>
                <CircleHelp size={14} aria-hidden />{' '}
                <Link href="/sync">Buka halaman sinkronisasi</Link>
              </span>
            </div>

            {/* ---- Log aktivitas akses (nyata dari audit_log) ---- */}
            <div className="auth-history-heading" style={{ marginTop: 20 }}>
              <strong>AKTIVITAS AKSES TERAKHIR</strong>
              <span className="tnum">
                {activity ? `${activity.activeSessions} sesi aktif / ${activity.windowDays} hari terakhir` : 'memuat...'}
              </span>
            </div>
            <div className="auth-table-wrap">
              <table className="auth-history">
                <thead>
                  <tr>
                    <th>Waktu</th>
                    <th>Pengguna</th>
                    <th>Alamat IP</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {!activity || activity.events.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
                        Belum ada aktivitas akses tercatat. Riwayat muncul setelah ada yang masuk atau keluar.
                      </td>
                    </tr>
                  ) : (
                    activity.events.map((e, i) => (
                      <tr key={`${e.at}-${i}`}>
                        <td className="tnum">
                          {new Date(e.at).toLocaleString('id-ID', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: ctx?.time.timeZone ?? 'Asia/Jakarta',
                          })}
                        </td>
                        <td title={e.maskedEmail}>
                          <span style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
                            <span
                              aria-hidden
                              style={{
                                display: 'inline-flex',
                                width: 22,
                                height: 22,
                                borderRadius: '50%',
                                background: 'var(--bg-sidebar)',
                                color: '#fff',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 10,
                                fontWeight: 700,
                                flex: '0 0 auto',
                              }}
                            >
                              {e.initials}
                            </span>
                            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {e.name}
                            </span>
                          </span>
                        </td>
                        <td className="tnum" title={e.network}>
                          {e.ip}
                        </td>
                        <td>
                          <span
                            className="auth-success-badge"
                            style={
                              e.action === 'logout'
                                ? { borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }
                                : undefined
                            }
                          >
                            {e.action === 'login' ? 'Masuk' : 'Keluar'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </main>
      <footer className="auth-footer">
        Dukungan internal: hubungi administrator sistem
        Terminal Doghouse <span aria-hidden>•</span> Hanya untuk Personel Berwenang{' '}
        <span aria-hidden>•</span> Standar IADC
      </footer>
    </div>
  );
}

function LoginFallback() {
  return (
    <div className="auth-page">
      <main className="auth-main">
        <p role="status" style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
          Memuat halaman login...
        </p>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}