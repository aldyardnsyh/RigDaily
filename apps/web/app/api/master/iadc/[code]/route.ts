/**
 * PATCH /api/master/iadc/[code]
 *
 * Ubah satu kode IADC. Body (minimal satu):
 *   { name?, category?, productive?, subCodeRequired?, active?, nptDefault? }
 *
 * `num` dan `code` tidak bisa diubah (nomor resmi IADC = identitas baris).
 * Butuh `master:manage`. Setiap perubahan dicatat ke audit_log (old vs new)
 * supaya bisa ditelusuri saat angka NPT bulanan dipertanyakan.
 */
import { z } from 'zod';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { listIadcCodes, updateIadcCode } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Minimal satu field harus diisi - PATCH kosong tidak bermakna. */
const zIadcPatch = z
  .object({
    name: z.string().trim().min(1, 'Nama kode wajib diisi').max(200).optional(),
    category: z.string().trim().min(1, 'Kategori wajib diisi').max(40).optional(),
    productive: z.boolean().optional(),
    subCodeRequired: z.boolean().optional(),
    active: z.boolean().optional(),
    nptDefault: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.name !== undefined ||
      v.category !== undefined ||
      v.productive !== undefined ||
      v.subCodeRequired !== undefined ||
      v.active !== undefined ||
      v.nptDefault !== undefined,
    { message: 'Isi minimal satu dari: name, category, productive, subCodeRequired, active, nptDefault' },
  );

type IadcDto = {
  code: string;
  name: string;
  category: string;
  productive: boolean;
  subCodeRequired: boolean;
  active: boolean;
  nptDefault: boolean;
};

function snapshot(c: IadcDto): Record<string, unknown> {
  return {
    name: c.name,
    category: c.category,
    productive: c.productive,
    subCodeRequired: c.subCodeRequired,
    active: c.active,
    nptDefault: c.nptDefault,
  };
}

export async function PATCH(req: Request, ctx: { params: { code: string } }): Promise<Response> {
  try {
    const user = await requirePermission('master:manage');

    const code = decodeURIComponent(ctx.params.code ?? '').trim();
    if (!code) throw new ApiError(400, 'INVALID_CODE', 'Kode IADC wajib diisi.');

    const patch = parseBody(zIadcPatch, await readJson(req));

    const before = (await listIadcCodes()).find((c) => c.code === code);
    if (!before) throw new ApiError(404, 'NOT_FOUND', `Kode IADC "${code}" tidak ditemukan.`);

    await updateIadcCode(code, patch);

    const after = (await listIadcCodes()).find((c) => c.code === code);
    if (!after) throw new ApiError(404, 'NOT_FOUND', `Kode IADC "${code}" tidak ditemukan.`);

    await recordAudit({
      entity: 'iadc_code',
      entityId: code,
      action: 'update',
      actor: user,
      oldJson: snapshot(before),
      newJson: { ...snapshot(after), changed: Object.keys(patch) },
      ip: getClientIp(req),
      terminal: req.headers.get('user-agent')?.slice(0, 300) ?? null,
    });

    return ok(after);
  } catch (err) {
    return fail(err);
  }
}
