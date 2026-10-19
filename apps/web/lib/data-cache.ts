'use client';

/**
 * Klien data dengan cache, dedupe, dan revalidasi latar.
 *
 * MASALAH YANG DIPERBAIKI
 * Setiap halaman memanggil `useApi` untuk data yang sama (`/api/auth/me`,
 * `/api/wells`, `/api/reports?limit=1`). Pindah halaman = semua fetch diulang
 * dari nol, masing-masing menunggu jaringan + query database. Terasa berat dan
 * membebani server.
 *
 * STRATEGI BARU
 * 1. CACHE dalam memori (per sesi tab) dengan TTL.
 *    Arahkan ke data yang jarang berubah (master sumur/rig, profil) diberi TTL
 *    panjang; data operasional diberi TTL pendek.
 * 2. DEDUPE: bila 3 komponen meminta URL yang sama pada saat yang sama, hanya
 *    SATU permintaan jaringan yang dijalankan; sisanya menunggu promise yang
 *    sama.
 * 3. STALE-WHILE-REVALIDATE: data lama langsung ditampilkan (tanpa loading),
 *    lalu diperbarui di latar belakang. Halaman terasa instan.
 * 4. PREFETCH: halaman berikutnya bisa memanaskan cache sebelum diklik.
 * 5. INVALIDASI: setelah mutasi (POST/PATCH/DELETE), cache terkait dibuang
 *    agar data tidak basi.
 */

type CacheEntry = {
  data: unknown;
  /** Waktu data diambil (ms epoch). */
  at: number;
  /** TTL dalam ms; setelah lewat, data dianggap usang. */
  ttl: number;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

/** Subscriber supaya komponen ikut ter-update saat cache berubah. */
type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

/**
 * TTL per pola URL.
 * Data master jarang berubah -> TTL panjang. Data operasional -> pendek.
 */
const TTL_RULES: Array<{ test: RegExp; ttl: number }> = [
  { test: /^\/api\/auth\/me$/, ttl: 5 * 60_000 },
  { test: /^\/api\/wells$/, ttl: 5 * 60_000 },
  { test: /^\/api\/rigs$/, ttl: 5 * 60_000 },
  { test: /^\/api\/master\/iadc$/, ttl: 10 * 60_000 },
  { test: /^\/api\/master\/rate-cards/, ttl: 5 * 60_000 },
  { test: /^\/api\/master\/kpi$/, ttl: 5 * 60_000 },
  { test: /^\/api\/master\/rules/, ttl: 60_000 },
  { test: /^\/api\/system\/time/, ttl: 30_000 },
  { test: /^\/api\/system\/context/, ttl: 60_000 },
  { test: /^\/api\/system\/login-/, ttl: 30_000 },
  { test: /^\/api\/dashboard/, ttl: 30_000 },
  { test: /^\/api\/reports\?/, ttl: 20_000 },
  { test: /^\/api\/reports\/[^/]+$/, ttl: 20_000 },
  { test: /^\/api\/insights/, ttl: 60_000 },
  { test: /^\/api\/personnel/, ttl: 30_000 },
  { test: /^\/api\/sync\//, ttl: 15_000 },
  { test: /^\/api\/admin\//, ttl: 15_000 },
  { test: /^\/api\/billing/, ttl: 30_000 },
  { test: /^\/api\/audit/, ttl: 15_000 },
];

const DEFAULT_TTL = 20_000;

export function ttlFor(path: string): number {
  for (const rule of TTL_RULES) {
    if (rule.test.test(path)) return rule.ttl;
  }
  return DEFAULT_TTL;
}

function notify(path: string): void {
  const set = listeners.get(path);
  if (!set) return;
  for (const fn of set) fn();
}

function subscribe(path: string, fn: Listener): () => void {
  let set = listeners.get(path);
  if (!set) {
    set = new Set();
    listeners.set(path, set);
  }
  set.add(fn);
  return () => {
    set?.delete(fn);
    if (set && set.size === 0) listeners.delete(path);
  };
}

export type CacheState<T> = {
  data: T | null;
  /** true bila belum ada data sama sekali (bukan sekadar revalidasi). */
  stale: boolean;
  /** true bila ada permintaan jaringan berjalan untuk path ini. */
  fetching: boolean;
};

/** Baca snapshot cache (untuk useSyncExternalStore). */
export function getCacheSnapshot<T>(path: string): CacheState<T> {
  const entry = cache.get(path);
  return {
    data: entry ? (entry.data as T) : null,
    stale: !entry,
    fetching: inflight.has(path),
  };
}

/**
 * Baca data cache bila masih SEGAR. Mengembalikan undefined bila belum ada
 * atau sudah usang, sehingga pemanggil tahu harus menampilkan loading.
 */
export function peekCache<T>(path: string): T | undefined {
  const entry = cache.get(path);
  if (!entry) return undefined;
  if (Date.now() - entry.at >= entry.ttl) return undefined;
  return entry.data as T;
}
/** Tandai satu path usang sehingga fetch berikutnya mengambil data baru. */
export function invalidate(path: string): void {
  cache.delete(path);
  notify(path);
}

/** Tandai semua path yang cocok dengan pola. */
export function invalidateMatching(pattern: RegExp): void {
  const affected: string[] = [];
  for (const key of cache.keys()) {
    if (pattern.test(key)) {
      cache.delete(key);
      affected.push(key);
    }
  }
  for (const key of affected) notify(key);
}

/** Buang seluruh cache (mis. setelah logout). */
export function clearAll(): void {
  const keys = [...cache.keys()];
  cache.clear();
  inflight.clear();
  for (const key of keys) notify(key);
}

export type FetchOptions = {
  /** Paksa ambil ulang walau cache masih segar. */
  force?: boolean;
  /** Lewati cache sepenuhnya (data sensitif / waktu nyata). */
  noCache?: boolean;
};

/**
 * Ambil data dengan cache + dedupe.
 * Mengembalikan data; melempar error dari `apiGet`.
 */
export async function fetchCached<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const now = Date.now();
  const entry = cache.get(path);

  if (!opts.force && !opts.noCache && entry && now - entry.at < entry.ttl) {
    return entry.data as T;
  }

  // Dedupe: pakai permintaan yang sedang berjalan bila ada.
  const existing = inflight.get(path);
  if (existing && !opts.force) {
    return existing as Promise<T>;
  }

  const promise = (async () => {
    const { apiGet } = await import('@/lib/api-client');
    const data = await apiGet<T>(path);
    cache.set(path, { data, at: Date.now(), ttl: ttlFor(path) });
    notify(path);
    return data;
  })();

  inflight.set(path, promise as Promise<unknown>);
  notify(path);

  try {
    return await promise;
  } finally {
    inflight.delete(path);
    notify(path);
  }
}

/**
 * Panaskan cache untuk halaman yang akan dibuka.
 * Dipanggil saat hover/fokus tautan navigasi.
 */
export function prefetchPaths(paths: string[]): void {
  for (const p of paths) {
    const entry = cache.get(p);
    if (entry && Date.now() - entry.at < entry.ttl) continue;
    if (inflight.has(p)) continue;
    void fetchCached(p).catch(() => undefined);
  }
}

/** Ringkasan cache untuk debugging/observability. */
export function cacheStats(): { entries: number; inflight: number } {
  return { entries: cache.size, inflight: inflight.size };
}

/** Seed cache secara manual (mis. data hasil mutasi yang sudah diketahui). */
export function primeCache<T>(path: string, data: T): void {
  cache.set(path, { data, at: Date.now(), ttl: ttlFor(path) });
  notify(path);
}

export { subscribe as subscribeCache };
