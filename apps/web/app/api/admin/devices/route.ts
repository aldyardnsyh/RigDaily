/**
 * /api/admin/devices - kelola device sync + API key (P0-5).
 *
 * GET   → daftar device (`sync:read`)
 * POST  → buat device baru + API key sekali-tampil (`master:manage`)
 * PATCH ?id=<uuid> { active } → aktif/nonaktifkan device (`master:manage`)
 * DELETE ?id=<uuid> → soft delete + nonaktifkan device (`master:manage`)
 *
 * Keamanan: `apiKey` hanya di-hash (SHA-256) saat disimpan; plaintext hanya
 * dikembalikan pada respons POST dan tidak bisa dibaca ulang (rotasi lewat
 * /api/admin/devices/[id]/rotate). Setiap mutasi dicatat di audit log tanpa
 * menyertakan API key.
 */
import { z } from 'zod';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { queryToObject } from '@/lib/http-query';
import {
  createDeviceApiKey,
  getRigById,
  listSyncDevices,
  setDeviceActive,
  softDeleteDevice,
} from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEVICE_KINDS = ['electron', 'office', 'api'] as const;

const zCreate = z.object({
  deviceId: z
    .string()
    .trim()
    .min(3, 'deviceId minimal 3 karakter')
    .max(80, 'deviceId maksimal 80 karakter')
    .regex(/^[A-Za-z0-9._:-]+$/, 'deviceId hanya boleh huruf, angka, titik, dash, titik dua, underscore'),
  name: z.string().trim().min(1, 'Nama device wajib diisi').max(160),
  rigId: z.string().uuid('rigId harus UUID').nullable().optional(),
  kind: z.enum(DEVICE_KINDS).optional(),
});

const zPatchQuery = z.object({
  id: z.string().uuid('id harus UUID'),
});

const zPatch = z.object({
  active: z.boolean(),
});

export async function GET(): Promise<Response> {
  try {
    await requirePermission('sync:read');
    return ok(await listSyncDevices());
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const actor = await requirePermission('master:manage');
    const body = parseBody(zCreate, await readJson(req));

    if (body.rigId) {
      const rig = await getRigById(body.rigId);
      if (!rig) {
        throw new ApiError(422, 'RIG_NOT_FOUND', `Rig ${body.rigId} tidak ditemukan.`);
      }
    }

    const existing = await listSyncDevices();
    if (existing.some((d) => d.deviceId.toLowerCase() === body.deviceId.toLowerCase())) {
      throw new ApiError(409, 'DEVICE_EXISTS', `Device ID "${body.deviceId}" sudah terdaftar.`);
    }

    const created = await createDeviceApiKey({
      deviceId: body.deviceId,
      name: body.name,
      rigId: body.rigId ?? null,
      kind: body.kind ?? 'electron',
    });

    await recordAudit({
      entity: 'sync_device',
      entityId: created.id,
      action: 'create',
      actor,
      ip: getClientIp(req),
      // API key TIDAK ikut diaudit - hanya metadata device.
      newJson: { deviceId: body.deviceId, name: body.name, rigId: body.rigId ?? null, kind: body.kind ?? 'electron' },
    });

    return ok({ id: created.id, deviceId: body.deviceId, apiKey: created.apiKey }, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(req: Request): Promise<Response> {
  try {
    const actor = await requirePermission('master:manage');
    const { id } = parseBody(zPatchQuery, queryToObject(req.url));
    const body = parseBody(zPatch, await readJson(req));

    const before = (await listSyncDevices()).find((d) => d.id === id);
    if (!before) {
      throw new ApiError(404, 'DEVICE_NOT_FOUND', `Device ${id} tidak ditemukan.`);
    }

    await setDeviceActive(id, body.active);

    await recordAudit({
      entity: 'sync_device',
      entityId: id,
      action: body.active ? 'activate' : 'deactivate',
      actor,
      ip: getClientIp(req),
      oldJson: { active: before.active },
      newJson: { active: body.active },
    });

    return ok({ id, active: body.active });
  } catch (err) {
    return fail(err);
  }
}

/**
 * Soft delete device (`deletedAt` + `active=false`) agar API key lamanya tidak
 * bisa dipakai push lagi. Sesi device tidak disimpan di tabel `sessions`, jadi
 * cukup menonaktifkan baris `sync_devices`.
 */
export async function DELETE(req: Request): Promise<Response> {
  try {
    const actor = await requirePermission('master:manage');
    const { id } = parseBody(zPatchQuery, queryToObject(req.url));

    const removed = await softDeleteDevice(id);
    if (!removed) {
      throw new ApiError(404, 'DEVICE_NOT_FOUND', `Device ${id} tidak ditemukan.`);
    }

    await recordAudit({
      entity: 'sync_device',
      entityId: id,
      action: 'delete',
      actor,
      ip: getClientIp(req),
      // API key TIDAK ikut diaudit - hanya metadata device.
      oldJson: {
        deviceId: removed.deviceId,
        name: removed.name,
        rigId: removed.rigId,
        kind: removed.kind,
        active: removed.active,
      },
      newJson: { deleted: true, active: false },
    });

    return ok({ id, deleted: true });
  } catch (err) {
    return fail(err);
  }
}
