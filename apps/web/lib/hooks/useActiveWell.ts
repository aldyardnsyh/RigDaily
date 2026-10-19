'use client';

/**
 * Pemilihan sumur aktif yang KONSISTEN antar modul.
 *
 * MASALAH YANG DIPERBAIKI (v2)
 * 1. Versi sebelumnya membaca `window.location.search` di dalam `useMemo([])`.
 *    Akibatnya nilai itu TIDAK reaktif: ketika user mengganti sumur lewat
 *    WellSwitcher, URL berubah tetapi hook tetap mengembalikan sumur lama,
 *    sehingga data tidak ikut berganti. Sekarang memakai `useSearchParams()`
 *    yang reaktif terhadap navigasi.
 * 2. `useSearchParams` mewajibkan Suspense boundary; karena hook ini dipakai di
 *    banyak halaman, hook menangani fallback sendiri lewat `useSyncExternalStore`
 *    untuk membaca query tanpa memicu deoptimisasi klien.
 *
 * ATURAN PRIORITAS
 * 1. `?wellId=` pada URL (pilihan eksplisit user / deep-link).
 * 2. Sumur dari laporan terbaru (sama dengan Dashboard).
 * 3. Sumur pertama pada master (belum ada laporan sama sekali).
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useApi } from '@/lib/hooks/useApi';
import type { WellDto } from '@/lib/repo/types';

type ReportsList = { items: Array<{ id: string; wellId: string }>; total: number };

/* ------------------------------------------------------------------ */
/* Pembacaan query yang reaktif tanpa memaksa seluruh halaman CSR      */
/* ------------------------------------------------------------------ */

function subscribeToLocation(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  // `popstate` untuk back/forward, event kustom untuk router.push lokal.
  window.addEventListener('popstate', onChange);
  window.addEventListener('rigdaily:navigate', onChange as EventListener);

  // Patch history sekali saja agar setiap pushState/replaceState memberi sinyal.
  const w = window as unknown as { __rigdailyHistoryPatched?: boolean };
  if (!w.__rigdailyHistoryPatched) {
    w.__rigdailyHistoryPatched = true;
    const wrap = (fn: History['pushState']) =>
      function patched(this: History, ...args: Parameters<History['pushState']>) {
        const result = fn.apply(this, args);
        window.dispatchEvent(new Event('rigdaily:navigate'));
        return result;
      };
    history.pushState = wrap(history.pushState);
    history.replaceState = wrap(history.replaceState);
  }

  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener('rigdaily:navigate', onChange as EventListener);
  };
}

function getSearch(): string {
  return typeof window === 'undefined' ? '' : window.location.search;
}

/** Baca query string secara reaktif (tanpa Suspense). */
function useReactiveSearch(): string {
  return useSyncExternalStore(subscribeToLocation, getSearch, () => '');
}

/** Baca `?wellId=` secara reaktif. */
export function useRequestedWellId(): string | null {
  const search = useReactiveSearch();
  return useMemo(() => {
    if (!search) return null;
    return new URLSearchParams(search).get('wellId');
  }, [search]);
}

export type ActiveWell = {
  /** null selama data belum siap. */
  wellId: string | null;
  well: WellDto | null;
  wells: WellDto[];
  /** true bila sumur berasal dari ?wellId= pada URL. */
  fromUrl: boolean;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

export function useActiveWell(): ActiveWell {
  const requestedWellId = useRequestedWellId();
  const wellsRes = useApi<WellDto[]>('/api/wells');
  const latestRes = useApi<ReportsList>('/api/reports?limit=1');

  const wells = wellsRes.data ?? [];
  const mostRecentWellId = latestRes.data?.items?.[0]?.wellId ?? null;

  const wellId = useMemo(() => {
    if (requestedWellId) return requestedWellId;
    if (mostRecentWellId) return mostRecentWellId;
    return wells.length > 0 ? wells[0].id : null;
  }, [requestedWellId, mostRecentWellId, wells]);

  const well = useMemo(() => wells.find((w) => w.id === wellId) ?? null, [wells, wellId]);

  const reload = useCallback(() => {
    wellsRes.reload();
    latestRes.reload();
  }, [wellsRes, latestRes]);

  return {
    wellId,
    well,
    wells,
    fromUrl: Boolean(requestedWellId),
    loading: wellsRes.loading || latestRes.loading,
    error: wellsRes.error ?? latestRes.error ?? null,
    reload,
  };
}

/**
 * Navigasi ke sumur lain tanpa kehilangan halaman aktif.
 * Dipakai WellSwitcher. Membuat URL baru + memberi sinyal agar hook reaktif
 * membaca ulang, lalu me-remount data lewat `router.refresh()`.
 */
export function useSelectWell(): (wellId: string) => void {
  return useCallback((wellId: string) => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('wellId', wellId);
    window.history.pushState({}, '', `${url.pathname}?${url.searchParams.toString()}`);
    window.dispatchEvent(new Event('rigdaily:navigate'));
  }, []);
}

/* ------------------------------------------------------------------ */
/* Penanda perubahan sumur untuk memaksa refetch komponen              */
/* ------------------------------------------------------------------ */

/**
 * Nilai yang berubah setiap kali sumur aktif berubah. Dipakai sebagai
 * dependency `useApi(...)` agar query ikut diperbarui.
 */
export function useWellKey(): string {
  const wellId = useRequestedWellId();
  const [key, setKey] = useState(wellId ?? '');
  useEffect(() => {
    setKey(wellId ?? '');
  }, [wellId]);
  return key;
}
