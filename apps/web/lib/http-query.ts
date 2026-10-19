/**
 * Helper query-string untuk route handler GET.
 *
 * Kenapa dipisah dari route: hampir semua endpoint list butuh pola yang sama
 * (ambil `searchParams` → objek biasa → validasi zod). Satu implementasi
 * menghindari drift antar endpoint.
 */
import { ApiError } from './api-response';

/** Query string URL → objek `string` biasa (key terakhir menang bila duplikat). */
export function queryToObject(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    new URL(url).searchParams.forEach((value, key) => {
      out[key] = value;
    });
  } catch {
    throw new ApiError(400, 'INVALID_URL', 'URL permintaan tidak valid.');
  }
  return out;
}

/** Query param wajib: trim + tolak nilai kosong (400 bila tidak ada). */
export function requireQueryParam(req: Request, name: string): string {
  const value = new URL(req.url).searchParams.get(name);
  if (!value || value.trim().length === 0) {
    throw new ApiError(400, 'MISSING_QUERY', `Query parameter "${name}" wajib diisi.`);
  }
  return value.trim();
}
