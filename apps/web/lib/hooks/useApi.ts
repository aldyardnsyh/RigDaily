'use client';
/**
 * Hook data-fetching ringan di atas `api-client`.
 *
 * Kenapa bukan library (SWR/React Query): requirement meminta tanpa dependency
 * baru. Hook ini cukup untuk pola halaman DDR/Time/Cost: satu GET per resource,
 * reload manual setelah mutasi, dan abaikan update setelah unmount.
 *
 * Kontrak publik (lihat brief Agent UI-1):
 *   useApi<T>(path, deps)  → { data, loading, error, reload }
 *   useMutation<TIn,TOut>(fn) → { run, loading, error }
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClientError } from '@/lib/api-client';
import { fetchCached, peekCache } from '@/lib/data-cache';

export type UseApiResult<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

export type UseMutationResult<TInput, TOutput> = {
  /** Jalankan mutasi. Menelan error (kembalikan `null`) - pesan tersedia di `error`. */
  run: (input: TInput) => Promise<TOutput | null>;
  loading: boolean;
  error: string | null;
};

function messageOf(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Terjadi kesalahan tidak dikenal.';
}

/**
 * GET satu path.
 *
 * `path === null` → tidak fetch (dependency belum siap), `data` tetap `null`.
 * `deps` memaksa refetch (mis. setelah mutasi); bila tidak diisi, path berubah
 * otomatis memicu refetch karena masuk dependency array.
 *
 * Anti-infinite-loop: efekt bergantung pada `path`, `nonce` (dari `reload`) dan
 * `deps` dari pemanggil - pemanggil WAJIB memberi `deps` stabil (array literal
 * primitif). Update state diabaikan setelah unmount / request usang.
 */
export function useApi<T>(path: string | null, deps: unknown[] = []): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(path !== null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  /*
   * GLOBAL WELL VERSION
   *
   * Ketika user mengganti sumur di topbar, URL berubah tetapi banyak query
   * tidak menyertakan `wellId` di path (mis. `/api/reports?limit=1`). Tanpa
   * sinyal tambahan, data lama tetap tampil.
   *
   * Hook ini mendengarkan event `rigdaily:navigate` (dipancarkan
   * `useSelectWell`) lalu menaikkan `nonce` internal, sehingga SEMUA query
   * `useApi` otomatis refetch saat sumur aktif berubah.
   */
  const [wellVersion, setWellVersion] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const bump = () => setWellVersion((v) => v + 1);
    window.addEventListener('rigdaily:navigate', bump);
    return () => window.removeEventListener('rigdaily:navigate', bump);
  }, []);

  // Guard: jangan setState setelah unmount / setelah path berubah.
  const aliveRef = useRef(true);
  const seqRef = useRef(0);

  /*
   * `reload()` = paksa ambil ulang dari server, mengabaikan cache.
   * `forceRef` menandai efek berikutnya agar memakai `force: true`.
   */
  const forceRef = useRef(false);
  const reload = useCallback(() => {
    forceRef.current = true;
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    if (path === null) {
      setData(null);
      setLoading(false);
      setError(null);
      return () => {
        aliveRef.current = false;
      };
    }

    const seq = ++seqRef.current;

    /*
     * JALUR CEPAT CACHE
     * Bila data masih segar di memori, tampilkan langsung TANPA spinner.
     * Ini membuat perpindahan halaman terasa instan: data master (sumur,
     * rig, profil) tidak diambil ulang setiap pindah halaman.
     * Bila data usang, data lama tetap tampil sambil diperbarui di latar
     * (stale-while-revalidate) sehingga layar tidak berkedip.
     */
    const cached = peekCache<T>(path);
    if (cached !== undefined) {
      setData(cached);
      setLoading(false);
      setError(null);
    } else {
      setLoading(true);
      setError(null);
    }

    const force = forceRef.current;
    forceRef.current = false;

    fetchCached<T>(path, { force })
      .then((result) => {
        if (!aliveRef.current || seq !== seqRef.current) return;
        setData(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!aliveRef.current || seq !== seqRef.current) return;
        setError(messageOf(err));
        setLoading(false);
      });

    return () => {
      aliveRef.current = false;
    };
    // deps sengaja disebar dari pemanggil; path + nonce menjamin refetch yang benar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, wellVersion, ...deps]);

  return { data, loading, error, reload };
}

/**
 * Wrapper mutasi. `fn` mengembalikan Promise.
 *
 * `run()` TIDAK melempar error: hasil sukses dikembalikan, error ditelan menjadi
 * `null` dan pesannya disimpan di `error`. Pemanggil cukup mengecek `null` untuk
 * menampilkan toast. (Bila butuh details, pakai `apiSend` langsung lalu tangkap.)
 */
export function useMutation<TInput, TOutput>(
  fn: (input: TInput) => Promise<TOutput>,
): UseMutationResult<TInput, TOutput> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const run = useCallback(async (input: TInput): Promise<TOutput | null> => {
    setLoading(true);
    setError(null);
    try {
      const result = await fnRef.current(input);
      if (aliveRef.current) setLoading(false);
      return result;
    } catch (err) {
      if (aliveRef.current) {
        setError(messageOf(err));
        setLoading(false);
      }
      return null;
    }
  }, []);

  return { run, loading, error };
}
