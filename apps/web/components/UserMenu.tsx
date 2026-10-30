'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, KeyRound, LogOut, User } from 'lucide-react';
import { apiSend } from '@/lib/api-client';

/**
 * Menu profil di topbar kanan.
 *
 * Perilaku:
 *  - Klik tombol avatar → dropdown (`role="menu"`) membuka; fokus pindah ke item pertama.
 *  - Tutup saat: klik di luar, tombol Escape, memilih item, kehilangan fokus, atau
 *    dropdown ditutup karena navigasi. Panah Atas/Bawah memindah fokus antar item (roving focus).
 *  - "Keluar" memanggil POST /api/auth/logout lalu hard-redirect ke /login
 *    (full reload agar cache client di memori ikut bersih).
 *
 * Semua warna memakai token dari `packages/ui/tokens.css` - tanpa hex literal.
 */

export type UserMenuUser = { id: string; name: string; email: string; role: string };

/** Inisial 1-2 huruf dari nama; fallback ke inisial email. */
function initialsOf(name: string, email: string): string {
  const fromName = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
  if (fromName) return fromName;
  return (email[0] ?? '?').toUpperCase();
}

/** "RigClerk" → "Rig Clerk" untuk tampilan kecil; label panjang tetap di /profile. */
function humanRole(role: string): string {
  return role.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function UserMenu({ user }: { user: UserMenuUser | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  }, []);

  /* Tutup saat klik di luar area menu. */
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && wrapRef.current && !wrapRef.current.contains(target)) close(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [open, close]);

  /* Escape menutup + focus trap sederhana: Tab tidak keluar dari menu terlalu liar. */
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
      );
      if (items.length === 0) return;
      event.preventDefault();
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const idx = active ? items.indexOf(active) : -1;
      const next = event.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
      items[next]?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  /* Setelah terbuka: fokus ke item pertama supaya keyboard user langsung bisa jalan. */
  useEffect(() => {
    if (!open) return;
    const raf = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [open]);

  async function onLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setError(null);
    try {
      await apiSend<{ ok: boolean }>('/api/auth/logout', 'POST');
    } catch {
      /*
       * Bila server gagal (mis. jaringan putus), tetap lanjutkan keluar:
       * cookie akan ditolak server pada permintaan berikutnya, dan lebih
       * buruk membiarkan pengguna tetap di halaman dengan sesi setengah mati.
       */
    }
    /*
     * Bersihkan seluruh cache data di memori. Tanpa ini, setelah login
     * dengan akun lain, halaman bisa menampilkan data milik sesi sebelumnya.
     * `replace` (bukan `assign`) menghapus halaman dari riwayat sehingga
     * tombol Back tidak mengembalikan user ke dashboard terlindungi.
     */
    try {
      const { clearAll } = await import('@/lib/data-cache');
      clearAll();
    } catch {
      /* cache tidak tersedia: abaikan */
    }
    window.location.replace('/login?loggedOut=1');
  }

  function goProfile() {
    close(false);
    router.push('/profile');
  }

  function goPassword() {
    close(false);
    router.push('/profile#password');
  }

  const name = user?.name ?? 'Pengguna';
  const email = user?.email ?? 'Belum masuk';
  const role = user ? humanRole(user.role) : '-';
  const initials = user ? initialsOf(user.name, user.email) : 'RD';

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Menu akun ${name}`}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-[var(--radius-input)] px-1 py-1"
        style={{
          background: open ? 'var(--bg-surface-2)' : 'transparent',
          border: '1px solid transparent',
          cursor: 'pointer',
          fontFamily: 'inherit',
          color: 'var(--text-primary)',
        }}
      >
        <span
          aria-hidden
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--bg-sidebar)] text-[var(--text-on-dark)]"
          style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', flex: '0 0 auto' }}
        >
          {initials}
        </span>
        {/* Nama disembunyikan di bawah xl agar tidak bertabrakan dengan badge sync di layar sempit. */}
        <span className="hidden leading-tight min-[1440px]:block" style={{ textAlign: 'left' }}>
          <span className="block truncate" style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>
            {name}
          </span>
          <span className="block" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
            {role}
          </span>
        </span>
        <ChevronDown size={14} aria-hidden style={{ color: 'var(--text-secondary)', flex: '0 0 auto' }} />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Menu akun"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
          }}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 252,
            zIndex: 70,
            padding: 6,
            borderRadius: 'var(--radius-card)',
            border: '1px solid var(--border-default)',
            background: 'var(--bg-surface)',
            boxShadow: 'var(--shadow-pop)',
          }}
        >
          <div
            style={{
              padding: '8px 10px 10px',
              borderBottom: '1px solid var(--border-default)',
              marginBottom: 4,
            }}
          >
            <div style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-primary)' }}>
              {name}
            </div>
            <div
              className="truncate"
              style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}
              title={email}
            >
              {email}
            </div>
            <span
              style={{
                display: 'inline-flex',
                marginTop: 6,
                padding: '2px 8px',
                borderRadius: 'var(--radius-badge)',
                background: 'var(--accent-tonal)',
                color: 'var(--bg-sidebar)',
                fontSize: 'var(--text-xs)',
                fontWeight: 'var(--weight-semibold)',
              }}
            >
              {role}
            </span>
          </div>

          <MenuItem icon={<User size={15} aria-hidden />} onClick={goProfile}>
            Profil saya
          </MenuItem>
          <MenuItem icon={<KeyRound size={15} aria-hidden />} onClick={goPassword}>
            Ganti password
          </MenuItem>

          <div role="separator" style={{ height: 1, background: 'var(--border-default)', margin: '4px 0' }} />

          <MenuItem icon={<LogOut size={15} aria-hidden />} onClick={onLogout} disabled={loggingOut} danger>
            {loggingOut ? 'Keluar...' : 'Keluar'}
          </MenuItem>

          {error && (
            <p
              role="alert"
              style={{
                margin: '6px 6px 2px',
                padding: '6px 8px',
                borderRadius: 'var(--radius-input)',
                background: 'var(--danger-soft)',
                color: 'var(--danger-deep)',
                fontSize: 'var(--text-xs)',
              }}
            >
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  onClick,
  disabled,
  danger,
  children,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'flex',
        width: '100%',
        alignItems: 'center',
        gap: 8,
        minHeight: 36,
        padding: '0 10px',
        borderRadius: 'var(--radius-input)',
        border: 0,
        background: 'transparent',
        color: danger ? 'var(--danger)' : 'var(--text-primary)',
        fontFamily: 'inherit',
        fontSize: 'var(--text-base)',
        fontWeight: 'var(--weight-medium)',
        textAlign: 'left',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
      onMouseEnter={(event) => {
        if (disabled) return;
        event.currentTarget.style.background = danger ? 'var(--danger-soft)' : 'var(--bg-surface-2)';
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = 'transparent';
      }}
    >
      <span aria-hidden style={{ display: 'inline-flex', color: 'inherit', flex: '0 0 auto' }}>
        {icon}
      </span>
      {children}
    </button>
  );
}
