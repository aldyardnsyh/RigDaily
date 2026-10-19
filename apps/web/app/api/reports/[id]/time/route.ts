/**
 * PUT /api/reports/[id]/time - ganti SELURUH time breakdown satu DDR.
 *
 * Body: `{ rows: [{ start, end, iadcCode, iadcSubcode?, vendor?, nptFlag?, remarks? }] }`
 * (min 1, max 200 baris).
 *
 * VALIDASI WAJIB memakai `validateTimeBreakdown()` dari @rigdaily/shared dengan
 * `validCodes` = kode IADC aktif di master dan `subCodeRequired` = kode yang
 * wajib sub-code. Ada issue severity `error` → data TIDAK disimpan, balas
 * 422 `VALIDATION_FAILED` + `details: issues`.
 *
 * Hanya boleh saat status `draft` (setelah submit → amendment).
 */
import { z } from 'zod';
import { validateTimeBreakdown, zHm } from '@rigdaily/shared';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { getReportById, listIadcCodes, replaceTimeRows } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zRow = z.object({
  start: zHm,
  end: zHm,
  iadcCode: z.string().min(1).max(4),
  iadcSubcode: z.string().max(160).nullable().optional(),
  vendor: z.string().max(160).nullable().optional(),
  nptFlag: z.boolean().optional(),
  remarks: z.string().max(2000).nullable().optional(),
});

const zBody = z.object({
  rows: z.array(zRow).min(1, 'Minimal 1 baris waktu').max(200, 'Maksimal 200 baris waktu'),
});

export async function PUT(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const user = await requirePermission('time:edit');

    const report = await getReportById(params.id);
    if (!report) {
      throw new ApiError(404, 'REPORT_NOT_FOUND', `Laporan ${params.id} tidak ditemukan.`);
    }

    if (report.status !== 'draft') {
      throw new ApiError(
        409,
        'REPORT_LOCKED',
        'Laporan yang sudah submitted/approved hanya bisa diubah lewat amendment.',
      );
    }

    const body = parseBody(zBody, await readJson(req));

    // Master IADC: hanya kode aktif yang valid; kode bertanda subCodeRequired wajib
    // sub-code/remarks - aturannya milik shared, bukan duplikat di sini.
    const codes = await listIadcCodes();
    const validCodes = new Set(codes.filter((c) => c.active).map((c) => c.code));
    const subCodeRequired = new Set(codes.filter((c) => c.active && c.subCodeRequired).map((c) => c.code));

    const validation = validateTimeBreakdown(
      body.rows.map((r) => ({
        start: r.start,
        end: r.end,
        code: r.iadcCode,
        npt: r.nptFlag,
        remarks: r.remarks ?? undefined,
      })),
      { requireFull24h: true, validCodes, subCodeRequired },
    );

    const errors = validation.issues.filter((i) => i.severity === 'error');
    if (errors.length > 0) {
      // Tidak menyimpan apa pun - UI menampilkan daftar issue apa adanya.
      throw new ApiError(
        422,
        'VALIDATION_FAILED',
        `Time breakdown tidak valid: ${errors.length} error. Perbaiki sebelum menyimpan.`,
        validation.issues,
      );
    }

    await replaceTimeRows(
      params.id,
      body.rows.map((r) => ({
        start: r.start,
        end: r.end,
        iadcCode: r.iadcCode,
        iadcSubcode: r.iadcSubcode ?? null,
        vendor: r.vendor ?? null,
        nptFlag: r.nptFlag ?? false,
        remarks: r.remarks ?? null,
      })),
    );

    await recordAudit({
      entity: 'daily_report',
      entityId: params.id,
      action: 'replace_time',
      actor: user,
      ip: getClientIp(req),
      oldJson: {
        rows: report.timeRows.map((t) => ({
          start: t.start,
          end: t.end,
          iadcCode: t.iadcCode,
          iadcSubcode: t.iadcSubcode,
          nptFlag: t.nptFlag,
        })),
        totalMinutes: report.totalMinutes,
      },
      newJson: {
        rows: body.rows.map((r) => ({
          start: r.start,
          end: r.end,
          iadcCode: r.iadcCode,
          iadcSubcode: r.iadcSubcode ?? null,
          nptFlag: r.nptFlag ?? false,
        })),
        totalMinutes: validation.totalMinutes,
      },
    });

    return ok({ ok: true, totalMinutes: validation.totalMinutes });
  } catch (err) {
    return fail(err);
  }
}
