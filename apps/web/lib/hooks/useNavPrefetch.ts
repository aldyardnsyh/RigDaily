'use client';

import { useEffect } from 'react';
import { prefetchPaths } from '@/lib/data-cache';

/**
 * Prefetch data halaman saat pengguna mengarahkan kursor ke tautan navigasi.
 *
 * KENAPA
 * Perpindahan halaman terasa lambat karena data baru diminta SETELAH halaman
 * dibuka. Dengan memanaskan cache saat hover/fokus (biasanya 200-600 ms
 * sebelum klik), halaman berikutnya langsung menampilkan data dari cache.
 *
 * Tidak membebani server: hanya berjalan bila tautan benar-benar disorot,
 * memakai dedupe cache, dan hasilnya dipakai ulang saat halaman dibuka.
 */

/** Peta rute -> endpoint yang dibutuhkan halaman tersebut. */
const ROUTE_DATA: Record<string, string[]> = {
  '/dashboard': ['/api/dashboard', '/api/reports?limit=1'],
  '/ddr': ['/api/reports?limit=1'],
  '/time': ['/api/reports?limit=1', '/api/master/iadc'],
  '/cost': ['/api/reports?limit=1', '/api/dashboard'],
  '/well-file': ['/api/reports?limit=1'],
  '/daily-ops': ['/api/reports?limit=1'],
  '/marine-mac': ['/api/reports?limit=1'],
  '/safety-survey': ['/api/reports?limit=1', '/api/incidents'],
  '/personnel': ['/api/personnel?limit=500'],
  '/insights': ['/api/insights'],
  '/performance': ['/api/dashboard', '/api/insights', '/api/reports?limit=50'],
  '/print': ['/api/reports?limit=50'],
  '/billing': ['/api/rigs', '/api/reports?limit=1'],
  '/reports': ['/api/reports?limit=50', '/api/master/rules'],
  '/sync': ['/api/sync/devices', '/api/sync/conflicts', '/api/master/rules'],
  '/admin': ['/api/admin/users', '/api/admin/audit?limit=50'],
  '/profile': ['/api/auth/me', '/api/auth/sessions'],
};

function pathsForHref(href: string): string[] {
  const base = href.split('?')[0];
  const own = ROUTE_DATA[base] ?? [];
  // Data bersama yang hampir semua halaman butuhkan.
  return ['/api/auth/me', '/api/wells', ...own];
}

/**
 * Pasang listener global untuk hover/fokus pada tautan sidebar.
 * Cukup dipasang sekali di layout aplikasi.
 */
export function useNavPrefetch(): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const warm = (target: EventTarget | null) => {
      const el = target instanceof Element ? target.closest('a[href]') : null;
      if (!el) return;
      const href = el.getAttribute('href');
      if (!href || !href.startsWith('/') || href.startsWith('//')) return;
      if (href.startsWith('/api/')) return;
      prefetchPaths(pathsForHref(href));
    };

    const onOver = (e: Event) => warm(e.target);
    const onFocus = (e: Event) => warm(e.target);

    /*
     * `pointerover` menangkap hover mouse dan sentuhan. `focusin` menangkap
     * navigasi keyboard sehingga pengguna keyboard juga mendapat manfaat.
     */
    document.addEventListener('pointerover', onOver, { passive: true });
    document.addEventListener('focusin', onFocus);

    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('focusin', onFocus);
    };
  }, []);
}
