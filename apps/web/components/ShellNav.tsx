'use client';
import { usePathname } from 'next/navigation';
import { AppShell } from '@rigdaily/ui';
import { useApi } from '@/lib/hooks/useApi';
import { ROLES, type RoleId } from '@rigdaily/shared';
import { UserMenu } from './UserMenu';
import { ServerClock, WellSwitcher } from './TopbarControls';
import { SyncBadge } from './SyncBadge';
import { useNavPrefetch } from '@/lib/hooks/useNavPrefetch';

type MePayload = {
  user: { id: string; name: string; email: string; role: string } | null;
};

/**
 * Path URL -> id menu aktif (harus cocok dengan `NavItem.id` di NAV_GROUPS).
 *
 * Rute yang punya awalan sama tetap dipilih yang paling spesifik lebih dulu
 * (mis. `/reports` sebelum fallback) dan halaman di luar menu mengembalikan
 * string kosong supaya tidak ada item yang salah tersorot sebagai aktif.
 */
function activeFromPath(path: string): string {
  if (path === '/dashboard') return 'dashboard';
  if (path === '/cost' || path.startsWith('/cost/')) return 'cost';
  if (path.includes('/ddr')) return 'ddr';
  if (path.includes('/time')) return 'time';
  if (path.includes('/well-file')) return 'well-file';
  if (path.includes('/daily-ops')) return 'daily-ops';
  if (path.includes('/well-header')) return 'well-header';
  if (path.includes('/bits')) return 'bits';
  if (path.includes('/casing-cement')) return 'casing-cement';
  if (path.includes('/marine-mac')) return 'marine-mac';
  if (path.includes('/safety-survey')) return 'safety-survey';
  if (path.includes('/personnel')) return 'personnel';
  if (path.includes('/performance')) return 'performance';
  if (path.includes('/insights')) return 'insights';
  if (path.includes('/billing')) return 'billing';
  if (path.includes('/reports')) return 'reports';
  if (path.includes('/print')) return 'print';
  if (path.includes('/sync')) return 'sync';
  if (path.includes('/admin')) return 'admin';
  if (path.includes('/profile')) return 'profile';
  return '';
}

function roleLabel(role: string | null | undefined): string | undefined {
  if (!role) return undefined;
  return ROLES[role as RoleId]?.label ?? role.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function ShellNav({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? '/';
  // Data user nyata untuk topbar + dropdown profil. Bila gagal, AppShell memakai default.
  // Panaskan cache saat pengguna menyorot menu: pindah halaman terasa instan.
  useNavPrefetch();
  const me = useApi<MePayload>('/api/auth/me');
  const user = me.data?.user ?? null;

  return (
    <AppShell
      active={activeFromPath(path)}
      userName={user?.name}
      userRole={roleLabel(user?.role)}
      userMenu={<UserMenu user={user} />}
      /*
       * Sumur dan tanggal TIDAK lagi di-hardcode:
       * - WellSwitcher membaca master sumur & laporan terbaru, bisa diganti user.
       * - ServerClock memakai waktu server (bukan jam perangkat rig).
       */
      wellSwitcher={<WellSwitcher />}
      clock={<ServerClock />}
      syncBadge={<SyncBadge />}
    >
      {children}
    </AppShell>
  );
}
