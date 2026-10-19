/**
 * Validasi bersama untuk aturan distribusi (dipakai POST koleksi & PATCH [id]).
 *
 * `scheduleCron` harus cron 5 field (menit jam hari-bulan bulan hari-minggu) -
 * parser cron scheduler mengharapkan tepat 5 field, jadi input asal-asalan
 * harus ditolak di pintu API, bukan saat pengiriman email gagal.
 */
import { z } from 'zod';

/**
 * Satu field cron: `*`, angka (`5`), rentang (`1-5`), daftar (`1,3,5`),
 * atau langkah (`*`/rentang + `/n`). Cukup untuk menolak input asal-asalan
 * tanpa memasang parser cron penuh.
 */
const CRON_FIELD = String.raw`(?:\*|\d{1,2})(?:-\d{1,2})?(?:\/\d{1,2})?(?:,(?:\*|\d{1,2})(?:-\d{1,2})?(?:\/\d{1,2})?)*`;
const CRON_5_FIELDS = new RegExp(String.raw`^\s*${CRON_FIELD}\s+${CRON_FIELD}\s+${CRON_FIELD}\s+${CRON_FIELD}\s+${CRON_FIELD}\s*$`);

/** Cron 5 field, mis. `0 7 * * *`. */
export const zCron5 = z
  .string()
  .trim()
  .min(1, 'Cron wajib diisi')
  .max(60, 'Cron maksimal 60 karakter')
  .refine((v) => CRON_5_FIELDS.test(v), {
    message: 'Format cron harus 5 field, contoh "0 7 * * *" (menit jam hari-bulan bulan hari-minggu).',
  });

/** Daftar penerima: RoleId atau email langsung, maksimum 50 item. */
export const zRecipientGroup = z
  .array(z.string().trim().min(1, 'Penerima tidak boleh kosong').max(200, 'Penerima maksimal 200 karakter'))
  .max(50, 'Maksimal 50 penerima');
