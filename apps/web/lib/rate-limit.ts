/**
 * Rate limiter in-memory (sliding window) - TANPA Redis.
 *
 * Target deploy: 1 instance Next.js di VPS 2 vCPU. Untuk multi-instance nanti
 * cukup ganti Map ini dengan tabel/Redis; signature tetap.
 *
 * Catatan: Map hidup per-proses. Di dev, HMR bisa membuat modul dievaluasi ulang,
 * jadi Map disimpan di globalThis supaya hitungan tidak reset tiap recompile.
 */
import 'server-only';

type Bucket = number[]; // timestamp (ms) percobaan yang masih di dalam window

const globalForRateLimit = globalThis as unknown as {
  __rigdailyRateLimitBuckets?: Map<string, Bucket>;
};

const buckets: Map<string, Bucket> = globalForRateLimit.__rigdailyRateLimitBuckets ?? new Map<string, Bucket>();
globalForRateLimit.__rigdailyRateLimitBuckets = buckets;

/** Batas jumlah key agar memori tidak tumbuh tanpa kendali (mis. serangan acak IP). */
const MAX_KEYS = 10_000;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Detik sampai kuota tersedia lagi (0 bila allowed). */
  retryAfterSec: number;
};

/** Buang key yang seluruh hit-nya sudah di luar window (lazy cleanup per panggilan). */
function prune(windowMs: number, now: number): void {
  const cutoff = now - windowMs;
  for (const [key, hits] of buckets) {
    if (hits.length === 0 || hits[hits.length - 1] <= cutoff) buckets.delete(key);
  }
}

/**
 * Catat satu percobaan untuk `key`.
 * `allowed=false` berarti permintaan ini DITOLAK dan tidak dihitung sebagai hit baru.
 */
export function rateLimit(key: string, opts: { limit: number; windowMs: number }): RateLimitResult {
  const { limit, windowMs } = opts;
  const now = Date.now();
  const windowStart = now - windowMs;

  const previous = buckets.get(key) ?? [];
  const hits = previous.filter((at) => at > windowStart);

  if (hits.length >= limit) {
    buckets.set(key, hits);
    const oldest = hits[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  hits.push(now);
  buckets.set(key, hits);

  if (buckets.size > MAX_KEYS) prune(windowMs, now);

  return { allowed: true, remaining: Math.max(0, limit - hits.length), retryAfterSec: 0 };
}

/** Reset bucket tertentu (dipakai test). */
export function resetRateLimit(key?: string): void {
  if (key === undefined) buckets.clear();
  else buckets.delete(key);
}
