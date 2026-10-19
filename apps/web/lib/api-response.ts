/**
 * Bentuk respons API - SATU pintu untuk sukses & error.
 *
 * Sukses : { data: T }
 * Error  : { error: { code, message, details? } }
 *
 * Semua route handler WAJIB memakai `ok()` / `fail()` supaya klien (web, Electron,
 * monitoring) melihat kontrak yang identik. Lihat docs/KONTRAK-FROZEN.md §7.
 */
import { NextResponse } from 'next/server';
import { pickClientIp } from './ip';
import type { ZodSchema } from 'zod';

/** Error terklasifikasi: status HTTP + kode mesin + pesan manusia. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    // Jaga prototype chain saat di-compile ke ES5/ES2020 (instanceof tetap bekerja).
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

/** Respons sukses standar: `{ data }`. */
export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  const res = NextResponse.json({ data }, init);
  /*
   * API selalu dinamis dan sering memuat data per pengguna. Tanpa header ini,
   * browser/Proxy bisa menyimpan respons lama sehingga setelah logout atau
   * ganti akun, UI masih menampilkan data sesi sebelumnya.
   */
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.headers.set('Pragma', 'no-cache');
  return res;
}

function isApiError(err: unknown): err is ApiError {
  return (
    err instanceof ApiError ||
    (typeof err === 'object' &&
      err !== null &&
      (err as { name?: unknown }).name === 'ApiError' &&
      typeof (err as { status?: unknown }).status === 'number')
  );
}

/** Ubah error apa pun menjadi respons JSON yang konsisten. */
export function fail(err: unknown): NextResponse {
  const noStore = (res: NextResponse): NextResponse => {
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.headers.set('Pragma', 'no-cache');
    return res;
  };

  if (isApiError(err)) {
    const body: { error: { code: string; message: string; details?: unknown } } = {
      error: { code: err.code, message: err.message },
    };
    if (err.details !== undefined) body.error.details = err.details;
    return noStore(NextResponse.json(body, { status: err.status }));
  }

  // Jangan bocorkan stack/SQL ke klien; cukup catat di server.
  console.error('[api] unhandled error:', err);
  return noStore(
    NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan pada server.' } },
      { status: 500 },
    ),
  );
}

/**
 * Validasi body dengan schema zod dari `@rigdaily/shared`.
 * Gagal → ApiError 400 berisi daftar issue (bukan throw mentah ZodError).
 */
export function parseBody<T>(schema: ZodSchema<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Data permintaan tidak valid.', result.error.issues);
  }
  return result.data;
}

/** Baca body JSON; body kosong / bukan JSON → ApiError 400. */
export async function readJson(req: Request): Promise<unknown> {
  let text: string;
  try {
    text = await req.text();
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Body permintaan tidak dapat dibaca.');
  }
  if (!text.trim()) {
    throw new ApiError(400, 'INVALID_JSON', 'Body permintaan kosong.');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Body permintaan bukan JSON yang valid.');
  }
}

/**
 * IP klien yang sudah dinormalisasi.
 *
 * Mengembalikan alamat IPv4 bila tersedia: `::ffff:192.168.1.5` menjadi
 * `192.168.1.5`, `::1` menjadi `127.0.0.1`. Tanpa normalisasi, halaman login
 * dan tabel sesi menampilkan `::1` yang tidak berarti bagi pengguna.
 */
export function getClientIp(req: Request): string {
  return pickClientIp(req.headers);
}
