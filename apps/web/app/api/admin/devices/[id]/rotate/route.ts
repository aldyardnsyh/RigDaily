/**
 * POST /api/admin/devices/[id]/rotate - rotasi API key device (P0-5).
 *
 * Butuh `master:manage`. Key lama langsung tidak berlaku (hash ditimpa), key
 * baru dikembalikan SEKALI di respons ini dan tidak bisa dibaca lagi.
 * Audit hanya mencatat aksi - API key tidak pernah masuk audit log.
 */
import { ApiError, fail, getClientIp, ok } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { listSyncDevices, rotateDeviceApiKey } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const actor = await requirePermission('master:manage');

    const device = (await listSyncDevices()).find((d) => d.id === params.id);
    if (!device) {
      throw new ApiError(404, 'DEVICE_NOT_FOUND', `Device ${params.id} tidak ditemukan.`);
    }

    const { apiKey } = await rotateDeviceApiKey(params.id);

    await recordAudit({
      entity: 'sync_device',
      entityId: params.id,
      action: 'rotate_key',
      actor,
      ip: getClientIp(req),
      newJson: { deviceId: device.deviceId, rotatedAt: new Date().toISOString() },
    });

    return ok({ id: params.id, deviceId: device.deviceId, apiKey });
  } catch (err) {
    return fail(err);
  }
}
