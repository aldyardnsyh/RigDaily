/**
 * Middleware - gerbang pertama sebelum halaman dirender.
 *
 * MASALAH YANG DIPERBAIKI (v2)
 * Versi sebelumnya mengalihkan `/login` ke `/dashboard` hanya karena cookie
 * ADA. Cookie kedaluwarsa atau sisa logout yang gagal membuat browser terus
 * terlempar ke dashboard, lalu semua API membalas 401:
 *
 *   GET /api/auth/me       401
 *   GET /api/dashboard     401
 *   GET /dashboard         200   <-- halaman kosong, salah
 *
 * STRATEGI v2 (TIGA LAPIS)
 * 1. Middleware TIDAK PERNAH mengalihkan `/login` ke `/dashboard`.
 *    Halaman login selalu bisa dibuka. Bila sesi valid, server action di
 *    halaman login yang mengalihkan (lihat `app/(auth)/login/page.tsx`).
 *    Dengan begitu cookie rusak tidak pernah memerangkap pengguna.
 * 2. Middleware tetap mengalihkan halaman terlindungi ke `/login` bila cookie
 *    tidak ada, dan MENGHAPUS cookie kosong.
 * 3. Validasi sesungguhnya dilakukan server di `app/(app)/layout.tsx` lewat
 *    `getSessionUser()` (cek hash token, expiry, user aktif).
 */
import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'rigdaily_session';

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  const raw = req.cookies.get(SESSION_COOKIE);
  const value = raw?.value ?? '';
  const hasSession = value.length > 0;

  /*
   * HALAMAN LOGIN: selalu boleh dibuka.
   *
   * Tidak ada redirect ke dashboard di sini. Alasannya: middleware berjalan
   * di Edge dan tidak bisa memvalidasi sesi ke database. Bila ia mengalihkan
   * berdasarkan keberadaan cookie saja, cookie rusak akan memaksa pengguna
   * terjebak di dashboard yang seluruh datanya 401.
   *
   * Pengalihan "sudah login, tidak perlu login lagi" dilakukan di sisi server
   * oleh halaman login sendiri, yang BISA memvalidasi sesi.
   */
  if (pathname === '/login') {
    const res = NextResponse.next();
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res;
  }

  // Halaman terlindungi tanpa sesi -> /login dengan tujuan semula.
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    url.searchParams.set('expired', '1');
    const res = NextResponse.redirect(url);
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  const res = NextResponse.next();
  /*
   * Halaman terlindungi tidak boleh disimpan browser/cache.
   * Tanpa ini, tombol Back setelah logout bisa menampilkan dashboard.
   */
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.headers.set('Pragma', 'no-cache');
  return res;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|reports).*)'],
};
