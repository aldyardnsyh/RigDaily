/**
 * POST /api/demo/reset
 *
 * Mengosongkan seluruh tabel instance ini lalu mengisi ulang data contoh.
 * Hanya aktif di mode demo. Tanpa parameter; pengguna harus sudah login.
 *
 * Catatan: pada Vercel reset hanya berlaku untuk instance yang melayani
 * request ini. Instance lain akan tetap memakai datanya sendiri sampai
 * didaur ulang - perilaku ini disengaja untuk demo in-memory.
 */
import { ApiError, fail, ok } from '@/lib/api-response';
import { clearSessionCookie, requireUser } from '@/lib/auth';
import { isDemoDatabase, isDemoMode, resetDemoData } from '@/lib/demo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  try {
    if (!isDemoMode()) {
      throw new ApiError(404, 'DEMO_DISABLED', 'Mode demo tidak aktif pada instalasi ini.');
    }

    if (!isDemoDatabase()) {
      throw new ApiError(
        409,
        'DEMO_RESET_UNSAFE',
        'Reset data demo hanya tersedia pada database in-memory, bukan PostgreSQL.',
      );
    }

    await requireUser();
    await resetDemoData();

    // Sesi lama menunjuk ke user hasil seed sebelumnya. Hapus cookie supaya
    // pengguna mendarat di /login (bukan langsung dialihkan ke dashboard oleh
    // layout auth) dan melihat konfirmasi reset.
    await clearSessionCookie();

    return ok({ ok: true, resetAt: new Date().toISOString() });
  } catch (err) {
    return fail(err);
  }
}
