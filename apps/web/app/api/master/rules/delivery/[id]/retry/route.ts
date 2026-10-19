/**
 * POST /api/master/rules/delivery/[id]/retry
 *
 * Kirim ulang SATU baris Delivery Log (`delivery_log`). Dipakai tombol
 * "Kirim ulang" di `/reports` untuk baris berstatus `queued` atau `failed`.
 *
 * Butuh `report:distribute` (sama dengan menjalankan distribusi).
 * Audit `delivery_retry` mencatat id baris + status hasil, sehingga siapa
 * mengirim ulang apa bisa ditelusuri.
 *
 * Respons: `{ data: { status: 'sent' | 'queued' | 'failed', message? } }`
 * 404 bila baris tidak ada. Mode queue-only (SMTP belum diatur) tidak
 * menghasilkan error - status tetap `queued` + pesan penjelasan.
 */
import { ApiError, fail, getClientIp, ok } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { retryDeliveryLog } from '@/lib/reports/distributor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const user = await requirePermission('report:distribute');

    const id = decodeURIComponent(params.id ?? '').trim();
    if (!id) throw new ApiError(400, 'INVALID_ID', 'id Delivery Log wajib diisi.');

    let result;
    try {
      result = await retryDeliveryLog(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('tidak ditemukan')) {
        throw new ApiError(404, 'DELIVERY_NOT_FOUND', `Baris Delivery Log ${id} tidak ditemukan.`);
      }
      throw err;
    }

    await recordAudit({
      entity: 'delivery_log',
      entityId: id,
      action: 'delivery_retry',
      actor: user,
      ip: getClientIp(req),
      newJson: { status: result.status, message: result.message ?? null },
    });

    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
