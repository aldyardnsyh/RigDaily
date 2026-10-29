import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { clearSessionCookie, getSessionUser } from '@/lib/auth';
import { isDemoMode } from '@/lib/demo';
import { ShellNav } from '../../components/ShellNav';

/**
 * Layout area terautentikasi - GERBANG RBAC SESUNGGUHNYA.
 *
 * KENAPA DI SINI, BUKAN DI MIDDLEWARE
 * Middleware berjalan di Edge runtime yang tidak bisa mengakses PostgreSQL.
 * Ia hanya bisa melihat apakah cookie ADA, bukan apakah sesinya masih SAH.
 * Akibatnya cookie kedaluwarsa lolos, dashboard dirender, lalu semua API
 * membalas 401 ("GET /api/auth/me 401" berulang di log).
 *
 * Layout ini berjalan di Node runtime dan memanggil `getSessionUser()` yang
 * memvalidasi: hash token ada di `sessions`, `expiresAt` belum lewat, user
 * masih aktif dan belum dihapus.
 *
 * Bila tidak sah:
 *  1. cookie sisa DIHAPUS (agar tidak memicu 401 berulang),
 *  2. pengguna dialihkan ke /login dengan tujuan semula,
 *  3. halaman login tetap bisa dibuka (middleware tidak memblokir /login).
 */
export const dynamic = 'force-dynamic';
/** Bootstrap PGlite + seed butuh beberapa detik pada cold start. */
export const maxDuration = 60;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();

  if (!user) {
    // Bersihkan cookie rusak/kedaluwarsa supaya tidak dikirim lagi.
    await clearSessionCookie();

    let next = '/dashboard';
    try {
      const h = headers();
      const referer = h.get('referer');
      if (referer) {
        const url = new URL(referer);
        if (url.pathname && url.pathname !== '/login' && !url.pathname.startsWith('/api')) {
          next = url.pathname + (url.search || '');
        }
      }
    } catch {
      /* header tidak tersedia: tetap ke /dashboard */
    }

    redirect(`/login?next=${encodeURIComponent(next)}&expired=1`);
  }

  return (
    <ShellNav demo={isDemoMode()}>
      {children}
    </ShellNav>
  );
}
