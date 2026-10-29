import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';

/*
 * Halaman login butuh sesi (atau justru tidak boleh dikunjungi saat sudah
 * login), jadi tidak boleh terindeks mesin pencari. Aturan global di root
 * layout mengizinkan indeks, tetapi layout tersarang ini menimpanya.
 */
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

/**
 * Layout halaman autentikasi (login).
 *
 * DI SINI pengecekan "sudah login, jadi tidak perlu login lagi" dilakukan,
 * bukan di middleware.
 *
 * KENAPA
 * Middleware (Edge) hanya bisa melihat keberadaan cookie, bukan keabsahannya.
 * Bila middleware yang mengalihkan /login -> /dashboard, cookie kedaluwarsa
 * atau sisa logout akan memaksa pengguna terjebak di dashboard yang seluruh
 * datanya 401. Layout ini berjalan di Node runtime dan BISA memvalidasi sesi
 * ke database lewat `getSessionUser()`.
 *
 * Aturan:
 *  - Sesi VALID   -> alihkan ke /dashboard (pengguna tidak perlu login ulang).
 *  - Sesi TIDAK VALID (cookie rusak/kedaluwarsa) -> tetap tampilkan /login,
 *    dan cookie sisa dihapus oleh `getSessionUser()`.
 */
export const dynamic = 'force-dynamic';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (user) redirect('/dashboard');

  return <div style={{ background: 'var(--bg-login)', minHeight: '100vh' }}>{children}</div>;
}
