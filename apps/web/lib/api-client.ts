import { clearAll, invalidateMatching } from './data-cache';

/**
 * Klien API sisi browser.
 *
 * Kontrak respons (lihat lib/api-response.ts):
 *   sukses → `{ data: T }`
 *   error  → `{ error: { code, message, details? } }`
 *
 * Semua fungsi di sini mengembalikan `data` mentah atau melempar `ApiClientError`.
 * 401 → redirect ke `/login` (sesi habis); pemanggil tidak perlu menangani sendiri.
 */

export class ApiClientError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
    // Jaga prototype chain agar `instanceof` tetap bekerja (target ES2020).
    Object.setPrototypeOf(this, ApiClientError.prototype);
  }
}

type ErrorBody = { error?: { code?: string; message?: string; details?: unknown } };

/**
 * 401 -> sesi habis.
 *
 * Langkah yang WAJIB dilakukan sebelum pindah halaman:
 * 1. Buang seluruh cache memori. Tanpa ini, data milik sesi lama (profil,
 *    daftar sumur, laporan) masih tersimpan dan ikut tampil setelah login
 *    ulang sebagai pengguna lain - risiko kebocoran data antar role.
 * 2. Hapus cookie sesi dari sisi klien. Cookie HttpOnly tidak bisa dihapus
 *    lewat `document.cookie`, jadi server yang menghapusnya; di sini kita
 *    menyetel penanda agar middleware tidak menganggap sesi masih ada.
 * 3. Baru alihkan ke /login.
 */
function redirectToLogin(): void {
  if (typeof window === 'undefined') return;
  clearAll();
  if (window.location.pathname.startsWith('/login')) return;
  // Simpan tujuan agar bisa dilanjutkan setelah login.
  const next = window.location.pathname + window.location.search;
  const target = new URL('/login', window.location.origin);
  if (next && next !== '/' && !next.startsWith('/login')) target.searchParams.set('next', next);
  target.searchParams.set('expired', '1');
  window.location.replace(target.toString());
}

/** Inti fetch: baca body JSON, map `{ data }` / `{ error }`. */
async function request<T>(
  path: string,
  init: { method: string; body?: unknown },
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const hasBody = init.body !== undefined;
  if (hasBody) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method,
      credentials: 'same-origin',
      headers,
      body: hasBody ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    });
  } catch (cause) {
    throw new ApiClientError(0, 'NETWORK_ERROR', 'Tidak dapat menghubungi server. Periksa koneksi.', cause);
  }

  if (res.status === 401) {
    redirectToLogin();
    throw new ApiClientError(401, 'UNAUTHORIZED', 'Sesi berakhir. Silakan login kembali.');
  }

  // Beberapa endpoint (mis. DELETE 204) bisa tanpa body.
  const text = await res.text();
  let parsed: unknown = null;
  if (text.trim().length > 0) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new ApiClientError(res.status, 'INVALID_RESPONSE', 'Server mengembalikan respons non-JSON.', text);
    }
  }

  if (!res.ok) {
    const body = (parsed ?? {}) as ErrorBody;
    const code = body.error?.code ?? `HTTP_${res.status}`;
    const message = body.error?.message ?? 'Permintaan gagal diproses server.';
    throw new ApiClientError(res.status, code, message, body.error?.details);
  }

  // Sukses tanpa body → kembalikan objek kosong (tipe T dipilih pemanggil).
  if (parsed === null) return undefined as T;

  if (typeof parsed === 'object' && parsed !== null && 'data' in parsed) {
    return (parsed as { data: T }).data;
  }
  // Fallback: bila server mengembalikan payload mentah (seharusnya tidak terjadi).
  return parsed as T;
}

/** GET → `data`. */
export async function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' });
}

/** POST / PUT / PATCH / DELETE dengan body opsional → `data`. */

/*
 * INVALIDASI CACHE SETELAH MUTASI
 * Setiap POST/PUT/PATCH/DELETE berhasil berarti data di server berubah,
 * sehingga cache yang mungkin basi harus dibuang. Tanpa ini, halaman bisa
 * menampilkan angka lama setelah user menyimpan sesuatu.
 */
function invalidateAfterMutation(path: string): void {
  const seg = path.split("?")[0];
  // Selalu buang daftar/detail laporan, dashboard, dan agregat terkait.
  invalidateMatching(/^\/api\/reports/);
  invalidateMatching(/^\/api\/dashboard/);
  invalidateMatching(/^\/api\/billing/);
  invalidateMatching(/^\/api\/insights/);
  invalidateMatching(/^\/api\/audit/);
  invalidateMatching(/^\/api\/admin\//);
  invalidateMatching(/^\/api\/personnel/);
  invalidateMatching(/^\/api\/sync\//);
  // Master data: hanya bila yang berubah memang master.
  if (seg.startsWith("/api/wells") || seg.startsWith("/api/rigs") || seg.startsWith("/api/master")) {
    invalidateMatching(/^\/api\/wells/);
    invalidateMatching(/^\/api\/rigs/);
    invalidateMatching(/^\/api\/master/);
  }
  if (seg.startsWith("/api/auth")) {
    invalidateMatching(/^\/api\/auth/);
  }
}
export async function apiSend<T>(
  path: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<T> {
  const result = await request<T>(path, { method, body });
  // Data di server berubah: buang cache terkait agar UI tidak menampilkan angka lama.
  invalidateAfterMutation(path);
  return result;
}

/** URL absolut untuk `<a href>` / `window.open` (PDF, unduhan biner). */
export function apiUrl(path: string): string {
  if (typeof window === 'undefined') return path;
  return new URL(path, window.location.origin).toString();
}
